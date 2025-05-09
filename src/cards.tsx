import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

// Global settings
const baseTimeOut = 500;
let currentTimeout = baseTimeOut;
let lastPlayManual = true;

// Card component with classic Microsoft Hearts styling
const Card = ({ card, position, draggable, onDragStart, onDragEnd, onClick, faceDown = false }) => {
  const cardRef = useRef(null);

  // Card suit symbols using text characters instead of SVG for classic look
  const getSuitSymbol = (suit) => {
    switch (suit) {
      case 'hearts': return '♥';
      case 'diamonds': return '♦';
      case 'clubs': return '♣';
      case 'spades': return '♠';
      default: return '';
    }
  };

  const getColor = (suit) => {
    return suit === 'hearts' || suit === 'diamonds' ? 'text-red-600' : 'text-black';
  };

  const getRank = (rank) => {
    switch (rank) {
      case 1: return 'A';
      case 11: return 'J';
      case 12: return 'Q';
      case 13: return 'K';
      default: return rank;
    }
  };

  // Classic card styling
  return (
    <div
      ref={cardRef}
      className={`absolute select-none ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        position: 'absolute',
        width: '71px', // Classic card dimensions
        height: '96px',
        top: position.y,
        left: position.x,
        transform: `translateY(${position.raised ? '-20px' : '0px'})`,
        transition: 'transform 0.2s ease',
        boxShadow: '2px 2px 5px rgba(0, 0, 0, 0.2)',
        borderRadius: '3px'
      }}
      onClick={() => onClick && onClick(card)}
      onMouseEnter={() => {
        if (cardRef.current && onClick) {
          cardRef.current.style.transform = 'translateY(-20px)';
        }
      }}
      onMouseLeave={() => {
        if (cardRef.current && onClick) {
          cardRef.current.style.transform = 'translateY(0px)';
        }
      }}
    >
      {/* Card face */}
      <div 
        className="h-full w-full flex flex-col justify-between p-1"
        style={{
          backgroundColor: faceDown ? '#006400' : 'white',
          border: '1px solid #000',
          borderRadius: '3px',
          background: faceDown ? 'repeating-linear-gradient(45deg, #006400, #006400 5px, #005300 5px, #005300 10px)' : 'white'
        }}
      >
        {!faceDown && (
          <>
            <div className={`self-start font-bold text-lg ${getColor(card.suit)}`} style={{ lineHeight: '1' }}>
              {getRank(card.rank)}
            </div>
            <div className={`flex justify-center items-center text-4xl ${getColor(card.suit)}`}>
              {getSuitSymbol(card.suit)}
            </div>
            <div className={`self-end font-bold text-lg ${getColor(card.suit)} rotate-180`} style={{ lineHeight: '1' }}>
              {getRank(card.rank)}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// Player area component
const PlayerArea = ({ player, isCurrentPlayer, isHuman, playCard }) => {
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Create the fan-shaped layout for cards similar to classic Microsoft Hearts
  const getPositionStyle = (index) => {
    if (isHuman) {
      // Bottom player (human) - fan out cards
      const totalWidth = Math.min(windowSize.width - 100, player.hand.length * 30);
      const spacing = totalWidth / Math.max(player.hand.length - 1, 1);
      const startX = (windowSize.width - totalWidth) / 2;
      
      return {
        x: startX + index * spacing,
        y: windowSize.height - 120,
        raised: false
      };
    } else if (player.id === 1) {
      // Right player - cards stacked sideways
      return {
        x: windowSize.width - 100,
        y: 150 + index * 15,
        raised: false
      };
    } else if (player.id === 2) {
      // Top player - cards stacked horizontally
      return {
        x: (windowSize.width / 2) - (player.hand.length * 15 / 2) + index * 15,
        y: 20,
        raised: false
      };
    } else {
      // Left player - cards stacked sideways
      return {
        x: 30,
        y: 150 + index * 15,
        raised: false
      };
    }
  };

  // Player name indicator and score display
  return (
    <div className={`absolute ${
      isHuman ? 'bottom-0 left-0 right-0' : 
      player.id === 1 ? 'right-0 top-0 bottom-0' :
      player.id === 2 ? 'top-0 left-0 right-0' :
      'left-0 top-0 bottom-0'
    } flex items-center justify-center`}>
      {/* Player name & score display */}
      <div className={`absolute ${
        isHuman ? 'bottom-36 left-1/2 transform -translate-x-1/2' :
        player.id === 1 ? 'right-24 top-1/2 transform -translate-y-1/2' :
        player.id === 2 ? 'top-24 left-1/2 transform -translate-x-1/2' :
        'left-24 top-1/2 transform -translate-y-1/2'
      } text-white font-bold bg-black bg-opacity-70 py-1 px-3 rounded`}>
        {player.name} {isCurrentPlayer && '(Turn)'} - Score: {player.totalScore}
      </div>
      
      {/* Cards */}
      {player.hand.map((card, index) => (
        <Card
          key={card.id}
          card={card}
          position={getPositionStyle(index)}
          draggable={isHuman && isCurrentPlayer}
          onClick={isHuman && isCurrentPlayer ? () => playCard(card) : undefined}
          faceDown={!isHuman}
        />
      ))}
    </div>
  );
};

// Game table component to display current trick
const GameTable = ({ currentTrick, message }) => {
  // Classic Microsoft Hearts style positions for cards in trick
  const getTrickCardPosition = (index) => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    
    const positions = [
      { x: centerX - 35, y: centerY + 50 },  // Bottom player's card
      { x: centerX + 50, y: centerY - 35 },  // Right player's card
      { x: centerX - 35, y: centerY - 120 },  // Top player's card
      { x: centerX - 120, y: centerY - 35 }   // Left player's card
    ];
    
    return positions[index];
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* Message display */}
      <div className="absolute top-1 left-0 right-0 text-center text-white text-lg font-bold bg-black bg-opacity-70 py-1">
        {message}
      </div>
      
      {/* Current trick */}
      {currentTrick.map((play) => (
        <Card
          key={`trick_${play.playerId}_${play.card.id}`}
          card={play.card}
          position={getTrickCardPosition(play.playerId)}
          draggable={false}
        />
      ))}
    </div>
  );
};

// Main game component
const HeartsGame = () => {
  // Game states
  const [deck, setDeck] = useState([]);
  const [players, setPlayers] = useState([
    { id: 0, name: 'You', hand: [], tricks: [], score: 0, totalScore: 0 },
    { id: 1, name: 'West', hand: [], tricks: [], score: 0, totalScore: 0 },
    { id: 2, name: 'North', hand: [], tricks: [], score: 0, totalScore: 0 },
    { id: 3, name: 'East', hand: [], tricks: [], score: 0, totalScore: 0 }
  ]);
  const [currentTrick, setCurrentTrick] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [leadSuit, setLeadSuit] = useState(null);
  const [heartsBroken, setHeartsBroken] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [gameStage, setGameStage] = useState('deal'); // deal, play, scoring
  const [message, setMessage] = useState('Welcome to Hearts!');
  
  // Window resize handling
  useEffect(() => {
    const handleResize = () => {
      // Force a re-render when window is resized
      setPlayers([...players]);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [players]);

  // Initialize deck
  useEffect(() => {
    initializeGame();
  }, []);

  const initializeGame = () => {
    const newDeck = createDeck();
    const shuffledDeck = shuffleDeck(newDeck);
    setDeck(shuffledDeck);
    setPlayers(players.map(player => ({ ...player, hand: [], tricks: [], score: 0 })));
    setCurrentTrick([]);
    setLeadSuit(null);
    setHeartsBroken(false);
    setGameOver(false);
    setWinner(null);
    setGameStage('deal');
    setMessage('Game initialized - click Deal to start');
  };

  const resetGame = () => {
    setPlayers(players.map(player => ({ ...player, hand: [], tricks: [], score: 0, totalScore: 0 })));
    initializeGame();
  };

  const createDeck = () => {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const deck = [];
    
    suits.forEach(suit => {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({ suit, rank, id: `${suit}_${rank}` });
      }
    });
    
    return deck;
  };

  const shuffleDeck = (deck) => {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const dealCards = () => {
    const shuffled = shuffleDeck(deck);
    const newPlayers = [...players];
    
    for (let i = 0; i < shuffled.length; i++) {
      const playerIndex = i % 4;
      newPlayers[playerIndex].hand.push(shuffled[i]);
    }
    
    // Sort hands
    newPlayers.forEach(player => {
      player.hand.sort((a, b) => {
        const suitOrder = { clubs: 1, diamonds: 2, spades: 3, hearts: 4 };
        if (suitOrder[a.suit] !== suitOrder[b.suit]) {
          return suitOrder[a.suit] - suitOrder[b.suit];
        }
        return a.rank - b.rank;
      });
    });

    setPlayers(newPlayers);
    findStartingPlayer(newPlayers);
    setGameStage('play');
  };

  const findStartingPlayer = (players) => {
    // Find player with 2 of clubs
    const twoOfClubsPlayer = players.findIndex(player => 
      player.hand.some(card => card.suit === 'clubs' && card.rank === 2)
    );
    
    setCurrentPlayer(twoOfClubsPlayer);
    setMessage(`${players[twoOfClubsPlayer].name} starts with the 2 of clubs`);
  };

  const handleCardPlay = (card, isManual) => {
    // Only allow current player to play
    if (currentPlayer !== 0 || currentTrick.some(play => play.playerId === 0)) return;
    
    // Validate the move
    if (!isValidMove(card)) return;
    
    playCard(0, card);
    
    // Simulate other players after a standard delay
    setTimeout(() => {
      simulateOtherPlayers();
    }, currentTimeout);
  };

  const isValidMove = (card) => {
    const playerHand = players[0].hand;
    
    // First trick special rules
    if (currentTrick.length === 0 && leadSuit === null) {
      // First card of the first trick must be 2 of clubs
      const twoOfClubs = playerHand.find(c => c.suit === 'clubs' && c.rank === 2);
      if (twoOfClubs) {
        return card.suit === 'clubs' && card.rank === 2;
      }
    }
    
    // If player is leading the trick
    if (currentTrick.length === 0) {
      // Cannot lead with hearts until hearts are broken
      if (card && card.suit === 'hearts' && !heartsBroken) {
        // Unless player only has hearts
        const onlyHasHearts = playerHand.every(c => c.suit === 'hearts');
        if (!onlyHasHearts) {
          setMessage("Can't lead with hearts until hearts are broken!");
          return false;
        }
      }
      return true;
    }
    
    // Must follow suit if possible
    if (leadSuit) {
      const hasSuit = playerHand.some(c => c.suit === leadSuit);
      if (hasSuit) {
        return card.suit === leadSuit;
      }
    }
    
    // First trick special rule: can't play hearts or queen of spades
    if (currentTrick.some(c => c.card.suit === 'clubs' && c.card.rank === 2)) {
      if (card.suit === 'hearts' || (card.suit === 'spades' && card.rank === 12)) {
        // Unless player only has hearts and queen of spades
        const onlyHasHeartAndQueen = playerHand.every(c => 
          c.suit === 'hearts' || (c.suit === 'spades' && c.rank === 12)
        );
        if (!onlyHasHeartAndQueen) {
          setMessage("Can't play hearts or queen of spades on the first trick!");
          return false;
        }
      }
    }
    
    return true;
  };

  const playCard = (playerId, card) => {
    // Add card to current trick
    if(currentTrick && currentTrick[playerId]) {
      console.log("Could prevent duplicate trick playing, but don't know how to terminate?...");
    }
    setCurrentTrick([...currentTrick, { playerId, card }]);
    
    // Set lead suit if this is the first card of the trick
    if (currentTrick.length === 0) {
      setLeadSuit(card.suit);
    }
    
    // Check if hearts are broken
    if (card.suit === 'hearts' && !heartsBroken) {
      setHeartsBroken(true);
    }
    
    // Remove card from player's hand
    const newPlayers = [...players];
    newPlayers[playerId].hand = newPlayers[playerId].hand.filter(c => c.id !== card.id);
    setPlayers(newPlayers);
    
    // If all players have played, evaluate the trick
    if (currentTrick.length === 3) {  // 3 cards currently in trick + 1 just played = 4
      setTimeout(() => evaluateTrick(), currentTimeout * 2);
    } else {
      // Move to next player
      setCurrentPlayer((currentPlayer + 1) % 4);
    }
  };

  const getBestMove = (playerId) => {
    const playerHand = playerId.hand ? playerId.hand : players[playerId].hand;
    
    // If leading a trick
    if (currentTrick.length === 0) {
      // Must play 2 of clubs if it's the first trick
      const twoOfClubs = playerHand.find(c => c.suit === 'clubs' && c.rank === 2);
      if (twoOfClubs) return twoOfClubs;
      
      // If hearts aren't broken, play a non-heart
      if (!heartsBroken) {
        const nonHeart = playerHand.find(c => c.suit !== 'hearts');
        if (nonHeart) return nonHeart;
      }
      
      // Otherwise, play lowest card
      return [...playerHand].sort((a, b) => a.rank - b.rank)[0];
    }
    
    // Follow suit if possible
    const suitCards = playerHand.filter(c => c.suit === leadSuit);
    if (suitCards.length > 0) {
      // Play highest card if it won't take the trick
      const currentHighest = currentTrick.reduce((highest, play) => {
        return play.card.suit === leadSuit && play.card.rank > highest.rank
          ? play.card
          : highest;
      }, { rank: 0 });
      
      const safeHighCards = suitCards.filter(c => c.rank < currentHighest.rank);
      if (safeHighCards.length > 0) {
        return safeHighCards.sort((a, b) => b.rank - a.rank)[0];
      }
      
      // Otherwise play lowest card of the suit
      return suitCards.sort((a, b) => a.rank - b.rank)[0];
    }
    
    // If can't follow suit, try to dump the queen of spades
    const queenOfSpades = playerHand.find(c => c.suit === 'spades' && c.rank === 12);
    if (queenOfSpades) return queenOfSpades;
    
    // Try to dump high hearts
    const hearts = playerHand.filter(c => c.suit === 'hearts').sort((a, b) => b.rank - a.rank);
    if (hearts.length > 0) return hearts[0];
    
    // Play highest card
    return [...playerHand].sort((a, b) => b.rank - a.rank)[0];
  };

  const simulateOtherPlayers = () => {
    if (gameStage !== 'play' || currentPlayer === 0) return;
  
    console.log(`Player ${currentPlayer}'s turn starts.`);
    
    const card = getBestMove(currentPlayer);
    if(card) {
      console.log(`Player ${currentPlayer} plays card value: ${card.rank} of ${card.suit}`);
      playCard(currentPlayer, card);
    } else {
      console.log(`Player ${currentPlayer} is out of cards.`);
      scoreHand();
    }
  };  

  const evaluateTrick = () => {
    const trick = [...currentTrick, currentTrick[3]]; // Add the latest card
    const leadingSuit = trick[0].card.suit;
  
    // Find the highest card of the leading suit
    let highestRank = -1;
    let winnerIndex = -1;
  
    trick.forEach((play, index) => {
      if (play && play.card && play.card.suit === leadingSuit && play.card.rank > highestRank) {
        highestRank = play.card.rank;
        winnerIndex = play.playerId;
      }
    });
  
    // Add the trick to the winner's tricks
    const newPlayers = [...players];
    newPlayers[winnerIndex].tricks.push(...trick.map(t => t ? t.card : console.log("What is even happening?")));
    setPlayers(newPlayers);
  
    // Clear the current trick and set the next player
    setCurrentTrick([]);
    setLeadSuit(null);
    setCurrentPlayer(winnerIndex);
    if (lastPlayManual) {
      currentTimeout = baseTimeOut;
    }
  
    console.log(`Player ${winnerIndex} wins the trick.`);
    console.log(`Player ${winnerIndex}'s turn starts.`);
    var tricksCount = newPlayers[0].tricks.length;
    if(tricksCount === 13) {
      console.log(`Trick length is 13, scoring hand.`);
      scoreHand();
    } else {
      console.log(`Trick length is ${trick.length}, continuing play.`);
    }
  };
  
  const scoreHand = () => {
    const newPlayers = [...players];
    let shootingMoonPlayer = null;
    let allPointCards = true;
    
    // Score each player's tricks
    newPlayers.forEach(player => {
      let hearts = 0;
      let queenOfSpades = false;
      
      player.tricks.forEach(card => {
        if(!card || !card.suit) {
          console.log("Card suit is undefined?, card: ", card);
        } else {

          if (card.suit === 'hearts') {
            hearts++;
          }
          if (card.suit === 'spades' && card.rank === 12) {
            queenOfSpades = true;
          }
        }
      });
      
      player.score = hearts + (queenOfSpades ? 13 : 0);
      
      // Check if a player shot the moon
      if (hearts === 13 && queenOfSpades) {
        shootingMoonPlayer = player.id;
      }
      
      if (player.score === 0) {
        allPointCards = false;
      }
    });
    
    // Apply shooting the moon
    if (shootingMoonPlayer !== null) {
      newPlayers.forEach(player => {
        if (player.id === shootingMoonPlayer) {
          player.score = 0;
        } else {
          player.score = 26;
        }
      });
      setMessage(`${newPlayers[shootingMoonPlayer].name} shot the moon!`);
    }
    
    // Update total scores
    newPlayers.forEach(player => {
      player.totalScore += player.score;
    });
    
    setPlayers(newPlayers);
    setGameStage('scoring');
    
    // Check if game is over (any player ≥ 100 points)
    if (newPlayers.some(player => player.totalScore >= 100)) {
      const winningPlayer = newPlayers.reduce((lowest, player) => 
        player.totalScore < lowest.totalScore ? player : lowest, newPlayers[0]);
      setWinner(winningPlayer);
      setGameOver(true);
      setMessage(`Game over! ${winningPlayer.name} wins with ${winningPlayer.totalScore} points!`);
    } else {
      setMessage("Hand complete! Press Deal to start the next hand.");
    }
  };

  const startNewHand = () => {
    const newPlayers = players.map(player => ({
      ...player,
      hand: [],
      tricks: [],
      score: 0
    }));
    
    setPlayers(newPlayers);
    setCurrentTrick([]);
    setLeadSuit(null);
    setHeartsBroken(false);
    setGameStage('deal');
    dealCards();
  };

  useEffect(() => {
    if (currentPlayer !== null && currentPlayer !== 0 && gameStage === 'play') {
      // Add a small delay before AI moves
      const timer = setTimeout(() => {
        simulateOtherPlayers();
      }, currentTimeout * 2);
      
      return () => clearTimeout(timer);
    }
  }, [currentPlayer, gameStage]);

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center" 
      style={{ backgroundColor: '#008000', backgroundImage: 'radial-gradient(circle, #009900 0%, #006600 100%)' }}>
      
      {/* Menu Bar */}
      <div className="absolute top-0 left-0 right-0 bg-gray-800 text-white px-2 py-1 flex items-center justify-between">
        <span className="text-lg font-bold">Hearts</span>
        <div className="flex gap-4">
          <button 
            className="text-white hover:text-gray-300" 
            onClick={() => alert("Hearts Rules:\n\n• Goal: Have the lowest score at the end\n• Each heart = 1 point\n• Queen of Spades = 13 points\n• Must follow suit if possible\n• Can't lead hearts until hearts are broken\n• Game ends when someone reaches 100 points\n• Shooting the moon: If you take all hearts + Queen of Spades, you get 0 points and others get 26")}
          >
            Help
          </button>
        </div>
      </div>
      
      {/* Player areas */}
      {players.map(player => (
        <PlayerArea
          key={player.id}
          player={player}
          isCurrentPlayer={currentPlayer === player.id}
          isHuman={player.id === 0}
          playCard={handleCardPlay}
        />
      ))}
      
      {/* Game table with current trick */}
      <GameTable 
        currentTrick={currentTrick} 
        message={message}
      />
      
      {/* Game controls */}
      <div className="absolute top-8 right-4 flex flex-col gap-2 z-20">
        {gameStage === 'deal' && (
          <button 
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            onClick={dealCards}
          >
            Deal
          </button>
        )}
        
        {gameStage === 'scoring' && !gameOver && (
          <button 
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            onClick={startNewHand}
          >
            Next Hand
          </button>
        )}
        
        {gameOver && (
          <button 
            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 flex items-center gap-1"
            onClick={resetGame}
          >
            <RefreshCw size={16} />
            New Game
          </button>
        )}
        
        {gameStage === 'play' && currentPlayer === 0 && (
          <button
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            onClick={() => { 
              currentTimeout = 10; 
              lastPlayManual = false; 
              handleCardPlay(getBestMove(players[0]), false); 
            }}
          >
            Auto Play
          </button>
        )}
      </div>
      
      {/* Score display in classic MS Hearts style */}
      <div className="absolute top-8 left-4 bg-white bg-opacity-90 p-2 rounded border border-gray-400 shadow-md">
        <div className="text-sm font-bold border-b border-gray-400 mb-1 pb-1">
          Score
        </div>
        {players.map(player => (
          <div key={player.id} className="flex justify-between text-sm">
            <span>{player.name}:</span>
            <span className="ml-4">{player.totalScore}</span>
          </div>
        ))}
        {gameStage === 'scoring' && (
          <div className="mt-2 pt-1 border-t border-gray-400">
            <div className="text-sm font-bold mb-1">Last Hand</div>
            {players.map(player => (
              <div key={`last_${player.id}`} className="flex justify-between text-sm">
                <span>{player.name}:</span>
                <span className="ml-4">{player.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Game over dialog */}
      {gameOver && winner && (
        <div className="absolute inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md text-center border-4 border-blue-800">
            <h2 className="text-2xl font-bold mb-4">Game Over!</h2>
            <p className="text-xl mb-6">{winner.name} wins with {winner.totalScore} points!</p>
            <h3 className="font-bold mb-2">Final Scores:</h3>
            {players.sort((a, b) => a.totalScore - b.totalScore).map(player => (
              <div key={player.id} className="flex justify-between mb-1">
                <span>{player.name}</span>
                <span>{player.totalScore}</span>
              </div>
            ))}
            <button 
              className="mt-6 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 mx-auto"
              onClick={resetGame}
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HeartsGame;