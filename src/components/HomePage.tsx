import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface HomePageProps {}

const cardBackings = [
  { id: 'classic', name: 'Classic Green', pattern: 'repeating-linear-gradient(45deg, #006400, #006400 5px, #005300 5px, #005300 10px)' },
  { id: 'blue', name: 'Royal Blue', pattern: 'repeating-linear-gradient(45deg, #1a237e, #1a237e 5px, #0d1442 5px, #0d1442 10px)' },
  { id: 'red', name: 'Casino Red', pattern: 'repeating-linear-gradient(45deg, #8b0000, #8b0000 5px, #5c0000 5px, #5c0000 10px)' },
  { id: 'purple', name: 'Royal Purple', pattern: 'repeating-linear-gradient(45deg, #4a148c, #4a148c 5px, #2a0a52 5px, #2a0a52 10px)' },
  { id: 'gold', name: 'Gold Pattern', pattern: 'repeating-linear-gradient(45deg, #b8860b, #b8860b 5px, #8b6508 5px, #8b6508 10px)' },
  { id: 'teal', name: 'Ocean Teal', pattern: 'repeating-linear-gradient(45deg, #00695c, #00695c 5px, #004d40 5px, #004d40 10px)' },
];

const games = [
  { id: 'hearts', name: 'Hearts', description: 'Classic trick-avoiding game. Try to have the lowest score!' },
  { id: 'bidwhist', name: 'Bid Whist', description: 'Partnership trick-taking game with bidding.' },
];

const HomePage: React.FC<HomePageProps> = () => {
  const navigate = useNavigate();
  const [selectedGame, setSelectedGame] = useState('hearts');
  const [selectedBacking, setSelectedBacking] = useState(() => {
    return localStorage.getItem('cardBacking') || 'classic';
  });

  const handleBackingChange = (backingId: string) => {
    setSelectedBacking(backingId);
    localStorage.setItem('cardBacking', backingId);
  };

  const handlePlayGame = () => {
    navigate(`/${selectedGame}`);
  };

  const selectedBackingData = cardBackings.find(b => b.id === selectedBacking);
  const selectedGameData = games.find(g => g.id === selectedGame);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        backgroundColor: '#1a1a2e',
        backgroundImage: 'radial-gradient(circle at 50% 50%, #16213e 0%, #1a1a2e 100%)'
      }}
    >
      <div className="bg-white rounded-lg shadow-2xl p-8 max-w-lg w-full mx-4">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">Card Games</h1>
        <p className="text-gray-500 text-center mb-8">Select a game and customize your cards</p>

        {/* Game Selection */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Select Game
          </label>
          <select
            value={selectedGame}
            onChange={(e) => setSelectedGame(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
          >
            {games.map(game => (
              <option key={game.id} value={game.id}>{game.name}</option>
            ))}
          </select>
          {selectedGameData && (
            <p className="mt-2 text-sm text-gray-500">{selectedGameData.description}</p>
          )}
        </div>

        {/* Card Backing Selection */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Card Backing
          </label>
          <div className="grid grid-cols-3 gap-3">
            {cardBackings.map(backing => (
              <button
                key={backing.id}
                onClick={() => handleBackingChange(backing.id)}
                className={`relative p-1 rounded-lg transition-all ${
                  selectedBacking === backing.id
                    ? 'ring-2 ring-blue-500 ring-offset-2'
                    : 'hover:ring-2 hover:ring-gray-300'
                }`}
              >
                <div
                  className="w-full h-16 rounded border border-gray-400"
                  style={{ background: backing.pattern }}
                />
                <span className="block text-xs mt-1 text-gray-600 truncate">{backing.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Preview Card */}
        <div className="mb-8 flex justify-center">
          <div className="text-center">
            <span className="text-sm text-gray-500 block mb-2">Preview</span>
            <div
              className="w-20 h-28 rounded border-2 border-gray-400 shadow-lg mx-auto"
              style={{ background: selectedBackingData?.pattern }}
            />
          </div>
        </div>

        {/* Play Button */}
        <button
          onClick={handlePlayGame}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg text-xl transition-colors shadow-lg"
        >
          Play {selectedGameData?.name}
        </button>
      </div>
    </div>
  );
};

export default HomePage;
export { cardBackings };
