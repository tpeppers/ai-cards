import React from 'react';
import { Card } from '../types/CardGame.ts';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout.ts';

interface LastBookEntry {
  playerId: number;
  card: Card;
}

interface LastBookProps {
  lastBook: LastBookEntry[];
  playerNames: string[];
  dragOffset?: { x: number; y: number };
  onDragStart?: (e: React.MouseEvent) => void;
  onTouchDragStart?: (e: React.TouchEvent) => void;
}

const suits: { [key: string]: { symbol: string; color: string } } = {
  spades: { symbol: '\u2660', color: 'black' },
  hearts: { symbol: '\u2665', color: 'red' },
  diamonds: { symbol: '\u2666', color: 'red' },
  clubs: { symbol: '\u2663', color: 'black' },
};

const getRankDisplay = (rank: number): string => {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return rank.toString();
};

const LastBook: React.FC<LastBookProps> = ({ lastBook, playerNames, dragOffset, onDragStart, onTouchDragStart }) => {
  const { isCompact } = useResponsiveLayout();
  return (
    <div
      className={`absolute bg-white bg-opacity-90 rounded border border-gray-400 shadow-md z-10 ${
        isCompact ? 'bottom-1 right-1 p-1 w-28' : 'bottom-4 right-4 p-3 w-48'
      }`}
      style={dragOffset ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` } : undefined}
    >
      <div
        className={`font-bold border-b border-gray-400 mb-1 pb-1 ${isCompact ? 'text-[10px]' : 'text-sm'}`}
        style={onDragStart ? { cursor: 'grab' } : undefined}
        onMouseDown={onDragStart}
        onTouchStart={onTouchDragStart}
      >
        Last Book
      </div>
      <div className={isCompact ? '' : 'space-y-1'}>
        {lastBook.length === 0 ? (
          <div className={`text-gray-500 italic ${isCompact ? 'text-[10px]' : 'text-xs'}`}>No books yet</div>
        ) : (
          lastBook.map((entry, index) => {
            const suitInfo = suits[entry.card.suit] || { symbol: '?', color: 'black' };
            return (
              <div key={index} className={`flex justify-between items-center ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                <span className="font-medium truncate mr-1">{playerNames[entry.playerId]}</span>
                <span style={{ color: suitInfo.color === 'red' ? '#dc2626' : '#1f2937' }}>
                  {getRankDisplay(entry.card.rank)}{suitInfo.symbol}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LastBook;
