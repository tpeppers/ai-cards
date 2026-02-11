import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BidWhistGame, BidWhistState } from '../games/BidWhistGame.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { StrategyAST } from '../strategy/types.ts';
import { GameState } from '../types/CardGame.ts';
import { cardToLetter } from '../urlGameState.js';
import PlayerArea from './PlayerArea.tsx';
import GameTable from './GameTable.tsx';
import TurnIndicator from './TurnIndicator.tsx';
import LastBook from './LastBook.tsx';

type ReplayPhase = 'loading' | 'bidding' | 'trumpSelection' | 'discarding' | 'play' | 'done';

interface ReplayConfig {
  deckUrl: string;
  dealer?: number;
  team0StrategyText: string;
  team0StrategyName: string;
  team1StrategyText: string;
  team1StrategyName: string;
}

const SPEED_OPTIONS = [
  { label: '0.5x', ms: 1600 },
  { label: '1x', ms: 800 },
  { label: '2x', ms: 400 },
  { label: '4x', ms: 200 },
];

const PLAYER_NAMES = ['South', 'East', 'North', 'West'];

const SUIT_SYMBOLS: { [k: string]: string } = {
  spades: '\u2660', hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663',
};

const ReplayPage: React.FC = () => {
  const gameRef = useRef<BidWhistGame | null>(null);
  const [strategies, setStrategies] = useState<(StrategyAST | null)[]>([null, null, null, null]);
  const [replayPhase, setReplayPhase] = useState<ReplayPhase>('loading');
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);
  const [stepIndex, setStepIndex] = useState(0);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [biddingState, setBiddingState] = useState<BidWhistState | null>(null);
  const [lastBook, setLastBook] = useState<{ playerId: number; card: any }[]>([]);
  const [config, setConfig] = useState<ReplayConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bidLog, setBidLog] = useState<{ player: string; action: string }[]>([]);
  const [trickPause, setTrickPause] = useState(false);
  const [trumpInfo, setTrumpInfo] = useState<string | null>(null);
  const [moveString, setMoveString] = useState('');
  const dealerRef = useRef<number>(0);

  // Load config from sessionStorage and URL hash
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('replay-config');
      if (!raw) {
        // Fallback: check URL hash for deck only
        const hash = window.location.hash.slice(1);
        if (hash && hash.length === 52) {
          setError('No strategy config found. Please open Replay from the Compare page.');
        } else {
          setError('No replay configuration found. Please open Replay from the Compare page.');
        }
        return;
      }

      const parsed: ReplayConfig = JSON.parse(raw);
      // Also use hash if present
      const hash = window.location.hash.slice(1);
      if (hash && hash.length === 52) {
        parsed.deckUrl = hash;
      }

      if (!parsed.deckUrl || parsed.deckUrl.length !== 52) {
        setError('Invalid deck URL. Please try again from the Compare page.');
        return;
      }

      setConfig(parsed);

      // Parse strategies
      const strats: (StrategyAST | null)[] = [null, null, null, null];
      if (parsed.team0StrategyText) {
        try {
          const ast = parseStrategy(parsed.team0StrategyText);
          strats[0] = ast; // South (player 0, team 0)
          strats[2] = ast; // North (player 2, team 0)
        } catch (e) {
          console.error('Failed to parse team 0 strategy:', e);
        }
      }
      if (parsed.team1StrategyText) {
        try {
          const ast = parseStrategy(parsed.team1StrategyText);
          strats[1] = ast; // East (player 1, team 1)
          strats[3] = ast; // West (player 3, team 1)
        } catch (e) {
          console.error('Failed to parse team 1 strategy:', e);
        }
      }
      setStrategies(strats);

      // Initialize game with dealer from config (matches simulator)
      const dealer = parsed.dealer ?? 0;
      const game = new BidWhistGame();
      game.setDealer(dealer);
      dealerRef.current = dealer;
      gameRef.current = game;
      game.dealCards(parsed.deckUrl);
      refreshState(game);
      setReplayPhase('bidding');
    } catch (e) {
      console.error('Failed to load replay config:', e);
      setError('Failed to load replay configuration.');
    }
  }, []);

  const refreshState = useCallback((game: BidWhistGame) => {
    setGameState(game.getGameState());
    setBiddingState(game.getBiddingState());
    setLastBook(game.getLastCompletedTrick());
  }, []);

  // Rebuild game from scratch, fast-replaying to the position encoded by targetMoves.
  // Each character in the string = one atomic step (bid digit, '!' trump, '#' discard, card letter).
  const rebuildFromMoves = useCallback((targetMoves: string) => {
    if (!config) return;

    const game = new BidWhistGame();
    // Restore the same dealer so bidding order is identical
    (game as any).dealer = dealerRef.current;
    game.dealCards(config.deckUrl);

    const newBidLog: { player: string; action: string }[] = [];
    let newTrumpInfo: string | null = null;
    let newPhase: ReplayPhase = 'bidding';

    for (let i = 0; i < targetMoves.length; i++) {
      const gs = game.getGameState();

      if (gs.gameStage === 'bidding') {
        const cp = gs.currentPlayer;
        if (cp === null) break;
        game.setStrategy(strategies[cp]);
        game.processAIBid(cp);

        const bs = game.getBiddingState();
        const lastBid = bs.bids[bs.bids.length - 1];
        if (lastBid) {
          const action = lastBid.passed
            ? 'Pass'
            : lastBid.amount === bs.currentHighBid && lastBid.playerId === bs.dealer && bs.bids.length === 4
              ? `Takes it (${lastBid.amount})`
              : `Bid ${lastBid.amount}`;
          newBidLog.push({ player: PLAYER_NAMES[lastBid.playerId], action });
        }

        const newGs = game.getGameState();
        if (newGs.gameStage === 'trumpSelection') {
          newPhase = 'trumpSelection';
        } else if (newGs.gameStage === 'deal' || (bs.allPlayersBid && bs.currentHighBidder === null)) {
          newPhase = 'done';
          newBidLog.push({ player: 'System', action: 'All passed \u2014 no contract' });
          break;
        }
      } else if (gs.gameStage === 'trumpSelection') {
        const declarer = game.getDeclarer();
        if (declarer === null) break;
        game.setStrategy(strategies[declarer]);
        game.processAITrumpSelection(declarer);

        const trump = game.getTrumpSuit();
        const dir = game.getBidDirection();
        if (trump) {
          const dirLabel = dir === 'uptown' ? 'Uptown' : dir === 'downtown' ? 'Downtown' : 'Downtown (No Aces)';
          newTrumpInfo = `${dirLabel} in ${SUIT_SYMBOLS[trump] || trump}`;
        }

        const newGs = game.getGameState();
        if (newGs.gameStage === 'play') newPhase = 'play';
        else if (newGs.gameStage === 'discarding') newPhase = 'discarding';
      } else if (gs.gameStage === 'discarding') {
        const declarer = game.getDeclarer();
        if (declarer === null) break;
        game.simulateAutoDiscard(declarer);
        newPhase = 'play';
      } else if (gs.gameStage === 'play') {
        const cp = gs.currentPlayer;
        if (cp === null) break;
        game.setStrategy(strategies[cp]);
        const card = game.getBestMove(cp);
        if (!card) { newPhase = 'done'; break; }
        game.playCard(cp, card);

        const newGs = game.getGameState();
        if (newGs.gameStage === 'scoring') { newPhase = 'done'; }
        else { newPhase = 'play'; }
      }
    }

    gameRef.current = game;
    setBidLog(newBidLog);
    setTrumpInfo(newTrumpInfo);
    setReplayPhase(newPhase);
    setLastBook(game.getLastCompletedTrick());
    setTrickPause(false);
    refreshState(game);
  }, [config, strategies, refreshState]);

  // Execute one step
  const executeStep = useCallback(() => {
    const game = gameRef.current;
    if (!game || replayPhase === 'loading' || replayPhase === 'done') return;
    if (trickPause) {
      setTrickPause(false);
      return;
    }

    const gs = game.getGameState();

    if (replayPhase === 'bidding') {
      const cp = gs.currentPlayer;
      if (cp === null) return;

      // Set strategy for current player
      game.setStrategy(strategies[cp]);
      game.processAIBid(cp);

      const bs = game.getBiddingState();
      const lastBid = bs.bids[bs.bids.length - 1];
      if (lastBid) {
        const action = lastBid.passed
          ? 'Pass'
          : lastBid.amount === bs.currentHighBid && lastBid.playerId === bs.dealer && bs.bids.length === 4
            ? `Takes it (${lastBid.amount})`
            : `Bid ${lastBid.amount}`;
        setBidLog(prev => [...prev, { player: PLAYER_NAMES[lastBid.playerId], action }]);
        // Encode bid: '0' for pass, '1'-'6' for bid amount
        setMoveString(prev => prev + String(lastBid.amount));
      }

      refreshState(game);
      const newGs = game.getGameState();

      // Check if bidding ended
      if (newGs.gameStage === 'trumpSelection') {
        setReplayPhase('trumpSelection');
      } else if (newGs.gameStage === 'bidding') {
        // Check if all passed (game may have auto-redealt)
        if (bs.allPlayersBid && bs.currentHighBidder === null) {
          setReplayPhase('done');
          setBidLog(prev => [...prev, { player: 'System', action: 'All passed \u2014 no contract' }]);
        }
      } else if (newGs.gameStage === 'deal') {
        // Everyone passed, game auto-started new hand
        setReplayPhase('done');
        setBidLog(prev => [...prev, { player: 'System', action: 'All passed \u2014 redealing' }]);
      }
    } else if (replayPhase === 'trumpSelection') {
      const declarer = game.getDeclarer();
      if (declarer === null) return;

      game.setStrategy(strategies[declarer]);
      game.processAITrumpSelection(declarer);
      refreshState(game);

      // Encode trump selection step
      setMoveString(prev => prev + '!');

      const newGs = game.getGameState();
      const trump = game.getTrumpSuit();
      const dir = game.getBidDirection();
      if (trump) {
        const dirLabel = dir === 'uptown' ? 'Uptown' : dir === 'downtown' ? 'Downtown' : 'Downtown (No Aces)';
        setTrumpInfo(`${dirLabel} in ${SUIT_SYMBOLS[trump] || trump}`);
      }

      if (newGs.gameStage === 'play') {
        // AI auto-discarded in setTrumpSuit
        setReplayPhase('play');
      } else if (newGs.gameStage === 'discarding') {
        setReplayPhase('discarding');
      }
    } else if (replayPhase === 'discarding') {
      const declarer = game.getDeclarer();
      if (declarer === null) return;

      game.simulateAutoDiscard(declarer);
      refreshState(game);
      // Encode discard step
      setMoveString(prev => prev + '#');
      setReplayPhase('play');
    } else if (replayPhase === 'play') {
      const cp = gs.currentPlayer;
      if (cp === null) return;

      game.setStrategy(strategies[cp]);
      const card = game.getBestMove(cp);
      if (!card) {
        setReplayPhase('done');
        return;
      }
      game.playCard(cp, card);
      refreshState(game);

      // Encode card play as its pangram letter (a-z, A-Z)
      setMoveString(prev => prev + cardToLetter(card));

      const newGs = game.getGameState();

      // Check if hand/game is done
      if (newGs.gameStage === 'scoring') {
        setReplayPhase('done');
        return;
      }

      // Check if trick just completed (currentTrick is empty)
      if (newGs.currentTrick.length === 0) {
        setTrickPause(true);
        setLastBook(game.getLastCompletedTrick());
      }
    }

    setStepIndex(prev => prev + 1);
  }, [replayPhase, strategies, refreshState, trickPause]);

  // Auto-play timer
  useEffect(() => {
    if (!isPlaying || replayPhase === 'done' || replayPhase === 'loading') return;

    const delay = trickPause ? speed * 1.5 : speed;
    const timer = setTimeout(() => {
      executeStep();
    }, delay);

    return () => clearTimeout(timer);
  }, [isPlaying, stepIndex, replayPhase, speed, trickPause, executeStep]);

  const handleRestart = () => {
    if (!config) return;
    const game = new BidWhistGame();
    (game as any).dealer = dealerRef.current;
    gameRef.current = game;
    game.dealCards(config.deckUrl);
    refreshState(game);
    setReplayPhase('bidding');
    setIsPlaying(false);
    setStepIndex(0);
    setBidLog([]);
    setLastBook([]);
    setTrickPause(false);
    setTrumpInfo(null);
    setMoveString('');
  };

  const handleStepForward = () => {
    executeStep();
  };

  const handleStepBack = () => {
    if (moveString.length === 0) return;
    setIsPlaying(false);
    const newMoves = moveString.slice(0, -1);
    setMoveString(newMoves);
    rebuildFromMoves(newMoves);
    setStepIndex(prev => prev + 1);
  };

  const togglePlay = () => {
    if (replayPhase === 'done') return;
    setIsPlaying(!isPlaying);
  };

  // Error state
  if (error) {
    return (
      <div style={{
        backgroundColor: '#1a2e23', color: '#e5e7eb', minHeight: '100vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px',
      }}>
        <div style={{
          backgroundColor: '#162b1e', border: '1px solid #374151', borderRadius: '8px',
          padding: '32px', maxWidth: '500px', textAlign: 'center',
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px', color: '#f56565' }}>
            Replay Error
          </h2>
          <p style={{ marginBottom: '24px', color: '#9ca3af' }}>{error}</p>
          <a href="/compare" style={{ color: '#60a5fa', textDecoration: 'underline' }}>
            Go to Compare page
          </a>
        </div>
      </div>
    );
  }

  // Loading state
  if (!gameState || replayPhase === 'loading') {
    return (
      <div style={{
        backgroundColor: '#008000', backgroundImage: 'radial-gradient(circle, #009900 0%, #006600 100%)',
        color: 'white', minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        Loading replay...
      </div>
    );
  }

  const t0Name = config?.team0StrategyName || 'Strategy A';
  const t1Name = config?.team1StrategyName || 'Strategy B';

  return (
    <div className="w-full h-screen overflow-hidden relative"
      style={{ backgroundColor: '#008000', backgroundImage: 'radial-gradient(circle, #009900 0%, #006600 100%)' }}>

      {/* Menu Bar */}
      <div className="absolute top-0 left-0 right-0 bg-gray-800 text-white px-2 py-1 flex items-center justify-between z-[70]">
        <span className="text-lg font-bold">
          Replay — {t0Name.length > 20 ? t0Name.slice(0, 18) + '..' : t0Name} vs {t1Name.length > 20 ? t1Name.slice(0, 18) + '..' : t1Name}
        </span>
        <div className="flex gap-4 text-sm">
          <span style={{ color: '#9ca3af' }}>
            Phase: <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{replayPhase}</span>
          </span>
        </div>
      </div>

      {/* Player areas — all face-up */}
      {gameState.players.map(player => (
        <PlayerArea
          key={player.id}
          player={player}
          isCurrentPlayer={gameState.currentPlayer === player.id}
          isHuman={player.id === 0}
          playCard={() => {}}
          showAllCards={true}
        />
      ))}

      {/* Turn indicator */}
      <TurnIndicator
        currentPlayer={gameRef.current?.getCurrentPlayer() ?? null}
        gameStage={gameState.gameStage}
      />

      {/* Game table with current trick */}
      <GameTable
        currentTrick={gameState.currentTrick}
        message={gameState.message}
      />

      {/* Last Book display */}
      {lastBook.length > 0 && (
        <LastBook lastBook={lastBook} playerNames={PLAYER_NAMES} />
      )}

      {/* Bid Log Panel */}
      {(replayPhase === 'bidding' || bidLog.length > 0) && (
        <div className="absolute top-8 left-4 bg-white bg-opacity-90 p-3 rounded border border-gray-400 shadow-md z-10"
          style={{ maxWidth: '220px', maxHeight: '300px', overflowY: 'auto' }}>
          <div className="text-sm font-bold border-b border-gray-400 mb-2 pb-1">
            Bid Log
          </div>
          {bidLog.length === 0 ? (
            <div className="text-xs text-gray-500 italic">Waiting for bids...</div>
          ) : (
            <div className="space-y-1">
              {bidLog.map((entry, i) => (
                <div key={i} className="text-xs flex justify-between items-center">
                  <span className="font-medium" style={{ color: entry.player === 'System' ? '#9333ea' : '#1f2937' }}>
                    {entry.player}
                  </span>
                  <span style={{
                    color: entry.action === 'Pass' ? '#9ca3af'
                      : entry.action.startsWith('Bid') ? '#2563eb'
                      : entry.action.startsWith('Takes') ? '#d97706'
                      : '#6b7280',
                    fontWeight: entry.action !== 'Pass' ? 'bold' : 'normal',
                  }}>
                    {entry.action}
                  </span>
                </div>
              ))}
            </div>
          )}
          {trumpInfo && (
            <div className="mt-2 pt-1 border-t border-gray-400 text-xs">
              <span className="font-medium">Trump: </span>
              <span style={{ fontWeight: 'bold', color: '#1f2937' }}>{trumpInfo}</span>
            </div>
          )}
          {biddingState && biddingState.currentHighBid > 0 && replayPhase === 'bidding' && (
            <div className="mt-1 text-xs text-gray-600">
              High bid: <span className="font-bold">{biddingState.currentHighBid}</span>
              {biddingState.currentHighBidder !== null && (
                <span> by {PLAYER_NAMES[biddingState.currentHighBidder]}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Score display */}
      {replayPhase === 'play' && (
        <div className="absolute top-8 right-4 bg-white bg-opacity-90 p-2 rounded border border-gray-400 shadow-md z-10">
          <div className="text-sm font-bold border-b border-gray-400 mb-1 pb-1">Books</div>
          <div className="text-xs flex justify-between">
            <span>S/N:</span>
            <span className="ml-4 font-bold">{gameState.players[0]?.score ?? 0}</span>
          </div>
          <div className="text-xs flex justify-between">
            <span>E/W:</span>
            <span className="ml-4 font-bold">{gameState.players[1]?.score ?? 0}</span>
          </div>
        </div>
      )}

      {/* Done overlay */}
      {replayPhase === 'done' && gameState.gameStage === 'scoring' && (
        <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md text-center border-4 border-blue-800">
            <h2 className="text-xl font-bold mb-3">Replay Complete</h2>
            <p className="text-lg mb-4">{gameState.message}</p>
            <div className="mb-4">
              <div className="flex justify-between mb-1">
                <span>S/N ({t0Name}):</span>
                <span className="font-bold">{gameState.players[0]?.score ?? 0} books</span>
              </div>
              <div className="flex justify-between mb-1">
                <span>E/W ({t1Name}):</span>
                <span className="font-bold">{gameState.players[1]?.score ?? 0} books</span>
              </div>
            </div>
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              onClick={handleRestart}
            >
              Replay Again
            </button>
          </div>
        </div>
      )}

      {/* All-passed overlay */}
      {replayPhase === 'done' && gameState.gameStage !== 'scoring' && (
        <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md text-center border-4 border-yellow-600">
            <h2 className="text-xl font-bold mb-3">All Passed</h2>
            <p className="text-gray-600 mb-4">No contract — all players passed.</p>
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              onClick={handleRestart}
            >
              Replay Again
            </button>
          </div>
        </div>
      )}

      {/* Control Bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gray-800 bg-opacity-95 text-white px-4 py-2 flex items-center justify-between z-[70]">
        <div className="flex items-center gap-3">
          {/* Restart */}
          <button
            className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-500"
            onClick={handleRestart}
          >
            Restart
          </button>

          {/* Step Back */}
          <button
            className="bg-yellow-600 text-white px-3 py-1 rounded text-sm hover:bg-yellow-500 disabled:opacity-50"
            onClick={handleStepBack}
            disabled={moveString.length === 0 || isPlaying}
          >
            Back
          </button>

          {/* Step Forward */}
          <button
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-500 disabled:opacity-50"
            onClick={handleStepForward}
            disabled={replayPhase === 'done' || isPlaying}
          >
            Step
          </button>

          {/* Play/Pause */}
          <button
            className={`px-3 py-1 rounded text-sm ${
              replayPhase === 'done'
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : isPlaying
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-green-600 hover:bg-green-500 text-white'
            }`}
            onClick={togglePlay}
            disabled={replayPhase === 'done'}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>

        {/* Speed controls */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Speed:</span>
          {SPEED_OPTIONS.map(opt => (
            <button
              key={opt.label}
              className={`px-2 py-1 rounded text-xs ${
                speed === opt.ms
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
              }`}
              onClick={() => setSpeed(opt.ms)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Info + Move String */}
        <div className="text-xs text-gray-400 flex flex-col items-end gap-0.5">
          <div className="flex gap-4">
            <span>T0: <span className="text-gray-200">{t0Name.length > 15 ? t0Name.slice(0, 13) + '..' : t0Name}</span></span>
            <span>T1: <span className="text-gray-200">{t1Name.length > 15 ? t1Name.slice(0, 13) + '..' : t1Name}</span></span>
          </div>
          {moveString.length > 0 && (
            <div style={{ fontFamily: 'monospace', letterSpacing: '1px', color: '#9ca3af', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'right' }}>
              <span style={{ direction: 'ltr', unicodeBidi: 'bidi-override' }}>
                {moveString.length > 54 ? '\u2026' + moveString.slice(-54) : moveString}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReplayPage;
