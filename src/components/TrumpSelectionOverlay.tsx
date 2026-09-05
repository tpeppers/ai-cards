import React, { useState, useEffect } from 'react';
import { Card } from '../types/CardGame.ts';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout.ts';
import { useOverlayFit, OVERLAY_TOP_INSET } from '../hooks/useOverlayFit.ts';

type BidDirection = 'uptown' | 'downtown' | 'downtown-noaces';

interface TrumpSelectionOverlayProps {
  isYourTurn: boolean;
  winningBid: number;
  playerHand: Card[];
  onSelectTrump: (suit: string, direction: BidDirection) => void;
  previewTrump?: { suit: string; direction: string } | null;
  /** See BiddingOverlay — fired when the panel has to sit on the card fan. */
  onHandCoverageChange?: (covered: boolean) => void;
}

/**
 * How the panel gives ground as the screen shrinks. Rung 0 is the classic
 * centred modal. Unlike bidding, the hand is also *inside* this panel as the
 * quick-select row, so the grid and the Accept button are what must stay on
 * screen — the ladder protects those first and the table fan second.
 */
const STAGE_TIGHT = 1;       // top-anchored, condensed chrome, pinned footer
const STAGE_TWO_COLUMN = 2;  // controls move into a right-hand column
const STAGE_COVER_HAND = 3;  // fan can't be cleared; leave its index strip showing

const suits = [
  { id: 'spades', name: 'Spades', symbol: '♠', color: 'black' },
  { id: 'hearts', name: 'Hearts', symbol: '♥', color: 'red' },
  { id: 'diamonds', name: 'Diamonds', symbol: '♦', color: 'red' },
  { id: 'clubs', name: 'Clubs', symbol: '♣', color: 'black' },
];

const getRankDisplay = (rank: number): string => {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return rank.toString();
};

const TrumpSelectionOverlay: React.FC<TrumpSelectionOverlayProps> = ({
  isYourTurn,
  winningBid,
  playerHand,
  onSelectTrump,
  previewTrump,
  onHandCoverageChange
}) => {
  const [selectedSuit, setSelectedSuit] = useState<string>('spades');
  const [isUptown, setIsUptown] = useState<boolean>(true);
  const [acesGood, setAcesGood] = useState<boolean>(false); // false = aces no good (default for downtown)
  const { isCompact, width, height } = useResponsiveLayout();

  const contentKey = `${width}x${height}|${playerHand.length}|${isYourTurn}|${isUptown}|${previewTrump != null}`;
  const { stage, backdropRef, panelRef, coveredMaxHeight } = useOverlayFit(contentKey, STAGE_COVER_HAND);

  const isTight = stage >= STAGE_TIGHT;
  const isTwoColumn = stage >= STAGE_TWO_COLUMN && isYourTurn;
  const coversHand = stage >= STAGE_COVER_HAND;

  useEffect(() => {
    onHandCoverageChange?.(coversHand);
    return () => onHandCoverageChange?.(false);
  }, [coversHand, onHandCoverageChange]);

  const panelMaxHeight = coversHand
    ? coveredMaxHeight
    : isTight
      ? Math.max(140, height - OVERLAY_TOP_INSET - 8)
      : undefined;

  const handleSubmit = () => {
    let direction: BidDirection;
    if (isUptown) {
      direction = 'uptown';
    } else if (acesGood) {
      direction = 'downtown';
    } else {
      direction = 'downtown-noaces';
    }
    onSelectTrump(selectedSuit, direction);
  };

  // Quick-select from card click
  const handleCardClick = (card: Card) => {
    // Set suit
    setSelectedSuit(card.suit);

    // Set direction based on rank: 2-7 = low (downtown), 8-K + A = high (uptown)
    // Ranks: 1=A, 2-10, 11=J, 12=Q, 13=K
    if (card.rank >= 2 && card.rank <= 7) {
      setIsUptown(false);
      setAcesGood(false); // default aces no good for low
    } else {
      setIsUptown(true);
    }
  };

  const getSuitSymbol = (suitId: string) => {
    const suit = suits.find(s => s.id === suitId);
    return suit?.symbol || '?';
  };

  const getSuitColor = (suitId: string) => {
    const suit = suits.find(s => s.id === suitId);
    return suit?.color === 'red' ? '#dc2626' : '#1f2937';
  };

  const getDirectionLabel = () => {
    if (isUptown) return 'Uptown';
    if (acesGood) return 'Downtown';
    return 'Downtown, Aces No Good';
  };

  const getAcceptLabel = () => {
    const suitSymbol = getSuitSymbol(selectedSuit);
    // The full label doesn't fit the narrow right-hand column.
    if (isTwoColumn) return `Accept ${suitSymbol}${isUptown ? '↑' : '↓'}`;
    return `Accept (${suitSymbol} ${getDirectionLabel()})`;
  };

  const header = isTight ? (
    <div className="flex items-baseline justify-between mb-1 shrink-0">
      <h2 className="font-bold text-gray-800 text-sm">Choose Trump</h2>
      <span className="text-[11px] text-gray-500 ml-2">Won with {winningBid}</span>
    </div>
  ) : (
    <>
      <h2 className={`font-bold text-center text-gray-800 ${isCompact ? 'text-base mb-1' : 'text-xl mb-1'}`}>Choose Trump</h2>
      <p className={`text-center text-gray-600 ${isCompact ? 'text-[11px] mb-2' : 'text-sm mb-3'}`}>
        You won with {winningBid}! Click a card or use controls below.
      </p>
    </>
  );

  // Your hand, as quick-select buttons. This is the one thing that must stay
  // on screen, so it owns the panel's scroll rather than the panel itself.
  const quickSelect = (
    <div className={`min-h-0 ${isTight ? 'mb-1 flex-1' : isCompact ? 'mb-2' : 'mb-4'}`}>
      {!isCompact && !isTight && (
        <label className="block text-xs font-semibold text-gray-500 mb-1">Click a card to quick-select:</label>
      )}
      <div
        className={`flex flex-wrap gap-1 justify-center bg-gray-100 rounded-lg overflow-y-auto ${
          isTight ? 'p-1 h-full' : isCompact ? 'p-1 max-h-24' : 'p-2 max-h-32'
        }`}
      >
        {playerHand.map((card) => {
          const suitInfo = suits.find(s => s.id === card.suit);
          const isSelected = card.suit === selectedSuit;
          const isPreview = previewTrump != null && card.suit === previewTrump.suit;
          return (
            <button
              key={card.id}
              onClick={() => handleCardClick(card)}
              className={`bg-white rounded border-2 flex flex-col items-center justify-center font-bold transition-all hover:scale-105 ${
                isCompact ? 'w-7 h-10' : 'w-10 h-14'
              } ${
                isPreview
                  ? 'border-green-400 ring-2 ring-green-300 bg-green-50 animate-pulse'
                  : isSelected
                    ? 'border-blue-500 ring-2 ring-blue-300 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
              }`}
              style={{ color: suitInfo?.color === 'red' ? '#dc2626' : '#1f2937' }}
            >
              <span className={isCompact ? 'text-[10px]' : 'text-sm'}>{getRankDisplay(card.rank)}</span>
              <span className={`leading-none ${isCompact ? 'text-xs' : 'text-base'}`}>{suitInfo?.symbol}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const suitPicker = (
    <div className={isTwoColumn ? '' : 'flex-1'}>
      <label className="block text-xs font-semibold text-gray-500 mb-1">Trump Suit</label>
      <select
        value={selectedSuit}
        onChange={(e) => setSelectedSuit(e.target.value)}
        className={`w-full border-2 border-gray-300 rounded-lg font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-300 ${
          isTight ? 'p-1 text-sm' : 'p-2 text-lg'
        }`}
        style={{ color: getSuitColor(selectedSuit) }}
      >
        {suits.map(suit => (
          <option key={suit.id} value={suit.id} style={{ color: suit.color === 'red' ? '#dc2626' : '#1f2937' }}>
            {suit.symbol} {suit.name}
          </option>
        ))}
      </select>
    </div>
  );

  const directionPicker = (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">Direction</label>
      <div className="flex border-2 border-gray-300 rounded-lg overflow-hidden">
        <button
          onClick={() => setIsUptown(true)}
          className={`flex items-center justify-center gap-1 font-bold transition-colors ${
            isTight ? 'px-2 py-1 flex-1' : 'px-3 py-2'
          } ${
            previewTrump != null && previewTrump.direction === 'uptown'
              ? 'bg-green-500 text-white animate-pulse'
              : isUptown
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
          title="Uptown - High cards win (A K Q J 10...2)"
        >
          <span className="text-lg">↑</span>
          <span className={`text-sm ${isTight ? '' : 'hidden sm:inline'}`}>High</span>
        </button>
        <button
          onClick={() => setIsUptown(false)}
          className={`flex items-center justify-center gap-1 font-bold transition-colors ${
            isTight ? 'px-2 py-1 flex-1' : 'px-3 py-2'
          } ${
            previewTrump != null && previewTrump.direction !== 'uptown'
              ? 'bg-green-500 text-white animate-pulse'
              : !isUptown
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
          title="Downtown - Low cards win (2 3 4...K)"
        >
          <span className="text-lg">↓</span>
          <span className={`text-sm ${isTight ? '' : 'hidden sm:inline'}`}>Low</span>
        </button>
      </div>
    </div>
  );

  const acesPicker = !isUptown && (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">Aces</label>
      <button
        onClick={() => setAcesGood(!acesGood)}
        className={`border-2 rounded-lg font-bold text-lg transition-all flex items-center justify-center gap-1 ${
          isTight ? 'px-2 py-1 w-full' : 'px-3 py-2'
        } ${
          acesGood
            ? 'border-green-500 bg-green-50 text-green-700'
            : 'border-red-400 bg-red-50 text-red-600'
        }`}
        title={acesGood ? 'Aces are good (high)' : 'Aces are no good (worst)'}
      >
        <span className="font-serif">A</span>
        <span className="text-sm">{acesGood ? '✓' : '✗'}</span>
      </button>
    </div>
  );

  const acceptButton = (
    <>
      <button
        onClick={handleSubmit}
        className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors ${
          isTight ? 'py-2 px-2 text-sm' : isCompact ? 'py-2 px-3 text-sm' : 'py-3 px-6 text-lg'
        }`}
      >
        {getAcceptLabel()}
      </button>
      {previewTrump != null && (
        <div className={`text-center text-green-500 animate-pulse ${isTight ? 'text-[10px] mt-1' : 'mt-2 text-sm'}`}>
          Auto Play would: {getSuitSymbol(previewTrump.suit)}{' '}
          {previewTrump.direction === 'uptown' ? 'Uptown' : previewTrump.direction === 'downtown' ? 'Downtown' : 'Downtown, Aces No Good'}
        </div>
      )}
    </>
  );

  const waiting = (
    <div className={isTight ? 'text-center py-2 text-xs' : 'text-center py-8'}>
      <div className="animate-pulse text-gray-600">
        Waiting for bid winner to choose trump...
      </div>
    </div>
  );

  return (
    <div
      ref={backdropRef}
      className={`absolute inset-0 bg-black bg-opacity-60 flex justify-center z-50 p-2 ${
        isTight ? 'items-start' : 'items-center'
      }`}
      style={isTight ? { paddingTop: `${OVERLAY_TOP_INSET}px` } : undefined}
    >
      <div
        ref={panelRef}
        data-fit-stage={stage}
        className={`bg-white rounded-lg shadow-2xl w-full max-w-lg flex flex-col ${
          isTight ? 'p-2 overflow-hidden' : isCompact ? 'p-2 max-h-[95vh] overflow-y-auto' : 'p-5 overflow-y-auto'
        }`}
        style={panelMaxHeight ? { maxHeight: `${panelMaxHeight}px` } : undefined}
      >
        {header}

        {!isYourTurn ? waiting : isTwoColumn ? (
          <div className="flex gap-2 min-h-0 flex-1">
            {/* Left: your hand, the thing you're actually choosing from */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">{quickSelect}</div>
            {/* Right: the controls. Accept is pinned below a scrolling picker
                stack, so it survives even when the panel is capped to a sliver. */}
            <div className="w-[45%] shrink-0 flex flex-col min-h-0 border-l border-gray-200 pl-2">
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-center gap-1">
                {suitPicker}
                {directionPicker}
                {acesPicker}
              </div>
              <div className="shrink-0 mt-1">{acceptButton}</div>
            </div>
          </div>
        ) : (
          <>
            {quickSelect}
            <div className={`flex items-end gap-2 shrink-0 ${isTight ? 'mb-1' : 'mb-4 gap-3'}`}>
              {suitPicker}
              {directionPicker}
              {acesPicker}
            </div>

            {/* Direction explanation — the first thing to go when space is tight */}
            {!isCompact && !isTight && (
              <div className="bg-gray-100 rounded-lg p-2 mb-4 text-center">
                <div className="text-sm text-gray-600">
                  {isUptown ? (
                    <span><strong>Uptown:</strong> A K Q J 10 9 8 7 6 5 4 3 2 (high cards win)</span>
                  ) : acesGood ? (
                    <span><strong>Downtown:</strong> A 2 3 4 5 6 7 8 9 10 J Q K (low cards win, A stays high)</span>
                  ) : (
                    <span><strong>Downtown, Aces No Good:</strong> 2 3 4 5 6 7 8 9 10 J Q K A (low cards win, A is worst)</span>
                  )}
                </div>
              </div>
            )}

            <div className="shrink-0">{acceptButton}</div>
          </>
        )}
      </div>
    </div>
  );
};

export default TrumpSelectionOverlay;
