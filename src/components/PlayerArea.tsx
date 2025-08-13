import React, { useState, useEffect } from 'react';
import { Player } from '../types/CardGame';
import Card from './Card.tsx';

interface PlayerAreaProps {
  player: Player;
  isCurrentPlayer: boolean;
  isHuman: boolean;
  playCard: (card: any) => void;
  showAllCards: boolean;
}

// Player area component
const PlayerArea: React.FC<PlayerAreaProps> = ({ player, isCurrentPlayer, isHuman, playCard, showAllCards }) => {
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
  const getPositionStyle = (index: number) => {
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
    } flex items-center justify-center`} id="playerHand">
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
          faceDown={!isHuman && !showAllCards}
        />
      ))}
    </div>
  );
};

export default PlayerArea;