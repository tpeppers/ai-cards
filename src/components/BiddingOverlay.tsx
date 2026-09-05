import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout.ts';

interface BidInfo {
  playerId: number;
  amount: number;
  passed: boolean;
}

interface BiddingOverlayProps {
  isYourTurn: boolean;
  currentHighBid: number;
  validBids: number[];
  bids: BidInfo[];
  playerNames: string[];
  dealer: number;
  currentBidder: number | null;
  onBid: (amount: number) => void;
  previewBid?: number | null;
  /**
   * Fired when the panel has run out of ways to clear the player's hand and
   * is going to sit on top of it. The table responds by moving the card
   * indices into the strip that is still exposed.
   */
  onHandCoverageChange?: (covered: boolean) => void;
}

/**
 * How the panel gives ground as the screen shrinks. Each step is entered only
 * after measuring that the previous one still covers the human's hand — you
 * cannot bid a hand you cannot see, so the hand wins every trade.
 */
const STAGE_ROOMY = 0;        // classic centred modal
const STAGE_COLLAPSED = 1;    // top-anchored, bid history behind a "…" chip
const STAGE_TWO_COLUMN = 2;   // bid controls move into a right-hand column
const STAGE_COVER_HAND = 3;   // hand can't be cleared; leave its index strip showing

/** Gap kept between the bottom of the panel and the top of the card fan. */
const HAND_CLEARANCE = 6;
/** Panel inset from the top of the play area once it stops being centred. */
const TOP_INSET = 34;

const BiddingOverlay: React.FC<BiddingOverlayProps> = ({
  isYourTurn,
  currentHighBid,
  validBids,
  bids,
  playerNames,
  dealer,
  currentBidder,
  onBid,
  previewBid,
  onHandCoverageChange
}) => {
  // Default to pass (0) - user can select a higher bid if they want
  const [selectedBid, setSelectedBid] = useState<number>(0);
  const [stage, setStage] = useState<number>(STAGE_ROOMY);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const { isCompact, isLandscape, width, height, cardHeight, handTopOffset } = useResponsiveLayout();

  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Everything that changes how tall the panel wants to be.
  const contentKey = `${width}x${height}|${bids.length}|${isYourTurn}|${validBids.length}|${historyExpanded}|${previewBid != null}`;
  const contentKeyRef = useRef(contentKey);
  // Lowest rung still worth trying. Rungs proven too tall for the current
  // content are never retried, which is what keeps the search from ping-ponging.
  const floorRef = useRef(STAGE_ROOMY);

  const handTop = height - handTopOffset;
  const isTight = stage >= STAGE_COLLAPSED;
  const isTwoColumn = stage >= STAGE_TWO_COLUMN && isYourTurn;
  const coversHand = stage >= STAGE_COVER_HAND;

  /**
   * Measure the panel against the top of the card fan and take one step.
   *
   * Steps up when the panel would sit on the hand, and back down when it turns
   * out to have more room than the rung it is on needs — the walk terminates
   * because `floorRef` only ever rises, so a rung that has been measured as
   * too tall is never revisited.
   */
  const settle = useCallback(() => {
    const backdrop = backdropRef.current;
    const panel = panelRef.current;
    if (!backdrop || !panel) return;
    const panelBottom = panel.getBoundingClientRect().bottom - backdrop.getBoundingClientRect().top;
    const fits = panelBottom <= handTop - HAND_CLEARANCE;
    setStage(s => {
      if (!fits) {
        if (s >= STAGE_COVER_HAND) return s;
        floorRef.current = Math.max(floorRef.current, s + 1);
        return s + 1;
      }
      return s > floorRef.current ? s - 1 : s;
    });
  }, [handTop]);

  // Re-measure before every paint in which the panel's height could have
  // changed. Each step re-runs this, so the walk finishes within a frame.
  useLayoutEffect(() => {
    if (contentKeyRef.current !== contentKey) {
      contentKeyRef.current = contentKey;
      floorRef.current = STAGE_ROOMY;
    }
    settle();
  }, [contentKey, stage, handTop, settle]);

  // The play-CDN Tailwind build generates a utility's CSS asynchronously the
  // first time that class appears, so the very first measurement of a rung can
  // read too tall and strand the panel further down the ladder than it needs.
  // Once the styles have landed, throw the floor away and let it walk back up.
  useEffect(() => {
    const recheck = () => {
      floorRef.current = STAGE_ROOMY;
      settle();
    };
    const raf = requestAnimationFrame(recheck);
    const timer = setTimeout(recheck, 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [contentKey, settle]);

  // Tell the table when the hand is about to be covered, and hand the flag
  // back on the way out so the cards return to normal after bidding.
  useEffect(() => {
    onHandCoverageChange?.(coversHand);
    return () => onHandCoverageChange?.(false);
  }, [coversHand, onHandCoverageChange]);

  const getBidLabel = (amount: number): string => {
    if (amount === 0) return 'Pass';
    if (amount === -1) return 'Take It';
    return amount.toString();
  };

  const handleSubmitBid = () => {
    onBid(selectedBid);
  };

  // Once the panel has to overlap, cap it so a strip of every card — enough
  // for the flipped-down rank and suit — stays below it.
  const indexStrip = Math.max(18, cardHeight * 0.45);
  const panelMaxHeight = coversHand
    ? Math.max(140, handTop + cardHeight - indexStrip - TOP_INSET)
    : isTight
      ? Math.max(140, height - TOP_INSET - 8)
      : undefined;

  const bidRows = (
    <div className="space-y-0.5">
      {bids.map((bid, index) => (
        <div key={index} className={`flex justify-between bg-gray-50 rounded ${isCompact ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'}`}>
          <span>{playerNames[bid.playerId]}</span>
          <span className={bid.passed ? 'text-gray-500' : 'text-green-600 font-semibold'}>
            {bid.passed ? 'Passed' : bid.amount}
          </span>
        </div>
      ))}
    </div>
  );

  const bidHistory = bids.length === 0 ? null : isTight ? (
    // Collapsed: a "…" chip that opens the list in place.
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setHistoryExpanded(v => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded px-2 py-1"
        aria-expanded={historyExpanded}
      >
        <span>Bids So Far ({bids.length})</span>
        <span className="text-gray-500 leading-none">{historyExpanded ? '▾' : '⋯'}</span>
      </button>
      {historyExpanded && <div className="mt-1">{bidRows}</div>}
    </div>
  ) : (
    <div className={isCompact ? 'mb-2' : 'mb-4'}>
      <h3 className={`font-semibold text-gray-700 ${isCompact ? 'text-xs mb-1' : 'mb-2'}`}>Bids So Far:</h3>
      {bidRows}
    </div>
  );

  const header = isTight ? (
    <div className="flex items-baseline justify-between mb-1">
      <h2 className="font-bold text-gray-800 text-sm">Bidding</h2>
      <span className="text-[11px] text-gray-500 truncate ml-2">{playerNames[dealer]} deals</span>
    </div>
  ) : (
    <>
      <h2 className={`font-bold text-center text-gray-800 ${isCompact ? 'text-lg mb-1' : 'text-2xl mb-2'}`}>Bidding Phase</h2>
      <p className={`text-center text-gray-500 ${isCompact ? 'text-xs mb-2' : 'text-sm mb-4'}`}>
        {playerNames[dealer]} is dealing
      </p>
    </>
  );

  const highBid = (
    <div className={`bg-gray-100 rounded ${isTight ? 'px-2 py-1 mb-2' : isCompact ? 'p-1 mb-2' : 'p-3 mb-4'}`}>
      <div className={isTight ? 'flex items-baseline justify-between' : 'text-center'}>
        <span className={`text-gray-600 ${isCompact ? 'text-xs' : ''}`}>{isTight ? 'High Bid' : 'Current High Bid: '}</span>
        <span className={`font-bold text-blue-600 ${isTight ? 'text-sm' : isCompact ? 'text-base' : 'text-xl'}`}>
          {currentHighBid > 0 ? currentHighBid : 'None'}
        </span>
      </div>
    </div>
  );

  const dealerHint = validBids.includes(-1) && (
    <div className={`bg-yellow-50 border border-yellow-200 rounded text-yellow-800 ${
      isTight ? 'p-1 text-[11px] leading-snug' : isCompact ? 'p-1 text-xs' : 'p-2 text-sm'
    }`}>
      {isTight
        ? 'As dealer you can "Take It" without raising.'
        : 'As dealer, you can "Take It" to claim the current bid without raising!'}
    </div>
  );

  // Select + submit. In the two-column layout this column never scrolls, so
  // the button stays reachable however long the bid history gets.
  const bidControls = (
    <div className={isTight ? 'space-y-1.5' : isCompact ? 'space-y-2' : 'space-y-4'}>
      {!isTwoColumn && dealerHint}
      <div>
        <label className={`block font-semibold text-gray-700 ${
          isTight ? 'text-[11px] mb-0.5' : isCompact ? 'text-xs mb-1' : 'text-sm mb-2'
        }`}>
          Your Bid:
        </label>
        <select
          value={selectedBid}
          onChange={(e) => setSelectedBid(Number(e.target.value))}
          className={`w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
            isTight ? 'p-1.5 text-sm' : isCompact ? 'p-2 text-sm' : 'p-3 text-lg'
          }`}
        >
          {validBids.map(bid => (
            <option key={bid} value={bid}>
              {getBidLabel(bid)}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={handleSubmitBid}
        className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors ${
          isTight ? 'py-2 px-2 text-sm' : isCompact ? 'py-2 px-3 text-sm' : 'py-3 px-6'
        }`}
      >
        {selectedBid === 0 ? 'Pass' : selectedBid === -1 ? 'Take It' : `Bid ${selectedBid}`}
      </button>
      {previewBid != null && (
        <div className={`text-center text-blue-400 animate-pulse ${isTight ? 'text-[10px]' : isCompact ? 'text-xs mt-1' : 'text-sm mt-2'}`}>
          Auto Play would: {getBidLabel(previewBid)}
        </div>
      )}
    </div>
  );

  const waiting = (
    <div className={isTight ? 'text-center py-1 text-xs' : 'text-center py-4'}>
      <div className="text-gray-600">
        <span className="animate-pulse">Waiting for </span>
        <span className="font-semibold">{currentBidder !== null ? playerNames[currentBidder] : '...'}</span>
        <span className="animate-pulse"> to bid...</span>
      </div>
    </div>
  );

  return (
    <div
      ref={backdropRef}
      className={`absolute inset-0 bg-black bg-opacity-60 flex justify-center z-50 p-2 ${
        isTight ? 'items-start' : 'items-center'
      }`}
      style={isTight ? { paddingTop: `${TOP_INSET}px` } : undefined}
    >
      <div
        ref={panelRef}
        className={`bg-white rounded-lg shadow-2xl w-full max-w-md flex flex-col ${
          isTight ? 'p-2' : isLandscape ? 'p-2 max-h-[95vh]' : isCompact ? 'p-3 max-h-[90vh]' : 'p-6'
        } ${isTight ? 'overflow-hidden' : 'overflow-y-auto'}`}
        style={panelMaxHeight ? { maxHeight: `${panelMaxHeight}px` } : undefined}
      >
        {header}

        {isTwoColumn ? (
          <div className="flex gap-2 min-h-0">
            {/* Left: state of the auction, scrolls if the history is opened */}
            <div className="flex-1 min-w-0 overflow-y-auto">
              {highBid}
              {bidHistory}
              {dealerHint}
            </div>
            {/* Right: the controls, always on screen */}
            <div className="w-[45%] shrink-0 flex flex-col justify-center border-l border-gray-200 pl-2">
              {bidControls}
            </div>
          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto">
            {highBid}
            {bidHistory}
            {isYourTurn ? bidControls : waiting}
          </div>
        )}
      </div>
    </div>
  );
};

export default BiddingOverlay;
