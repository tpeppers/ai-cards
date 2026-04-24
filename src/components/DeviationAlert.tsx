import React, { useEffect, useState } from 'react';
import { getDeviationAlertMode, DeviationAlertMode } from '../utils/deviationJournal.ts';

/**
 * Transient banner that appears when the human's most recent decision
 * differs from the currently-selected Auto Play strategy's recommendation.
 * Controlled by the `deviationAlerts` setting in localStorage:
 *   'off'       → never shows
 *   'deviation' → shows as "DEVIATION DETECTED"
 *   'blunder'   → shows as "BLUNDER!"
 *
 * Wired to a simple pub/sub on window — callers invoke
 * `notifyDeviation(detail)` and the banner consumes it. Kept as a
 * window event rather than a context or redux so it doesn't require
 * threading a provider through BidWhistGame and GameEngine.
 */

interface DeviationDetail {
  phase: string;
  selectedName: string;
  human: string;
  selectedChoice: string;
}

export function notifyDeviation(detail: DeviationDetail): void {
  if (getDeviationAlertMode() === 'off') return;
  window.dispatchEvent(new CustomEvent('deviation-alert', { detail }));
}

const SHOW_MS = 3200;

const DeviationAlert: React.FC = () => {
  const [detail, setDetail] = useState<DeviationDetail | null>(null);
  const [mode, setMode] = useState<DeviationAlertMode>(() => getDeviationAlertMode());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<DeviationDetail>;
      // Re-read mode at fire time so the setting toggle takes effect
      // without a page refresh.
      setMode(getDeviationAlertMode());
      setDetail(ce.detail);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setDetail(null), SHOW_MS);
    };
    window.addEventListener('deviation-alert', handler as EventListener);
    return () => {
      window.removeEventListener('deviation-alert', handler as EventListener);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!detail || mode === 'off') return null;

  const headline = mode === 'blunder' ? 'BLUNDER!' : 'DEVIATION DETECTED';
  const headlineColor = mode === 'blunder' ? '#dc2626' : '#d97706';

  return (
    <div
      style={{
        position: 'fixed',
        top: '4.5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(17, 24, 39, 0.95)',
        border: `2px solid ${headlineColor}`,
        borderRadius: '8px',
        padding: '0.6em 1em',
        boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
        zIndex: 9999,
        color: '#e5e7eb',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '0.9em',
        minWidth: '22rem',
        maxWidth: '32rem',
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: headlineColor, fontWeight: 700, letterSpacing: '0.05em', marginBottom: '0.3em' }}>
        ⚠ {headline}
      </div>
      <div style={{ fontSize: '0.85em', color: '#9ca3af' }}>
        {detail.phase}: you chose <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{detail.human}</span>;
        {' '}<em>{detail.selectedName}</em> would have chosen <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{detail.selectedChoice}</span>.
      </div>
    </div>
  );
};

export default DeviationAlert;
