import React, { useRef } from 'react';
import { Card as CardType } from '../types/CardGame';
import { getCardBacking } from '../utils/cardBackings.ts';
import { BASE_CARD_WIDTH, BASE_CARD_HEIGHT } from '../hooks/useResponsiveLayout.ts';

interface CardProps {
  card: CardType;
  position: {
    x: number;
    y: number;
    raised?: boolean;
    raiseTransform?: string; // custom CSS transform when raised, e.g. 'translateX(-20px)'
  };
  zIndex?: number;
  draggable?: boolean;
  onDragStart?: (card: CardType) => void;
  onDragEnd?: () => void;
  onClick?: (card: CardType) => void;
  faceDown?: boolean;
  width?: number;
  height?: number;
  /**
   * Move the readable rank/suit index to the BOTTOM of the card. Used when an
   * overlay has to cover the top of the player's hand — the exposed strip is
   * then the one carrying the index, so the hand is still playable.
   */
  indexAtBottom?: boolean;
}

// Card component with classic Microsoft Hearts styling
const Card: React.FC<CardProps> = ({
  card,
  position,
  zIndex = 1,
  draggable = false,
  onDragStart,
  onDragEnd,
  onClick,
  faceDown = false,
  width,
  height,
  indexAtBottom = false
}) => {
  // Derive dimensions and text scale from props (defaults = classic size)
  const w = width ?? BASE_CARD_WIDTH;
  const h = height ?? (w * (BASE_CARD_HEIGHT / BASE_CARD_WIDTH));
  const scale = w / BASE_CARD_WIDTH;
  const cornerFontSize = Math.max(7, Math.round(12 * scale));
  const centerFontSize = Math.max(11, Math.round(24 * scale));
  const jokerCenterFontSize = Math.max(14, Math.round(30 * scale));
  const cornerPadding = Math.max(1, Math.round(4 * scale));
  const cardRef = useRef<HTMLDivElement>(null);

  // Corner placement. Normally the upright index is top-left and its mirrored
  // twin bottom-right; flipping swaps the two so the upright one lands in the
  // strip left visible below an overlay.
  const uprightCorner: React.CSSProperties = indexAtBottom
    ? { bottom: cornerPadding, left: cornerPadding }
    : { top: cornerPadding, left: cornerPadding };
  const mirroredCorner: React.CSSProperties = indexAtBottom
    ? { top: cornerPadding, right: cornerPadding }
    : { bottom: cornerPadding, right: cornerPadding };

  // Check if card is a joker
  const isJoker = card.suit === 'joker';
  const isBigJoker = isJoker && card.rank === 15;

  // Card suit symbols using text characters instead of SVG for classic look
  const getSuitSymbol = (suit: string) => {
    switch (suit) {
      case 'hearts': return '♥';
      case 'diamonds': return '♦';
      case 'clubs': return '♣';
      case 'spades': return '♠';
      case 'joker': return '★';
      default: return '';
    }
  };

  const getColor = (suit: string) => {
    const stored = localStorage.getItem('suitColors');
    if (stored) {
      try {
        const colors = JSON.parse(stored);
        if (colors[suit]) return colors[suit];
      } catch {}
    }
    if (suit === 'joker') return isBigJoker ? 'red' : 'black';
    return suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black';
  };

  const getRank = (rank: number) => {
    switch (rank) {
      case 1: return 'A';
      case 11: return 'J';
      case 12: return 'Q';
      case 13: return 'K';
      case 14: return ''; // Little joker
      case 15: return ''; // Big joker
      default: return rank.toString();
    }
  };

  const getJokerLabel = () => {
    return isBigJoker ? 'BIG' : 'little';
  };

  // Classic card styling
  return (
    <div
      ref={cardRef}
      className={`absolute select-none ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        position: 'absolute',
        width: `${w}px`,
        height: `${h}px`,
        top: position.y,
        left: position.x,
        zIndex: position.raised ? 100 : zIndex,
        transform: position.raised
          ? (position.raiseTransform || 'translateY(-20px)')
          : 'translateY(0px)',
        transition: 'transform 0.2s ease, z-index 0.2s ease',
        boxShadow: '2px 2px 5px rgba(0, 0, 0, 0.2)',
        borderRadius: '3px'
      }}
      onClick={() => onClick && onClick(card)}
      onMouseEnter={() => {
        if (cardRef.current && onClick) {
          cardRef.current.style.transform = 'translateY(-20px)';
          cardRef.current.style.zIndex = '100';
        }
      }}
      onMouseLeave={() => {
        if (cardRef.current && onClick) {
          const raisedTransform = position.raiseTransform || 'translateY(-20px)';
          cardRef.current.style.transform = position.raised ? raisedTransform : 'translateY(0px)';
          cardRef.current.style.zIndex = String(position.raised ? 100 : zIndex);
        }
      }}
    >
      {/* Card face */}
      <div
        className="h-full w-full relative"
        id="cardFace"
        style={{
          backgroundColor: faceDown ? '#006400' : 'white',
          border: '1px solid #000',
          borderRadius: '3px',
          background: faceDown ? getCardBacking() : 'white'
        }}
      >
        {!faceDown && (
          <>
            {isJoker ? (
              <>
                {/* Joker card layout */}
                <div className="absolute leading-none" style={{ ...uprightCorner, color: getColor(card.suit) }}>
                  <span className="font-bold" style={{ fontSize: cornerFontSize }}>{getJokerLabel()}</span>
                </div>
                {/* Center: large star */}
                <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ color: getColor(card.suit) }}>
                  <span style={{ fontSize: jokerCenterFontSize, lineHeight: 1 }}>★</span>
                  <span className="font-bold" style={{ fontSize: cornerFontSize }}>JOKER</span>
                </div>
                {/* Mirrored label in the opposite corner */}
                <div className="absolute leading-none rotate-180" style={{ ...mirroredCorner, color: getColor(card.suit) }}>
                  <span className="font-bold" style={{ fontSize: cornerFontSize }}>{getJokerLabel()}</span>
                </div>
              </>
            ) : (
              <>
                {/* Upright index: rank + suit side-by-side */}
                <div className="absolute flex items-center leading-none" style={{ ...uprightCorner, color: getColor(card.suit) }}>
                  <span className="font-bold" style={{ fontSize: cornerFontSize + 2 }}>{getRank(card.rank)}</span>
                  <span style={{ fontSize: cornerFontSize }}>{getSuitSymbol(card.suit)}</span>
                </div>
                {/* Center suit symbol */}
                <div className="absolute inset-0 flex items-center justify-center" style={{ color: getColor(card.suit) }}>
                  <span style={{ fontSize: centerFontSize, lineHeight: 1 }}>{getSuitSymbol(card.suit)}</span>
                </div>
                {/* Mirrored index in the opposite corner */}
                <div className="absolute flex items-center leading-none rotate-180" style={{ ...mirroredCorner, color: getColor(card.suit) }}>
                  <span className="font-bold" style={{ fontSize: cornerFontSize + 2 }}>{getRank(card.rank)}</span>
                  <span style={{ fontSize: cornerFontSize }}>{getSuitSymbol(card.suit)}</span>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Card;