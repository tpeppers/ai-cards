import React, { useState } from 'react';
import { playWhistingFanfare, stopWhistingFanfare, FINALE_OPTIONS, FinaleStyle } from '../utils/whistingSound.ts';
import { simpleBackings, themedBackings, allBackings } from '../utils/cardBackings.ts';
import {
  getDeviationAlertMode, setDeviationAlertMode, DeviationAlertMode,
  exportJournal, clearJournal, journalSize,
} from '../utils/deviationJournal.ts';

const DEFAULT_SUIT_COLORS: { [key: string]: string } = {
  spades: '#000000',
  hearts: '#ff0000',
  diamonds: '#ff0000',
  clubs: '#000000',
};

const getSavedSuitColors = (): { [key: string]: string } => {
  try {
    const stored = localStorage.getItem('suitColors');
    if (stored) return { ...DEFAULT_SUIT_COLORS, ...JSON.parse(stored) };
  } catch {}
  return { ...DEFAULT_SUIT_COLORS };
};

const SettingsPage: React.FC = () => {
  const [selectedBacking, setSelectedBacking] = useState(() =>
    localStorage.getItem('cardBacking') || 'classic'
  );
  const [suitColors, setSuitColors] = useState(getSavedSuitColors);
  const [animationMode, setAnimationMode] = useState(() =>
    localStorage.getItem('whistingAnimation') || 'enabled'
  );
  const [finaleStyle, setFinaleStyle] = useState(() =>
    localStorage.getItem('whistingFinale') || 'orchestra'
  );
  const [soundEnabled, setSoundEnabled] = useState(() =>
    (localStorage.getItem('whistingSound') || 'enabled') !== 'disabled'
  );
  const [devAlertMode, setDevAlertModeState] = useState<DeviationAlertMode>(() => getDeviationAlertMode());
  const [journalCount, setJournalCount] = useState<number>(() => journalSize());
  const [gameModeEnabled, setGameModeEnabled] = useState<boolean>(() =>
    localStorage.getItem('gameModeEnabled') === '1'
  );

  const handleBackingChange = (id: string) => {
    setSelectedBacking(id);
    localStorage.setItem('cardBacking', id);
  };

  const handleSuitColorChange = (suit: string, color: string) => {
    const updated = { ...suitColors, [suit]: color };
    setSuitColors(updated);
    localStorage.setItem('suitColors', JSON.stringify(updated));
  };

  const handleResetColors = () => {
    setSuitColors({ ...DEFAULT_SUIT_COLORS });
    localStorage.removeItem('suitColors');
  };

  const handleAnimationChange = (mode: string) => {
    setAnimationMode(mode);
    localStorage.setItem('whistingAnimation', mode);
  };

  const handleFinaleChange = (style: string) => {
    setFinaleStyle(style);
    localStorage.setItem('whistingFinale', style);
  };

  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    localStorage.setItem('whistingSound', enabled ? 'enabled' : 'disabled');
  };

  const handleDevAlertChange = (mode: DeviationAlertMode) => {
    setDevAlertModeState(mode);
    setDeviationAlertMode(mode);
  };

  const handleDownloadJournal = () => {
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

  const handleClearJournal = () => {
    if (!window.confirm(`Clear ${journalCount} journal entries? This cannot be undone.`)) return;
    clearJournal();
    setJournalCount(0);
  };

  const handleGameModeToggle = (enabled: boolean) => {
    setGameModeEnabled(enabled);
    if (enabled) localStorage.setItem('gameModeEnabled', '1');
    else localStorage.removeItem('gameModeEnabled');
  };

  const selectedBackingData = allBackings.find(b => b.id === selectedBacking);

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: '#1a1a2e',
        backgroundImage: 'radial-gradient(circle at 50% 50%, #16213e 0%, #1a1a2e 100%)',
        color: '#e5e7eb',
      }}
    >
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Settings</h1>

        {/* Card Backing */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-600 pb-2">Card Backing</h2>

          <h3 className="text-sm font-medium text-gray-400 mb-2">Solid Patterns</h3>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {simpleBackings.map(backing => (
              <button
                key={backing.id}
                onClick={() => handleBackingChange(backing.id)}
                className={`relative p-1 rounded-lg transition-all ${
                  selectedBacking === backing.id
                    ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900'
                    : 'hover:ring-2 hover:ring-gray-500'
                }`}
              >
                <div
                  className="w-full h-16 rounded border border-gray-600"
                  style={{ background: backing.pattern }}
                />
                <span className="block text-xs mt-1 text-gray-400 truncate">{backing.name}</span>
              </button>
            ))}
          </div>

          <h3 className="text-sm font-medium text-gray-400 mb-2">Whisted Themes</h3>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {themedBackings.map(backing => (
              <button
                key={backing.id}
                onClick={() => handleBackingChange(backing.id)}
                className={`relative p-1 rounded-lg transition-all ${
                  selectedBacking === backing.id
                    ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900'
                    : 'hover:ring-2 hover:ring-gray-500'
                }`}
              >
                <div
                  className="w-full h-16 rounded border border-gray-600"
                  style={{ background: backing.pattern }}
                />
                <span className="block text-xs mt-1 text-gray-400 truncate">{backing.name}</span>
              </button>
            ))}
          </div>

          {/* Preview */}
          <div className="flex justify-center">
            <div className="text-center">
              <span className="text-sm text-gray-500 block mb-2">Preview</span>
              <div
                className="w-20 h-28 rounded border-2 border-gray-500 shadow-lg mx-auto"
                style={{ background: selectedBackingData?.pattern }}
              />
            </div>
          </div>
        </section>

        {/* Suit Colors */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-600 pb-2">Suit Colors</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            {(['spades', 'hearts', 'diamonds', 'clubs'] as const).map(suit => {
              const symbols: { [k: string]: string } = {
                spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
              };
              return (
                <div key={suit} className="flex items-center gap-3 bg-gray-800 rounded-lg p-3">
                  <span className="text-2xl" style={{ color: suitColors[suit] }}>
                    {symbols[suit]}
                  </span>
                  <span className="capitalize text-sm flex-1">{suit}</span>
                  <input
                    type="color"
                    value={suitColors[suit]}
                    onChange={e => handleSuitColorChange(suit, e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border-0"
                    style={{ backgroundColor: 'transparent' }}
                  />
                </div>
              );
            })}
          </div>
          {/* Preview card */}
          <div className="flex justify-center gap-3 mb-4">
            {(['spades', 'hearts', 'diamonds', 'clubs'] as const).map(suit => {
              const symbols: { [k: string]: string } = {
                spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
              };
              return (
                <div
                  key={suit}
                  className="w-14 h-20 bg-white rounded border border-gray-400 flex flex-col items-center justify-center shadow"
                >
                  <span className="font-bold text-sm" style={{ color: suitColors[suit] }}>A</span>
                  <span className="text-xl" style={{ color: suitColors[suit] }}>{symbols[suit]}</span>
                </div>
              );
            })}
          </div>
          <button
            onClick={handleResetColors}
            className="text-sm text-blue-400 hover:text-blue-300 underline"
          >
            Reset to Default
          </button>
        </section>

        {/* Whisting Animation */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-600 pb-2">Whisting Animation</h2>
          <div className="space-y-3">
            {([
              { value: 'enabled', label: 'Enabled', desc: 'Show celebration animation in a centered window (default).' },
              { value: 'disabled', label: 'Disabled', desc: 'Skip the animation entirely — go straight to the game-over screen.' },
              { value: 'fullscreen', label: 'Full Screen', desc: 'Stretch the animation to fill the entire viewport.' },
            ] as const).map(opt => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  animationMode === opt.value ? 'bg-blue-900 bg-opacity-40' : 'bg-gray-800 hover:bg-gray-750'
                }`}
              >
                <input
                  type="radio"
                  name="whistingAnimation"
                  value={opt.value}
                  checked={animationMode === opt.value}
                  onChange={() => handleAnimationChange(opt.value)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-sm text-gray-400">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Whisting Sound */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-600 pb-2">Whisting Sound</h2>
          <div className="flex items-center gap-3 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={e => handleSoundToggle(e.target.checked)}
              />
              <span className="text-sm">Play fanfare on whisting</span>
            </label>
          </div>
          {soundEnabled && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400">Finale style:</label>
                <select
                  value={finaleStyle}
                  onChange={e => handleFinaleChange(e.target.value)}
                  className="bg-gray-800 text-white border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {FINALE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <button
                  className="text-sm text-blue-400 hover:text-blue-300 underline"
                  onClick={() => {
                    stopWhistingFanfare();
                    playWhistingFanfare(finaleStyle as FinaleStyle);
                  }}
                >
                  Preview
                </button>
              </div>
              <p className="text-xs text-gray-500">
                All styles share the same ascending arpeggio buildup — only the finale chord differs.
              </p>
            </div>
          )}
        </section>

        {/* Deviation alerts / Journal */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">Strategy journal</h2>
          <p className="text-sm text-gray-400 mb-4">
            When enabled, every human decision is compared to the currently-selected Auto Play strategy's
            recommendation. Divergences briefly flash an on-screen banner and are recorded to a
            journal you can export for offline review.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Deviation alert mode</label>
              <select
                value={devAlertMode}
                onChange={(e) => handleDevAlertChange(e.target.value as DeviationAlertMode)}
                className="bg-gray-800 text-white border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="off">Off (default)</option>
                <option value="deviation">On — show "DEVIATION DETECTED"</option>
                <option value="blunder">On — show "BLUNDER!"</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                The journal is recorded regardless of this setting — the toggle only controls
                whether a banner is shown during play.
              </p>
            </div>

            <div className="pt-3 border-t border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-medium">Journal contents</div>
                  <div className="text-xs text-gray-500">
                    {journalCount === 0
                      ? 'No decisions recorded yet — play a hand to start logging.'
                      : `${journalCount} entries (decisions + hand outcomes).`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleDownloadJournal}
                  disabled={journalCount === 0}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm px-4 py-2 rounded"
                >
                  Download JSON
                </button>
                <button
                  onClick={() => setJournalCount(journalSize())}
                  className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-4 py-2 rounded"
                >
                  Refresh count
                </button>
                <button
                  onClick={handleClearJournal}
                  disabled={journalCount === 0}
                  className="bg-red-700 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm px-4 py-2 rounded"
                >
                  Clear journal
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                The JSON file pairs with <code className="bg-gray-800 px-1 rounded">scripts/journal-to-brief.js</code> which
                emits a markdown brief suitable for pasting into a fresh Claude Code conversation
                for strategy analysis.
              </p>
            </div>
          </div>
        </section>

        {/* Game Mode */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">Game Mode</h2>
          <p className="text-sm text-gray-400 mb-4">
            When enabled, the <a href="/upload" className="text-blue-400 underline">Upload</a> page
            shows a seat selector (Dealer / 1st, 2nd, 3rd bidder) and a session code field. Four
            uploads sharing a session code (one per seat, within 10 minutes) reconstruct the full
            52-character deck URL server-side and archive a zip containing the original images.
          </p>
          <p className="text-sm text-gray-400 mb-4">
            Requires the backend to be reachable (<code className="bg-gray-800 px-1 rounded">npm run server</code> locally,
            or the <code className="bg-gray-800 px-1 rounded">docker/Dockerfile.server</code> image running with a
            <code className="bg-gray-800 px-1 rounded"> GAME_MODE_STORAGE</code> volume mounted). Game Mode is a no-op on
            the GitHub Pages standalone build.
          </p>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={gameModeEnabled}
              onChange={(e) => handleGameModeToggle(e.target.checked)}
              className="rounded"
            />
            <span>Enable Game Mode uploads</span>
          </label>
          {gameModeEnabled && (
            <p className="text-xs text-gray-500 mt-2">
              Session codes are 6-character alphanumeric (ABCDEFGHJKLMNPQRSTUVWXYZ23456789).
              First uploader can leave it blank and the server will generate one — share that
              code with the other three players for the remaining uploads.
            </p>
          )}
        </section>
      </div>
    </div>
  );
};

export default SettingsPage;
