import { useState, useEffect } from 'react';

export const BASE_CARD_WIDTH = 71;
export const BASE_CARD_HEIGHT = 96;

// Height of the app-level router navbar (bg-gray-800 p-4 in App.js).
// Play areas live below this, so we subtract it from innerHeight.
export const APP_NAV_HEIGHT = 68;

const REFERENCE_WIDTH = 900;
const REFERENCE_HEIGHT = 700;
const MIN_SCALE = 0.5;
const COMPACT_BREAKPOINT = 700;

export interface ResponsiveLayout {
  width: number;
  height: number;
  scale: number;
  cardWidth: number;
  cardHeight: number;
  isCompact: boolean;
}

const readViewport = () => ({
  width: typeof window !== 'undefined' ? window.innerWidth : REFERENCE_WIDTH,
  height: typeof window !== 'undefined' ? window.innerHeight : REFERENCE_HEIGHT,
});

export function useResponsiveLayout(): ResponsiveLayout {
  const [size, setSize] = useState(readViewport);

  useEffect(() => {
    const handleResize = () => setSize(readViewport());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { width } = size;
  // Subtract the app-level router navbar so card positions live in the real play area.
  const height = Math.max(200, size.height - APP_NAV_HEIGHT);
  const scaleX = width / REFERENCE_WIDTH;
  const scaleY = height / REFERENCE_HEIGHT;
  const scale = Math.max(MIN_SCALE, Math.min(1, Math.min(scaleX, scaleY)));
  const cardWidth = BASE_CARD_WIDTH * scale;
  const cardHeight = BASE_CARD_HEIGHT * scale;
  const isCompact = width < COMPACT_BREAKPOINT;

  return { width, height, scale, cardWidth, cardHeight, isCompact };
}
