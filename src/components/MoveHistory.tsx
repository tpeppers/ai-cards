import React from 'react';

interface MoveHistoryEntry {
  id: string;
  playerName: string;
  card: string;
  timestamp: number;
}

interface MoveHistoryProps {
  moves: MoveHistoryEntry[];
}

const MoveHistory: React.FunctionComponent<MoveHistoryProps> = ({ moves }) => {
  return (
    <div className="absolute bottom-4 right-4 bg-white bg-opacity-90 p-3 rounded border border-gray-400 shadow-md w-64 max-h-48 overflow-y-auto z-10">
      <div className="text-sm font-bold border-b border-gray-400 mb-2 pb-1">
        Move History
      </div>
      <div className="space-y-1">
        {moves.length === 0 ? (
          <div className="text-xs text-gray-500 italic">No moves yet</div>
        ) : (
          moves.slice(-10).map((move) => (
            <div key={move.id} className="text-xs">
              <span className="font-medium">{move.playerName}</span>: {move.card}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MoveHistory;