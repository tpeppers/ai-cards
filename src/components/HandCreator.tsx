import React, { useState } from 'react';
import { Card } from '../types/CardGame';
import { cardToLetter } from '../urlGameState.js';

const CardImage: React.FC<{ suit: string; rank: number; className?: string }> = ({ suit, rank, className = '' }) => {

  const [selectedCards, setSelectedCards] = useState<Card[]>([]);

  const suits = [
    { name: 'spades', symbol: '♠', color: 'black' },
    { name: 'hearts', symbol: '♥', color: 'red' },
    { name: 'clubs', symbol: '♣', color: 'black' },
    { name: 'diamonds', symbol: '♦', color: 'red' }
  ];

  const getRankDisplay = (rank: number) => {
    switch (rank) {
      case 1: return 'A';
      case 11: return 'J';
      case 12: return 'Q';
      case 13: return 'K';
      default: return rank.toString();
    }
  };

  const isCardSelected = (suit: string, rank: number) => {
    return selectedCards.some(card => card.suit === suit && card.rank === rank);
  };

  const suitInfo = suits[suit as keyof typeof suits];

  const toggleCard = (suit: string, rank: number) => {
    const cardId = `${suit}_${rank}`;
    const card = { suit, rank, id: cardId };

    if (isCardSelected(suit, rank)) {
      setSelectedCards(prev => prev.filter(c => c.id !== cardId));
    } else if (selectedCards.length < 12) {
      setSelectedCards(prev => [...prev, card]);
    }
  };

  // TODO::: GET THE RIGHT SUIT in a TYPESCRIPTY way
  var idx = 0;
  var fdx = 0;
  while (idx < 4) {
    if (suits[idx].name === suit) {
      fdx = idx;
    }
    idx = idx + 1;
  }
  var suitS = suits[fdx];

  return (<button
                    key={rank}
                    onClick={() => toggleCard(suitS.name, rank)}
                    className={`
                      w-12 h-16 border rounded text-sm font-bold
                      'bg-gray-300 text-gray-500 border-gray-400 cursor-pointer opacity-50'
                      transition-colors duration-200
                    `}
                    style={{
                      color: suitS.color
                    }}
                  >
                    <div className="flex flex-col items-center justify-center h-full">
                      <div className="text-xs">{getRankDisplay(rank)}</div>
                      <div className="text-sm">{suitS.symbol}</div>
                    </div>
                  </button>
                
  );
};

const HandCreator: React.FC = () => {
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);

  const suits = [
    { name: 'spades', symbol: '♠', color: 'black' },
    { name: 'hearts', symbol: '♥', color: 'red' },
    { name: 'clubs', symbol: '♣', color: 'black' },
    { name: 'diamonds', symbol: '♦', color: 'red' }
  ];

  const getRankDisplay = (rank: number) => {
    switch (rank) {
      case 1: return 'A';
      case 11: return 'J';
      case 12: return 'Q';
      case 13: return 'K';
      default: return rank.toString();
    }
  };

  const isCardSelected = (suit: string, rank: number) => {
    return selectedCards.some(card => card.suit === suit && card.rank === rank);
  };

  const toggleCard = (suit: string, rank: number) => {
    const cardId = `${suit}_${rank}`;
    const card = { suit, rank, id: cardId };

    if (isCardSelected(suit, rank)) {
      setSelectedCards(prev => prev.filter(c => c.id !== cardId));
    } else if (selectedCards.length < 12) {
      setSelectedCards(prev => [...prev, card]);
    }
  };

  const exportHand = () => {
    // TODO: This needs to actually seed-in _s as every 4th card, to properly stack the deck 
    // NOTE: Is the kitty really just ganna be the last 4 ?! REALLY?!
    //const letters = selectedCards.map(card => cardToLetter(card)).join('');
    //const exportString = letters + '_'.repeat(40);

    var letters = selectedCards.map(card => cardToLetter(card)).join('');
    var exportString = '';
    for(let i = 0; i < letters.length; i = i + 1) {
      exportString = exportString + letters[i] + "___"; // +3x '_' after each letter
    }
    // then an extra 4x "_"s at the end for the kitty
    exportString = exportString + "____"
    navigator.clipboard.writeText(exportString);
  };

  const resetHand = () => {
    setSelectedCards([]);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-center">Hand Creator</h1>

      <div className="mb-6">
        <p className="text-lg mb-2">
          Selected: {selectedCards.length}/12 cards
        </p>
        {selectedCards.length > 0 && (
          <div className="mb-4">
            <div className="text-sm text-gray-600 mb-2">Selected cards:</div>
            <div className="flex flex-wrap gap-1">
              {selectedCards.map(card => (
                <CardImage
                  key={card.id}
                  suit={card.suit}
                  rank={card.rank}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-6">
        {suits.map((suit) => (
          <div key={suit.name} className="border rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
              <span style={{ color: suit.color }}>{suit.symbol}</span>
              <span className="capitalize">{suit.name}</span>
            </h2>
            <div className="grid grid-cols-13 gap-2">
              {Array.from({ length: 13 }, (_, i) => i + 1).map((rank) => {
                const selected = isCardSelected(suit.name, rank);
                const disabled = !selected && selectedCards.length >= 12;

                return (
                  <button
                    key={rank}
                    onClick={() => toggleCard(suit.name, rank)}
                    disabled={disabled}
                    className={`
                      w-12 h-16 border rounded text-sm font-bold
                      ${selected
                        ? 'bg-gray-300 text-gray-500 border-gray-400 cursor-pointer opacity-50'
                        : disabled
                          ? 'bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed'
                          : 'bg-white hover:bg-gray-100 border-gray-300 cursor-pointer'
                      }
                      transition-colors duration-200
                    `}
                    style={{
                      color: !selected && !disabled ? suit.color : undefined
                    }}
                  >
                    <div className="flex flex-col items-center justify-center h-full">
                      <div className="text-xs">{getRankDisplay(rank)}</div>
                      <div className="text-sm">{suit.symbol}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 text-center space-y-4">
        <div className="flex justify-center gap-4">
          <button
            onClick={resetHand}
            disabled={selectedCards.length === 0}
            className={`
              px-6 py-3 font-semibold rounded-lg text-lg
              ${selectedCards.length > 0
                ? 'bg-red-600 hover:bg-red-700 text-white cursor-pointer'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }
              transition-colors duration-200
            `}
          >
            Reset Hand
          </button>
          <button
            onClick={exportHand}
            disabled={selectedCards.length !== 12}
            className={`
              px-8 py-3 font-semibold rounded-lg text-lg
              ${selectedCards.length === 12
                ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }
              transition-colors duration-200
            `}
          >
            Export Hand
          </button>
        </div>
        {selectedCards.length === 12 && (
          <p className="text-sm text-gray-600">
            Hand will be copied to clipboard
          </p>
        )}
        {selectedCards.length > 0 && selectedCards.length < 12 && (
          <p className="text-sm text-gray-600">
            Click cards to add/remove them from your hand
          </p>
        )}
      </div>
    </div>
  );
};

export default HandCreator;