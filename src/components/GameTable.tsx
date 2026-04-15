import React from 'react';
import { PlayedCard } from '../types/CardGame.ts';
import Card from './Card.tsx';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout.ts';

interface GameTableProps {
  currentTrick: PlayedCard[];
  message: string;
}

// Game table component to display current trick
const GameTable: React.FC<GameTableProps> = ({ currentTrick, message }) => {
  const { width, height, scale, cardWidth, cardHeight, isCompact } = useResponsiveLayout();

  // Classic Microsoft Hearts style positions for cards in trick (scaled from reference 71x96 layout)
  const getTrickCardPosition = (index: number) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const halfW = cardWidth / 2;
    const halfH = cardHeight / 2;
    const gap = 14 * scale;

    const positions = [
      { x: centerX - halfW,           y: centerY + gap },               // Bottom player's card
      { x: centerX + gap,             y: centerY - halfH },             // Right player's card
      { x: centerX - halfW,           y: centerY - cardHeight - gap },  // Top player's card
      { x: centerX - cardWidth - gap, y: centerY - halfH }              // Left player's card
    ];

    return positions[index];
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* Message display - positioned below menu bar. On compact we narrow it so it
          does not cover the score panel / controls that sit at top-left and top-right. */}
      {message && (
        <div
          className={`absolute text-center text-white font-bold bg-black bg-opacity-70 ${
            isCompact
              ? 'top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-0.5 rounded max-w-[60%] truncate'
              : 'top-8 left-0 right-0 text-lg py-1'
          }`}
        >
          {message}
        </div>
      )}

      {/* Current trick */}
      {currentTrick.map((play) => (
        <Card
          key={`trick_${play.playerId}_${play.card.id}`}
          card={play.card}
          position={getTrickCardPosition(play.playerId)}
          draggable={false}
          width={cardWidth}
          height={cardHeight}
        />
      ))}
    </div>
  );
};

export default GameTable;