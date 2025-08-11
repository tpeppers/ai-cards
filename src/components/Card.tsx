import React, { useRef } from 'react';
import { Card as CardType } from '../types/CardGame';

interface CardProps {
  card: CardType;
  position: {
    x: number;
    y: number;
    raised?: boolean;
  };
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
  draggable = false, 
  onDragStart, 
  onDragEnd, 
  onClick, 
  faceDown = false 
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

  // Card suit symbols using text characters instead of SVG for classic look
  const getSuitSymbol = (suit: string) => {
    switch (suit) {
      case 'hearts': return '♥';
      case 'diamonds': return '♦';
      case 'clubs': return '♣';
      case 'spades': return '♠';
      default: return '';
    }
  };

  const getColor = (suit: string) => {
    return suit === 'hearts' || suit === 'diamonds' ? 'text-red-600' : 'text-black';
  };

  const getRank = (rank: number) => {
    switch (rank) {
      case 1: return 'A';
      case 11: return 'J';
      case 12: return 'Q';
      case 13: return 'K';
      default: return rank.toString();
    }
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
        transform: `translateY(${position.raised ? '-20px' : '0px'})`,
        transition: 'transform 0.2s ease',
        boxShadow: '2px 2px 5px rgba(0, 0, 0, 0.2)',
        borderRadius: '3px'
      }}
      onClick={() => onClick && onClick(card)}
      onMouseEnter={() => {
        if (cardRef.current && onClick) {
          cardRef.current.style.transform = 'translateY(-20px)';
        }
      }}
      onMouseLeave={() => {
        if (cardRef.current && onClick) {
          cardRef.current.style.transform = 'translateY(0px)';
        }
      }}
    >
      {/* Card face */}
      <div 
        className="h-full w-full flex flex-col justify-between p-1"
        style={{
          backgroundColor: faceDown ? '#006400' : 'white',
          border: '1px solid #000',
          borderRadius: '3px',
          background: faceDown ? 'repeating-linear-gradient(45deg, #006400, #006400 5px, #005300 5px, #005300 10px)' : 'white'
        }}
      >
        {!faceDown && (
          <>
            <div className={`self-start font-bold text-lg ${getColor(card.suit)}`} style={{ lineHeight: '1' }}>
              {getRank(card.rank)}
            </div>
            <div className={`flex justify-center items-center text-4xl ${getColor(card.suit)}`}>
              {getSuitSymbol(card.suit)}
            </div>
            <div className={`self-end font-bold text-lg ${getColor(card.suit)} rotate-180`} style={{ lineHeight: '1' }}>
              {getRank(card.rank)}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Card;