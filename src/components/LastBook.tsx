import React from 'react';
import { Card } from '../types/CardGame.ts';

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
  return (
    <div
      className="absolute bottom-4 right-4 bg-white bg-opacity-90 p-3 rounded border border-gray-400 shadow-md w-48 z-10"
      style={dragOffset ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` } : undefined}
    >
      <div
        className="text-sm font-bold border-b border-gray-400 mb-2 pb-1"
        style={onDragStart ? { cursor: 'grab' } : undefined}
        onMouseDown={onDragStart}
        onTouchStart={onTouchDragStart}
      >
        Last Book
      </div>
      <div className="space-y-1">
        {lastBook.length === 0 ? (
          <div className="text-xs text-gray-500 italic">No books yet</div>
        ) : (
          lastBook.map((entry, index) => {
            const suitInfo = suits[entry.card.suit] || { symbol: '?', color: 'black' };
            return (
              <div key={index} className="text-xs flex justify-between items-center">
                <span className="font-medium">{playerNames[entry.playerId]}</span>
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
