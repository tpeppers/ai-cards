import React, { useState, useRef, useMemo } from 'react';
import { STRATEGY_REGISTRY, splitStrategySections, replaceStrategySection } from '../strategies/index.ts';
import { BatchRunner } from '../simulation/BatchRunner.ts';
import { ComparisonConfig, StrategyComparisonResult } from '../simulation/types.ts';
import { RED_TEAM_DECKS } from '../simulation/redTeamDecks.ts';
import ComparisonResults from './ComparisonResults.tsx';
import {
  DiffLineType, DiffLine, DiffResult, DiffHunk,
  computeDiff, identifyHunks, buildEffectiveText,
} from '../utils/diffUtils.ts';

const bidWhistStrategies = STRATEGY_REGISTRY.filter(s => s.game === 'bidwhist');
const CUSTOM_VALUE = 'custom';

const HAND_COUNT_OPTIONS = [10, 100, 1000, 10000];

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

// --- Diff display ---

const DIFF_BG: Record<DiffLineType, string> = {
  same: 'transparent',
  added: 'rgba(34, 197, 94, 0.15)',
  removed: 'rgba(239, 68, 68, 0.15)',
  changed: 'rgba(234, 179, 8, 0.12)',
  comment: 'transparent',
  blank: 'rgba(75, 85, 99, 0.15)',
};

const DIFF_TEXT_COLOR: Record<DiffLineType, string> = {
  same: '#e5e7eb',
  added: '#4ade80',
  removed: '#f87171',
  changed: '#fbbf24',
  comment: '#6b7280',
  blank: 'transparent',
};

const DIFF_BORDER_COLOR: Record<string, string> = {
  added: '#4ade80',
  removed: '#f87171',
  changed: '#fbbf24',
};

const DIFF_LINE_HEIGHT = 20;

const DiffPane: React.FC<{
  lines: DiffLine[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}> = ({ lines, scrollRef, onScroll }) => (
  <div
    ref={scrollRef}
    onScroll={onScroll}
    style={{
      flex: 1,
      minWidth: 0,
      overflowY: 'auto',
      overflowX: 'auto',
      height: `${14 * DIFF_LINE_HEIGHT + 16}px`,
      padding: '8px',
      borderRadius: '4px',
      border: '1px solid #4b5563',
      backgroundColor: '#374151',
      fontFamily: 'monospace',
      fontSize: '13px',
      boxSizing: 'border-box',
      whiteSpace: 'pre',
    }}
  >
    {lines.map((line, i) => (
      <div
        key={i}
        style={{
          height: `${DIFF_LINE_HEIGHT}px`,
          lineHeight: `${DIFF_LINE_HEIGHT}px`,
          backgroundColor: DIFF_BG[line.type],
          color: DIFF_TEXT_COLOR[line.type],
          borderLeft: DIFF_BORDER_COLOR[line.type]
            ? `3px solid ${DIFF_BORDER_COLOR[line.type]}`
            : '3px solid transparent',
          paddingLeft: '6px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {line.text || '\u00A0'}
      </div>
    ))}
  </div>
);

const ABDiffPane: React.FC<{
  lines: DiffLine[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  side: 'left' | 'right';
  hunks: DiffHunk[];
  disabledHunkIds: Set<number>;
  onToggleHunk?: (hunkId: number) => void;
}> = ({ lines, scrollRef, onScroll, side, hunks, disabledHunkIds, onToggleHunk }) => {
  const lineHunkMap = useMemo(() => {
    const map = new Map<number, DiffHunk>();
    for (const h of hunks) {
      for (let i = h.start; i < h.start + h.length; i++) {
        map.set(i, h);
      }
    }
    return map;
  }, [hunks]);

  const hunkFirstLines = useMemo(() => {
    const map = new Map<number, DiffHunk>();
    for (const h of hunks) map.set(h.start, h);
    return map;
  }, [hunks]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      style={{
        flex: 1,
        minWidth: 0,
        overflowY: 'auto',
        overflowX: 'auto',
        height: `${14 * DIFF_LINE_HEIGHT + 16}px`,
        padding: '8px',
        borderRadius: '4px',
        border: '1px solid #4b5563',
        backgroundColor: '#374151',
        fontFamily: 'monospace',
        fontSize: '13px',
        boxSizing: 'border-box',
        whiteSpace: 'pre',
      }}
    >
      {lines.map((line, i) => {
        const hunk = lineHunkMap.get(i);
        const isDisabled = hunk != null && disabledHunkIds.has(hunk.id);
        const firstLineHunk = hunkFirstLines.get(i);
        const showCheckbox = firstLineHunk != null && side === firstLineHunk.checkboxSide && onToggleHunk;

        let bg = DIFF_BG[line.type];
        let color = DIFF_TEXT_COLOR[line.type];
        let borderLeft = DIFF_BORDER_COLOR[line.type]
          ? `3px solid ${DIFF_BORDER_COLOR[line.type]}`
          : '3px solid transparent';
        let textDecoration = 'none';
        let opacity = 1;

        if (isDisabled) {
          // The side with the checkbox shows dimmed/strikethrough (the version being excluded)
          // The other side renders as "same" (the version being kept)
          if (hunk && side === hunk.checkboxSide) {
            bg = 'transparent';
            color = '#6b7280';
            borderLeft = '3px solid transparent';
            textDecoration = 'line-through';
            opacity = 0.5;
          } else {
            bg = 'transparent';
            color = '#e5e7eb';
            borderLeft = '3px solid transparent';
          }
        }

        const hasCheckboxInHunk = hunk != null && side === hunk.checkboxSide;

        return (
          <div
            key={i}
            style={{
              height: `${DIFF_LINE_HEIGHT}px`,
              lineHeight: `${DIFF_LINE_HEIGHT}px`,
              backgroundColor: bg,
              color,
              borderLeft,
              paddingLeft: hasCheckboxInHunk ? '2px' : '6px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'flex',
              alignItems: 'center',
              textDecoration,
              opacity,
            }}
          >
            {showCheckbox && (
              <input
                type="checkbox"
                checked={!isDisabled}
                onChange={() => onToggleHunk(firstLineHunk.id)}
                style={{
                  accentColor: '#3b82f6',
                  marginRight: '4px',
                  flexShrink: 0,
                  cursor: 'pointer',
                }}
              />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {line.text || '\u00A0'}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const StrategyComparison: React.FC = () => {
  const [assignmentMode, setAssignmentMode] = useState<'by-team' | 'round-robin' | 'ab-test'>('by-team');
  const [team0Selection, setTeam0Selection] = useState('0');
  const [team1Selection, setTeam1Selection] = useState('1');
  const [custom0Text, setCustom0Text] = useState('');
  const [custom1Text, setCustom1Text] = useState('');
  const [numHands, setNumHands] = useState(100);

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

  // Diff view state
  const [diffEnabled, setDiffEnabled] = useState(false);
  const diffLeftRef = useRef<HTMLDivElement | null>(null);
  const diffRightRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScroll = useRef(false);

  const handleLeftScroll = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (diffLeftRef.current && diffRightRef.current) {
      diffRightRef.current.scrollTop = diffLeftRef.current.scrollTop;
    }
    isSyncingScroll.current = false;
  };
  const handleRightScroll = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (diffLeftRef.current && diffRightRef.current) {
      diffLeftRef.current.scrollTop = diffRightRef.current.scrollTop;
    }
    isSyncingScroll.current = false;
  };

  // A/B Diff view state
  const [abDiffEnabled, setAbDiffEnabled] = useState(false);
  const [disabledHunkIds, setDisabledHunkIds] = useState<Set<number>>(new Set());
  const abDiffLeftRef = useRef<HTMLDivElement | null>(null);
  const abDiffRightRef = useRef<HTMLDivElement | null>(null);
  const isAbSyncingScroll = useRef(false);

  const handleAbLeftScroll = () => {
    if (isAbSyncingScroll.current) return;
    isAbSyncingScroll.current = true;
    if (abDiffLeftRef.current && abDiffRightRef.current) {
      abDiffRightRef.current.scrollTop = abDiffLeftRef.current.scrollTop;
    }
    isAbSyncingScroll.current = false;
  };
  const handleAbRightScroll = () => {
    if (isAbSyncingScroll.current) return;
    isAbSyncingScroll.current = true;
    if (abDiffLeftRef.current && abDiffRightRef.current) {
      abDiffLeftRef.current.scrollTop = abDiffRightRef.current.scrollTop;
    }
    isAbSyncingScroll.current = false;
  };

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

  const diffResult = useMemo<DiffResult | null>(() => {
    if (!diffEnabled || assignmentMode !== 'by-team') return null;
    const textA = getDisplayText(team0Selection, custom0Text);
    const textB = getDisplayText(team1Selection, custom1Text);
    return computeDiff(textA, textB);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffEnabled, assignmentMode, team0Selection, team1Selection, custom0Text, custom1Text]);

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

  const abDiffResult = useMemo<DiffResult | null>(() => {
    if (!abDiffEnabled || assignmentMode !== 'ab-test') return null;
    return computeDiff(abOriginalSectionText, abSectionText);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abDiffEnabled, assignmentMode, abOriginalSectionText, abSectionText]);

  const abHunks = useMemo<DiffHunk[]>(() => {
    if (!abDiffResult) return [];
    return identifyHunks(abDiffResult);
  }, [abDiffResult]);

  const handleAbDiffToggle = () => {
    setAbDiffEnabled(d => {
      if (!d) setDisabledHunkIds(new Set());
      return !d;
    });
  };

  const toggleHunk = (hunkId: number) => {
    setDisabledHunkIds(prev => {
      const next = new Set(prev);
      if (next.has(hunkId)) next.delete(hunkId);
      else next.add(hunkId);
      return next;
    });
  };

  const handleAbBaseChange = (value: string) => {
    setAbBaseSelection(value);
    // Reset override source to base strategy and load its section
    setAbOverrideSource(value);
    const sections = splitStrategySections(bidWhistStrategies[Number(value)].text);
    setAbSectionText(sections[abSection]);
    setDisabledHunkIds(new Set());
  };

  const handleAbSectionChange = (section: 'play' | 'bid' | 'trump' | 'discard') => {
    setAbSection(section);
    // Load section from current override source (or base if manual)
    const sourceIdx = abOverrideSource === 'manual' ? Number(abBaseSelection) : Number(abOverrideSource);
    const sections = splitStrategySections(bidWhistStrategies[sourceIdx].text);
    setAbSectionText(sections[section]);
    setDisabledHunkIds(new Set());
  };

  const handleAbOverrideSourceChange = (value: string) => {
    setAbOverrideSource(value);
    if (value !== 'manual') {
      const sections = splitStrategySections(bidWhistStrategies[Number(value)].text);
      setAbSectionText(sections[abSection]);
    }
    setDisabledHunkIds(new Set());
  };

  const handleRun = async () => {
    let config: ComparisonConfig;

    const isRedMode = numHands === -1;
    const effectiveNumHands = isRedMode ? RED_TEAM_DECKS.length : numHands;
    const predefinedDeckUrls = isRedMode ? RED_TEAM_DECKS.map(d => d.url) : undefined;

    if (assignmentMode === 'ab-test') {
      const baseEntry = bidWhistStrategies[Number(abBaseSelection)];
      // When diff is on with some hunks disabled, build effective text
      let effectiveSectionText = abSectionText;
      let hunkAnnotation = '';
      if (abDiffEnabled && disabledHunkIds.size > 0 && abDiffResult) {
        effectiveSectionText = buildEffectiveText(abDiffResult, abHunks, disabledHunkIds);
        const enabledCount = abHunks.length - disabledHunkIds.size;
        hunkAnnotation = ` [${enabledCount}/${abHunks.length} hunks]`;
      }
      const modifiedText = replaceStrategySection(baseEntry.text, abSection, effectiveSectionText);
      const sourceEntry = abOverrideSource !== 'manual' ? bidWhistStrategies[Number(abOverrideSource)] : null;
      const modLabel = sourceEntry && sourceEntry.name !== baseEntry.name
        ? `${sourceEntry.name} ${abSection}`
        : `modified ${abSection}`;
      config = {
        strategies: [
          { name: baseEntry.name, strategyText: baseEntry.text },
          { name: `${baseEntry.name} (${modLabel}${hunkAnnotation})`, strategyText: modifiedText },
        ],
        assignmentMode: 'by-team',
        numHands: effectiveNumHands,
        predefinedDeckUrls,
        abTestMeta: {
          section: abSection,
          originalSectionText: abOriginalSectionText,
          modifiedSectionText: effectiveSectionText,
        },
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
        numHands: effectiveNumHands,
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
      config = { strategies, assignmentMode, numHands: effectiveNumHands, predefinedDeckUrls };
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
          <div style={{ marginBottom: '16px' }}>
            {/* Dropdowns row */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
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
                  }}
                >
                  {bidWhistStrategies.map((s, i) => (
                    <option key={i} value={String(i)}>{s.name}</option>
                  ))}
                  <option value={CUSTOM_VALUE}>Custom</option>
                </select>
              </div>
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
                  }}
                >
                  {bidWhistStrategies.map((s, i) => (
                    <option key={i} value={String(i)}>{s.name}</option>
                  ))}
                  <option value={CUSTOM_VALUE}>Custom</option>
                </select>
              </div>
            </div>

            {/* Diff checkbox */}
            <label style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '8px',
              fontSize: '13px',
              cursor: 'pointer',
              color: '#9ca3af',
            }}>
              <input
                type="checkbox"
                checked={diffEnabled}
                onChange={() => setDiffEnabled(d => !d)}
                style={{ accentColor: '#3b82f6' }}
              />
              Diff
            </label>

            {/* Content panes */}
            <div style={{ display: 'flex', gap: '16px' }}>
              {diffEnabled && diffResult ? (
                <>
                  <DiffPane lines={diffResult.left} scrollRef={diffLeftRef} onScroll={handleLeftScroll} />
                  <DiffPane lines={diffResult.right} scrollRef={diffRightRef} onScroll={handleRightScroll} />
                </>
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                </>
              )}
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

            {/* Diff checkbox */}
            <label style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '8px',
              fontSize: '13px',
              cursor: 'pointer',
              color: '#9ca3af',
            }}>
              <input
                type="checkbox"
                checked={abDiffEnabled}
                onChange={handleAbDiffToggle}
                style={{ accentColor: '#3b82f6' }}
              />
              Diff
              {abDiffEnabled && abHunks.length > 0 && (
                <span style={{ color: '#6b7280', fontSize: '12px' }}>
                  ({abHunks.length} hunk{abHunks.length !== 1 ? 's' : ''}{disabledHunkIds.size > 0 ? `, ${disabledHunkIds.size} disabled` : ''})
                </span>
              )}
            </label>

            {/* Content panes */}
            <div style={{ display: 'flex', gap: '16px' }}>
              {abDiffEnabled && abDiffResult ? (
                <>
                  <ABDiffPane
                    lines={abDiffResult.left}
                    scrollRef={abDiffLeftRef}
                    onScroll={handleAbLeftScroll}
                    side="left"
                    hunks={abHunks}
                    disabledHunkIds={disabledHunkIds}
                    onToggleHunk={toggleHunk}
                  />
                  <ABDiffPane
                    lines={abDiffResult.right}
                    scrollRef={abDiffRightRef}
                    onScroll={handleAbRightScroll}
                    side="right"
                    hunks={abHunks}
                    disabledHunkIds={disabledHunkIds}
                    onToggleHunk={toggleHunk}
                  />
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        )}

        {/* Game count */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            Number of Hands (played across full games to 21)
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {HAND_COUNT_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => setNumHands(n)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: numHands === n ? '#3b82f6' : '#374151',
                  color: '#e5e7eb',
                  cursor: 'pointer',
                }}
              >
                {n >= 1000 ? `${n / 1000}K` : n}
              </button>
            ))}
            <button
              onClick={() => setNumHands(-1)}
              style={{
                padding: '6px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: numHands === -1 ? '#ef4444' : '#374151',
                color: '#e5e7eb',
                cursor: 'pointer',
                fontWeight: numHands === -1 ? 'bold' : 'normal',
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
