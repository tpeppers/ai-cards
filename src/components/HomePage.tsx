import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

interface HomePageProps {}

const games = [
  { id: 'hearts', name: 'Hearts', description: 'Classic trick-avoiding game. Try to have the lowest score!' },
  { id: 'bidwhist', name: 'Bid Whist', description: 'Partnership trick-taking game with bidding.' },
];

const HomePage: React.FC<HomePageProps> = () => {
  const navigate = useNavigate();
  const [selectedGame, setSelectedGame] = useState('hearts');

  const handlePlayGame = () => {
    navigate(`/${selectedGame}`);
  };

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

        {/* Settings Link */}
        <div className="mb-8 text-center">
          <Link
            to="/settings"
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            Customize card backing, suit colors &amp; animations in Settings
          </Link>
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
