import React, { useState, useEffect, useRef, useCallback } from 'react';
import GameEngine from './components/GameEngine.tsx';
import BiddingOverlay from './components/BiddingOverlay.tsx';
import TrumpSelectionOverlay from './components/TrumpSelectionOverlay.tsx';
import DiscardOverlay from './components/DiscardOverlay.tsx';
import LastBook from './components/LastBook.tsx';
import { BidWhistGame } from './games/BidWhistGame.ts';
import { GameState } from './types/CardGame.ts';
import { STRATEGY_REGISTRY } from './strategies/index.ts';
import { getGameStateFromUrl } from './urlGameState.js';

const BidWhistGameComponent: React.FunctionComponent = () => {
  const gameRef = useRef<BidWhistGame>(new BidWhistGame());
  const [gameState, setGameState] = useState<GameState>(gameRef.current.getGameState());
  const [biddingState, setBiddingState] = useState(gameRef.current.getBiddingState());
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [showStrategyMenu, setShowStrategyMenu] = useState(false);
  const [autoPlaySignal, setAutoPlaySignal] = useState(0);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [previewBid, setPreviewBid] = useState<number | null>(null);
  const [previewTrump, setPreviewTrump] = useState<{ suit: string; direction: string } | null>(null);
  const familyStrategyText = STRATEGY_REGISTRY.find(s => s.game === 'bidwhist' && s.name === 'Family')?.text || null;
  const [opponentStrategy, setOpponentStrategy] = useState<string | null>(familyStrategyText);
  const [showDealMenu, setShowDealMenu] = useState(false);
  const strategyMenuRef = useRef<HTMLDivElement>(null);
  const dealMenuRef = useRef<HTMLDivElement>(null);

  const game = gameRef.current;

  const gameRules = `Bid Whist Rules:

• 4 players in 2 teams (You & North vs East & West)
• 52 cards (standard deck, no jokers)
• Each player gets 12 cards, 4 go to the kitty

Bidding:
• Bid 1-6 (books over 6 you'll win)
• Pass or bid higher than current bid
• Highest bidder wins the kitty

After Winning Bid:
• Take 4 kitty cards (now have 16)
• Choose trump suit and direction
• Discard 4 cards (back to 12)
• Lead the first card

Gameplay:
• Must follow suit if possible
• Trump beats other suits
• Bid winner leads first trick

Scoring:
• Make contract: +1 point per book over 6
• Fail contract: Opponents get bid points
• First team to 7 points wins

Card Rankings:
• Uptown: A K Q J 10 9 8 7 6 5 4 3 2
• Downtown: A 2 3 4 5 6 7 8 9 10 J Q K`;

  const updateStates = () => {
    setGameState(game.getGameState());
    setBiddingState(game.getBiddingState());
  };

  // Load the opponent strategy onto the game engine
  const loadOpponentStrategy = useCallback(() => {
    if (opponentStrategy) {
      game.loadStrategy(opponentStrategy);
    } else {
      game.setStrategy(null);
    }
  }, [opponentStrategy, game]);

  // Handle human bid
  const handleBid = (amount: number) => {
    if (game.placeBid(0, amount)) {
      updateStates();
    }
  };

  // Handle human trump selection
  const handleTrumpSelection = (suit: string, direction: 'uptown' | 'downtown' | 'downtown-noaces') => {
    if (game.setTrumpSuit(suit, direction)) {
      updateStates();
    }
  };

  // Handle human discard selection
  const handleDiscard = (cardIds: string[]) => {
    if (game.discardCards(cardIds)) {
      updateStates();
      // Signal GameEngine to refresh its state for play phase
      setRefreshKey(prev => prev + 1);
    }
  };

  // Track number of bids to trigger re-renders
  const bidCount = biddingState.bids.length;

  // Auto-process AI bids during bidding phase
  useEffect(() => {
    // Only run during bidding
    if (gameState.gameStage !== 'bidding') return;

    // Get current player from game (source of truth)
    const currentPlayer = game.getGameState().currentPlayer;

    // Only process if it's an AI's turn (not player 0)
    if (currentPlayer === null || currentPlayer === 0) return;

    const timer = setTimeout(() => {
      // Verify still in bidding and same player's turn
      const state = game.getGameState();
      if (state.gameStage !== 'bidding') return;
      if (state.currentPlayer !== currentPlayer) return;

      // Load opponent strategy before AI decision
      loadOpponentStrategy();
      // Process the AI bid
      game.processAIBid(currentPlayer);

      // Force state update
      const newGameState = game.getGameState();
      const newBiddingState = game.getBiddingState();
      setGameState(newGameState);
      setBiddingState(newBiddingState);
    }, 1000);

    return () => clearTimeout(timer);
  }, [gameState.gameStage, bidCount]);

  // Auto-process AI trump selection
  useEffect(() => {
    if (gameState.gameStage !== 'trumpSelection') return;

    const declarer = game.getDeclarer();
    if (declarer === null || declarer === 0) return;

    // AI player chooses trump
    const timer = setTimeout(() => {
      loadOpponentStrategy();
      game.processAITrumpSelection(declarer);
      updateStates();
      // Signal GameEngine to refresh for play phase (AI auto-discards)
      setRefreshKey(prev => prev + 1);
    }, 1500);

    return () => clearTimeout(timer);
  }, [gameState.gameStage]);

  // Close strategy menu on outside click
  useEffect(() => {
    if (!showStrategyMenu && !showDealMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (showStrategyMenu && strategyMenuRef.current && !strategyMenuRef.current.contains(e.target as Node)) {
        setShowStrategyMenu(false);
      }
      if (showDealMenu && dealMenuRef.current && !dealMenuRef.current.contains(e.target as Node)) {
        setShowDealMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showStrategyMenu, showDealMenu]);

  // Determine whether Auto Play should be visible
  const currentDeclarer = game.getDeclarer();
  const showAutoPlay =
    (gameState.gameStage === 'bidding' && gameState.currentPlayer === 0) ||
    (gameState.gameStage === 'trumpSelection' && currentDeclarer === 0) ||
    (gameState.gameStage === 'discarding') ||
    (gameState.gameStage === 'play' && gameState.currentPlayer === 0);

  // Phase-aware Auto Play handler
  const handleAutoPlay = useCallback(() => {
    // Load selected strategy or clear it
    if (selectedStrategy) {
      game.loadStrategy(selectedStrategy);
    } else {
      game.setStrategy(null);
    }

    const stage = game.getGameState().gameStage;

    if (stage === 'bidding') {
      const bid = game.getAIBid(0);
      handleBid(bid);
    } else if (stage === 'trumpSelection') {
      const result = game.getAITrumpSelection(0);
      handleTrumpSelection(result.suit, result.direction);
    } else if (stage === 'discarding') {
      game.simulateAutoDiscard(0);
      updateStates();
      setRefreshKey(prev => prev + 1);
    } else if (stage === 'play') {
      // Signal GameEngine to run its internal handleAutoPlay
      setAutoPlaySignal(prev => prev + 1);
    }
  }, [selectedStrategy, game]);

  // Preview: compute what Auto Play would do on hover
  const handleAutoPlayHover = useCallback(() => {
    if (selectedStrategy) {
      game.loadStrategy(selectedStrategy);
    } else {
      game.setStrategy(null);
    }

    const stage = game.getGameState().gameStage;

    if (stage === 'bidding') {
      const bid = game.getAIBid(0);
      setPreviewBid(bid);
    } else if (stage === 'trumpSelection') {
      const result = game.getAITrumpSelection(0);
      setPreviewTrump({ suit: result.suit, direction: result.direction });
    } else if (stage === 'play') {
      const bestMove = game.getBestMove(0);
      if (bestMove) {
        setPreviewCardId(bestMove.id);
      }
    }
  }, [selectedStrategy, game]);

  const handleAutoPlayLeave = useCallback(() => {
    setPreviewCardId(null);
    setPreviewBid(null);
    setPreviewTrump(null);
  }, []);

  // Deal handler (replaces GameEngine's built-in Deal button)
  const handleDeal = useCallback(() => {
    game.dealCards(getGameStateFromUrl());
    updateStates();
    setRefreshKey(prev => prev + 1);
  }, [game]);

  // Called by GameEngine before each AI card play
  const handleBeforeAIMove = useCallback(() => {
    loadOpponentStrategy();
  }, [loadOpponentStrategy]);

  // Get the display name for the selected strategy
  const selectedStrategyName = selectedStrategy
    ? STRATEGY_REGISTRY.find(s => s.text === selectedStrategy)?.name || 'Custom'
    : null;

  // Track current game stage in a ref so the callback doesn't depend on gameState
  const gameStageRef = useRef(gameState.gameStage);
  gameStageRef.current = gameState.gameStage;

  // Handle game state changes from GameEngine
  const handleGameStateChange = useCallback((newState: GameState) => {
    // Define phase order - never allow regression to earlier phases
    const phaseOrder = ['deal', 'bidding', 'trumpSelection', 'discarding', 'play', 'scoring'];
    const currentStage = gameStageRef.current;
    const currentPhaseIndex = phaseOrder.indexOf(currentStage);
    const newPhaseIndex = phaseOrder.indexOf(newState.gameStage);

    // Allow transition from scoring to deal/bidding (new hand)
    const isNewHand = currentStage === 'scoring' &&
      (newState.gameStage === 'deal' || newState.gameStage === 'bidding');

    // Don't allow GameEngine to regress to earlier phases (stale state)
    // Exception: new hand transitions are allowed
    if (newPhaseIndex < currentPhaseIndex && !isNewHand) {
      return;
    }

    // Don't let GameEngine overwrite state while in managed phases
    if ((newState.gameStage === 'bidding' && currentStage === 'bidding') ||
        (newState.gameStage === 'trumpSelection' && currentStage === 'trumpSelection') ||
        (newState.gameStage === 'discarding' && currentStage === 'discarding')) {
      return;
    }

    // Update both states together to keep them in sync
    const newBiddingState = game.getBiddingState();
    setGameState(newState);
    setBiddingState(newBiddingState);
  }, [game]);

  const playerNames = gameState.players.map(p => p.name);
  const declarer = game.getDeclarer();
  const isHumanDeclarer = declarer === 0;
  const lastBook = game.getLastCompletedTrick();

  const bidWhistStrategies = STRATEGY_REGISTRY.filter(s => s.game === 'bidwhist');

  const opponentStrategyName = opponentStrategy
    ? STRATEGY_REGISTRY.find(s => s.text === opponentStrategy)?.name || 'Custom'
    : 'Default AI';

  return (
    <div className="relative w-full h-screen">
      <GameEngine
        game={game}
        gameName="Bid Whist"
        gameRules={gameRules}
        useUrlSeeding={true}
        hideMoveHistory={true}
        refreshKey={refreshKey}
        onGameStateChange={handleGameStateChange}
        autoPlaySignal={autoPlaySignal}
        hideAutoPlay={true}
        hideDeal={true}
        previewCardId={previewCardId}
        onBeforeAIMove={handleBeforeAIMove}
        extraControls={
          <>
            {/* Deal + Opponent Strategy Selector */}
            {gameState.gameStage === 'deal' && (
              <div className="relative" ref={dealMenuRef}>
                <div className="flex flex-row gap-0">
                  <button
                    className="bg-blue-600 text-white px-4 py-2 rounded-l hover:bg-blue-700"
                    onClick={handleDeal}
                    id="dealButton"
                  >
                    Deal
                  </button>
                  <button
                    className="bg-blue-600 text-white px-2 py-2 rounded-r hover:bg-blue-700 border-l border-blue-700"
                    onClick={() => setShowDealMenu(prev => !prev)}
                  >
                    ...
                  </button>
                </div>
                <div className="text-gray-300 text-xs mt-1 max-w-[160px] truncate">
                  vs {opponentStrategyName}
                </div>
                {showDealMenu && (
                  <div className="absolute right-0 mt-1 bg-white rounded shadow-lg border border-gray-300 w-56 max-h-80 overflow-y-auto z-10">
                    <div className="px-3 py-2 text-xs font-bold text-gray-500 border-b border-gray-200">
                      Opponent AI Strategy
                    </div>
                    <button
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                        opponentStrategy === null ? 'bg-blue-50 font-semibold' : ''
                      }`}
                      onClick={() => { setOpponentStrategy(null); setShowDealMenu(false); }}
                    >
                      Default AI
                    </button>
                    {bidWhistStrategies.map(s => (
                      <button
                        key={s.name}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 border-t border-gray-100 ${
                          opponentStrategy === s.text ? 'bg-blue-50 font-semibold' : ''
                        }`}
                        onClick={() => { setOpponentStrategy(s.text); setShowDealMenu(false); }}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        }
      />

      {/* Last Book display (replaces Move History for Bid Whist) */}
      {gameState.gameStage === 'play' && (
        <LastBook lastBook={lastBook} playerNames={playerNames} />
      )}

      {/* Bidding overlay */}
      {biddingState.biddingPhase && (
        <BiddingOverlay
          isYourTurn={gameState.currentPlayer === 0}
          currentHighBid={biddingState.currentHighBid}
          validBids={game.getValidBids()}
          bids={biddingState.bids}
          playerNames={playerNames}
          dealer={biddingState.dealer}
          currentBidder={gameState.currentPlayer}
          onBid={handleBid}
          previewBid={previewBid}
        />
      )}

      {/* Trump selection overlay */}
      {game.isTrumpSelectionPhase() && (
        <TrumpSelectionOverlay
          isYourTurn={isHumanDeclarer}
          winningBid={biddingState.currentHighBid}
          playerHand={gameState.players[0]?.hand || []}
          onSelectTrump={handleTrumpSelection}
          previewTrump={previewTrump}
        />
      )}

      {/* Discard overlay */}
      {game.isDiscardPhase() && (
        <DiscardOverlay
          playerHand={gameState.players[0]?.hand || []}
          trumpSuit={game.getTrumpSuit()}
          onDiscard={handleDiscard}
        />
      )}

      {/* Auto Play + Strategy Selector (z-60 to float above overlays) */}
      {showAutoPlay && (
        <div className="absolute top-10 right-4 z-[60]" ref={strategyMenuRef}>
          <div className="flex flex-row gap-0">
            <button
              className="bg-green-600 text-white px-3 py-1 text-sm rounded-l hover:bg-green-700"
              onClick={handleAutoPlay}
              onMouseEnter={handleAutoPlayHover}
              onMouseLeave={handleAutoPlayLeave}
            >
              Auto Play
            </button>
            <button
              className="bg-green-600 text-white px-2 py-1 text-sm rounded-r hover:bg-green-700 border-l border-green-700"
              onClick={() => setShowStrategyMenu(prev => !prev)}
            >
              ...
            </button>
          </div>
          {selectedStrategyName && (
            <div className="text-gray-300 text-xs mt-1 max-w-[140px] truncate">
              {selectedStrategyName}
            </div>
          )}
          {showStrategyMenu && (
            <div className="absolute right-0 mt-1 bg-white rounded shadow-lg border border-gray-300 w-56 max-h-80 overflow-y-auto">
              <button
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                  selectedStrategy === null ? 'bg-blue-50 font-semibold' : ''
                }`}
                onClick={() => { setSelectedStrategy(null); setShowStrategyMenu(false); }}
              >
                Default AI
              </button>
              {bidWhistStrategies.map(s => (
                <button
                  key={s.name}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 border-t border-gray-100 ${
                    selectedStrategy === s.text ? 'bg-blue-50 font-semibold' : ''
                  }`}
                  onClick={() => { setSelectedStrategy(s.text); setShowStrategyMenu(false); }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BidWhistGameComponent;
