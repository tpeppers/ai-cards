import React, { useEffect, useState } from 'react';
import { getDeviationAlertMode, DeviationAlertMode } from '../utils/deviationJournal.ts';

/**
 * Modal-ish deviation notice that appears when the human's most recent
 * decision differs from the currently-selected Auto Play strategy's
 * recommendation. Controlled by the `deviationAlerts` setting:
 *   'off'       → never shows
 *   'deviation' → "DEVIATION DETECTED"
 *   'blunder'   → "BLUNDER!"
 *
 * Dialog stays until the user clicks OK (no auto-hide). The full
 * detail payload is also logged to the browser console so the user can
 * copy it out for analysis.
 *
 * Pub/sub on window — callers invoke `notifyDeviation(detail)` and the
 * banner consumes it. Kept as a window event rather than a context or
 * redux so it doesn't require threading a provider through BidWhistGame
 * and GameEngine.
 */

export interface DeviationDetail {
  phase: string;
  selectedName: string;
  human: string;
  selectedChoice: string;
  // Optional extended context — populated by the BidWhistGame caller
  // from the DecisionRecord so the dialog (and console log) can show
  // the full situation, not just a one-liner.
  handId?: string;
  bidCount?: number;
  currentBid?: number;
  trumpSuit?: string | null;
  direction?: string;
  trickNumber?: number;
  leadSuit?: string | null;
  currentTrickSoFar?: Array<{ playerId: number; card: string }>;
  familyChoice?: string;
  claudeFamChoice?: string;
  divergedFromFamily?: boolean;
  divergedFromClaudeFam?: boolean;
}

export function notifyDeviation(detail: DeviationDetail): void {
  if (getDeviationAlertMode() === 'off') return;
  // Always log the full explanation — useful even when the visible
  // banner is dismissed quickly, and doubly so for users who want to
  // replay their session from DevTools.
  // eslint-disable-next-line no-console
  console.log('[deviation]', detail);
  window.dispatchEvent(new CustomEvent('deviation-alert', { detail }));
}

const DeviationAlert: React.FC = () => {
  const [detail, setDetail] = useState<DeviationDetail | null>(null);
  const [mode, setMode] = useState<DeviationAlertMode>(() => getDeviationAlertMode());

  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<DeviationDetail>;
      // Re-read mode at fire time so the setting toggle takes effect
      // without a page refresh.
      setMode(getDeviationAlertMode());
      setDetail(ce.detail);
    };
    window.addEventListener('deviation-alert', handler as EventListener);
    return () => {
      window.removeEventListener('deviation-alert', handler as EventListener);
    };
  }, []);

  if (!detail || mode === 'off') return null;

  const headline = mode === 'blunder' ? 'BLUNDER!' : 'DEVIATION DETECTED';
  const headlineColor = mode === 'blunder' ? '#dc2626' : '#d97706';

  const rows: Array<[string, React.ReactNode]> = [
    ['Phase', detail.phase],
    ['Strategy', <em key="s">{detail.selectedName}</em>],
    ['Your choice', <span key="h" style={{ color: '#fde68a', fontWeight: 600 }}>{detail.human}</span>],
    ['Strategy would have chosen', <span key="c" style={{ color: '#a7f3d0', fontWeight: 600 }}>{detail.selectedChoice}</span>],
  ];
  if (detail.familyChoice) {
    rows.push(['Family strategy', (
      <span style={{ color: detail.divergedFromFamily ? '#fecaca' : '#a7f3d0' }}>
        {detail.familyChoice}{detail.divergedFromFamily ? ' (also diverged)' : ' (matches)'}
      </span>
    )]);
  }
  if (detail.claudeFamChoice) {
    rows.push(['ClaudeFam strategy', (
      <span style={{ color: detail.divergedFromClaudeFam ? '#fecaca' : '#a7f3d0' }}>
        {detail.claudeFamChoice}{detail.divergedFromClaudeFam ? ' (also diverged)' : ' (matches)'}
      </span>
    )]);
  }
  // Phase-specific context
  if (detail.phase === 'bid' && (detail.bidCount !== undefined || detail.currentBid !== undefined)) {
    rows.push(['Bid state', `current=${detail.currentBid ?? '-'}, priorBids=${detail.bidCount ?? 0}`]);
  }
  if (detail.phase === 'trump' || detail.phase === 'discard' || detail.phase === 'play') {
    if (detail.trumpSuit || detail.direction) {
      rows.push(['Trump', `${detail.trumpSuit ?? '-'} ${detail.direction ?? ''}`.trim()]);
    }
  }
  if (detail.phase === 'play') {
    if (detail.trickNumber !== undefined) rows.push(['Trick #', String(detail.trickNumber)]);
    if (detail.leadSuit) rows.push(['Lead suit', detail.leadSuit]);
    if (detail.currentTrickSoFar && detail.currentTrickSoFar.length > 0) {
      rows.push(['Trick so far', detail.currentTrickSoFar.map(p => `P${p.playerId}:${p.card}`).join(', ')]);
    }
  }
  if (detail.handId) {
    rows.push(['Hand', <code key="hid" style={{ fontSize: '0.75em', color: '#9ca3af' }}>{detail.handId.slice(0, 16)}…</code>]);
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={() => setDetail(null)}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'rgba(17, 24, 39, 0.98)',
          border: `2px solid ${headlineColor}`,
          borderRadius: '10px',
          padding: '1em 1.25em',
          boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
          color: '#e5e7eb',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '0.95em',
          minWidth: '24rem',
          maxWidth: '36rem',
        }}
      >
        <div style={{ color: headlineColor, fontWeight: 700, letterSpacing: '0.05em', marginBottom: '0.6em', fontSize: '1.05em' }}>
          ⚠ {headline}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88em' }}>
          <tbody>
            {rows.map(([label, value], i) => (
              <tr key={i}>
                <td style={{ padding: '0.15em 0.6em 0.15em 0', color: '#9ca3af', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  {label}:
                </td>
                <td style={{ padding: '0.15em 0', color: '#e5e7eb' }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: '0.9em', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setDetail(null)}
            style={{
              background: headlineColor,
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '0.45em 1.3em',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.95em',
            }}
          >
            OK
          </button>
        </div>
        <div style={{ marginTop: '0.5em', fontSize: '0.72em', color: '#6b7280' }}>
          Full detail also logged to browser console.
        </div>
      </div>
    </div>
  );
};

export default DeviationAlert;
