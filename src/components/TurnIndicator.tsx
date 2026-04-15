import React from 'react';
import { Player } from '../types/CardGame';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout.ts';

interface TurnIndicatorProps {
  currentPlayer: Player | null;
  gameStage: string;
  displayName?: string;
}

const TurnIndicator: React.FC<TurnIndicatorProps> = ({ currentPlayer, gameStage, displayName }) => {
  const { scale, isCompact } = useResponsiveLayout();

  if (gameStage !== 'play' || !currentPlayer) {
    return null;
  }

  // Pin indicator just below the North player's cards (which sit at y=70*scale with height ~96*scale)
  const topPx = Math.round(70 * scale + 96 * scale + 12);

  return (
    <div
      className={`absolute left-1/2 transform -translate-x-1/2 bg-white bg-opacity-95 rounded-lg shadow-lg border-2 border-blue-500 z-30 ${
        isCompact ? 'px-2 py-1' : 'px-4 py-2'
      }`}
      style={{ top: `${topPx}px` }}
    >
      <div className="flex items-center gap-2">
        <div className={`bg-blue-500 rounded-full animate-pulse ${isCompact ? 'w-2 h-2' : 'w-3 h-3'}`}></div>
        <span className={`font-bold text-gray-800 ${isCompact ? 'text-xs' : ''}`}>
          {(displayName || currentPlayer.name)}'s Turn
        </span>
      </div>
    </div>
  );
};

export default TurnIndicator;