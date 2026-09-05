import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useResponsiveLayout } from './useResponsiveLayout.ts';

/** Gap kept between the bottom of a panel and the top of the human's card fan. */
export const HAND_CLEARANCE = 6;
/** Panel inset from the top of the play area once it stops being centred. */
export const OVERLAY_TOP_INSET = 34;

export interface OverlayFit {
  /** Current rung: 0 is the roomiest layout, `maxStage` the most squeezed. */
  stage: number;
  /** Put on the full-bleed backdrop — it defines the play-area coordinate space. */
  backdropRef: React.RefObject<HTMLDivElement | null>;
  /** Put on the panel itself — this is what gets measured. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** Y of the top of the human's card fan, in play-area coordinates. */
  handTop: number;
  /** Height of one card in the fan. */
  cardHeight: number;
  /** Height of the play area. */
  height: number;
  /**
   * Panel height cap for the final rung: leaves a strip of every card in the
   * fan showing, wide enough for the rank and suit once the cards flip their
   * index to the bottom edge.
   */
  coveredMaxHeight: number;
}

/**
 * Fits a modal panel above the player's own cards on small screens.
 *
 * The caller decides what each rung means (collapse a section, split into two
 * columns, shrink the card buttons); this hook only decides which rung is the
 * lowest one whose rendered panel clears the fan.
 *
 * `contentKey` must capture everything that changes the panel's height, so the
 * search restarts whenever the content does.
 *
 * Callers should put `data-fit-stage={stage}` on the panel — the chosen rung is
 * otherwise invisible from the outside, which makes layout bugs here painful to
 * diagnose in a real browser.
 */
export function useOverlayFit(contentKey: string, maxStage: number): OverlayFit {
  const [stage, setStage] = useState(0);
  const { height, cardHeight, handTopOffset } = useResponsiveLayout();

  const backdropRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const contentKeyRef = useRef(contentKey);
  // Lowest rung still worth trying. Rungs proven too tall for the current
  // content are never retried, which is what keeps the search from ping-ponging.
  const floorRef = useRef(0);

  const handTop = height - handTopOffset;

  /**
   * Measure the panel against the top of the card fan and take one step.
   *
   * Steps up when the panel would sit on the hand, and back down when it turns
   * out to have more room than the rung it is on needs. The walk terminates
   * because `floorRef` only ever rises, so a rung already measured as too tall
   * is never revisited.
   */
  const settle = useCallback(() => {
    const backdrop = backdropRef.current;
    const panel = panelRef.current;
    if (!backdrop || !panel) return;
    const panelBottom = panel.getBoundingClientRect().bottom - backdrop.getBoundingClientRect().top;
    const fits = panelBottom <= handTop - HAND_CLEARANCE;
    setStage(s => {
      if (!fits) {
        if (s >= maxStage) return s;
        floorRef.current = Math.max(floorRef.current, s + 1);
        return s + 1;
      }
      return s > floorRef.current ? s - 1 : s;
    });
  }, [handTop, maxStage]);

  // Re-measure before every paint in which the panel's height could have
  // changed. Each step re-runs this, so the walk finishes within a frame.
  useLayoutEffect(() => {
    if (contentKeyRef.current !== contentKey) {
      contentKeyRef.current = contentKey;
      floorRef.current = 0;
    }
    settle();
  }, [contentKey, stage, settle]);

  // The play-CDN Tailwind build generates a utility's CSS asynchronously the
  // first time that class appears, so the very first measurement of a rung can
  // read too tall and strand the panel further down the ladder than it needs.
  // Once the styles have landed, throw the floor away and let it walk back up.
  useEffect(() => {
    const recheck = () => {
      floorRef.current = 0;
      settle();
    };
    const raf = requestAnimationFrame(recheck);
    const timer = setTimeout(recheck, 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [contentKey, settle]);

  const indexStrip = Math.max(18, cardHeight * 0.45);

  return {
    stage,
    backdropRef,
    panelRef,
    handTop,
    cardHeight,
    height,
    coveredMaxHeight: Math.max(140, handTop + cardHeight - indexStrip - OVERLAY_TOP_INSET),
  };
}
