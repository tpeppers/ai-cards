import React, { useRef } from 'react';
import { Card as CardType } from '../types/CardGame';

const cardBackings: { [key: string]: string } = {
  'classic': 'repeating-linear-gradient(45deg, #006400, #006400 5px, #005300 5px, #005300 10px)',
  'blue': 'repeating-linear-gradient(45deg, #1a237e, #1a237e 5px, #0d1442 5px, #0d1442 10px)',
  'red': 'repeating-linear-gradient(45deg, #8b0000, #8b0000 5px, #5c0000 5px, #5c0000 10px)',
  'purple': 'repeating-linear-gradient(45deg, #4a148c, #4a148c 5px, #2a0a52 5px, #2a0a52 10px)',
  'gold': 'repeating-linear-gradient(45deg, #b8860b, #b8860b 5px, #8b6508 5px, #8b6508 10px)',
  'teal': 'repeating-linear-gradient(45deg, #00695c, #00695c 5px, #004d40 5px, #004d40 10px)',
};

const getCardBacking = (): string => {
  const backingId = localStorage.getItem('cardBacking') || 'classic';
  return cardBackings[backingId] || cardBackings['classic'];
};

interface CardProps {
  card: CardType;
  position: {
    x: number;
    y: number;
    raised?: boolean;
  };
  zIndex?: number;
  draggable?: boolean;
  onDragStart?: (card: CardType) => void;
  onDragEnd?: () => void;
  onClick?: (card: CardType) => void;
  faceDown?: boolean;
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
  faceDown = false
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

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
        width: '71px', // Classic card dimensions
        height: '96px',
        top: position.y,
        left: position.x,
        zIndex: zIndex,
        transform: `translateY(${position.raised ? '-20px' : '0px'})`,
        transition: 'transform 0.2s ease',
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
          cardRef.current.style.transform = `translateY(${position.raised ? '-20px' : '0px'})`;
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
                <div className="absolute top-1 left-1 leading-none" style={{ color: getColor(card.suit) }}>
                  <span className="font-bold text-xs">{getJokerLabel()}</span>
                </div>
                {/* Center: large star */}
                <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ color: getColor(card.suit) }}>
                  <span className="text-3xl">★</span>
                  <span className="text-xs font-bold">JOKER</span>
                </div>
                {/* Bottom-right corner (rotated) */}
                <div className="absolute bottom-1 right-1 leading-none rotate-180" style={{ color: getColor(card.suit) }}>
                  <span className="font-bold text-xs">{getJokerLabel()}</span>
                </div>
              </>
            ) : (
              <>
                {/* Top-left corner: rank + suit side-by-side */}
                <div className="absolute top-1 left-1 flex items-center leading-none" style={{ color: getColor(card.suit) }}>
                  <span className="font-bold text-sm">{getRank(card.rank)}</span>
                  <span className="text-xs">{getSuitSymbol(card.suit)}</span>
                </div>
                {/* Center suit symbol */}
                <div className="absolute inset-0 flex items-center justify-center" style={{ color: getColor(card.suit) }}>
                  <span className="text-2xl">{getSuitSymbol(card.suit)}</span>
                </div>
                {/* Bottom-right corner: rank + suit side-by-side (rotated) */}
                <div className="absolute bottom-1 right-1 flex items-center leading-none rotate-180" style={{ color: getColor(card.suit) }}>
                  <span className="font-bold text-sm">{getRank(card.rank)}</span>
                  <span className="text-xs">{getSuitSymbol(card.suit)}</span>
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