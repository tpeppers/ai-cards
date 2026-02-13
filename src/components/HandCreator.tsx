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
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importDealString, setImportDealString] = useState('');
  const [importPlayer, setImportPlayer] = useState(0);
  const [importIncludeKitty, setImportIncludeKitty] = useState(false);
  const [sortMode, setSortMode] = useState<string>('none');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

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
    const letters = selectedCards.map(card => cardToLetter(card));
    const deal = new Array(52).fill('_');

    // First 12 cards go to player 0 slots: positions 0, 4, 8, ..., 44
    for (let i = 0; i < Math.min(letters.length, 12); i++) {
      deal[i * 4] = letters[i];
    }
    // Cards 13-16 go to kitty slots: positions 48, 49, 50, 51
    for (let i = 12; i < letters.length; i++) {
      deal[48 + (i - 12)] = letters[i];
    }

    const exportString = "http://localhost:3000/#" + deal.join('');
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
    // Filter out empty lines and trim whitespace
    const handList = hands.split('\n').map(h => h.trim()).filter(h => h.length > 0);
    console.log("Storing hands: ", handList);
    setStoredHands(handList);
  };

  const loadSelectedHand = (handString: string) => {
    if (!handString || !handString.trim()) return;

    // Parse the hand string to recreate the selected cards
    const cards: Card[] = [];
    for (let i = 0; i < handString.length; i++) {
      const letter = handString[i];
      // Skip whitespace and invalid characters
      if (!letter || letter.trim() === '') continue;
      try {
        const card = letterToCard(letter);
        if (card) {
          cards.push(card);
        }
      } catch (e) {
        // Skip invalid card letters
        console.warn(`Skipping invalid card letter: "${letter}"`);
      }
    }
    setSelectedCards(cards);
    setSelectedStoredHand(handString);
  };


  const importFromClipboard = async () => {
    try {
      let text = await navigator.clipboard.readText();
      // Strip URL prefix if present
      const hashIndex = text.indexOf('#');
      if (hashIndex !== -1) {
        text = text.substring(hashIndex + 1);
      }
      // Validate: exactly 52 chars, all valid card letters or underscore
      if (text.length !== 52 || !/^[a-zA-Z_]{52}$/.test(text)) {
        alert('Clipboard does not contain a valid 52-character deal string.');
        return;
      }
      const hasUnderscores = text.includes('_');
      if (hasUnderscores) {
        // Partial deal: extract player 0's hand directly
        const cards: Card[] = [];
        for (let i = 0; i < 12; i++) {
          const letter = text[i * 4];
          if (letter !== '_') {
            try {
              cards.push(letterToCard(letter));
            } catch { /* skip invalid */ }
          }
        }
        // Also grab kitty positions for player 0's extended hand
        for (let i = 48; i < 52; i++) {
          const letter = text[i];
          if (letter !== '_') {
            try {
              cards.push(letterToCard(letter));
            } catch { /* skip invalid */ }
          }
        }
        setSelectedCards(cards);
        setHandSize(cards.length);
      } else {
        // Full deal: show dialog to pick player
        setImportDealString(text);
        setImportPlayer(0);
        setImportIncludeKitty(false);
        setShowImportDialog(true);
      }
    } catch (err) {
      alert('Failed to read clipboard. Make sure you have granted clipboard permissions.');
    }
  };

  const getImportPreviewCards = (dealString: string, player: number, includeKitty: boolean): Card[] => {
    const cards: Card[] = [];
    for (let i = 0; i < 12; i++) {
      const letter = dealString[player + i * 4];
      if (letter && letter !== '_') {
        try { cards.push(letterToCard(letter)); } catch { /* skip */ }
      }
    }
    if (includeKitty) {
      for (let i = 48; i < 52; i++) {
        const letter = dealString[i];
        if (letter && letter !== '_') {
          try { cards.push(letterToCard(letter)); } catch { /* skip */ }
        }
      }
    }
    return cards;
  };

  const confirmImport = () => {
    const cards = getImportPreviewCards(importDealString, importPlayer, importIncludeKitty);
    setSelectedCards(cards);
    setHandSize(cards.length);
    setShowImportDialog(false);
  };

  const resetHand = () => {
    setSelectedCards([]);
    setSelectedStoredHand('');
    setSortMode('none');
  };

  const sortHand = () => {
    const modes = ['none', 'default', 'uptown', 'downtown', 'downtown-noaces'];
    const nextIdx = (modes.indexOf(sortMode) + 1) % modes.length;
    const next = modes[nextIdx];
    setSortMode(next);

    if (next === 'none') return;

    const suitOrder: Record<string, number> = { spades: 1, hearts: 2, clubs: 3, diamonds: 4 };

    const getCardValue = (rank: number, mode: string): number => {
      if (mode === 'default') return rank;
      if (mode === 'uptown') return rank === 1 ? 14 : rank;
      if (mode === 'downtown') return rank === 1 ? 14 : (14 - rank);
      /* downtown-noaces */ return rank === 1 ? 1 : (14 - rank);
    };

    setSelectedCards(prev => [...prev].sort((a, b) => {
      if (suitOrder[a.suit] !== suitOrder[b.suit]) return suitOrder[a.suit] - suitOrder[b.suit];
      return getCardValue(a.rank, next) - getCardValue(b.rank, next);
    }));
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
            max="16"
            value={handSize}
            onChange={(e) => handleHandSizeChange(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
          />
          <div className="flex justify-between text-sm text-gray-600 mt-1">
            <span>1</span>
            <span>16</span>
          </div>
        </div>
        <p className="text-lg mb-2">
          Selected: {selectedCards.length}/{handSize} cards
        </p>
        {(
          <div className="mb-4">
            <div className="text-sm text-gray-600 mb-2">Selected cards:</div>
            <div className="flex flex-wrap gap-1">
              {selectedCards.length === 0 ? `None` : selectedCards.map((card, index) => (
                <div
                  key={card.id}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex === null || dragIndex === index) return;
                    setSelectedCards(prev => {
                      const next = [...prev];
                      const [moved] = next.splice(dragIndex, 1);
                      next.splice(index, 0, moved);
                      return next;
                    });
                    setSortMode('none');
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  style={{ cursor: 'grab' }}
                  className={dragIndex !== null && dragIndex !== index ? 'border-l-2 border-blue-400' : ''}
                >
                  <CardImage suit={card.suit} rank={card.rank} />
                </div>
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
            onClick={sortHand}
            disabled={selectedCards.length < 2}
            className={`
              px-6 py-3 font-semibold rounded-lg text-lg
              ${selectedCards.length >= 2
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }
              transition-colors duration-200
            `}
          >
            Sort Hand{sortMode !== 'none' ? ` (${sortMode === 'default' ? 'Low→High'
              : sortMode === 'uptown' ? 'Uptown'
              : sortMode === 'downtown' ? 'Downtown'
              : 'No Aces'})` : ''}
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
          <button
            onClick={importFromClipboard}
            className="px-6 py-2 font-semibold rounded-lg text-base bg-teal-600 hover:bg-teal-700 text-white cursor-pointer transition-colors duration-200"
          >
            Import from Clipboard
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
      {showImportDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold mb-4">Import Hand from Deal</h2>

            <div className="mb-4">
              <label className="block font-semibold mb-2">Select player:</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 0, label: 'South' },
                  { value: 1, label: 'East' },
                  { value: 2, label: 'North' },
                  { value: 3, label: 'West' },
                ].map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="importPlayer"
                      checked={importPlayer === value}
                      onChange={() => setImportPlayer(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={importIncludeKitty}
                  onChange={(e) => setImportIncludeKitty(e.target.checked)}
                />
                Include kitty (4 cards)
              </label>
            </div>

            <div className="mb-4">
              <div className="text-sm text-gray-600 mb-1">
                Preview ({getImportPreviewCards(importDealString, importPlayer, importIncludeKitty).length} cards):
              </div>
              <div className="flex flex-wrap gap-1">
                {getImportPreviewCards(importDealString, importPlayer, importIncludeKitty).map(card => (
                  <CardImage key={card.id} suit={card.suit} rank={card.rank} />
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowImportDialog(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold transition-colors"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HandCreator;