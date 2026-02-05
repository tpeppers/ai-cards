import React, { useState, useEffect, useRef } from 'react';
import GameEngine from './components/GameEngine.tsx';
import BiddingOverlay from './components/BiddingOverlay.tsx';
import TrumpSelectionOverlay from './components/TrumpSelectionOverlay.tsx';
import DiscardOverlay from './components/DiscardOverlay.tsx';
import LastBook from './components/LastBook.tsx';
import { BidWhistGame } from './games/BidWhistGame.ts';
import { GameState } from './types/CardGame.ts';

const BidWhistGameComponent: React.FunctionComponent = () => {
  const gameRef = useRef<BidWhistGame>(new BidWhistGame());
  const [gameState, setGameState] = useState<GameState>(gameRef.current.getGameState());
  const [biddingState, setBiddingState] = useState(gameRef.current.getBiddingState());
  const [refreshKey, setRefreshKey] = useState(0);

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
      game.processAITrumpSelection(declarer);
      updateStates();
      // Signal GameEngine to refresh for play phase (AI auto-discards)
      setRefreshKey(prev => prev + 1);
    }, 1500);

    return () => clearTimeout(timer);
  }, [gameState.gameStage]);

  // Handle game state changes from GameEngine
  const handleGameStateChange = (newState: GameState) => {
    // Define phase order - never allow regression to earlier phases
    const phaseOrder = ['deal', 'bidding', 'trumpSelection', 'discarding', 'play', 'scoring'];
    const currentPhaseIndex = phaseOrder.indexOf(gameState.gameStage);
    const newPhaseIndex = phaseOrder.indexOf(newState.gameStage);

    // Allow transition from scoring to deal/bidding (new hand)
    const isNewHand = gameState.gameStage === 'scoring' &&
      (newState.gameStage === 'deal' || newState.gameStage === 'bidding');

    // Don't allow GameEngine to regress to earlier phases (stale state)
    // Exception: new hand transitions are allowed
    if (newPhaseIndex < currentPhaseIndex && !isNewHand) {
      return;
    }

    // Don't let GameEngine overwrite state while in managed phases
    if ((newState.gameStage === 'bidding' && gameState.gameStage === 'bidding') ||
        (newState.gameStage === 'trumpSelection' && gameState.gameStage === 'trumpSelection') ||
        (newState.gameStage === 'discarding' && gameState.gameStage === 'discarding')) {
      return;
    }

    // Update both states together to keep them in sync
    const newBiddingState = game.getBiddingState();
    setGameState(newState);
    setBiddingState(newBiddingState);
  };

  const playerNames = gameState.players.map(p => p.name);
  const declarer = game.getDeclarer();
  const isHumanDeclarer = declarer === 0;
  const lastBook = game.getLastCompletedTrick();

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
        />
      )}

      {/* Trump selection overlay */}
      {game.isTrumpSelectionPhase() && (
        <TrumpSelectionOverlay
          isYourTurn={isHumanDeclarer}
          winningBid={biddingState.currentHighBid}
          playerHand={gameState.players[0]?.hand || []}
          onSelectTrump={handleTrumpSelection}
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
    </div>
  );
};

export default BidWhistGameComponent;
