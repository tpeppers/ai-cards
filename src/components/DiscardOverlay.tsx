import React, { useState } from 'react';
import { Card } from '../types/CardGame.ts';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout.ts';

interface DiscardOverlayProps {
  playerHand: Card[];
  trumpSuit: string | null;
  onDiscard: (cardIds: string[]) => void;
}

const suits = [
  { id: 'spades', symbol: '♠', color: 'black' },
  { id: 'hearts', symbol: '♥', color: 'red' },
  { id: 'diamonds', symbol: '♦', color: 'red' },
  { id: 'clubs', symbol: '♣', color: 'black' },
];

const getRankDisplay = (rank: number): string => {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return rank.toString();
};

const DiscardOverlay: React.FC<DiscardOverlayProps> = ({
  playerHand,
  trumpSuit,
  onDiscard
}) => {
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const { isCompact } = useResponsiveLayout();

  const toggleCard = (cardId: string) => {
    const newSelected = new Set(selectedCards);
    if (newSelected.has(cardId)) {
      newSelected.delete(cardId);
    } else if (newSelected.size < 4) {
      newSelected.add(cardId);
    }
    setSelectedCards(newSelected);
  };

  const handleDiscard = () => {
    if (selectedCards.size === 4) {
      onDiscard(Array.from(selectedCards));
    }
  };

  const getSuitInfo = (suitId: string) => {
    return suits.find(s => s.id === suitId) || { symbol: '?', color: 'black' };
  };

  return (
    <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-2">
      <div className={`bg-white rounded-lg shadow-2xl w-full max-w-2xl overflow-y-auto ${isCompact ? 'p-2 max-h-[95vh]' : 'p-5'}`}>
        <h2 className={`font-bold text-center text-gray-800 ${isCompact ? 'text-base mb-1' : 'text-xl mb-1'}`}>Discard 4 Cards</h2>
        <p className={`text-center text-gray-600 ${isCompact ? 'text-[11px] mb-2' : 'text-sm mb-3'}`}>
          Select 4 cards to discard. Trump ({getSuitInfo(trumpSuit || '').symbol}) highlighted.
        </p>

        {/* Card selection grid */}
        <div className={isCompact ? 'mb-2' : 'mb-4'}>
          <div className={`flex flex-wrap justify-center bg-gray-100 rounded-lg ${isCompact ? 'gap-1 p-1' : 'gap-2 p-3'}`}>
            {playerHand.map((card) => {
              const suitInfo = getSuitInfo(card.suit);
              const isSelected = selectedCards.has(card.id);
              const isTrump = card.suit === trumpSuit;
              return (
                <button
                  key={card.id}
                  onClick={() => toggleCard(card.id)}
                  className={`bg-white rounded border-2 flex flex-col items-center justify-center font-bold transition-all hover:scale-105 ${
                    isCompact ? 'w-8 h-11' : 'w-12 h-16'
                  } ${
                    isSelected
                      ? 'border-red-500 ring-2 ring-red-300 bg-red-50'
                      : isTrump
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                  style={{ color: suitInfo.color === 'red' ? '#dc2626' : '#1f2937' }}
                >
                  <span className={isCompact ? 'text-xs' : 'text-base'}>{getRankDisplay(card.rank)}</span>
                  <span className={`leading-none ${isCompact ? 'text-sm' : 'text-lg'}`}>{suitInfo.symbol}</span>
                  {isSelected && (
                    <span className={`text-red-600 font-bold ${isCompact ? 'text-[9px]' : 'text-xs'}`}>X</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selection count and hint */}
        <div className={`bg-gray-100 rounded-lg text-center ${isCompact ? 'p-1 mb-2' : 'p-2 mb-4'}`}>
          <div className={`text-gray-600 ${isCompact ? 'text-[11px]' : 'text-sm'}`}>
            <span className="font-bold">{selectedCards.size}/4</span> selected
            {selectedCards.size < 4 && (
              <span className="text-gray-500 ml-2">
                ({4 - selectedCards.size} more)
              </span>
            )}
          </div>
          {!isCompact && (
            <div className="text-xs text-yellow-700 mt-1">
              Tip: Avoid discarding trump cards (yellow border)
            </div>
          )}
        </div>

        <button
          onClick={handleDiscard}
          disabled={selectedCards.size !== 4}
          className={`w-full font-bold rounded-lg transition-colors ${
            isCompact ? 'py-2 px-3 text-sm' : 'py-3 px-6 text-lg'
          } ${
            selectedCards.size === 4
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {selectedCards.size === 4 ? 'Discard Selected' : `Select ${4 - selectedCards.size} more`}
        </button>
      </div>
    </div>
  );
};

export default DiscardOverlay;
