import React, { useState, useRef } from 'react';
import { STRATEGY_REGISTRY, splitStrategySections, replaceStrategySection } from '../strategies/index.ts';
import { BatchRunner } from '../simulation/BatchRunner.ts';
import { ComparisonConfig, StrategyComparisonResult } from '../simulation/types.ts';
import { RED_TEAM_DECKS } from '../simulation/redTeamDecks.ts';
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
  const [assignmentMode, setAssignmentMode] = useState<'by-team' | 'round-robin' | 'ab-test'>('by-team');
  const [team0Selection, setTeam0Selection] = useState('0');
  const [team1Selection, setTeam1Selection] = useState('1');
  const [custom0Text, setCustom0Text] = useState('');
  const [custom1Text, setCustom1Text] = useState('');
  const [numGames, setNumGames] = useState(100);

  // Round-robin state
  const [rrSelected, setRrSelected] = useState<Set<number>>(() => new Set([0, 1]));
  const [rrCustomChecked, setRrCustomChecked] = useState(false);
  const [rrCustomText, setRrCustomText] = useState('');

  // A/B Test state
  const [abBaseSelection, setAbBaseSelection] = useState('0');
  const [abSection, setAbSection] = useState<'play' | 'bid' | 'trump' | 'discard'>('trump');
  const [abOverrideSource, setAbOverrideSource] = useState('0'); // index into bidWhistStrategies, or 'manual'
  const [abSectionText, setAbSectionText] = useState(() => {
    const sections = splitStrategySections(bidWhistStrategies[0].text);
    return sections.trump;
  });

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

  const toggleRrStrategy = (idx: number) => {
    setRrSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const rrStrategyCount = rrSelected.size + (rrCustomChecked ? 1 : 0);

  const abBaseText = bidWhistStrategies[Number(abBaseSelection)]?.text ?? '';
  const abSections = splitStrategySections(abBaseText);
  const abOriginalSectionText = abSections[abSection];

  const handleAbBaseChange = (value: string) => {
    setAbBaseSelection(value);
    // Reset override source to base strategy and load its section
    setAbOverrideSource(value);
    const sections = splitStrategySections(bidWhistStrategies[Number(value)].text);
    setAbSectionText(sections[abSection]);
  };

  const handleAbSectionChange = (section: 'play' | 'bid' | 'trump' | 'discard') => {
    setAbSection(section);
    // Load section from current override source (or base if manual)
    const sourceIdx = abOverrideSource === 'manual' ? Number(abBaseSelection) : Number(abOverrideSource);
    const sections = splitStrategySections(bidWhistStrategies[sourceIdx].text);
    setAbSectionText(sections[section]);
  };

  const handleAbOverrideSourceChange = (value: string) => {
    setAbOverrideSource(value);
    if (value !== 'manual') {
      const sections = splitStrategySections(bidWhistStrategies[Number(value)].text);
      setAbSectionText(sections[abSection]);
    }
  };

  const handleRun = async () => {
    let config: ComparisonConfig;

    const isRedMode = numGames === -1;
    const effectiveNumGames = isRedMode ? RED_TEAM_DECKS.length : numGames;
    const predefinedDeckUrls = isRedMode ? RED_TEAM_DECKS.map(d => d.url) : undefined;

    if (assignmentMode === 'ab-test') {
      const baseEntry = bidWhistStrategies[Number(abBaseSelection)];
      const modifiedText = replaceStrategySection(baseEntry.text, abSection, abSectionText);
      const sourceEntry = abOverrideSource !== 'manual' ? bidWhistStrategies[Number(abOverrideSource)] : null;
      const modLabel = sourceEntry && sourceEntry.name !== baseEntry.name
        ? `${sourceEntry.name} ${abSection}`
        : `modified ${abSection}`;
      config = {
        strategies: [
          { name: baseEntry.name, strategyText: baseEntry.text },
          { name: `${baseEntry.name} (${modLabel})`, strategyText: modifiedText },
        ],
        assignmentMode: 'by-team',
        numGames: effectiveNumGames,
        predefinedDeckUrls,
      };
    } else if (assignmentMode === 'by-team') {
      const strat0 = getTextForSlot(team0Selection, custom0Text);
      const strat1 = getTextForSlot(team1Selection, custom1Text);
      config = {
        strategies: [
          { name: strat0.name, strategyText: strat0.text },
          { name: strat1.name, strategyText: strat1.text },
        ],
        assignmentMode,
        numGames: effectiveNumGames,
        predefinedDeckUrls,
      };
    } else {
      // Round-robin: build strategies from checked items
      const strategies = Array.from(rrSelected)
        .sort((a, b) => a - b)
        .map(idx => ({
          name: bidWhistStrategies[idx].name,
          strategyText: bidWhistStrategies[idx].text,
        }));
      if (rrCustomChecked && rrCustomText.trim()) {
        strategies.push({ name: 'Custom', strategyText: rrCustomText });
      }
      config = { strategies, assignmentMode, numGames: effectiveNumGames, predefinedDeckUrls };
    }

    const runner = new BatchRunner();
    runnerRef.current = runner;
    setRunning(true);
    setResult(null);
    setProgress({ completed: 0, total: 0 });

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

  const canRun = assignmentMode === 'by-team' || assignmentMode === 'ab-test' || rrStrategyCount >= 2;

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
              onClick={() => setAssignmentMode('round-robin')}
              style={{
                padding: '6px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: assignmentMode === 'round-robin' ? '#3b82f6' : '#374151',
                color: '#e5e7eb',
                cursor: 'pointer',
              }}
            >
              Round Robin
            </button>
            <button
              onClick={() => setAssignmentMode('ab-test')}
              style={{
                padding: '6px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: assignmentMode === 'ab-test' ? '#3b82f6' : '#374151',
                color: '#e5e7eb',
                cursor: 'pointer',
              }}
            >
              A/B Test
            </button>
          </div>
        </div>

        {/* By-team: two strategy slots side-by-side */}
        {assignmentMode === 'by-team' && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
            {/* Slot 0 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                Team 0 (You & North)
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
                Team 1 (East & West)
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
        )}

        {/* Round-robin: checkbox list */}
        {assignmentMode === 'round-robin' && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
              Select strategies to compare ({rrStrategyCount} selected, need 2+)
            </label>
            <div style={{
              maxHeight: '300px',
              overflowY: 'auto',
              backgroundColor: '#0f1f15',
              borderRadius: '6px',
              padding: '8px',
              border: '1px solid #374151',
            }}>
              {bidWhistStrategies.map((s, i) => (
                <label
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 8px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    backgroundColor: rrSelected.has(i) ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={rrSelected.has(i)}
                    onChange={() => toggleRrStrategy(i)}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <span style={{ fontSize: '13px' }}>{s.name}</span>
                </label>
              ))}
              {/* Custom option */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  backgroundColor: rrCustomChecked ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  borderTop: '1px solid #374151',
                  marginTop: '4px',
                  paddingTop: '10px',
                }}
              >
                <input
                  type="checkbox"
                  checked={rrCustomChecked}
                  onChange={() => setRrCustomChecked(!rrCustomChecked)}
                  style={{ accentColor: '#3b82f6' }}
                />
                <span style={{ fontSize: '13px' }}>Custom</span>
              </label>
            </div>
            {rrCustomChecked && (
              <textarea
                value={rrCustomText}
                onChange={(e) => setRrCustomText(e.target.value)}
                rows={10}
                style={{ ...textareaBase, marginTop: '8px' }}
                placeholder="Paste .cstrat strategy here..."
              />
            )}
          </div>
        )}

        {/* A/B Test: base strategy + section override */}
        {assignmentMode === 'ab-test' && (
          <div style={{ marginBottom: '16px' }}>
            {/* Base strategy selector */}
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
              Base Strategy
            </label>
            <select
              value={abBaseSelection}
              onChange={(e) => handleAbBaseChange(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #4b5563',
                backgroundColor: '#374151',
                color: '#e5e7eb',
                width: '100%',
                marginBottom: '12px',
              }}
            >
              {bidWhistStrategies.map((s, i) => (
                <option key={i} value={String(i)}>{s.name}</option>
              ))}
            </select>

            {/* Section selector */}
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
              Section to Override
            </label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              {(['play', 'bid', 'trump', 'discard'] as const).map(sec => (
                <button
                  key={sec}
                  onClick={() => handleAbSectionChange(sec)}
                  style={{
                    padding: '6px 16px',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: abSection === sec ? '#3b82f6' : '#374151',
                    color: '#e5e7eb',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                  }}
                >
                  {sec}:
                </button>
              ))}
            </div>

            {/* Override source dropdown */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '6px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                  Original
                </label>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                  Modified
                </label>
                <select
                  value={abOverrideSource}
                  onChange={(e) => handleAbOverrideSourceChange(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    border: '1px solid #4b5563',
                    backgroundColor: '#374151',
                    color: '#e5e7eb',
                    width: '100%',
                    fontSize: '12px',
                  }}
                >
                  {bidWhistStrategies.map((s, i) => (
                    <option key={i} value={String(i)}>
                      {s.name}{String(i) === abBaseSelection ? ' (base)' : ''} — {abSection}:
                    </option>
                  ))}
                  <option value="manual">Manual edit</option>
                </select>
              </div>
            </div>

            {/* Side-by-side textareas */}
            <div style={{ display: 'flex', gap: '16px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <textarea
                  value={abOriginalSectionText}
                  readOnly
                  rows={14}
                  style={{
                    ...textareaBase,
                    opacity: 0.7,
                    cursor: 'default',
                  }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <textarea
                  value={abSectionText}
                  onChange={(e) => { setAbSectionText(e.target.value); setAbOverrideSource('manual'); }}
                  rows={14}
                  style={textareaBase}
                />
              </div>
            </div>
          </div>
        )}

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
            <button
              onClick={() => setNumGames(-1)}
              style={{
                padding: '6px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: numGames === -1 ? '#ef4444' : '#374151',
                color: '#e5e7eb',
                cursor: 'pointer',
                fontWeight: numGames === -1 ? 'bold' : 'normal',
              }}
            >
              {RED_TEAM_DECKS.length}-RED
            </button>
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={running || !canRun}
          style={{
            padding: '10px 32px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: (running || !canRun) ? '#4b5563' : '#10b981',
            color: '#ffffff',
            fontWeight: 'bold',
            fontSize: '16px',
            cursor: (running || !canRun) ? 'not-allowed' : 'pointer',
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
