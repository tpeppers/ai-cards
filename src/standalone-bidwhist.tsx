import React from 'react';
import { createRoot } from 'react-dom/client';
import BidWhistGame from './BidWhistGame.tsx';

const root = createRoot(document.getElementById('root')!);
root.render(<BidWhistGame />);
