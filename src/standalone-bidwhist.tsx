import React from 'react';
import { createRoot } from 'react-dom/client';
import BidWhistGame from './BidWhistGame.tsx';

const root = createRoot(document.getElementById('root')!);
root.render(
  <div style={{ width: '100%', height: '100%' }}>
    <BidWhistGame />
  </div>
);
