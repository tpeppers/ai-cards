import React, { useState, useEffect } from 'react';
import { Card } from '../types/CardGame';
import { cardToLetter, handToCanonicalString, letterToCard } from '../urlGameState.js';
import { getStoredHands } from './HandStorage.js'


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
  const [handSize, setHandSize] = useState<number>(12);
  const [storedHands, setStoredHands] = useState<string[]>([]);
  const [selectedStoredHand, setSelectedStoredHand] = useState<string>('');

  const handleHandSizeChange = (newSize: number) => {
    setHandSize(newSize);
    if (selectedCards.length > newSize) {
      setSelectedCards(prev => prev.slice(0, newSize));
    }
  };

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
    } else if (selectedCards.length < handSize) {
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

    // then add "___"s on to the end until the total length is 52
    var amountToAdd = 52 - exportString.length;
    exportString = exportString + '_'.repeat(amountToAdd);
    exportString = "http://localhost:3000/#" + exportString;
    navigator.clipboard.writeText(exportString);
  };

  const exportHandToDisk = async () => {
    if (selectedCards.length === 0) return;

    // Convert selected cards to letters and get canonical string
    const handLetters = selectedCards.map(card => cardToLetter(card)).join('');
    const canonicalHand = handToCanonicalString(handLetters);

    try {
      // Save to server
      const response = await fetch('http://localhost:3001/api/hands', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ hands: [canonicalHand] })
      });

      if (!response.ok) {
        throw new Error('Failed to save hand to server');
      }

      const result = await response.json();

      // Refresh stored hands
      await loadStoredHands();

      alert(`Hand saved to server! Total hands: ${result.totalHands}`);

      // Get all hands for download
      const allHands = await getStoredHands();

      // Create and download file
      const blob = new Blob([allHands.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'hands.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error saving hand:', error);
      alert('Failed to save hand to server');
    }
  };

  const importHandsFromDisk = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const content = e.target?.result as string;
            const importedHands = content.split('\n').filter(hand => hand.trim() !== '');

            // Save to server
            const response = await fetch('http://localhost:3001/api/hands', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ hands: importedHands })
            });

            if (!response.ok) {
              throw new Error('Failed to save hands to server');
            }

            const result = await response.json();

            // Refresh stored hands
            await loadStoredHands();

            alert(`Imported ${importedHands.length} hands. Total unique hands: ${result.totalHands}`);
          } catch (error) {
            console.error('Error importing hands:', error);
            alert('Failed to import hands to server');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const loadStoredHands = async () => {
    const hands = await getStoredHands();
    console.log("Storing hands: ", hands.split('\n'));
    setStoredHands(hands.split('\n'));
  };

  const loadSelectedHand = (handString: string) => {
    if (!handString) return;

    // Parse the hand string to recreate the selected cards
    const cards: Card[] = [];
    for (let i = 0; i < handString.length; i++) {
      const letter = handString[i];
      const card = letterToCard(letter);
      if (card) {
        cards.push(card);
      }
    }
    setSelectedCards(cards);
    setSelectedStoredHand(handString);
  };


  const resetHand = () => {
    setSelectedCards([]);
    setSelectedStoredHand('');
  };

  useEffect(() => {
    loadStoredHands();
  }, []);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-center">Hand Creator</h1>

      <div className="mb-6">
        <div className="mb-4">
          <label htmlFor="storedHands" className="block text-lg font-semibold mb-2">
            Load Stored Hand
          </label>
          <select
            id="storedHands"
            value={selectedStoredHand}
            onChange={(e) => loadSelectedHand(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-lg text-base"
          >
            <option value="">Select a stored hand...</option>
            {storedHands.map((hand, index) => (
              <option key={index} value={hand}>
                Hand {index + 1}: {hand}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-4">
          <label htmlFor="handSize" className="block text-lg font-semibold mb-2">
            Hand Size: {handSize} cards
          </label>
          <input
            id="handSize"
            type="range"
            min="1"
            max="13"
            value={handSize}
            onChange={(e) => handleHandSizeChange(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
          />
          <div className="flex justify-between text-sm text-gray-600 mt-1">
            <span>1</span>
            <span>13</span>
          </div>
        </div>
        <p className="text-lg mb-2">
          Selected: {selectedCards.length}/{handSize} cards
        </p>
        {(
          <div className="mb-4">
            <div className="text-sm text-gray-600 mb-2">Selected cards:</div>
            <div className="flex flex-wrap gap-1">
              {selectedCards.length === 0 ? `None` : selectedCards.map(card => (
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

      <div className="grid grid-cols-2 gap-4">
        {/* Left column - Black suits */}
        <div className="space-y-4">
          {suits.filter(s => s.color === 'black').map((suit) => (
            <div key={suit.name} className="border rounded-lg p-2">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-1">
                <span style={{ color: suit.color }}>{suit.symbol}</span>
                <span className="capitalize">{suit.name}</span>
              </h2>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 13 }, (_, i) => i + 1).map((rank) => {
                  const selected = isCardSelected(suit.name, rank);
                  const disabled = !selected && selectedCards.length >= handSize;

                  return (
                    <button
                      key={rank}
                      onClick={() => toggleCard(suit.name, rank)}
                      disabled={disabled}
                      className={`
                        w-6 h-8 border rounded text-xs font-bold
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
                      <div className="flex flex-col items-center justify-center h-full leading-none">
                        <div style={{ fontSize: '10px' }}>{getRankDisplay(rank)}</div>
                        <div style={{ fontSize: '10px' }}>{suit.symbol}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {/* Right column - Red suits */}
        <div className="space-y-4">
          {suits.filter(s => s.color === 'red').map((suit) => (
            <div key={suit.name} className="border rounded-lg p-2">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-1">
                <span style={{ color: suit.color }}>{suit.symbol}</span>
                <span className="capitalize">{suit.name}</span>
              </h2>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 13 }, (_, i) => i + 1).map((rank) => {
                  const selected = isCardSelected(suit.name, rank);
                  const disabled = !selected && selectedCards.length >= handSize;

                  return (
                    <button
                      key={rank}
                      onClick={() => toggleCard(suit.name, rank)}
                      disabled={disabled}
                      className={`
                        w-6 h-8 border rounded text-xs font-bold
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
                      <div className="flex flex-col items-center justify-center h-full leading-none">
                        <div style={{ fontSize: '10px' }}>{getRankDisplay(rank)}</div>
                        <div style={{ fontSize: '10px' }}>{suit.symbol}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 text-center space-y-4">
        <div className="flex justify-center gap-4 flex-wrap">
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
            disabled={selectedCards.length !== handSize}
            className={`
              px-8 py-3 font-semibold rounded-lg text-lg
              ${selectedCards.length === handSize
                ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }
              transition-colors duration-200
            `}
          >
            Export Hand
          </button>
        </div>
        <div className="flex justify-center gap-4 flex-wrap">
          <button
            onClick={exportHandToDisk}
            disabled={selectedCards.length === 0}
            className={`
              px-6 py-2 font-semibold rounded-lg text-base
              ${selectedCards.length > 0
                ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }
              transition-colors duration-200
            `}
          >
            Export to Disk
          </button>
          <button
            onClick={importHandsFromDisk}
            className="px-6 py-2 font-semibold rounded-lg text-base bg-purple-600 hover:bg-purple-700 text-white cursor-pointer transition-colors duration-200"
          >
            Import from Disk
          </button>
        </div>
        {selectedCards.length === handSize && (
          <p className="text-sm text-gray-600">
            Hand will be copied to clipboard
          </p>
        )}
        {selectedCards.length > 0 && selectedCards.length < handSize && (
          <p className="text-sm text-gray-600">
            Click cards to add/remove them from your hand
          </p>
        )}
        <div className="text-sm text-gray-600 space-y-1 mt-4">
          <p><strong>Export to Disk:</strong> Saves canonicalized hands to a downloadable text file</p>
          <p><strong>Import from Disk:</strong> Loads hands from a text file and merges with existing hands</p>
          <p>Hands are automatically deduplicated and sorted alphabetically</p>
        </div>
      </div>
    </div>
  );
};

export default HandCreator;