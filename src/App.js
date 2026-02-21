import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import HomePage from './components/HomePage.tsx';
import HeartsGame from './cards.tsx';
import BidWhistGame from './BidWhistGame.tsx';
import HandCreator from './components/HandCreator.tsx';
import Upload from './components/Upload.tsx';
import StrategyComparison from './components/StrategyComparison.tsx';
import ReplayPage from './components/ReplayPage.tsx';
import SettingsPage from './components/SettingsPage.tsx';
import MultiplayerPage from './components/MultiplayerPage.tsx';

function App() {
  return (
    <>
      <meta httpEquiv="Content-Security-Policy" content="%%CSP_CONTENT%%"></meta>
      <Router>
        <nav className="bg-gray-800 text-white p-4">
          <div className="max-w-6xl mx-auto flex space-x-6">
            <Link
              to="/"
              className="hover:text-blue-300 transition-colors"
            >
              Home
            </Link>
            <Link
              to="/hearts"
              className="hover:text-blue-300 transition-colors"
            >
              Hearts
            </Link>
            <Link
              to="/bidwhist"
              className="hover:text-blue-300 transition-colors"
            >
              Bid Whist
            </Link>
            <Link
              to="/hand-creator"
              className="hover:text-blue-300 transition-colors"
            >
              Hand Creator
            </Link>
            <Link
              to="/upload"
              className="hover:text-blue-300 transition-colors"
            >
              Upload
            </Link>
            <Link
              to="/compare"
              className="hover:text-blue-300 transition-colors"
            >
              Compare
            </Link>
            <Link
              to="/replay"
              className="hover:text-blue-300 transition-colors"
            >
              Replay
            </Link>
            <Link
              to="/multiplayer"
              className="hover:text-blue-300 transition-colors"
            >
              Multiplayer
            </Link>
            <Link
              to="/settings"
              className="hover:text-blue-300 transition-colors"
            >
              Settings
            </Link>
          </div>
        </nav>

        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/hearts" element={<HeartsGame />} />
          <Route path="/bidwhist" element={<BidWhistGame />} />
          <Route path="/hand-creator" element={<HandCreator />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/compare" element={<StrategyComparison />} />
          <Route path="/replay" element={<ReplayPage />} />
          <Route path="/multiplayer" element={<MultiplayerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Router>
    </>
  );
}

export default App;
