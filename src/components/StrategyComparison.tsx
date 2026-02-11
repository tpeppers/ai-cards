import React, { useState, useRef } from 'react';
import { STRATEGY_REGISTRY, StrategyRegistryEntry } from '../strategies/index.ts';
import { BatchRunner } from '../simulation/BatchRunner.ts';
import { ComparisonConfig, StrategyComparisonResult } from '../simulation/types.ts';
import ComparisonResults from './ComparisonResults.tsx';

const bidWhistStrategies = STRATEGY_REGISTRY.filter(s => s.game === 'bidwhist');

const GAME_COUNT_OPTIONS = [10, 100, 1000, 10000];

const StrategyComparison: React.FC = () => {
  const [assignmentMode, setAssignmentMode] = useState<'by-team' | 'by-player'>('by-team');
  const [team0Strategy, setTeam0Strategy] = useState(0);
  const [team1Strategy, setTeam1Strategy] = useState(1);
  const [numGames, setNumGames] = useState(100);
  const [customStrategy, setCustomStrategy] = useState('');
  const [useCustomForTeam, setUseCustomForTeam] = useState<number | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [result, setResult] = useState<StrategyComparisonResult | null>(null);

  const runnerRef = useRef<BatchRunner | null>(null);

  const getStrategyForIndex = (idx: number): { name: string; text: string } => {
    if (idx < bidWhistStrategies.length) {
      return { name: bidWhistStrategies[idx].name, text: bidWhistStrategies[idx].text };
    }
    return { name: 'Custom', text: customStrategy };
  };

  const handleRun = async () => {
    const strat0 = useCustomForTeam === 0
      ? { name: 'Custom', text: customStrategy }
      : getStrategyForIndex(team0Strategy);
    const strat1 = useCustomForTeam === 1
      ? { name: 'Custom', text: customStrategy }
      : getStrategyForIndex(team1Strategy);

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

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px', color: '#e5e7eb' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '24px' }}>
        Strategy Comparison
      </h1>

      {/* Config panel */}
      <div style={{
        backgroundColor: '#1f2937',
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

        {/* Strategy dropdowns */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
              {assignmentMode === 'by-team' ? 'Team 0 (You & North)' : 'Player 0'}
            </label>
            <select
              value={useCustomForTeam === 0 ? 'custom' : team0Strategy}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setUseCustomForTeam(0);
                } else {
                  if (useCustomForTeam === 0) setUseCustomForTeam(null);
                  setTeam0Strategy(Number(e.target.value));
                }
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #4b5563',
                backgroundColor: '#374151',
                color: '#e5e7eb',
                minWidth: '180px',
              }}
            >
              {bidWhistStrategies.map((s, i) => (
                <option key={i} value={i}>{s.name}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
              {assignmentMode === 'by-team' ? 'Team 1 (East & West)' : 'Player 1'}
            </label>
            <select
              value={useCustomForTeam === 1 ? 'custom' : team1Strategy}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setUseCustomForTeam(1);
                } else {
                  if (useCustomForTeam === 1) setUseCustomForTeam(null);
                  setTeam1Strategy(Number(e.target.value));
                }
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #4b5563',
                backgroundColor: '#374151',
                color: '#e5e7eb',
                minWidth: '180px',
              }}
            >
              {bidWhistStrategies.map((s, i) => (
                <option key={i} value={i}>{s.name}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
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

        {/* Custom strategy textarea */}
        {useCustomForTeam !== null && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
              Custom Strategy (for {assignmentMode === 'by-team' ? `Team ${useCustomForTeam}` : `Player ${useCustomForTeam}`})
            </label>
            <textarea
              value={customStrategy}
              onChange={(e) => setCustomStrategy(e.target.value)}
              rows={12}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #4b5563',
                backgroundColor: '#374151',
                color: '#e5e7eb',
                fontFamily: 'monospace',
                fontSize: '13px',
                resize: 'vertical',
              }}
              placeholder="Paste .cstrat strategy here..."
            />
          </div>
        )}

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
          backgroundColor: '#1f2937',
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
  );
};

export default StrategyComparison;
