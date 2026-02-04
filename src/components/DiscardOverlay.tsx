import React, { useState } from 'react';
import { Card } from '../types/CardGame.ts';

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
    <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl p-5 max-w-2xl w-full mx-4">
        <h2 className="text-xl font-bold text-center mb-1 text-gray-800">Discard 4 Cards</h2>
        <p className="text-center text-gray-600 text-sm mb-3">
          Select 4 cards to discard. Trump suit ({getSuitInfo(trumpSuit || '').symbol}) cards are highlighted.
        </p>

        {/* Card selection grid */}
        <div className="mb-4">
          <div className="flex flex-wrap gap-2 justify-center bg-gray-100 rounded-lg p-3">
            {playerHand.map((card) => {
              const suitInfo = getSuitInfo(card.suit);
              const isSelected = selectedCards.has(card.id);
              const isTrump = card.suit === trumpSuit;
              return (
                <button
                  key={card.id}
                  onClick={() => toggleCard(card.id)}
                  className={`w-12 h-16 bg-white rounded border-2 flex flex-col items-center justify-center text-sm font-bold transition-all hover:scale-105 ${
                    isSelected
                      ? 'border-red-500 ring-2 ring-red-300 bg-red-50'
                      : isTrump
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                  style={{ color: suitInfo.color === 'red' ? '#dc2626' : '#1f2937' }}
                >
                  <span className="text-base">{getRankDisplay(card.rank)}</span>
                  <span className="text-lg leading-none">{suitInfo.symbol}</span>
                  {isSelected && (
                    <span className="text-xs text-red-600 font-bold">X</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selection count and hint */}
        <div className="bg-gray-100 rounded-lg p-2 mb-4 text-center">
          <div className="text-sm text-gray-600">
            <span className="font-bold">{selectedCards.size}/4</span> cards selected
            {selectedCards.size < 4 && (
              <span className="text-gray-500 ml-2">
                (click {4 - selectedCards.size} more)
              </span>
            )}
          </div>
          <div className="text-xs text-yellow-700 mt-1">
            Tip: Avoid discarding trump cards (yellow border)
          </div>
        </div>

        <button
          onClick={handleDiscard}
          disabled={selectedCards.size !== 4}
          className={`w-full font-bold py-3 px-6 rounded-lg transition-colors text-lg ${
            selectedCards.size === 4
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {selectedCards.size === 4 ? 'Discard Selected Cards' : `Select ${4 - selectedCards.size} More Cards`}
        </button>
      </div>
    </div>
  );
};

export default DiscardOverlay;
