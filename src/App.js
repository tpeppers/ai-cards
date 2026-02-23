import React, { useState, useRef, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import HomePage from './components/HomePage.tsx';
import HeartsGame from './cards.tsx';
import BidWhistGame from './BidWhistGame.tsx';
import HandCreator from './components/HandCreator.tsx';
import Upload from './components/Upload.tsx';
import StrategyComparison from './components/StrategyComparison.tsx';
import ReplayPage from './components/ReplayPage.tsx';
import SettingsPage from './components/SettingsPage.tsx';
import MultiplayerPage from './components/MultiplayerPage.tsx';

function NavDropdown({ label, items, openMenu, setOpenMenu }) {
  const ref = useRef(null);
  const isOpen = openMenu === label;

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        if (isOpen) setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, setOpenMenu]);

  const location = useLocation();
  const isActive = items.some(item =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpenMenu(isOpen ? null : label)}
        className={`flex items-center gap-1 px-3 py-1.5 rounded transition-colors ${
          isActive ? 'text-blue-300' : 'hover:text-blue-300'
        }`}
      >
        {label}
        <svg className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-gray-700 rounded shadow-lg py-1 min-w-[160px] z-50">
          {items.map(item => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpenMenu(null)}
              className={`block px-4 py-2 transition-colors ${
                (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to))
                  ? 'text-blue-300 bg-gray-600'
                  : 'hover:bg-gray-600 hover:text-blue-300'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NavBar() {
  const [openMenu, setOpenMenu] = useState(null);
  const location = useLocation();

  const playItems = [
    { label: 'Home', to: '/' },
    { label: 'Hearts', to: '/hearts' },
    { label: 'Bid Whist', to: '/bidwhist' },
    { label: 'Multiplayer', to: '/multiplayer' },
  ];

  const analysisItems = [
    { label: 'Hand Creator', to: '/hand-creator' },
    { label: 'Upload', to: '/upload' },
    { label: 'Compare', to: '/compare' },
    { label: 'Replay', to: '/replay' },
  ];

  return (
    <nav className="bg-gray-800 text-white p-4">
      <div className="max-w-6xl mx-auto flex items-center">
        <div className="flex space-x-2">
          <NavDropdown label="Play" items={playItems} openMenu={openMenu} setOpenMenu={setOpenMenu} />
          <NavDropdown label="Analysis" items={analysisItems} openMenu={openMenu} setOpenMenu={setOpenMenu} />
        </div>
        <div className="ml-auto">
          <Link
            to="/settings"
            onClick={() => setOpenMenu(null)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors ${
              location.pathname === '/settings' ? 'text-blue-300' : 'hover:text-blue-300'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </Link>
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <>
      <meta httpEquiv="Content-Security-Policy" content="%%CSP_CONTENT%%"></meta>
      <Router>
        <NavBar />

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
