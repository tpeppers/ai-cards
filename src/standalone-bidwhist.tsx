import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import BidWhistGame from './BidWhistGame.tsx';

// MemoryRouter provides the router context BidWhistGame's useLocation
// needs (Challenge Mode detection) without touching window.location.hash,
// which the deck-URL seeding reads directly. The standalone always runs
// with an empty search string, i.e. challenge mode off.
const root = createRoot(document.getElementById('root')!);
root.render(
  <div style={{ width: '100%', height: '100%' }}>
    <MemoryRouter>
      <BidWhistGame />
    </MemoryRouter>
  </div>
);
