import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { CardGame, GameState } from '../types/CardGame.tsx';
import PlayerArea from './PlayerArea.tsx';
import GameTable from './GameTable.tsx';
import MoveHistory from './MoveHistory.tsx';
import TurnIndicator from './TurnIndicator.tsx';
import { 
  decodeUrlToDeck, 
  getGameStateFromUrl, 
  isValidDeckUrl,
  generateRandomDeckUrl,
  encodeDeckToUrl,
  updateUrlWithGameState
} from '../urlGameState.js';

interface MoveHistoryEntry {
  id: string;
  playerName: string;
  card: string;
  timestamp: number;
}

interface GameEngineProps {
  game: CardGame;
  gameName: string;
  gameRules: string;
  useUrlSeeding?: boolean;
  hideMoveHistory?: boolean;
  refreshKey?: number;
  onGameStateChange?: (gameState: GameState) => void;
  autoPlaySignal?: number;
  hideAutoPlay?: boolean;
  previewCardId?: string | null;
}

// Global settings
const baseTimeOut = 500;
let currentTimeout = baseTimeOut;
let lastPlayManual = true;

const GameEngine: React.FunctionComponent<GameEngineProps> = ({
  game,
  gameName,
  gameRules,
  useUrlSeeding = true,
  hideMoveHistory = false,
  refreshKey = 0,
  onGameStateChange,
  autoPlaySignal = 0,
  hideAutoPlay = false,
  previewCardId = null
}) => {
  const [gameState, setGameState] = useState<GameState>(game.getGameState());
  const [moveHistory, setMoveHistory] = useState<MoveHistoryEntry[]>([]);
  const [showAllCards, setShowAllCards] = useState<boolean>(false);
  
  // Window resize handling
  useEffect(() => {
    const handleResize = () => {
      // Force a re-render when window is resized
      setGameState({...game.getGameState()});
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [game]);

  // Keyboard shortcuts: 1-9, 0, -, = to play cards at index 0-11
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only process if it's the human's turn during play phase
      const currentGameState = game.getGameState();
      if (currentGameState.gameStage !== 'play') return;
      if (currentGameState.currentPlayer !== 0) return;
      if (currentGameState.currentTrick.some(play => play.playerId === 0)) return;

      // Map keys to card indices: 1=0, 2=1, ..., 9=8, 0=9, -=10, ==11
      const keyToIndex: { [key: string]: number } = {
        '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5,
        '7': 6, '8': 7, '9': 8, '0': 9, '-': 10, '=': 11
      };

      const cardIndex = keyToIndex[event.key];
      if (cardIndex === undefined) return;

      const humanHand = currentGameState.players[0]?.hand;
      if (!humanHand || cardIndex >= humanHand.length) return;

      const card = humanHand[cardIndex];
      if (card) {
        handleCardPlay(card);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState.currentPlayer, gameState.gameStage, gameState.currentTrick]);

  // Sync state when parent signals a refresh (e.g., after bidding/discarding)
  useEffect(() => {
    if (refreshKey > 0) {
      setGameState(game.getGameState());
    }
  }, [refreshKey, game]);

  // Respond to parent-triggered auto play signal
  useEffect(() => {
    if (autoPlaySignal > 0) {
      handleAutoPlay();
    }
  }, [autoPlaySignal]);

  // Initialize game
  useEffect(() => {
    initializeGame();
  }, []);

  // Notify parent of game state changes
  useEffect(() => {
    if (onGameStateChange) {
      onGameStateChange(gameState);
    }
  }, [gameState, onGameStateChange]);

  const updateGameState = () => {
    const newState = game.getGameState();
    setGameState(newState);
  };

  const initializeGame = () => {
    //TODO: REMOVE USE_URL_SEEDING, WANT IT TO BE CONTROLLED BY EXISTANCE OF URL EXTRAS
    // http://localhost:3000/#n___r___t___a___c___j___m___D___H___L___Q___W___Z___
    if (getGameStateFromUrl() != null) {
      // Check if there's a valid deck URL in the hash
      const urlState = getGameStateFromUrl();
      if (urlState && isValidDeckUrl(urlState)) {
        try {
          const deck = decodeUrlToDeck(urlState);
          // TODO: Apply deck to game if game supports URL seeding
          console.log('URL deck loaded:', deck);
          updateGameState();
        } catch (error) {
          console.error('Failed to decode URL deck:', error);
          // Generate new random deck URL
          const randomUrl = generateRandomDeckUrl();
          updateUrlWithGameState(randomUrl);
        }
      } else {
        // Generate new random deck URL
        const randomUrl = generateRandomDeckUrl();
        updateUrlWithGameState(randomUrl);
      }
    }
    
    updateGameState();
  };

  const formatCard = (card: any) => {
    const rankNames: { [key: number]: string } = {
      1: 'A', 11: 'J', 12: 'Q', 13: 'K'
    };
    const suitSymbols: { [key: string]: string } = {
      hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠'
    };
    const rankStr = rankNames[card.rank] || card.rank.toString();
    const suitSymbol = suitSymbols[card.suit] || card.suit;
    return `${rankStr}${suitSymbol}`;
  };

  const addMoveToHistory = (playerId: number, card: any) => {
    const player = game.getPlayer(playerId);
    if (player) {
      const move: MoveHistoryEntry = {
        id: `${Date.now()}-${playerId}-${card.id}`,
        playerName: player.name,
        card: formatCard(card),
        timestamp: Date.now()
      };
      setMoveHistory(prev => [...prev, move]);
    }
  };

  const resetGame = (useNewUrl: boolean) => {
    game.resetGame();
    setMoveHistory([]);
    updateGameState();
    if (useNewUrl) {
      const randomUrl = generateRandomDeckUrl();
      updateUrlWithGameState(randomUrl);
    }
  };

  // TODO: Is there a better starting point for this? 
  // e.g., should it pull from a checkbox, not have an open-top dead-end && really be always on?
  const dealCards = (urlToDeal?: string) => {
    game.dealCards(getGameStateFromUrl());
    updateGameState();
  };

  const handleCardPlay = (card: any) => {
    // Only allow current player to play
    const currentPlayer = game.getCurrentPlayer();
    const currentGameState = game.getGameState();
    if (!currentPlayer || currentPlayer.id !== 0 || currentGameState.currentTrick.some(play => play.playerId === 0)) {
      return;
    }

    const move = game.playCard(0, card);
    if (!move.isValid && move.errorMessage) {
      // Show error message temporarily
      const tempState = {...gameState, message: move.errorMessage};
      setGameState(tempState);
      setTimeout(() => updateGameState(), 2000);
      return;
    }
    
    console.log(`Player 0's turn starts, played card: ${card.rank} of ${card.suit}`);
    addMoveToHistory(0, card);
    updateGameState();  
  };

  const simulateOtherPlayers = () => {
    if (gameState.gameStage !== 'play') return;
    
    const currentPlayerObj = game.getCurrentPlayer();
    if (!currentPlayerObj || currentPlayerObj.id === 0) return;
  
    console.log(`Player ${currentPlayerObj.id}'s turn (${(game.players[currentPlayerObj.id].name)}) starts.`);
    
    const card = game.getBestMove(currentPlayerObj.id);
    if (card) {
      console.log(`Player ${(game.players[currentPlayerObj.id].name)} plays card value: ${card.rank} of ${card.suit}`);
      const move = game.playCard(currentPlayerObj.id, card);
      if (move.isValid) {
        addMoveToHistory(currentPlayerObj.id, card);
        updateGameState();
      } else {
        console.error(`Invalid move by player ${currentPlayerObj.id}: `, move.errorMessage);
      }
    } else {
      console.log(`Player ${currentPlayerObj.id} is out of cards or no valid moves.`);
    }
  };

  const startNewHand = () => {
    game.startNewHand();
    updateGameState();
  };

  const handleAutoPlay = () => {
    currentTimeout = 10; 
    lastPlayManual = false; 
    
    const currentPlayerObj = game.getCurrentPlayer();
    if (currentPlayerObj && currentPlayerObj.id === 0) {
      const bestMove = game.getBestMove(0);
      if (bestMove) {
        handleCardPlay(bestMove);
      }
    }
  };

  const handleRandomUrl = () => {
    const randomUrl = generateRandomDeckUrl();
    window.location.hash = randomUrl;
    resetGame(true);
  };

  const toggleCardVisibility = () => {
    setShowAllCards(!showAllCards);
  };

  // Auto-play for AI players
  useEffect(() => {
    const currentPlayerObj = game.getCurrentPlayer();
    if (currentPlayerObj && currentPlayerObj.id !== 0 && gameState.gameStage === 'play') {
      const timer = setTimeout(() => {
        simulateOtherPlayers();
      }, currentTimeout * 2);
      
      return () => {
        clearTimeout(timer)
      };
    }
  }, [gameState.currentPlayer, gameState.gameStage, gameState.currentTrick]);

  return (
    <div className="w-full h-screen overflow-hidden relative"
      style={{ backgroundColor: '#008000', backgroundImage: 'radial-gradient(circle, #009900 0%, #006600 100%)' }}>
      
      {/* Menu Bar */}
      <div className="absolute top-0 left-0 right-0 bg-gray-800 text-white px-2 py-1 flex items-center justify-between">
        <span className="text-lg font-bold">{gameName}</span>
        <div className="flex gap-4">
          <button 
            className="text-white hover:text-gray-300" 
            onClick={() => alert(gameRules)}
          >
            Help
          </button>
        </div>
      </div>
      
      {/* Player areas */}
      {gameState.players.map(player => (
        <PlayerArea
          key={player.id}
          player={player}
          isCurrentPlayer={gameState.currentPlayer === player.id}
          isHuman={player.id === 0}
          playCard={handleCardPlay}
          showAllCards={showAllCards}
          previewCardId={player.id === 0 ? previewCardId : null}
        />
      ))}
      {/* Turn indicator */}
      <TurnIndicator 
        currentPlayer={game.getCurrentPlayer()} 
        gameStage={gameState.gameStage}
      />
      
      {/* Game table with current trick */}
      <GameTable 
        currentTrick={gameState.currentTrick} 
        message={gameState.message}
      />
      
      {/* Game controls */}
      <div className="absolute top-8 right-4 flex flex-col gap-2 z-[60]">
        {gameState.gameStage === 'deal' && (
          <button 
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            onClick={dealCards}
            id="dealButton"
          >
            Deal
          </button>
        )}
        
        {gameState.gameStage === 'scoring' && !gameState.gameOver && (
          <button 
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            onClick={startNewHand}
          >
            Next Hand
          </button>
        )}
        
        {gameState.gameOver && (
          <button
            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 flex items-center gap-1"
            onClick={() => resetGame(true)}
          >
            <RefreshCw size={16} />
            New Game
          </button>
        )}
        
        {!hideAutoPlay && gameState.gameStage === 'play' && gameState.currentPlayer === 0 && (
          <button
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            onClick={handleAutoPlay}
          >
            Auto Play
          </button>
        )}
        
        {(
          <button
            className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700"
            onClick={handleRandomUrl}
          >
            Random URL
          </button>
        )}
        
        <button
          className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700"
          onClick={toggleCardVisibility}
        >
          {showAllCards ? 'Hide Cards' : 'Show All Cards'}
        </button>
      </div>
      
      {/* Score display */}
      <div className="absolute top-8 left-4 bg-white bg-opacity-90 p-2 rounded border border-gray-400 shadow-md">
        <div className="text-sm font-bold border-b border-gray-400 mb-1 pb-1">
          Score
        </div>
        {gameState.players.map(player => (
          <div key={player.id} className="flex justify-between text-sm">
            <span>{player.name}:</span>
            <span className="ml-4">{player.totalScore}</span>
          </div>
        ))}
        {gameState.gameStage === 'scoring' && (
          <div className="mt-2 pt-1 border-t border-gray-400">
            <div className="text-sm font-bold mb-1">Last Hand</div>
            {gameState.players.map(player => (
              <div key={`last_${player.id}`} className="flex justify-between text-sm">
                <span>{player.name}:</span>
                <span className="ml-4">{player.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Move History */}
      {!hideMoveHistory && <MoveHistory moves={moveHistory} />}
      
      {/* Game over dialog */}
      {gameState.gameOver && gameState.winner && (
        <div className="absolute inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md text-center border-4 border-blue-800">
            <h2 className="text-2xl font-bold mb-4">Game Over!</h2>
            <p className="text-xl mb-6">{gameState.winner.name} wins with {gameState.winner.totalScore} points!</p>
            <h3 className="font-bold mb-2">Final Scores:</h3>
            {gameState.players.sort((a, b) => a.totalScore - b.totalScore).map(player => (
              <div key={player.id} className="flex justify-between mb-1">
                <span>{player.name}</span>
                <span>{player.totalScore}</span>
              </div>
            ))}
            <button
              className="mt-6 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 mx-auto"
              onClick={() => resetGame(true)}
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameEngine;