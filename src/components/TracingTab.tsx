import React, { useState, useEffect, useMemo } from 'react';
import { StrategyComparisonResult } from '../simulation/types.ts';
import { BidWhistSimulator } from '../simulation/BidWhistSimulator.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { RuleTraceEntry, setStrategyDebug } from '../strategy/evaluator.ts';
import { computeDiff, identifyHunks, DiffResult, DiffHunk } from '../utils/diffUtils.ts';
import { StrategyAST } from '../strategy/types.ts';

interface TracingTabProps {
  result: StrategyComparisonResult;
}

interface HunkExample {
  deckUrl: string;
  rotation: number;
  ruleIndex: number;
  conditionText?: string;
  bWon: boolean;
}

interface HunkAttribution {
  hunkId: number;
  hunkPreview: string;
  gamesWonByB: number;
  gamesLostByB: number;
  totalActivations: number;
  exampleGames: HunkExample[];
}

interface TracingAnalysis {
  section: string;
  hunkCount: number;
  gamesAnalyzed: number;
  hunkAttributions: HunkAttribution[];
  unchangedStats: { trials: number; wonByB: number; lostByB: number };
  multiHunkTrials: number;
}

// ── Rule-to-hunk mapping ─────────────────────────────────────────

function buildRuleToHunkMap(
  diff: DiffResult,
  hunks: DiffHunk[],
  section: 'play' | 'bid' | 'trump' | 'discard'
): Map<string, number | null> {
  const lineToHunk = new Map<number, number>();
  for (const hunk of hunks) {
    for (let i = hunk.start; i < hunk.start + hunk.length; i++) {
      lineToHunk.set(i, hunk.id);
    }
  }

  const ruleToHunk = new Map<string, number | null>();
  let currentSubSection = '';
  let ruleIndex = 0;

  for (let i = 0; i < diff.right.length; i++) {
    const line = diff.right[i];
    if (line.type === 'blank' && line.text === '') continue;

    const trimmed = line.text.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // For play section, detect subsection headers
    if (section === 'play') {
      if (/^leading\s*:/.test(trimmed)) {
        currentSubSection = 'leading';
        ruleIndex = 0;
        continue;
      }
      if (/^following\s*:/.test(trimmed)) {
        currentSubSection = 'following';
        ruleIndex = 0;
        continue;
      }
      if (/^void\s*:/.test(trimmed)) {
        currentSubSection = 'void';
        ruleIndex = 0;
        continue;
      }
    }

    // Detect 'when' keywords
    if (trimmed.startsWith('when ')) {
      const key = section === 'play'
        ? `play:${currentSubSection}:${ruleIndex}`
        : `${section}::${ruleIndex}`;
      const hunkId = lineToHunk.has(i) ? lineToHunk.get(i)! : null;
      ruleToHunk.set(key, hunkId);
      ruleIndex++;
    }

    // Detect 'default:' keyword
    if (/^default\s*:/.test(trimmed)) {
      const key = section === 'play'
        ? `play:${currentSubSection}:-1`
        : `${section}::-1`;
      const hunkId = lineToHunk.has(i) ? lineToHunk.get(i)! : null;
      ruleToHunk.set(key, hunkId);
    }
  }

  return ruleToHunk;
}

function getHunkPreview(diff: DiffResult, hunk: DiffHunk): string {
  // Show the first meaningful changed line from the right side
  for (let i = hunk.start; i < hunk.start + hunk.length; i++) {
    const r = diff.right[i];
    if (r.type !== 'blank' && r.text.trim() !== '' && !r.text.trim().startsWith('#')) {
      const text = r.text.trim();
      return text.length > 60 ? text.slice(0, 57) + '...' : text;
    }
  }
  // Fallback to left side
  for (let i = hunk.start; i < hunk.start + hunk.length; i++) {
    const l = diff.left[i];
    if (l.type !== 'blank' && l.text.trim() !== '' && !l.text.trim().startsWith('#')) {
      const text = l.text.trim();
      return text.length > 60 ? text.slice(0, 57) + '...' : text;
    }
  }
  return '(empty hunk)';
}

function traceKey(entry: RuleTraceEntry): string {
  if (entry.phase === 'play') {
    return `play:${entry.subSection || ''}:${entry.ruleIndex}`;
  }
  return `${entry.phase}::${entry.ruleIndex}`;
}

// ── Styles ───────────────────────────────────────────────────────

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
  fontFamily: 'monospace',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #4b5563',
  color: '#9ca3af',
  fontWeight: 'bold',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid #374151',
  color: '#e5e7eb',
};

const netStyle = (net: number): React.CSSProperties => ({
  ...tdStyle,
  color: net > 0 ? '#68d391' : net < 0 ? '#f56565' : '#9ca3af',
  fontWeight: 'bold',
});

// ── Component ────────────────────────────────────────────────────

const TracingTab: React.FC<TracingTabProps> = ({ result }) => {
  const [analysis, setAnalysis] = useState<TracingAnalysis | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set());

  const { config, interestingGames } = result;
  const abMeta = config.abTestMeta!;

  // Phase 1: Compute diff and hunks
  const { diff, hunks } = useMemo(() => {
    const d = computeDiff(abMeta.originalSectionText, abMeta.modifiedSectionText);
    const h = identifyHunks(d);
    return { diff: d, hunks: h };
  }, [abMeta.originalSectionText, abMeta.modifiedSectionText]);

  // Phase 2: Build rule-to-hunk mapping
  const ruleToHunk = useMemo(() => {
    return buildRuleToHunkMap(diff, hunks, abMeta.section);
  }, [diff, hunks, abMeta.section]);

  // Hunk previews
  const hunkPreviews = useMemo(() => {
    return hunks.map(h => getHunkPreview(diff, h));
  }, [diff, hunks]);

  // Phase 3 & 4: Re-simulate and aggregate (async with progress)
  useEffect(() => {
    let cancelled = false;

    const runAnalysis = async () => {
      // Parse strategies
      let parsedA: StrategyAST | null = null;
      let parsedB: StrategyAST | null = null;
      try { parsedA = parseStrategy(config.strategies[0].strategyText); } catch { /* */ }
      try { parsedB = parseStrategy(config.strategies[1].strategyText); } catch { /* */ }

      if (!parsedA || !parsedB) {
        setAnalysis({
          section: abMeta.section,
          hunkCount: hunks.length,
          gamesAnalyzed: 0,
          hunkAttributions: [],
          unchangedStats: { trials: 0, wonByB: 0, lostByB: 0 },
          multiHunkTrials: 0,
        });
        return;
      }

      // configA: team0=A(base), team1=B(modified) → B is players 1,3
      const configAStrategies: (StrategyAST | null)[] = [parsedA, parsedB, parsedA, parsedB];
      // configB: team0=B(modified), team1=A(base) → B is players 0,2
      const configBStrategies: (StrategyAST | null)[] = [parsedB, parsedA, parsedB, parsedA];

      const simulator = new BidWhistSimulator();
      const gamesToAnalyze = interestingGames.slice(0, 200);
      const total = gamesToAnalyze.length;
      setProgress({ current: 0, total });

      // Per-hunk accumulators
      const hunkWon = new Map<number, number>();
      const hunkLost = new Map<number, number>();
      const hunkActivations = new Map<number, number>();
      const hunkExamples = new Map<number, HunkExample[]>();
      for (const h of hunks) {
        hunkWon.set(h.id, 0);
        hunkLost.set(h.id, 0);
        hunkActivations.set(h.id, 0);
        hunkExamples.set(h.id, []);
      }

      let unchangedTrials = 0;
      let unchangedWon = 0;
      let unchangedLost = 0;
      let multiHunkTrials = 0;

      // Suppress debug logging during mass re-simulation
      setStrategyDebug(false);

      const processTraces = (
        traces: RuleTraceEntry[],
        bPlayerIds: number[],
        bWon: boolean,
        game: typeof gamesToAnalyze[0],
      ) => {
        const bTraces = traces.filter(t =>
          t.phase === abMeta.section && bPlayerIds.includes(t.playerId)
        );

        const activated = new Set<number>();
        for (const trace of bTraces) {
          if (trace.ruleIndex === -2) continue; // no match at all
          const key = traceKey(trace);
          const hunkId = ruleToHunk.get(key);
          if (hunkId !== undefined && hunkId !== null) {
            activated.add(hunkId);
            hunkActivations.set(hunkId, (hunkActivations.get(hunkId) || 0) + 1);
            const examples = hunkExamples.get(hunkId)!;
            if (examples.length < 3) {
              examples.push({
                deckUrl: game.deckUrl,
                rotation: game.rotation,
                ruleIndex: trace.ruleIndex,
                conditionText: trace.conditionText,
                bWon,
              });
            }
          }
        }

        if (activated.size === 0) {
          unchangedTrials++;
          if (bWon) unchangedWon++;
          else unchangedLost++;
        } else {
          if (activated.size > 1) multiHunkTrials++;
          for (const hId of activated) {
            if (bWon) hunkWon.set(hId, (hunkWon.get(hId) || 0) + 1);
            else hunkLost.set(hId, (hunkLost.get(hId) || 0) + 1);
          }
        }
      };

      const BATCH_SIZE = 10;
      for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
        if (cancelled) break;
        const batchEnd = Math.min(batchStart + BATCH_SIZE, total);

        for (let gi = batchStart; gi < batchEnd; gi++) {
          const game = gamesToAnalyze[gi];

          const bWonInA = game.configAResult.winningTeam === 1;
          const bWonInB = game.configBResult.winningTeam === 0;

          const rotatedUrl = BidWhistSimulator.rotateDeck(game.deckUrl, game.rotation);

          // Re-simulate configB (B = team0, players 0,2)
          const { traces: tracesB } = simulator.simulateGameWithTracing(
            rotatedUrl, configBStrategies,
            game.configBResult.handDeckUrls, 1, game.rotation
          );
          processTraces(tracesB, [0, 2], bWonInB, game);

          // Re-simulate configA (B = team1, players 1,3)
          const { traces: tracesA } = simulator.simulateGameWithTracing(
            rotatedUrl, configAStrategies,
            game.configAResult.handDeckUrls, 0, game.rotation
          );
          processTraces(tracesA, [1, 3], bWonInA, game);
        }

        setProgress({ current: batchEnd, total });
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      setStrategyDebug(true);
      if (cancelled) return;

      const hunkAttributions: HunkAttribution[] = hunks.map((h, idx) => ({
        hunkId: h.id,
        hunkPreview: hunkPreviews[idx] || '?',
        gamesWonByB: hunkWon.get(h.id) || 0,
        gamesLostByB: hunkLost.get(h.id) || 0,
        totalActivations: hunkActivations.get(h.id) || 0,
        exampleGames: hunkExamples.get(h.id) || [],
      }));

      setAnalysis({
        section: abMeta.section,
        hunkCount: hunks.length,
        gamesAnalyzed: total,
        hunkAttributions,
        unchangedStats: { trials: unchangedTrials, wonByB: unchangedWon, lostByB: unchangedLost },
        multiHunkTrials,
      });
    };

    runAnalysis();
    return () => { cancelled = true; setStrategyDebug(true); };
  }, [interestingGames, config, ruleToHunk, hunks, abMeta, hunkPreviews]);

  const toggleExpand = (hunkId: number) => {
    setExpandedHunks(prev => {
      const next = new Set(prev);
      if (next.has(hunkId)) next.delete(hunkId);
      else next.add(hunkId);
      return next;
    });
  };

  const openReplay = (deckUrl: string, rotation: number) => {
    const rotatedUrl = BidWhistSimulator.rotateDeck(deckUrl, rotation);
    const t0 = config.strategies[0];
    const t1 = config.strategies[1];
    sessionStorage.setItem('replay-config', JSON.stringify({
      deckUrl: rotatedUrl,
      dealer: rotation,
      team0StrategyText: t0?.strategyText ?? '',
      team0StrategyName: t0?.name ?? 'Strategy A',
      team1StrategyText: t1?.strategyText ?? '',
      team1StrategyName: t1?.name ?? 'Strategy B',
    }));
    window.open(`/replay#${rotatedUrl}`, '_blank');
  };

  // ── Render ─────────────────────────────────────────────────────

  if (!analysis && progress.total > 0) {
    const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    return (
      <div style={{ padding: '16px', color: '#9ca3af' }}>
        <div style={{ marginBottom: '8px' }}>
          Analyzing {progress.current}/{progress.total} interesting games...
        </div>
        <div style={{
          width: '300px', height: '6px', backgroundColor: '#374151',
          borderRadius: '3px', overflow: 'hidden',
        }}>
          <div style={{
            width: `${pct}%`, height: '100%', backgroundColor: '#3b82f6',
            transition: 'width 0.2s',
          }} />
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div style={{ padding: '16px', color: '#9ca3af' }}>
        Preparing trace analysis...
      </div>
    );
  }

  if (analysis.gamesAnalyzed === 0) {
    return (
      <div style={{ padding: '16px', color: '#9ca3af' }}>
        No interesting games to analyze. Run more games or adjust your strategy changes.
      </div>
    );
  }

  const totalTrials = analysis.gamesAnalyzed * 2;

  return (
    <div style={{ padding: '0' }}>
      <div style={{ marginBottom: '16px', color: '#9ca3af', fontSize: '13px' }}>
        Tracing: <strong style={{ color: '#e5e7eb' }}>{analysis.section}</strong> section
        {' \u2014 '}{analysis.hunkCount} hunk{analysis.hunkCount !== 1 ? 's' : ''},
        {' '}{analysis.gamesAnalyzed} interesting games analyzed ({totalTrials} trials)
      </div>

      {/* Hunk summary table */}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Hunk</th>
            <th style={{ ...thStyle, minWidth: '200px' }}>Preview</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Trials</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>B Won</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>B Lost</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Net</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Win%</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Firings</th>
          </tr>
        </thead>
        <tbody>
          {analysis.hunkAttributions.map(ha => {
            const trials = ha.gamesWonByB + ha.gamesLostByB;
            const net = ha.gamesWonByB - ha.gamesLostByB;
            const winPct = trials > 0 ? ((ha.gamesWonByB / trials) * 100).toFixed(0) + '%' : '\u2014';
            return (
              <tr key={ha.hunkId} style={{ cursor: ha.exampleGames.length > 0 ? 'pointer' : 'default' }}
                  onClick={() => ha.exampleGames.length > 0 && toggleExpand(ha.hunkId)}>
                <td style={tdStyle}>
                  <span style={{ color: '#60a5fa' }}>#{ha.hunkId + 1}</span>
                  {ha.exampleGames.length > 0 && (
                    <span style={{ marginLeft: '6px', fontSize: '10px', color: '#6b7280' }}>
                      {expandedHunks.has(ha.hunkId) ? '\u25BC' : '\u25B6'}
                    </span>
                  )}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px', color: '#d1d5db', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ha.hunkPreview}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{trials}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#68d391' }}>{ha.gamesWonByB}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#f56565' }}>{ha.gamesLostByB}</td>
                <td style={{ ...netStyle(net), textAlign: 'right' }}>
                  {net > 0 ? '+' : ''}{net}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', color: trials > 0 ? (ha.gamesWonByB / trials > 0.5 ? '#68d391' : ha.gamesWonByB / trials < 0.5 ? '#f56565' : '#9ca3af') : '#9ca3af' }}>
                  {winPct}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#6b7280' }}>{ha.totalActivations}</td>
              </tr>
            );
          })}

          {/* Unchanged rules row */}
          {analysis.unchangedStats.trials > 0 && (() => {
            const u = analysis.unchangedStats;
            const net = u.wonByB - u.lostByB;
            const winPct = u.trials > 0 ? ((u.wonByB / u.trials) * 100).toFixed(0) + '%' : '\u2014';
            return (
              <tr style={{ borderTop: '2px solid #4b5563' }}>
                <td style={{ ...tdStyle, color: '#6b7280', fontStyle: 'italic' }}>(none)</td>
                <td style={{ ...tdStyle, color: '#6b7280', fontStyle: 'italic' }}>unchanged rules only</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{u.trials}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#68d391' }}>{u.wonByB}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#f56565' }}>{u.lostByB}</td>
                <td style={{ ...netStyle(net), textAlign: 'right' }}>
                  {net > 0 ? '+' : ''}{net}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', color: u.trials > 0 ? (u.wonByB / u.trials > 0.5 ? '#68d391' : u.wonByB / u.trials < 0.5 ? '#f56565' : '#9ca3af') : '#9ca3af' }}>
                  {winPct}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#6b7280' }}>{'\u2014'}</td>
              </tr>
            );
          })()}
        </tbody>
      </table>

      {analysis.multiHunkTrials > 0 && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
          Note: {analysis.multiHunkTrials} trial{analysis.multiHunkTrials !== 1 ? 's' : ''} had multiple hunks activated simultaneously.
        </div>
      )}

      {/* Expandable per-hunk detail */}
      {analysis.hunkAttributions.map(ha => (
        expandedHunks.has(ha.hunkId) && ha.exampleGames.length > 0 && (
          <div key={`detail-${ha.hunkId}`} style={{
            marginTop: '12px', padding: '12px',
            backgroundColor: '#1e293b', borderRadius: '6px',
            border: '1px solid #334155',
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#60a5fa', fontSize: '13px' }}>
              Hunk #{ha.hunkId + 1} — Example Games
            </div>
            {ha.exampleGames.map((ex, i) => (
              <div key={i} style={{
                padding: '6px 8px', marginBottom: '4px',
                backgroundColor: '#0f172a', borderRadius: '4px',
                fontSize: '12px', fontFamily: 'monospace',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}>
                <span
                  style={{ color: '#60a5fa', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={(e) => { e.stopPropagation(); openReplay(ex.deckUrl, ex.rotation); }}
                  title="Open in replay viewer"
                >
                  {ex.deckUrl.slice(0, 8)}...R{ex.rotation}
                </span>
                <span style={{ color: '#9ca3af' }}>
                  Rule {ex.ruleIndex === -1 ? 'default' : `#${ex.ruleIndex}`}
                  {ex.conditionText && (
                    <span style={{ color: '#d1d5db' }}>: {ex.conditionText}</span>
                  )}
                </span>
                <span style={{
                  marginLeft: 'auto',
                  color: ex.bWon ? '#68d391' : '#f56565',
                  fontWeight: 'bold',
                }}>
                  B {ex.bWon ? 'Won' : 'Lost'}
                </span>
              </div>
            ))}
          </div>
        )
      ))}
    </div>
  );
};

export default TracingTab;
