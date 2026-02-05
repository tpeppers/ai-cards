import React from 'react';
import { PlayedCard } from '../types/CardGame.ts';
import Card from './Card.tsx';

interface GameTableProps {
  currentTrick: PlayedCard[];
  message: string;
}

// Game table component to display current trick
const GameTable: React.FC<GameTableProps> = ({ currentTrick, message }) => {
  // Classic Microsoft Hearts style positions for cards in trick
  const getTrickCardPosition = (index: number) => {
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
      {/* Message display - positioned below menu bar */}
      <div className="absolute top-8 left-0 right-0 text-center text-white text-lg font-bold bg-black bg-opacity-70 py-1">
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

export default GameTable;