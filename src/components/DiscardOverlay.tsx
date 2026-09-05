import React, { useState, useEffect } from 'react';
import { Card } from '../types/CardGame.ts';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout.ts';
import { useOverlayFit, OVERLAY_TOP_INSET } from '../hooks/useOverlayFit.ts';

interface DiscardOverlayProps {
  playerHand: Card[];
  trumpSuit: string | null;
  onDiscard: (cardIds: string[]) => void;
  /** See BiddingOverlay — fired when the panel has to sit on the card fan. */
  onHandCoverageChange?: (covered: boolean) => void;
}

/**
 * How the panel gives ground as the screen shrinks. Rung 0 is the classic
 * centred modal. Discarding happens entirely inside this panel — the sixteen
 * card buttons ARE the interaction — so the ladder shrinks the cards to keep
 * them all reachable rather than splitting them into a column, and the
 * confirm button sits outside the scroll area from rung 1 on.
 */
const STAGE_TIGHT = 1;        // top-anchored, condensed chrome, pinned footer
const STAGE_SMALL_CARDS = 2;  // shrink the buttons so more fit per row
const STAGE_COVER_HAND = 3;   // fan can't be cleared; leave its index strip showing

const suits = [
  { id: 'spades', symbol: '♠', color: 'black' },
  { id: 'hearts', symbol: '♥', color: 'red' },
  { id: 'diamonds', symbol: '♦', color: 'red' },
  { id: 'clubs', symbol: '♣', color: 'black' },
];

const getRankDisplay = (rank: number): string => {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return rank.toString();
};

const DiscardOverlay: React.FC<DiscardOverlayProps> = ({
  playerHand,
  trumpSuit,
  onDiscard,
  onHandCoverageChange
}) => {
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const { isCompact, width, height } = useResponsiveLayout();

  // Selecting a card doesn't change the panel's height — the X badge sits
  // inside a fixed-size button — so it deliberately stays out of the key and
  // taps don't send the fit walk round again.
  const contentKey = `${width}x${height}|${playerHand.length}`;
  const { stage, backdropRef, panelRef, coveredMaxHeight } = useOverlayFit(contentKey, STAGE_COVER_HAND);

  const isTight = stage >= STAGE_TIGHT;
  const smallCards = stage >= STAGE_SMALL_CARDS;
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

  const toggleCard = (cardId: string) => {
    // Functional update: two taps landing in the same render would otherwise
    // both branch off the same stale set and the first one would be lost.
    setSelectedCards(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else if (next.size < 4) {
        next.add(cardId);
      }
      return next;
    });
  };

  const handleDiscard = () => {
    if (selectedCards.size === 4) {
      onDiscard(Array.from(selectedCards));
    }
  };

  const getSuitInfo = (suitId: string) => {
    return suits.find(s => s.id === suitId) || { symbol: '?', color: 'black' };
  };

  const cardSize = smallCards ? 'w-6 h-9' : isCompact ? 'w-8 h-11' : 'w-12 h-16';
  const rankSize = smallCards ? 'text-[9px]' : isCompact ? 'text-xs' : 'text-base';
  const suitSize = smallCards ? 'text-[11px]' : isCompact ? 'text-sm' : 'text-lg';

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
        className={`bg-white rounded-lg shadow-2xl w-full max-w-2xl flex flex-col ${
          isTight ? 'p-2 overflow-hidden' : isCompact ? 'p-2 max-h-[95vh] overflow-y-auto' : 'p-5 overflow-y-auto'
        }`}
        style={panelMaxHeight ? { maxHeight: `${panelMaxHeight}px` } : undefined}
      >
        {isTight ? (
          <div className="flex items-baseline justify-between mb-1 shrink-0">
            <h2 className="font-bold text-gray-800 text-sm">Discard 4</h2>
            <span className="text-[11px] text-gray-500 ml-2">
              Trump {getSuitInfo(trumpSuit || '').symbol}
            </span>
          </div>
        ) : (
          <>
            <h2 className={`font-bold text-center text-gray-800 ${isCompact ? 'text-base mb-1' : 'text-xl mb-1'}`}>Discard 4 Cards</h2>
            <p className={`text-center text-gray-600 ${isCompact ? 'text-[11px] mb-2' : 'text-sm mb-3'}`}>
              Select 4 cards to discard. Trump ({getSuitInfo(trumpSuit || '').symbol}) highlighted.
            </p>
          </>
        )}

        {/* Card selection grid — the interaction itself, so it owns the panel's
            scroll and everything else is pinned around it. */}
        <div className={`min-h-0 ${isTight ? 'flex-1 mb-1' : isCompact ? 'mb-2' : 'mb-4'}`}>
          <div
            className={`flex flex-wrap justify-center bg-gray-100 rounded-lg overflow-y-auto ${
              isTight ? 'gap-1 p-1 h-full' : isCompact ? 'gap-1 p-1' : 'gap-2 p-3'
            }`}
          >
            {playerHand.map((card) => {
              const suitInfo = getSuitInfo(card.suit);
              const isSelected = selectedCards.has(card.id);
              const isTrump = card.suit === trumpSuit;
              return (
                <button
                  key={card.id}
                  onClick={() => toggleCard(card.id)}
                  className={`bg-white rounded border-2 flex flex-col items-center justify-center font-bold transition-all hover:scale-105 ${cardSize} ${
                    isSelected
                      ? 'border-red-500 ring-2 ring-red-300 bg-red-50'
                      : isTrump
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                  style={{ color: suitInfo.color === 'red' ? '#dc2626' : '#1f2937' }}
                >
                  <span className={rankSize}>{getRankDisplay(card.rank)}</span>
                  <span className={`leading-none ${suitSize}`}>{suitInfo.symbol}</span>
                  {isSelected && !smallCards && (
                    <span className={`text-red-600 font-bold ${isCompact ? 'text-[9px]' : 'text-xs'}`}>X</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selection count and hint — folded into the button once space is tight */}
        {!isTight && (
          <div className={`bg-gray-100 rounded-lg text-center shrink-0 ${isCompact ? 'p-1 mb-2' : 'p-2 mb-4'}`}>
            <div className={`text-gray-600 ${isCompact ? 'text-[11px]' : 'text-sm'}`}>
              <span className="font-bold">{selectedCards.size}/4</span> selected
              {selectedCards.size < 4 && (
                <span className="text-gray-500 ml-2">
                  ({4 - selectedCards.size} more)
                </span>
              )}
            </div>
            {!isCompact && (
              <div className="text-xs text-yellow-700 mt-1">
                Tip: Avoid discarding trump cards (yellow border)
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleDiscard}
          disabled={selectedCards.size !== 4}
          className={`w-full font-bold rounded-lg transition-colors shrink-0 ${
            isTight ? 'py-2 px-2 text-sm' : isCompact ? 'py-2 px-3 text-sm' : 'py-3 px-6 text-lg'
          } ${
            selectedCards.size === 4
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {selectedCards.size === 4 ? 'Discard Selected' : `Select ${4 - selectedCards.size} more (${selectedCards.size}/4)`}
        </button>
      </div>
    </div>
  );
};

export default DiscardOverlay;
