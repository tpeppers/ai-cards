import React, { useState, useCallback, useEffect } from 'react';
import {
  SignalLabConfig,
  SIGNAL_LAB_PRESETS,
  DEFAULT_CONFIG,
  generateSignalStrategy,
  configSummary,
  getAvailableBaseStyles,
} from '../simulation/signalLab.ts';

export interface SignalLabStrategy {
  name: string;
  strategyText: string;
}

interface Props {
  onStrategiesChange: (strategies: SignalLabStrategy[]) => void;
}

const baseStyles = getAvailableBaseStyles();

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '4px',
  border: '1px solid #4b5563',
  backgroundColor: '#374151',
  color: '#e5e7eb',
  fontSize: '12px',
};

const sliderRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '6px',
  fontSize: '13px',
};

const labelStyle: React.CSSProperties = {
  width: '180px',
  flexShrink: 0,
  color: '#9ca3af',
};

const ConfigEditor: React.FC<{
  config: SignalLabConfig;
  onChange: (config: SignalLabConfig) => void;
}> = ({ config, onChange }) => {
  const set = <K extends keyof SignalLabConfig>(key: K, val: SignalLabConfig[K]) =>
    onChange({ ...config, [key]: val });

  return (
    <div style={{
      padding: '12px',
      backgroundColor: '#0f1f15',
      borderRadius: '6px',
      border: '1px solid #374151',
      marginTop: '8px',
    }}>
      {/* Name */}
      <div style={sliderRow}>
        <span style={labelStyle}>Name</span>
        <input
          value={config.name}
          onChange={e => set('name', e.target.value)}
          style={{
            ...selectStyle,
            flex: 1,
            padding: '4px 8px',
          }}
        />
      </div>

      {/* ── Bid Signals ── */}
      <div style={{ color: '#6ee7b7', fontSize: '12px', fontWeight: 'bold', margin: '10px 0 6px', borderBottom: '1px solid #374151', paddingBottom: '4px' }}>
        BID SIGNALS (Seats 1 & 2)
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Bid 1 (downtown)</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <input type="checkbox" checked={config.bid1Enabled} onChange={e => set('bid1Enabled', e.target.checked)} style={{ accentColor: '#3b82f6' }} />
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>enabled</span>
        </label>
        {config.bid1Enabled && (
          <>
            <span style={{ color: '#9ca3af', fontSize: '12px' }}>deuce_trey &ge;</span>
            <input type="range" min={1} max={5} value={config.bid1Threshold} onChange={e => set('bid1Threshold', +e.target.value)} style={{ width: '80px' }} />
            <span style={{ minWidth: '16px', color: '#fbbf24' }}>{config.bid1Threshold}</span>
          </>
        )}
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Bid 2 (uptown)</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <input type="checkbox" checked={config.bid2Enabled} onChange={e => set('bid2Enabled', e.target.checked)} style={{ accentColor: '#3b82f6' }} />
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>enabled</span>
        </label>
        {config.bid2Enabled && (
          <>
            <span style={{ color: '#9ca3af', fontSize: '12px' }}>king_ace &ge;</span>
            <input type="range" min={1} max={5} value={config.bid2Threshold} onChange={e => set('bid2Threshold', +e.target.value)} style={{ width: '80px' }} />
            <span style={{ minWidth: '16px', color: '#fbbf24' }}>{config.bid2Threshold}</span>
          </>
        )}
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Bid 3 meaning</span>
        <select value={config.bid3Mode} onChange={e => set('bid3Mode', e.target.value as SignalLabConfig['bid3Mode'])} style={selectStyle}>
          <option value="disabled">Disabled</option>
          <option value="mixed">Mixed (high + low)</option>
          <option value="aces2">2+ Aces</option>
          <option value="aces3">3+ Aces</option>
        </select>
        {config.bid3Mode === 'mixed' && (
          <>
            <span style={{ color: '#9ca3af', fontSize: '12px' }}>each &ge;</span>
            <input type="range" min={1} max={4} value={config.bid3MixedThreshold} onChange={e => set('bid3MixedThreshold', +e.target.value)} style={{ width: '60px' }} />
            <span style={{ minWidth: '16px', color: '#fbbf24' }}>{config.bid3MixedThreshold}</span>
          </>
        )}
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Strong suit threshold</span>
        <input type="range" min={4} max={8} value={config.strongSuitThreshold} onChange={e => set('strongSuitThreshold', +e.target.value)} style={{ width: '80px' }} />
        <span style={{ minWidth: '16px', color: '#fbbf24' }}>{config.strongSuitThreshold}+</span>
        <span style={{ color: '#6b7280', fontSize: '11px' }}>cards to bid 4</span>
      </div>

      {/* ── Seat 3 & Dealer ── */}
      <div style={{ color: '#6ee7b7', fontSize: '12px', fontWeight: 'bold', margin: '10px 0 6px', borderBottom: '1px solid #374151', paddingBottom: '4px' }}>
        SEAT 3 & DEALER
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Seat 3 min bid</span>
        <input type="range" min={3} max={5} value={config.seat3MinBid} onChange={e => set('seat3MinBid', +e.target.value)} style={{ width: '80px' }} />
        <span style={{ minWidth: '16px', color: '#fbbf24' }}>{config.seat3MinBid}</span>
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Seat 3 push on partner</span>
        <input type="checkbox" checked={config.seat3PushOnPartner} onChange={e => set('seat3PushOnPartner', e.target.checked)} style={{ accentColor: '#3b82f6' }} />
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Dealer take max</span>
        <input type="range" min={1} max={5} value={config.dealerTakeMax} onChange={e => set('dealerTakeMax', +e.target.value)} style={{ width: '80px' }} />
        <span style={{ minWidth: '16px', color: '#fbbf24' }}>{config.dealerTakeMax}</span>
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Dealer steal protection</span>
        <input type="checkbox" checked={config.dealerStealProtection} onChange={e => set('dealerStealProtection', e.target.checked)} style={{ accentColor: '#3b82f6' }} />
      </div>

      {/* ── Trump Selection ── */}
      <div style={{ color: '#6ee7b7', fontSize: '12px', fontWeight: 'bold', margin: '10px 0 6px', borderBottom: '1px solid #374151', paddingBottom: '4px' }}>
        TRUMP SELECTION
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Partner bonus</span>
        <input type="range" min={0} max={6} value={config.partnerBonus} onChange={e => set('partnerBonus', +e.target.value)} style={{ width: '100px' }} />
        <span style={{ minWidth: '24px', color: '#fbbf24' }}>+{config.partnerBonus}</span>
        <span style={{ color: '#6b7280', fontSize: '11px' }}>added to partner's direction count</span>
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Enemy counter</span>
        <input type="range" min={0} max={5} value={config.enemyCounter} onChange={e => set('enemyCounter', +e.target.value)} style={{ width: '100px' }} />
        <span style={{ minWidth: '24px', color: '#fbbf24' }}>+{config.enemyCounter}</span>
        <span style={{ color: '#6b7280', fontSize: '11px' }}>counter-bonus vs enemy signal</span>
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Aces for downtown</span>
        <input type="range" min={1} max={3} value={config.aceThreshold} onChange={e => set('aceThreshold', +e.target.value)} style={{ width: '80px' }} />
        <span style={{ minWidth: '16px', color: '#fbbf24' }}>{config.aceThreshold}</span>
        <span style={{ color: '#6b7280', fontSize: '11px' }}>vs downtown-noaces</span>
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Trust bid-3 = aces</span>
        <input type="checkbox" checked={config.trustBid3Aces} onChange={e => set('trustBid3Aces', e.target.checked)} style={{ accentColor: '#3b82f6' }} />
        <span style={{ color: '#6b7280', fontSize: '11px' }}>partner bid 3 means "has 2+ aces"</span>
      </div>

      {/* ── Base Play/Discard Style ── */}
      <div style={{ color: '#6ee7b7', fontSize: '12px', fontWeight: 'bold', margin: '10px 0 6px', borderBottom: '1px solid #374151', paddingBottom: '4px' }}>
        PLAY & DISCARD
      </div>

      <div style={sliderRow}>
        <span style={labelStyle}>Base style</span>
        <select value={config.baseStyle} onChange={e => set('baseStyle', e.target.value)} style={{ ...selectStyle, flex: 1 }}>
          {baseStyles.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      {/* ── Generated strategy preview ── */}
      <details style={{ marginTop: '8px' }}>
        <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: '12px' }}>
          Preview generated strategy
        </summary>
        <pre style={{
          marginTop: '6px',
          padding: '8px',
          backgroundColor: '#1a2e23',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#9ca3af',
          maxHeight: '200px',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
        }}>
          {generateSignalStrategy(config)}
        </pre>
      </details>
    </div>
  );
};

const SignalLabPanel: React.FC<Props> = ({ onStrategiesChange }) => {
  const [configs, setConfigs] = useState<SignalLabConfig[]>(() => [...SIGNAL_LAB_PRESETS]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set([0, 1, 4]));
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Report selected strategies to parent whenever selection/configs change
  const reportStrategies = useCallback(() => {
    const strategies = Array.from(selected)
      .sort((a, b) => a - b)
      .filter(i => i < configs.length)
      .map(i => ({
        name: configs[i].name,
        strategyText: generateSignalStrategy(configs[i]),
      }));
    onStrategiesChange(strategies);
  }, [selected, configs, onStrategiesChange]);

  useEffect(() => {
    reportStrategies();
  }, [reportStrategies]);

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const updateConfig = (idx: number, config: SignalLabConfig) => {
    setConfigs(prev => {
      const next = [...prev];
      next[idx] = config;
      return next;
    });
  };

  const addCustom = () => {
    const newConfig = { ...DEFAULT_CONFIG, name: `Custom ${configs.length - SIGNAL_LAB_PRESETS.length + 1}` };
    setConfigs(prev => [...prev, newConfig]);
    const newIdx = configs.length;
    setSelected(prev => new Set([...prev, newIdx]));
    setExpandedIndex(newIdx);
  };

  const removeConfig = (idx: number) => {
    if (idx < SIGNAL_LAB_PRESETS.length) return; // can't remove presets
    setConfigs(prev => prev.filter((_, i) => i !== idx));
    setSelected(prev => {
      const next = new Set<number>();
      for (const s of prev) {
        if (s < idx) next.add(s);
        else if (s > idx) next.add(s - 1);
        // skip s === idx (removed)
      }
      return next;
    });
    if (expandedIndex === idx) setExpandedIndex(null);
    else if (expandedIndex !== null && expandedIndex > idx) setExpandedIndex(expandedIndex - 1);
  };

  const duplicateConfig = (idx: number) => {
    const copy = { ...configs[idx], name: `${configs[idx].name} (copy)` };
    setConfigs(prev => [...prev, copy]);
    const newIdx = configs.length;
    setSelected(prev => new Set([...prev, newIdx]));
    setExpandedIndex(newIdx);
  };

  const selectedCount = selected.size;

  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
        Signal bid variants ({selectedCount} selected, need 2+)
      </label>

      <div style={{
        maxHeight: expandedIndex !== null ? '600px' : '360px',
        overflowY: 'auto',
        backgroundColor: '#0f1f15',
        borderRadius: '6px',
        padding: '8px',
        border: '1px solid #374151',
      }}>
        {configs.map((config, i) => {
          const isPreset = i < SIGNAL_LAB_PRESETS.length;
          const isExpanded = expandedIndex === i;
          const isSelected = selected.has(i);

          return (
            <div key={i} style={{ marginBottom: '2px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(i)}
                  style={{ accentColor: '#3b82f6', flexShrink: 0 }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: isExpanded ? '#6ee7b7' : '#e5e7eb',
                  }}
                  onClick={() => setExpandedIndex(isExpanded ? null : i)}
                >
                  {config.name}
                  <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '8px' }}>
                    {configSummary(config)}
                  </span>
                </span>
                <button
                  onClick={() => duplicateConfig(i)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#6b7280',
                    cursor: 'pointer',
                    fontSize: '12px',
                    padding: '2px 4px',
                  }}
                  title="Duplicate"
                >
                  copy
                </button>
                {!isPreset && (
                  <button
                    onClick={() => removeConfig(i)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      fontSize: '12px',
                      padding: '2px 4px',
                    }}
                    title="Remove"
                  >
                    x
                  </button>
                )}
              </div>
              {isExpanded && (
                <ConfigEditor
                  config={config}
                  onChange={(updated) => updateConfig(i, updated)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Add custom button */}
      <button
        onClick={addCustom}
        style={{
          marginTop: '8px',
          padding: '6px 16px',
          borderRadius: '4px',
          border: '1px dashed #4b5563',
          backgroundColor: 'transparent',
          color: '#9ca3af',
          cursor: 'pointer',
          fontSize: '13px',
        }}
      >
        + Add Custom Variant
      </button>
    </div>
  );
};

export default SignalLabPanel;
