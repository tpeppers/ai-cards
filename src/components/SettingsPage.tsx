import React, { useState } from 'react';
import { playWhistingFanfare, stopWhistingFanfare, FINALE_OPTIONS, FinaleStyle } from '../utils/whistingSound.ts';
import { simpleBackings, themedBackings, allBackings } from '../utils/cardBackings.ts';

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
      </div>
    </div>
  );
};

export default SettingsPage;
