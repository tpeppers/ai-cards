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
        y: windowSize.height - 140,  // Position cards higher to stay within viewport
        raised: false
      };
    } else if (player.id === 1) {
      // Right player (East) - cards stacked sideways
      return {
        x: windowSize.width - 100,
        y: 120 + index * 25,
        raised: false
      };
    } else if (player.id === 2) {
      // Top player (North) - cards stacked horizontally, below message bar
      return {
        x: (windowSize.width / 2) - (player.hand.length * 30 / 2) + index * 30,
        y: 70,
        raised: false
      };
    } else {
      // Left player (West) - cards stacked sideways
      return {
        x: 30,
        y: 120 + index * 25,
        raised: false
      };
    }
  };

  // Player name indicator and score display
  return (
    <>
      {/* Player name & score display */}
      <div className={`absolute ${
        isHuman ? 'bottom-36 left-1/2 transform -translate-x-1/2' :
        player.id === 1 ? 'right-24 top-1/2 transform -translate-y-1/2' :
        player.id === 2 ? 'top-44 left-1/2 transform -translate-x-1/2' :
        'left-24 top-1/2 transform -translate-y-1/2'
      } text-white font-bold bg-black bg-opacity-70 py-1 px-3 rounded z-10`}>
        {player.name} {isCurrentPlayer && '(Turn)'} - Score: {player.totalScore}
      </div>

      {/* Cards */}
      {player.hand.map((card, index) => (
        <Card
          key={card.id}
          card={card}
          position={getPositionStyle(index)}
          zIndex={index + 1}
          draggable={isHuman && isCurrentPlayer}
          onClick={isHuman && isCurrentPlayer ? () => playCard(card) : undefined}
          faceDown={!isHuman && !showAllCards}
        />
      ))}
    </>
  );
};

export default PlayerArea;