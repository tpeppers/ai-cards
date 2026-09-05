import React from 'react';
import { Player } from '../types/CardGame';
import Card from './Card.tsx';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout.ts';

interface PlayerAreaProps {
  player: Player;
  isCurrentPlayer: boolean;
  isHuman: boolean;
  playCard: (card: any) => void;
  showAllCards: boolean;
  previewCardId?: string | null;
  displayName?: string;
  subtitle?: string;
}

// Player area component
const PlayerArea: React.FC<PlayerAreaProps> = ({ player, isCurrentPlayer, isHuman, playCard, showAllCards, previewCardId = null, displayName, subtitle }) => {
  const { width, height, scale, cardWidth, cardHeight, isCompact, handTopOffset } = useResponsiveLayout();

  // Scaled layout constants
  const humanFanSpacing = 30 * scale;
  const sideStackSpacing = 25 * scale;
  const topFanSpacing = 30 * scale;
  const westEdgeX = 30 * scale;
  const eastEdgeX = width - 100 * scale;
  const sideTopY = 120 * scale;
  const topY = 70 * scale;
  const bottomY = height - handTopOffset;
  // Compact keeps a wider side margin than the plain scaled value so the fan
  // clears the corner affordances (journal gear / challenge button) that live
  // in the bottom-left of the play area.
  const humanHandMargin = isCompact ? Math.max(80 * scale, 96) : 80 * scale;

  // Create the fan-shaped layout for cards similar to classic Microsoft Hearts
  const getPositionStyle = (index: number, cardId?: string) => {
    const isPreview = !!(previewCardId && cardId === previewCardId);

    if (isHuman) {
      // Bottom player (human) - fan out cards, pull UP toward center.
      // The fan is laid out from the space actually available (viewport minus
      // margins minus one full card, since `x` is the card's left edge), so a
      // narrow phone spreads the cards out instead of clumping them into an
      // untappable stack in the middle of an otherwise empty row.
      const available = Math.max(cardWidth, width - humanHandMargin - cardWidth);
      const maxSpacing = available / Math.max(player.hand.length - 1, 1);
      // Compact screens spend the whole row; larger ones keep the classic fan.
      const preferredSpacing = isCompact ? cardWidth * 0.8 : humanFanSpacing;
      const spacing = Math.min(maxSpacing, preferredSpacing);
      const span = spacing * Math.max(player.hand.length - 1, 0);
      const startX = (width - span - cardWidth) / 2;

      return {
        x: startX + index * spacing,
        y: bottomY,
        raised: isPreview,
        // default raiseTransform = translateY(-20px), no override needed
      };
    } else if (player.id === 1) {
      // Right player (East) - cards stacked sideways, pull LEFT toward center
      return {
        x: eastEdgeX,
        y: sideTopY + index * sideStackSpacing,
        raised: isPreview,
        raiseTransform: 'translateX(-20px)',
      };
    } else if (player.id === 2) {
      // Top player (North) - cards stacked horizontally, pull DOWN toward center
      return {
        x: (width / 2) - (player.hand.length * topFanSpacing / 2) + index * topFanSpacing,
        y: topY,
        raised: isPreview,
        raiseTransform: 'translateY(20px)',
      };
    } else {
      // Left player (West) - cards stacked sideways, pull RIGHT toward center
      return {
        x: westEdgeX,
        y: sideTopY + index * sideStackSpacing,
        raised: isPreview,
        raiseTransform: 'translateX(20px)',
      };
    }
  };

  // Player name badge position — corner-anchored on compact to avoid colliding with scaled cards
  const badgeStyle: React.CSSProperties = (() => {
    if (isHuman) {
      // Just above the human card fan
      return {
        bottom: `${Math.max(4, height - bottomY + 4)}px`,
        left: '50%',
        transform: 'translateX(-50%)',
      };
    }
    if (player.id === 2) {
      // Just below the north cards
      return {
        top: `${topY + cardHeight + 4}px`,
        left: '50%',
        transform: 'translateX(-50%)',
      };
    }
    // East/West: pinned just above the top of the side card stack, at the corresponding edge
    const sideBadgeTop = Math.max(36, sideTopY - 24);
    if (player.id === 1) {
      return { top: `${sideBadgeTop}px`, right: '4px' };
    }
    return { top: `${sideBadgeTop}px`, left: '4px' };
  })();

  const badgeFontSize = 12;

  // Player name indicator and score display
  return (
    <>
      {/* Player name & score display — hidden on compact to avoid crowding the chrome */}
      {!isCompact && (
        <div
          className="absolute text-white font-bold bg-black bg-opacity-70 rounded z-10"
          style={{
            ...badgeStyle,
            fontSize: `${badgeFontSize}px`,
            padding: '4px 10px',
            whiteSpace: 'nowrap',
          }}
        >
          <div>{displayName || player.name} {isCurrentPlayer && '(Turn)'} - Score: {player.totalScore}</div>
          {subtitle && (
            <div style={{ fontSize: `${badgeFontSize - 2}px`, fontWeight: 'normal', opacity: 0.8, textAlign: 'center' }}>{subtitle}</div>
          )}
        </div>
      )}

      {/* Cards */}
      {player.hand.map((card, index) => (
        <Card
          key={card.id}
          card={card}
          position={getPositionStyle(index, card.id)}
          zIndex={index + 1}
          draggable={isHuman && isCurrentPlayer}
          onClick={isHuman && isCurrentPlayer ? () => playCard(card) : undefined}
          faceDown={!isHuman && !showAllCards}
          width={cardWidth}
          height={cardHeight}
        />
      ))}
    </>
  );
};

export default PlayerArea;