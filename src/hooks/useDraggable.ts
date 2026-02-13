import { useState, useCallback, useRef, useEffect } from 'react';

interface DragState {
  x: number;
  y: number;
}

interface UseDraggableReturn {
  position: DragState;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleTouchStart: (e: React.TouchEvent) => void;
  isDragging: boolean;
}

/**
 * Hook to make an absolutely-positioned overlay draggable.
 * Attach handleMouseDown/handleTouchStart to the element's title bar or header.
 * Use position.x / position.y as left/top offsets (0,0 = no movement from original CSS position).
 */
export function useDraggable(): UseDraggableReturn {
  const [position, setPosition] = useState<DragState>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    offsetRef.current = { x: e.clientX, y: e.clientY };
    startPosRef.current = { ...position };
  }, [position]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    const touch = e.touches[0];
    setIsDragging(true);
    offsetRef.current = { x: touch.clientX, y: touch.clientY };
    startPosRef.current = { ...position };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: startPosRef.current.x + (e.clientX - offsetRef.current.x),
        y: startPosRef.current.y + (e.clientY - offsetRef.current.y),
      });
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      setPosition({
        x: startPosRef.current.x + (touch.clientX - offsetRef.current.x),
        y: startPosRef.current.y + (touch.clientY - offsetRef.current.y),
      });
    };

    const handleEnd = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchcancel', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, [isDragging]);

  return { position, handleMouseDown, handleTouchStart, isDragging };
}
