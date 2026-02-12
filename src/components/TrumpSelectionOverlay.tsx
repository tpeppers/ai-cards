import React, { useState } from 'react';
import { Card } from '../types/CardGame.ts';

type BidDirection = 'uptown' | 'downtown' | 'downtown-noaces';

interface TrumpSelectionOverlayProps {
  isYourTurn: boolean;
  winningBid: number;
  playerHand: Card[];
  onSelectTrump: (suit: string, direction: BidDirection) => void;
  previewTrump?: { suit: string; direction: string } | null;
}

const suits = [
  { id: 'spades', name: 'Spades', symbol: '♠', color: 'black' },
  { id: 'hearts', name: 'Hearts', symbol: '♥', color: 'red' },
  { id: 'diamonds', name: 'Diamonds', symbol: '♦', color: 'red' },
  { id: 'clubs', name: 'Clubs', symbol: '♣', color: 'black' },
];

const getRankDisplay = (rank: number): string => {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return rank.toString();
};

const TrumpSelectionOverlay: React.FC<TrumpSelectionOverlayProps> = ({
  isYourTurn,
  winningBid,
  playerHand,
  onSelectTrump,
  previewTrump
}) => {
  const [selectedSuit, setSelectedSuit] = useState<string>('spades');
  const [isUptown, setIsUptown] = useState<boolean>(true);
  const [acesGood, setAcesGood] = useState<boolean>(false); // false = aces no good (default for downtown)

  const handleSubmit = () => {
    let direction: BidDirection;
    if (isUptown) {
      direction = 'uptown';
    } else if (acesGood) {
      direction = 'downtown';
    } else {
      direction = 'downtown-noaces';
    }
    onSelectTrump(selectedSuit, direction);
  };

  // Quick-select from card click
  const handleCardClick = (card: Card) => {
    // Set suit
    setSelectedSuit(card.suit);

    // Set direction based on rank: 2-7 = low (downtown), 8-K + A = high (uptown)
    // Ranks: 1=A, 2-10, 11=J, 12=Q, 13=K
    if (card.rank >= 2 && card.rank <= 7) {
      setIsUptown(false);
      setAcesGood(false); // default aces no good for low
    } else {
      setIsUptown(true);
    }
  };

  const getSuitSymbol = (suitId: string) => {
    const suit = suits.find(s => s.id === suitId);
    return suit?.symbol || '?';
  };

  const getSuitColor = (suitId: string) => {
    const suit = suits.find(s => s.id === suitId);
    return suit?.color === 'red' ? '#dc2626' : '#1f2937';
  };

  const getDirectionLabel = () => {
    if (isUptown) return 'Uptown';
    if (acesGood) return 'Downtown';
    return 'Downtown, Aces No Good';
  };

  const getAcceptLabel = () => {
    const suitSymbol = getSuitSymbol(selectedSuit);
    return `Accept (${suitSymbol} ${getDirectionLabel()})`;
  };

  return (
    <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl p-5 max-w-lg w-full mx-4">
        <h2 className="text-xl font-bold text-center mb-1 text-gray-800">Choose Trump</h2>
        <p className="text-center text-gray-600 text-sm mb-3">
          You won with {winningBid}! Click a card or use controls below.
        </p>

        {isYourTurn ? (
          <>
            {/* Clickable hand for quick-select */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Click a card to quick-select:</label>
              <div className="flex flex-wrap gap-1 justify-center bg-gray-100 rounded-lg p-2 max-h-32 overflow-y-auto">
                {playerHand.map((card) => {
                  const suitInfo = suits.find(s => s.id === card.suit);
                  const isSelected = card.suit === selectedSuit;
                  const isPreview = previewTrump != null && card.suit === previewTrump.suit;
                  return (
                    <button
                      key={card.id}
                      onClick={() => handleCardClick(card)}
                      className={`w-10 h-14 bg-white rounded border-2 flex flex-col items-center justify-center text-xs font-bold transition-all hover:scale-105 ${
                        isPreview
                          ? 'border-green-400 ring-2 ring-green-300 bg-green-50 animate-pulse'
                          : isSelected
                            ? 'border-blue-500 ring-2 ring-blue-300 bg-blue-50'
                            : 'border-gray-300 hover:border-gray-400'
                      }`}
                      style={{ color: suitInfo?.color === 'red' ? '#dc2626' : '#1f2937' }}
                    >
                      <span className="text-sm">{getRankDisplay(card.rank)}</span>
                      <span className="text-base leading-none">{suitInfo?.symbol}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Compact controls row */}
            <div className="flex items-center gap-3 mb-4">
              {/* Suit dropdown */}
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Trump Suit</label>
                <select
                  value={selectedSuit}
                  onChange={(e) => setSelectedSuit(e.target.value)}
                  className="w-full p-2 border-2 border-gray-300 rounded-lg text-lg font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-300"
                  style={{ color: getSuitColor(selectedSuit) }}
                >
                  {suits.map(suit => (
                    <option key={suit.id} value={suit.id} style={{ color: suit.color === 'red' ? '#dc2626' : '#1f2937' }}>
                      {suit.symbol} {suit.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Direction toggle */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Direction</label>
                <div className="flex border-2 border-gray-300 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setIsUptown(true)}
                    className={`px-3 py-2 flex items-center gap-1 font-bold transition-colors ${
                      previewTrump != null && previewTrump.direction === 'uptown'
                        ? 'bg-green-500 text-white animate-pulse'
                        : isUptown
                          ? 'bg-blue-500 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-100'
                    }`}
                    title="Uptown - High cards win (A K Q J 10...2)"
                  >
                    <span className="text-lg">↑</span>
                    <span className="text-sm hidden sm:inline">High</span>
                  </button>
                  <button
                    onClick={() => setIsUptown(false)}
                    className={`px-3 py-2 flex items-center gap-1 font-bold transition-colors ${
                      previewTrump != null && previewTrump.direction !== 'uptown'
                        ? 'bg-green-500 text-white animate-pulse'
                        : !isUptown
                          ? 'bg-blue-500 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-100'
                    }`}
                    title="Downtown - Low cards win (2 3 4...K)"
                  >
                    <span className="text-lg">↓</span>
                    <span className="text-sm hidden sm:inline">Low</span>
                  </button>
                </div>
              </div>

              {/* Aces toggle (only visible when downtown) */}
              {!isUptown && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Aces</label>
                  <button
                    onClick={() => setAcesGood(!acesGood)}
                    className={`px-3 py-2 border-2 rounded-lg font-bold text-lg transition-all flex items-center gap-1 ${
                      acesGood
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-red-400 bg-red-50 text-red-600'
                    }`}
                    title={acesGood ? 'Aces are good (high)' : 'Aces are no good (worst)'}
                  >
                    <span className="font-serif">A</span>
                    <span className="text-sm">{acesGood ? '✓' : '✗'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Direction explanation */}
            <div className="bg-gray-100 rounded-lg p-2 mb-4 text-center">
              <div className="text-sm text-gray-600">
                {isUptown ? (
                  <span><strong>Uptown:</strong> A K Q J 10 9 8 7 6 5 4 3 2 (high cards win)</span>
                ) : acesGood ? (
                  <span><strong>Downtown:</strong> A 2 3 4 5 6 7 8 9 10 J Q K (low cards win, A stays high)</span>
                ) : (
                  <span><strong>Downtown, Aces No Good:</strong> 2 3 4 5 6 7 8 9 10 J Q K A (low cards win, A is worst)</span>
                )}
              </div>
            </div>

            <button
              onClick={handleSubmit}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-colors text-lg"
            >
              {getAcceptLabel()}
            </button>
            {previewTrump != null && (
              <div className="mt-2 text-center text-sm text-green-500 animate-pulse">
                Auto Play would: {getSuitSymbol(previewTrump.suit)}{' '}
                {previewTrump.direction === 'uptown' ? 'Uptown' : previewTrump.direction === 'downtown' ? 'Downtown' : 'Downtown, Aces No Good'}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <div className="animate-pulse text-gray-600">
              Waiting for bid winner to choose trump...
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrumpSelectionOverlay;
