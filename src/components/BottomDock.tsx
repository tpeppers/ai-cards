import React from 'react';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout.ts';

interface BottomDockProps {
  /** Which edge the slot hugs once the play area is compact. */
  compactSide: 'left' | 'center' | 'right';
  /** Positioning classes used at full size (the classic desktop layout). */
  wideClassName: string;
  className?: string;
  /** Stacking class for the slot. Defaults above the cards, below the overlays. */
  zIndexClass?: string;
  children: React.ReactNode;
}

/**
 * Anchors a small panel or button in the bottom band of the play area.
 *
 * On phones the slot is lifted to just above the human's card fan instead of
 * sitting in the very bottom corner, where it used to cover the player's own
 * cards in portrait. Landing on the side players' card backs is fine — those
 * are decorative — so the dock is stacked above them (cards top out near
 * z-16, raised cards excepted) but below the modal overlays.
 */
const BottomDock: React.FC<BottomDockProps> = ({ compactSide, wideClassName, className = '', zIndexClass = 'z-40', children }) => {
  const { isCompact, chromeBottom } = useResponsiveLayout();

  if (!isCompact) {
    return <div className={`absolute ${zIndexClass} ${wideClassName} ${className}`}>{children}</div>;
  }

  const sideStyle: React.CSSProperties =
    compactSide === 'left' ? { left: 4 }
      : compactSide === 'right' ? { right: 4 }
        : { left: '50%', transform: 'translateX(-50%)' };

  return (
    <div className={`absolute ${zIndexClass} ${className}`} style={{ bottom: `${chromeBottom}px`, ...sideStyle }}>
      {children}
    </div>
  );
};

export default BottomDock;
