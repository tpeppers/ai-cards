import React, { useState, useEffect, useRef, useLayoutEffect, createContext, useContext } from 'react';

export const BASE_CARD_WIDTH = 71;
export const BASE_CARD_HEIGHT = 96;

const REFERENCE_WIDTH = 900;
const REFERENCE_HEIGHT = 700;
const MIN_SCALE = 0.5;
const COMPACT_WIDTH_BREAKPOINT = 700;
// Any viewport shorter than this triggers compact mode too, so landscape
// phones (wide but short) get the corner-anchored chrome.
const COMPACT_HEIGHT_BREAKPOINT = 500;

export interface ResponsiveLayout {
  width: number;
  height: number;
  scale: number;
  cardWidth: number;
  cardHeight: number;
  isCompact: boolean;
  isLandscape: boolean;
}

const computeLayout = (width: number, height: number): ResponsiveLayout => {
  const effectiveHeight = Math.max(200, height);
  const effectiveWidth = Math.max(200, width);
  const scaleX = effectiveWidth / REFERENCE_WIDTH;
  const scaleY = effectiveHeight / REFERENCE_HEIGHT;
  const scale = Math.max(MIN_SCALE, Math.min(1, Math.min(scaleX, scaleY)));
  const isCompact =
    effectiveWidth < COMPACT_WIDTH_BREAKPOINT ||
    effectiveHeight < COMPACT_HEIGHT_BREAKPOINT;
  const isLandscape =
    effectiveWidth > effectiveHeight && effectiveHeight < COMPACT_HEIGHT_BREAKPOINT;
  return {
    width: effectiveWidth,
    height: effectiveHeight,
    scale,
    cardWidth: BASE_CARD_WIDTH * scale,
    cardHeight: BASE_CARD_HEIGHT * scale,
    isCompact,
    isLandscape,
  };
};

const readViewportLayout = (): ResponsiveLayout => {
  if (typeof window === 'undefined') {
    return computeLayout(REFERENCE_WIDTH, REFERENCE_HEIGHT);
  }
  return computeLayout(window.innerWidth, window.innerHeight);
};

const PlayAreaLayoutContext = createContext<ResponsiveLayout | null>(null);

/**
 * Provider that measures its wrapping element and exposes the resulting
 * layout to descendants via context. Children that call useResponsiveLayout
 * get the actual play-area dimensions instead of window.innerWidth/Height.
 * Falls back to the window viewport if no element has been attached yet.
 */
export const PlayAreaLayoutProvider: React.FC<{
  elementRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}> = ({ elementRef, children }) => {
  const [layout, setLayout] = useState<ResponsiveLayout>(readViewportLayout);

  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      // If the element has not been laid out yet (w/h still 0), fall back to window.
      if (rect.width > 0 && rect.height > 0) {
        setLayout(computeLayout(rect.width, rect.height));
      } else {
        setLayout(readViewportLayout());
      }
    };

    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      return () => ro.disconnect();
    }

    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [elementRef]);

  return React.createElement(
    PlayAreaLayoutContext.Provider,
    { value: layout },
    children
  );
};

/**
 * Read the current play-area layout. Inside a PlayAreaLayoutProvider this
 * returns the measured container dimensions; outside a provider it falls
 * back to the window viewport (so standalone entry points still work).
 */
export function useResponsiveLayout(): ResponsiveLayout {
  const ctx = useContext(PlayAreaLayoutContext);
  const [fallback, setFallback] = useState<ResponsiveLayout>(readViewportLayout);

  useEffect(() => {
    if (ctx) return; // context-provided layout, no window listener needed
    const onResize = () => setFallback(readViewportLayout());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [ctx]);

  return ctx || fallback;
}
