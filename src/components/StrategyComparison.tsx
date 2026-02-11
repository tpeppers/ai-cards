import React, { useState, useRef } from 'react';
import { STRATEGY_REGISTRY } from '../strategies/index.ts';
import { BatchRunner } from '../simulation/BatchRunner.ts';
import { ComparisonConfig, StrategyComparisonResult } from '../simulation/types.ts';
import ComparisonResults from './ComparisonResults.tsx';

const bidWhistStrategies = STRATEGY_REGISTRY.filter(s => s.game === 'bidwhist');
const CUSTOM_VALUE = 'custom';

const GAME_COUNT_OPTIONS = [10, 100, 1000, 10000];

const textareaBase: React.CSSProperties = {
  width: '100%',
  padding: '8px',
  borderRadius: '4px',
  border: '1px solid #4b5563',
  backgroundColor: '#374151',
  color: '#e5e7eb',
  fontFamily: 'monospace',
  fontSize: '13px',
  resize: 'vertical',
  boxSizing: 'border-box',
};

const StrategyComparison: React.FC = () => {
  const [assignmentMode, setAssignmentMode] = useState<'by-team' | 'by-player'>('by-team');
  const [team0Selection, setTeam0Selection] = useState('0');
  const [team1Selection, setTeam1Selection] = useState('1');
  const [custom0Text, setCustom0Text] = useState('');
  const [custom1Text, setCustom1Text] = useState('');
  const [numGames, setNumGames] = useState(100);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [result, setResult] = useState<StrategyComparisonResult | null>(null);

  const runnerRef = useRef<BatchRunner | null>(null);

  const isCustom0 = team0Selection === CUSTOM_VALUE;
  const isCustom1 = team1Selection === CUSTOM_VALUE;

  const getTextForSlot = (selection: string, customText: string): { name: string; text: string } => {
    if (selection === CUSTOM_VALUE) {
      return { name: 'Custom', text: customText };
    }
    const idx = Number(selection);
    const entry = bidWhistStrategies[idx];
    return { name: entry.name, text: entry.text };
  };

  const getDisplayText = (selection: string, customText: string): string => {
    if (selection === CUSTOM_VALUE) return customText;
    const idx = Number(selection);
    return bidWhistStrategies[idx]?.text ?? '';
  };

  const handleRun = async () => {
    const strat0 = getTextForSlot(team0Selection, custom0Text);
    const strat1 = getTextForSlot(team1Selection, custom1Text);

    const config: ComparisonConfig = {
      strategies: [
        { name: strat0.name, strategyText: strat0.text },
        { name: strat1.name, strategyText: strat1.text },
      ],
      assignmentMode,
      numGames,
    };

    const runner = new BatchRunner();
    runnerRef.current = runner;
    setRunning(true);
    setResult(null);
    setProgress({ completed: 0, total: numGames * 4 });

    try {
      const comparisonResult = await runner.runComparison(config, (completed, total) => {
        setProgress({ completed, total });
      });
      setResult(comparisonResult);
    } catch (err) {
      console.error('Comparison error:', err);
    } finally {
      setRunning(false);
      runnerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (runnerRef.current) {
      runnerRef.current.abort();
    }
  };

  const progressPct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

  const teamLabel = (idx: number) =>
    assignmentMode === 'by-team'
      ? (idx === 0 ? 'Team 0 (You & North)' : 'Team 1 (East & West)')
      : `Player ${idx}`;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f1f15', padding: '24px', color: '#e5e7eb' }}>
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '24px' }}>
        Strategy Comparison
      </h1>

      {/* Config panel */}
      <div style={{
        backgroundColor: '#162b1e',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        {/* Assignment mode toggle */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
            Assignment Mode
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setAssignmentMode('by-team')}
              style={{
                padding: '6px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: assignmentMode === 'by-team' ? '#3b82f6' : '#374151',
                color: '#e5e7eb',
                cursor: 'pointer',
              }}
            >
              By Team
            </button>
            <button
              onClick={() => setAssignmentMode('by-player')}
              style={{
                padding: '6px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: assignmentMode === 'by-player' ? '#3b82f6' : '#374151',
                color: '#e5e7eb',
                cursor: 'pointer',
              }}
            >
              By Player
            </button>
          </div>
        </div>

        {/* Strategy slots side-by-side */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          {/* Slot 0 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
              {teamLabel(0)}
            </label>
            <select
              value={team0Selection}
              onChange={(e) => setTeam0Selection(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #4b5563',
                backgroundColor: '#374151',
                color: '#e5e7eb',
                width: '100%',
                marginBottom: '8px',
              }}
            >
              {bidWhistStrategies.map((s, i) => (
                <option key={i} value={String(i)}>{s.name}</option>
              ))}
              <option value={CUSTOM_VALUE}>Custom</option>
            </select>
            <textarea
              value={getDisplayText(team0Selection, custom0Text)}
              onChange={(e) => { if (isCustom0) setCustom0Text(e.target.value); }}
              readOnly={!isCustom0}
              rows={14}
              style={{
                ...textareaBase,
                opacity: isCustom0 ? 1 : 0.7,
                cursor: isCustom0 ? 'text' : 'default',
              }}
              placeholder={isCustom0 ? 'Paste .cstrat strategy here...' : ''}
            />
          </div>

          {/* Slot 1 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
              {teamLabel(1)}
            </label>
            <select
              value={team1Selection}
              onChange={(e) => setTeam1Selection(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #4b5563',
                backgroundColor: '#374151',
                color: '#e5e7eb',
                width: '100%',
                marginBottom: '8px',
              }}
            >
              {bidWhistStrategies.map((s, i) => (
                <option key={i} value={String(i)}>{s.name}</option>
              ))}
              <option value={CUSTOM_VALUE}>Custom</option>
            </select>
            <textarea
              value={getDisplayText(team1Selection, custom1Text)}
              onChange={(e) => { if (isCustom1) setCustom1Text(e.target.value); }}
              readOnly={!isCustom1}
              rows={14}
              style={{
                ...textareaBase,
                opacity: isCustom1 ? 1 : 0.7,
                cursor: isCustom1 ? 'text' : 'default',
              }}
              placeholder={isCustom1 ? 'Paste .cstrat strategy here...' : ''}
            />
          </div>
        </div>

        {/* Game count */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            Number of Games (each played with 4 rotations)
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {GAME_COUNT_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => setNumGames(n)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: numGames === n ? '#3b82f6' : '#374151',
                  color: '#e5e7eb',
                  cursor: 'pointer',
                }}
              >
                {n >= 1000 ? `${n / 1000}K` : n}
              </button>
            ))}
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={running}
          style={{
            padding: '10px 32px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: running ? '#4b5563' : '#10b981',
            color: '#ffffff',
            fontWeight: 'bold',
            fontSize: '16px',
            cursor: running ? 'not-allowed' : 'pointer',
          }}
        >
          {running ? 'Running...' : 'Run Comparison'}
        </button>
      </div>

      {/* Progress bar */}
      {running && (
        <div style={{
          backgroundColor: '#162b1e',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span>Progress: {progress.completed} / {progress.total} simulations</span>
            <button
              onClick={handleCancel}
              style={{
                padding: '4px 12px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: '#ef4444',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
          </div>
          <div style={{
            width: '100%',
            height: '8px',
            backgroundColor: '#374151',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${progressPct}%`,
              height: '100%',
              backgroundColor: '#3b82f6',
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}

      {/* Results */}
      {result && <ComparisonResults result={result} />}
    </div>
    </div>
  );
};

export default StrategyComparison;
