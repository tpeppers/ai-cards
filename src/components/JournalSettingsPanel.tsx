import React, { useState } from 'react';
import {
  getDeviationAlertMode, setDeviationAlertMode, DeviationAlertMode,
  exportJournal, clearJournal, journalSize,
} from '../utils/deviationJournal.ts';

/**
 * Compact journal settings overlay. Embedded inside BidWhistGame so it
 * ships to both the main React app (on /bidwhist) and the standalone
 * GitHub Pages build (which only renders BidWhistGame). Full settings
 * still live at /settings in the main app; this panel is a minimal
 * subset focused on the deviation-alert toggle and the journal
 * export/clear actions.
 *
 * Reads/writes via deviationJournal.ts, so localStorage state stays in
 * sync between the two UIs when both are accessible.
 */

interface JournalSettingsPanelProps {
  onClose: () => void;
}

const JournalSettingsPanel: React.FC<JournalSettingsPanelProps> = ({ onClose }) => {
  const [mode, setMode] = useState<DeviationAlertMode>(() => getDeviationAlertMode());
  const [count, setCount] = useState<number>(() => journalSize());

  const handleModeChange = (m: DeviationAlertMode) => {
    setMode(m);
    setDeviationAlertMode(m);
  };

  const handleDownload = () => {
    const data = exportJournal();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `deviation-journal-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    if (!window.confirm(`Clear ${count} journal entries? This cannot be undone.`)) return;
    clearJournal();
    setCount(0);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1f2937', color: '#e5e7eb',
          border: '1px solid #374151', borderRadius: 8,
          padding: '1.2em 1.5em', maxWidth: 420, width: '90%',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1em' }}>
          <h3 style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>Strategy journal</h3>
          <button
            onClick={onClose}
            style={{ background: 'transparent', color: '#9ca3af', border: 'none', fontSize: '1.3em', cursor: 'pointer', padding: '0 0.2em' }}
            aria-label="Close"
          >×</button>
        </div>

        <p style={{ fontSize: '0.85em', color: '#9ca3af', margin: '0 0 1em 0', lineHeight: 1.4 }}>
          Records every human decision alongside what the currently-selected Auto Play strategy
          would have done. Optionally flashes a banner on divergence.
        </p>

        <div style={{ marginBottom: '1em' }}>
          <label style={{ display: 'block', fontSize: '0.85em', fontWeight: 600, marginBottom: '0.4em' }}>
            Deviation alert mode
          </label>
          <select
            value={mode}
            onChange={e => handleModeChange(e.target.value as DeviationAlertMode)}
            style={{
              background: '#111827', color: '#e5e7eb',
              border: '1px solid #4b5563', borderRadius: 4,
              padding: '0.5em 0.7em', fontSize: '0.9em', width: '100%',
            }}
          >
            <option value="off">Off (default)</option>
            <option value="deviation">On — show "DEVIATION DETECTED"</option>
            <option value="blunder">On — show "BLUNDER!"</option>
          </select>
          <div style={{ fontSize: '0.75em', color: '#6b7280', marginTop: '0.3em' }}>
            The journal records decisions regardless of this setting — the toggle only controls the
            in-game banner.
          </div>
        </div>

        <div style={{ borderTop: '1px solid #374151', paddingTop: '0.9em' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6em' }}>
            <div>
              <div style={{ fontSize: '0.85em', fontWeight: 600 }}>Journal contents</div>
              <div style={{ fontSize: '0.75em', color: '#6b7280' }}>
                {count === 0
                  ? 'Empty — play a hand to start recording.'
                  : `${count} entries stored in browser localStorage.`}
              </div>
            </div>
            <button
              onClick={() => setCount(journalSize())}
              title="Refresh count"
              style={{ background: '#374151', color: '#e5e7eb', border: 'none', padding: '0.3em 0.6em', borderRadius: 4, fontSize: '0.75em', cursor: 'pointer' }}
            >⟳</button>
          </div>
          <div style={{ display: 'flex', gap: '0.5em' }}>
            <button
              onClick={handleDownload}
              disabled={count === 0}
              style={{
                background: count === 0 ? '#374151' : '#2563eb',
                color: count === 0 ? '#6b7280' : '#fff',
                border: 'none', padding: '0.5em 0.9em', borderRadius: 4,
                fontSize: '0.85em', cursor: count === 0 ? 'default' : 'pointer', flex: 1,
              }}
            >Download JSON</button>
            <button
              onClick={handleClear}
              disabled={count === 0}
              style={{
                background: count === 0 ? '#374151' : '#b91c1c',
                color: count === 0 ? '#6b7280' : '#fff',
                border: 'none', padding: '0.5em 0.9em', borderRadius: 4,
                fontSize: '0.85em', cursor: count === 0 ? 'default' : 'pointer',
              }}
            >Clear</button>
          </div>
          <div style={{ fontSize: '0.72em', color: '#6b7280', marginTop: '0.5em', lineHeight: 1.4 }}>
            The JSON export pairs with <code style={{ background: '#111827', padding: '0.05em 0.25em', borderRadius: 2 }}>scripts/journal-to-brief.js</code> in
            the repo to emit a markdown brief for strategy review.
          </div>
        </div>
      </div>
    </div>
  );
};

export default JournalSettingsPanel;
