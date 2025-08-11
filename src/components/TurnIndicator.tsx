import React from 'react';
import { Player } from '../types/CardGame';

interface TurnIndicatorProps {
  currentPlayer: Player | null;
  gameStage: string;
}

const TurnIndicator: React.FC<TurnIndicatorProps> = ({ currentPlayer, gameStage }) => {
  if (gameStage !== 'play' || !currentPlayer) {
    return null;
  }

  return (
    <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-white bg-opacity-95 px-4 py-2 rounded-lg shadow-lg border-2 border-blue-500 z-30">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
        <span className="font-bold text-gray-800">
          {currentPlayer.name}'s Turn
        </span>
      </div>
    </div>
  );
};

export default TurnIndicator;