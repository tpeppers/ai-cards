import React, { useState, useEffect, useRef } from 'react';
import { X, RefreshCw } from 'lucide-react';

// Improved Card component with more reliable rendering
const Card = ({ card, position, draggable, onDragStart, onDragEnd, onClick }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const cardRef = useRef(null);

  const handleMouseDown = (e) => {
    if (!draggable) return;
    setIsDragging(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    if (onDragStart) onDragStart(card);
    e.preventDefault();
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (cardRef.current) {
      cardRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (cardRef.current) {
      cardRef.current.style.transform = '';
    }
    if (onDragEnd) onDragEnd(card);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Simplified card rendering with SVG for suits
  const getSuitSymbol = (suit) => {
    switch (suit) {
      case 'hearts': return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="red">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      );
      case 'diamonds': return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="red">
          <path d="M12 2L6 12 12 22 18 12z" />
        </svg>
      );
      case 'clubs': return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="black">
          <path d="M12 2C9.24 2 7 4.24 7 7c0 2.12 1.31 3.89 3 4.65V14c0 1.1-.9 2-2 2h-1v2h8v-2h-1c-1.1 0-2-.9-2-2v-2.35c1.69-.76 3-2.53 3-4.65 0-2.76-2.24-5-5-5zm0 8c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3z" />
        </svg>
      );
      case 'spades': return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="black">
          <path d="M12 2L8 10c-2.2 0-4 1.8-4 4 0 1.9 1.3 3.4 3 3.9V22h6v-4.1c1.7-.5 3-2 3-3.9 0-2.2-1.8-4-4-4l-4-8z" />
        </svg>
      );
      default: return null;
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

  // Generate card background
  return (
    <div
      ref={cardRef}
      //h-full w-full flex flex-col justify-between p-2
      className={`absolute bg-white rounded-lg border-2 border-gray-300 select-none cursor-pointer shadow-md ${isDragging ? 'z-50' : 'z-10'}`}
      style={{
        width: '80px',
        height: '112px',
        top: position.y,
        left: position.x,
      }}
      onMouseDown={handleMouseDown}
      onClick={() => onClick && onClick(card)}
    >
      <div className="h-full w-full flex flex-col justify-between p-2">
        <div className={`self-start font-bold ${getColor(card.suit)}`}>
          {getRank(card.rank)}
        </div>
        <div className="flex justify-center items-center">
          {getSuitSymbol(card.suit)}
        </div>
        <div className={`self-end font-bold ${getColor(card.suit)} rotate-180`}>
          {getRank(card.rank)}
        </div>
      </div>
    </div>
  );
};

// Player area component to organize the UI better
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

  const getPositionStyle = (index) => {
    if (isHuman) {
      // Bottom player (human)
      const baseX = 20;//Math.max(windowSize.width / 2 - (player.hand.length * 25) / 2, 20);
      return {
        x: baseX + index * 25,
        y: windowSize.height - 140
      };
    } else if (player.id === 1) {
      // Right player
      return {
        x: windowSize.width - 140,
        y: 100 + index * 20
      };
    } else if (player.id === 2) {
      // Top player
      const baseX = Math.max(windowSize.width / 2 - (player.hand.length * 25) / 2, 20);
      return {
        x: baseX + index * 25,
        y: 20
      };
    } else {
      // Left player
      return {
        x: 20,
        y: 100 + index * 20
      };
    }
  };

  return (
    <div className={`absolute ${
      isHuman ? 'bottom-0 left-0 right-0' : 
      player.id === 1 ? 'right-0 top-0 bottom-0' :
      player.id === 2 ? 'top-0 left-0 right-0' :
      'left-0 top-0 bottom-0'
    } flex items-center justify-center`}>
      {/* Player indicator */}
      <div className={`absolute ${
        isHuman ? 'bottom-2' :
        player.id === 1 ? 'right-2 top-1/2 transform -translate-y-1/2' :
        player.id === 2 ? 'top-2' :
        'left-2 top-1/2 transform -translate-y-1/2'
      } text-white font-bold`}>
        {player.name} {isCurrentPlayer && '(Turn)'} - Score: {player.totalScore}
      </div>
      
      {/* Cards */}
      {player.hand.map((card, index) => (
        <Card
          key={card.id}
          card={card}
          position={getPositionStyle(index)}
          draggable={isHuman && isCurrentPlayer}
          onClick={isHuman ? () => playCard(card) : undefined}
          onDragEnd={isHuman ? () => playCard(card) : undefined}
        />
      ))}
    </div>
  );
};

// Game table component for better organization
const GameTable = ({ currentTrick, message }) => {
  // Responsive positioning for trick cards
  const getTrickCardPosition = (index) => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    
    const positions = [
      { x: centerX, y: centerY + 60 },  // Bottom player's card
      { x: centerX + 60, y: centerY },  // Right player's card
      { x: centerX, y: centerY - 60 },  // Top player's card
      { x: centerX - 60, y: centerY }   // Left player's card
    ];
    
    return positions[index];
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* Center table */}
      <div className="w-40 h-40 rounded-full bg-green-900 border-2 border-yellow-600 shadow-lg"></div>
      
      {/* Message display */}
      <div className="absolute top-16 left-0 right-0 text-center text-white text-lg font-bold bg-black bg-opacity-50 py-2">
        {message}
      </div>
      
      {/* Current trick */}
      {currentTrick.map((play) => (
        <Card
          key={`trick_${play.playerId}`}
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
    { id: 1, name: 'Player 2', hand: [], tricks: [], score: 0, totalScore: 0 },
    { id: 2, name: 'Player 3', hand: [], tricks: [], score: 0, totalScore: 0 },
    { id: 3, name: 'Player 4', hand: [], tricks: [], score: 0, totalScore: 0 }
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
    setMessage(`Game initialized, compiled @ ${new Date().toLocaleTimeString()} (NOT REALLY, but lets pretend!)`);
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

  const handleCardPlay = (card) => {
    // Only allow current player to play
    if (currentPlayer !== 0) return;
    
    // Validate the move
    if (!isValidMove(card)) return;
    
    playCard(0, card);
    
    // Simulate other players after a short delay
    setTimeout(() => {
      simulateOtherPlayers();
    }, 500);
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
      if (card.suit === 'hearts' && !heartsBroken) {
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
      setTimeout(() => evaluateTrick(), 1000);
    } else {
      // Move to next player
      setCurrentPlayer((currentPlayer + 1) % 4);
    }
  };

  const getBestMove = (playerId) => {
    const playerHand = players[playerId].hand;
    
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
  
    console.log(`Player ${winnerIndex} wins the trick.`);
    console.log(`Player ${winnerIndex}'s turn starts.`);
    if(trick.length === 13) {
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
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [currentPlayer, gameStage]);

  return (
    <div className="w-full h-screen bg-green-800 overflow-hidden">
      {/* Game header */}
      <div className="absolute top-2 left-4 text-white text-2xl font-bold">Hearts</div>
      
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
      <div className="absolute bottom-36 left-1/2 transform -translate-x-1/2 flex gap-2 z-20">
        {gameStage === 'deal' && (
          <button 
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            onClick={dealCards}
          >
            Deal
          </button>
        )}
        
        {gameStage === 'scoring' && !gameOver && (
          <button 
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            onClick={startNewHand}
          >
            Next Hand
          </button>
        )}
        
        {gameOver && (
          <button 
            className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 flex items-center gap-1"
            onClick={resetGame}
          >
            <RefreshCw size={16} />
            New Game
          </button>
        )}
      </div>
      
      {/* Game over overlay */}
      {gameOver && winner && (
        <div className="absolute inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg max-w-md text-center">
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
              className="mt-6 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-1 mx-auto"
              onClick={resetGame}
            >
              <RefreshCw size={16} />
              Play Again
            </button>
          </div>
          <button 
            className="absolute top-4 right-4 text-white hover:text-gray-300"
            onClick={() => setGameOver(false)}
          >
            <X size={24} />
          </button>
        </div>
      )}

      {/* Rules button */}
      <button
        className="absolute top-2 right-4 bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 text-sm"
        onClick={() => alert("Hearts Rules:\n\n• Goal: Have the lowest score at the end\n• Each heart = 1 point\n• Queen of Spades = 13 points\n• Must follow suit if possible\n• Can't lead hearts until hearts are broken\n• Game ends when someone reaches 100 points\n• Shooting the moon: If you take all hearts + Queen of Spades, you get 0 points and others get 26")}
      >
        Rules
      </button>
    </div>
  );
};

export default HeartsGame;