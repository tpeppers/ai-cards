import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import HeartsGame from './cards.tsx';
import HandCreator from './components/HandCreator.tsx';
import Upload from './components/Upload.tsx';

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
              Hearts Game
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
          </div>
        </nav>

        <Routes>
          <Route path="/" element={<HeartsGame />} />
          <Route path="/hand-creator" element={<HandCreator />} />
          <Route path="/upload" element={<Upload />} />
        </Routes>
      </Router>
    </>
  );
}

export default App;
