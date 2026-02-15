import React, { useState, useEffect, useRef, useCallback } from 'react';
import GameEngine from './components/GameEngine.tsx';
import BiddingOverlay from './components/BiddingOverlay.tsx';
import TrumpSelectionOverlay from './components/TrumpSelectionOverlay.tsx';
import DiscardOverlay from './components/DiscardOverlay.tsx';
import LastBook from './components/LastBook.tsx';
import StrategyConfigModal from './components/StrategyConfigModal.tsx';
import { BidWhistGame } from './games/BidWhistGame.ts';
import { GameState } from './types/CardGame.ts';
import { STRATEGY_REGISTRY } from './strategies/index.ts';
import { getGameStateFromUrl } from './urlGameState.js';
import { useDraggable } from './hooks/useDraggable.ts';

const SUIT_SYMBOLS: { [key: string]: string } = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣'
};

const SUIT_COLORS: { [key: string]: string } = {
  spades: 'black', hearts: 'red', diamonds: 'red', clubs: 'black'
};

const RANK_DISPLAY: { [key: number]: string } = {
  1: 'A', 11: 'J', 12: 'Q', 13: 'K'
};

const BidWhistGameComponent: React.FunctionComponent = () => {
  const gameRef = useRef<BidWhistGame>(new BidWhistGame());
  const [gameState, setGameState] = useState<GameState>(gameRef.current.getGameState());
  const [biddingState, setBiddingState] = useState(gameRef.current.getBiddingState());
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoPlaySignal, setAutoPlaySignal] = useState(0);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [previewBid, setPreviewBid] = useState<number | null>(null);
  const [previewTrump, setPreviewTrump] = useState<{ suit: string; direction: string } | null>(null);
  const [showAllCards, setShowAllCards] = useState(false);

  // Strategy configuration state
  const familyStrategyText = STRATEGY_REGISTRY.find(s => s.game === 'bidwhist' && s.name === 'Family')?.text || null;
  const [tableStrategy, setTableStrategy] = useState<string | null>(familyStrategyText);
  const [playerStrategyOverrides, setPlayerStrategyOverrides] = useState<(string | null)[]>([null, null, null, null]);
  const [showStrategyModal, setShowStrategyModal] = useState(false);

  const game = gameRef.current;

  // Draggable overlays
  const lastBookDrag = useDraggable();
  const booksDrag = useDraggable();

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
• Make contract: bid points + 1 per 2 overtricks
• Fail contract: opponents get bid + 1 per 2 undertricks
• All 13 books = Whisting!
• First team to 21 wins (11 = shutout if opponent has 0)

Card Rankings:
• Uptown: A K Q J 10 9 8 7 6 5 4 3 2
• Downtown: A 2 3 4 5 6 7 8 9 10 J Q K`;

  const updateStates = () => {
    setGameState(game.getGameState());
    setBiddingState(game.getBiddingState());
  };

  // Get the effective strategy text for a given player
  const getEffectiveStrategy = useCallback((playerId: number): string | null => {
    const override = playerStrategyOverrides[playerId];
    if (override === null) return tableStrategy; // "Use table strategy"
    if (override === '') return null;             // "Default AI"
    return override;                              // specific strategy text
  }, [tableStrategy, playerStrategyOverrides]);

  // Load the effective strategy for a player onto the game engine
  const loadStrategyForPlayer = useCallback((playerId: number) => {
    const strategy = getEffectiveStrategy(playerId);
    if (strategy) {
      game.loadStrategy(strategy);
    } else {
      game.setStrategy(null);
    }
  }, [getEffectiveStrategy, game]);

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

      // Load strategy for this specific AI player
      loadStrategyForPlayer(currentPlayer);
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
      loadStrategyForPlayer(declarer);
      game.processAITrumpSelection(declarer);
      updateStates();
      // Signal GameEngine to refresh for play phase (AI auto-discards)
      setRefreshKey(prev => prev + 1);
    }, 1500);

    return () => clearTimeout(timer);
  }, [gameState.gameStage]);

  // Determine whether Auto Play should be visible
  const currentDeclarer = game.getDeclarer();
  const showAutoPlay =
    (gameState.gameStage === 'bidding' && gameState.currentPlayer === 0) ||
    (gameState.gameStage === 'trumpSelection' && currentDeclarer === 0) ||
    (gameState.gameStage === 'discarding') ||
    (gameState.gameStage === 'play' && gameState.currentPlayer === 0);

  // Phase-aware Auto Play handler
  const handleAutoPlay = useCallback(() => {
    loadStrategyForPlayer(0);

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
  }, [loadStrategyForPlayer, game]);

  // Preview: compute what Auto Play would do on hover
  const handleAutoPlayHover = useCallback(() => {
    loadStrategyForPlayer(0);

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
  }, [loadStrategyForPlayer, game]);

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
  const handleBeforeAIMove = useCallback((playerId: number) => {
    loadStrategyForPlayer(playerId);
  }, [loadStrategyForPlayer]);

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

  // Strategy name helper
  const strategyNameFromText = (text: string | null): string => {
    if (text === null) return 'Default AI';
    return STRATEGY_REGISTRY.find(s => s.text === text)?.name || 'Custom';
  };

  const tableStrategyName = strategyNameFromText(tableStrategy);

  // Check if any player has an override
  const hasAnyOverride = playerStrategyOverrides.some(o => o !== null);

  // Compute display game name
  const displayGameName = (!hasAnyOverride && tableStrategy !== null)
    ? `Bid Whist (${tableStrategyName.toLowerCase()})`
    : 'Bid Whist';

  // Compute player display names
  const basePlayerNames = gameState.players.map(p => p.name);
  const playerDisplayNames = basePlayerNames.map((name, i) => {
    if (!hasAnyOverride) return name; // all use table strategy, no suffixes
    const override = playerStrategyOverrides[i];
    if (override === null) return name; // using table strategy (the default), no suffix
    const overrideName = override === '' ? 'default ai' : strategyNameFromText(override).toLowerCase();
    return `${name} (${overrideName})`;
  });

  // Effective strategy name for player 0 (shown under Auto Play)
  const player0EffectiveStrategy = getEffectiveStrategy(0);
  const player0StrategyName = strategyNameFromText(player0EffectiveStrategy);

  const declarer = game.getDeclarer();
  const isHumanDeclarer = declarer === 0;
  const lastBook = game.getLastCompletedTrick();

  return (
    <div className="relative w-full h-screen">
      <GameEngine
        game={game}
        gameName={displayGameName}
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
        playerDisplayNames={playerDisplayNames}
        showAllCards={showAllCards}
        onToggleShowAllCards={() => setShowAllCards(prev => !prev)}
        extraControls={
          <>
            {/* Deal + Strategy Config */}
            {gameState.gameStage === 'deal' && (
              <div className="relative">
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
                    onClick={() => setShowStrategyModal(true)}
                  >
                    ...
                  </button>
                </div>
                <div className="text-gray-300 text-xs mt-1 max-w-[160px] truncate">
                  {tableStrategyName}
                </div>
              </div>
            )}
            {/* Push dealt hand to URL */}
            {gameState.gameStage !== 'deal' && game.getLastDealtDeckUrl() && (
              <button
                className="bg-gray-600 text-white px-3 py-1 text-sm rounded hover:bg-gray-500"
                title="Update browser URL with this deal (for sharing/bookmarking)"
                onClick={() => {
                  const deckUrl = game.getLastDealtDeckUrl();
                  window.history.replaceState(null, '', `#${deckUrl}`);
                }}
              >
                Push to URL
              </button>
            )}
          </>
        }
      />

      {/* Last Book display (replaces Move History for Bid Whist) */}
      {gameState.gameStage === 'play' && (
        <LastBook
          lastBook={lastBook}
          playerNames={playerDisplayNames}
          dragOffset={lastBookDrag.position}
          onDragStart={lastBookDrag.handleMouseDown}
          onTouchDragStart={lastBookDrag.handleTouchStart}
        />
      )}

      {/* Books indicator */}
      {gameState.gameStage === 'play' && (() => {
        const books = game.getBooksWon();
        return (
          <div
            className="absolute top-8 right-4 bg-white bg-opacity-90 p-2 rounded border border-gray-400 shadow-md z-10"
            style={{ transform: `translate(${booksDrag.position.x}px, ${booksDrag.position.y}px)` }}
          >
            <div
              className="text-sm font-bold border-b border-gray-400 mb-1 pb-1"
              style={{ cursor: 'grab' }}
              onMouseDown={booksDrag.handleMouseDown}
              onTouchStart={booksDrag.handleTouchStart}
            >
              Books
            </div>
            <div className="text-xs flex justify-between">
              <span>S/N:</span>
              <span className="ml-4 font-bold">{books[0]}</span>
            </div>
            <div className="text-xs flex justify-between">
              <span>E/W:</span>
              <span className="ml-4 font-bold">{books[1]}</span>
            </div>
          </div>
        );
      })()}

      {/* Bidding overlay */}
      {biddingState.biddingPhase && (
        <BiddingOverlay
          isYourTurn={gameState.currentPlayer === 0}
          currentHighBid={biddingState.currentHighBid}
          validBids={game.getValidBids()}
          bids={biddingState.bids}
          playerNames={playerDisplayNames}
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

      {/* Kitty display when Show All Cards is enabled during bidding/trump phases */}
      {showAllCards && (biddingState.biddingPhase || game.isTrumpSelectionPhase()) && game.getKitty().length > 0 && (
        <div className="absolute top-1/2 -translate-y-1/2 z-[51] pointer-events-none"
          style={{ left: 'calc(50% + 230px)' }}>
          <div className="bg-white bg-opacity-95 rounded-lg shadow-lg p-3 pointer-events-auto">
            <div className="text-xs font-semibold text-gray-500 mb-2 text-center">Kitty</div>
            <div className="grid grid-cols-2 gap-1">
              {game.getKitty().map(card => (
                <div
                  key={card.id}
                  className="w-10 h-14 bg-white border border-gray-300 rounded flex flex-col items-center justify-center text-xs font-bold shadow-sm"
                  style={{ color: SUIT_COLORS[card.suit] || 'black' }}
                >
                  <span>{RANK_DISPLAY[card.rank] || card.rank}</span>
                  <span className="text-base leading-none">{SUIT_SYMBOLS[card.suit]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Discard overlay */}
      {game.isDiscardPhase() && (
        <DiscardOverlay
          playerHand={gameState.players[0]?.hand || []}
          trumpSuit={game.getTrumpSuit()}
          onDiscard={handleDiscard}
        />
      )}

      {/* Auto Play button (z-60 to float above overlays) */}
      {showAutoPlay && (
        <div className="absolute top-10 right-4 z-[60]">
          <button
            className="bg-green-600 text-white px-3 py-1 text-sm rounded hover:bg-green-700"
            onClick={handleAutoPlay}
            onMouseEnter={handleAutoPlayHover}
            onMouseLeave={handleAutoPlayLeave}
          >
            Auto Play
          </button>
          <div className="text-gray-300 text-xs mt-1 max-w-[140px] truncate">
            {player0StrategyName}
          </div>
        </div>
      )}

      {/* Strategy Configuration Modal */}
      {showStrategyModal && (
        <StrategyConfigModal
          tableStrategy={tableStrategy}
          playerOverrides={playerStrategyOverrides}
          onApply={(newTable, newOverrides) => {
            setTableStrategy(newTable);
            setPlayerStrategyOverrides(newOverrides);
            setShowStrategyModal(false);
          }}
          onCancel={() => setShowStrategyModal(false)}
        />
      )}
    </div>
  );
};

export default BidWhistGameComponent;
