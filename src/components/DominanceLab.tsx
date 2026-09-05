import React, { useState, useMemo, useRef, useCallback } from 'react';
import { STRATEGY_REGISTRY, BIDWHIST_CURRENT_BEST } from '../strategies/index.ts';
import { Card } from '../types/CardGame.ts';
import { letterToCard, generateRandomDeckUrl } from '../urlGameState.js';
import {
  analyzeBoardSpec,
  buildSpecFromSeatHand,
  seatLetters,
  kittyLetters,
  runDominanceCheck,
  deviatingSeatsFor,
  DominanceConfig,
  DominanceReport,
  ChallengerReport,
  TrialOutcome,
  DeviationScope,
  HandOutcome,
  SEAT_LABELS,
  WILDCARD,
  DECK_LENGTH,
} from '../simulation/dominance.ts';
import {
  runDominanceSearch,
  confirmFinalist,
  DominanceSearchOptions,
  DominanceSearchReport,
  FinalistReport,
  GenerationSnapshot,
} from '../simulation/dominanceSearch.ts';
import { SIGNAL_LAB_PRESETS } from '../simulation/signalLab.ts';

const bidWhistStrategies = STRATEGY_REGISTRY.filter(s => s.game === 'bidwhist');
const CUSTOM_VALUE = 'custom';
const EMPTY_SPEC = WILDCARD.repeat(DECK_LENGTH);

const SEAT_SHORT = ['S', 'E', 'N', 'W'];

const SUIT_SYMBOLS: { [key: string]: string } = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
};
const SUIT_COLORS: { [key: string]: string } = {
  spades: '#a0aec0', hearts: '#f56565', diamonds: '#f6ad55', clubs: '#68d391',
};
const SUIT_ORDER = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANK_LABELS: { [r: number]: string } = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};

// ── Shared styles ────────────────────────────────────────────────────

const panel: React.CSSProperties = {
  backgroundColor: '#162b1e',
  padding: '16px',
  borderRadius: '8px',
  marginBottom: '16px',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#6ee7b7',
  marginBottom: '10px',
};

const inputBase: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '4px',
  border: '1px solid #4b5563',
  backgroundColor: '#374151',
  color: '#e5e7eb',
  fontFamily: 'monospace',
  fontSize: '13px',
  boxSizing: 'border-box',
};

const textareaBase: React.CSSProperties = {
  ...inputBase,
  width: '100%',
  resize: 'vertical',
};

const btn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '4px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 600,
  color: '#e5e7eb',
  backgroundColor: '#374151',
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderBottom: '2px solid #4b5563',
  color: '#93c5fd',
  fontWeight: 600,
  fontSize: '12px',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid #263c2d',
  fontSize: '13px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  color: '#9ca3af',
  marginBottom: '4px',
};

// ── Card rendering ───────────────────────────────────────────────────

/** Split a run of card letters into suit groups, with unknowns counted. */
function groupLetters(letters: string): { suit: string; ranks: number[] }[] {
  const groups: { [suit: string]: number[] } = {};
  for (const suit of SUIT_ORDER) groups[suit] = [];
  let unknown = 0;
  for (const ch of letters) {
    if (ch === WILDCARD) { unknown++; continue; }
    const card: Card = letterToCard(ch);
    groups[card.suit].push(card.rank as number);
  }
  const out = SUIT_ORDER
    .filter(s => groups[s].length > 0)
    .map(suit => ({ suit, ranks: groups[suit].sort((a, b) => b - a) }));
  if (unknown > 0) out.push({ suit: 'unknown', ranks: new Array(unknown).fill(0) });
  return out;
}

const SeatCards: React.FC<{ letters: string }> = ({ letters }) => {
  const groups = groupLetters(letters);
  if (groups.length === 0) return <span style={{ color: '#4b5563' }}>—</span>;
  return (
    <>
      {groups.map(({ suit, ranks }) => (
        <div key={suit} style={{ lineHeight: 1.7, whiteSpace: 'nowrap' }}>
          {suit === 'unknown' ? (
            <span style={{ color: '#4b5563' }}>? &times; {ranks.length}</span>
          ) : (
            <>
              <span style={{ color: SUIT_COLORS[suit], fontWeight: 'bold', marginRight: 6 }}>
                {SUIT_SYMBOLS[suit]}
              </span>
              {ranks.map((r, i) => (
                <span key={i} style={{ marginRight: 5 }}>{RANK_LABELS[r]}</span>
              ))}
            </>
          )}
        </div>
      ))}
    </>
  );
};

// ── Small presentational helpers ─────────────────────────────────────

/**
 * Diverging bar centred on zero. Deltas are signed points-per-hand, so a
 * left/right split reads the sign faster than a number alone.
 */
const DeltaBar: React.FC<{ value: number; max: number }> = ({ value, max }) => {
  const scale = max > 0 ? Math.min(1, Math.abs(value) / max) : 0;
  const pct = scale * 50;
  return (
    <div style={{ position: 'relative', height: 12, width: 120, backgroundColor: '#0f1f15', borderRadius: 2 }}>
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: '#4b5563' }} />
      <div
        style={{
          position: 'absolute',
          top: 2,
          bottom: 2,
          left: value >= 0 ? '50%' : `${50 - pct}%`,
          width: `${pct}%`,
          backgroundColor: value > 0 ? '#f87171' : '#4ade80',
          borderRadius: 2,
        }}
      />
    </div>
  );
};

function describeOutcome(o: HandOutcome, team: number): string {
  if (o.passedOut) return 'passed out';
  const declarerTeam = o.declarer % 2;
  const books = o.booksWon[team] + (declarerTeam === team ? 1 : 0);
  const dir = o.direction === 'uptown' ? 'up' : o.direction === 'downtown' ? 'dn' : 'dn-nA';
  const suit = SUIT_SYMBOLS[o.trumpSuit] ?? '?';
  const who = SEAT_SHORT[o.declarer];
  const whist = o.whistTeam >= 0 ? ' WHIST' : '';
  return `${who} ${o.bidAmount}${suit}${dir} · ${books} books${whist}`;
}

// ── Component ────────────────────────────────────────────────────────

export default function DominanceLab() {
  // Board
  const [spec, setSpec] = useState(EMPTY_SPEC);
  const [handInput, setHandInput] = useState('');

  // Deviation
  const [seat, setSeat] = useState(0);
  const [scope, setScope] = useState<DeviationScope>('seat');
  const [dealers, setDealers] = useState<boolean[]>([true, true, true, true]);
  const [fills, setFills] = useState(200);
  const [seed, setSeed] = useState(12345);

  // Champion
  const championDefaultIdx = Math.max(0, bidWhistStrategies.findIndex(s => s.name === BIDWHIST_CURRENT_BEST.name));
  const [championSel, setChampionSel] = useState(String(championDefaultIdx));
  const [championCustom, setChampionCustom] = useState('');

  // Challengers
  const [challengerSel, setChallengerSel] = useState<Set<number>>(
    () => new Set(bidWhistStrategies.map((_, i) => i).filter(i => i !== championDefaultIdx)),
  );
  const [customChecked, setCustomChecked] = useState(false);
  const [customText, setCustomText] = useState('');

  // Run state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [report, setReport] = useState<DominanceReport | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const abortRef = useRef(false);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [generations, setGenerations] = useState(12);
  const [population, setPopulation] = useState(16);
  const [searching, setSearching] = useState(false);
  const [genLog, setGenLog] = useState<GenerationSnapshot[]>([]);
  const [searchReport, setSearchReport] = useState<DominanceSearchReport | null>(null);
  const [confirmations, setConfirmations] = useState<Record<string, ChallengerReport | null>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const searchAbortRef = useRef(false);

  const specInfo = useMemo(() => analyzeBoardSpec(spec), [spec]);
  const activeDealers = useMemo(
    () => dealers.map((on, i) => (on ? i : -1)).filter(i => i >= 0),
    [dealers],
  );
  const deviatingSeats = useMemo(() => deviatingSeatsFor(seat, scope), [seat, scope]);

  const champion = useMemo(() => {
    if (championSel === CUSTOM_VALUE) return { name: 'Custom champion', strategyText: championCustom };
    const entry = bidWhistStrategies[Number(championSel)];
    return { name: entry.name, strategyText: entry.text };
  }, [championSel, championCustom]);

  const challengers = useMemo(() => {
    const out = Array.from(challengerSel)
      .sort((a, b) => a - b)
      .map(i => ({ name: bidWhistStrategies[i].name, strategyText: bidWhistStrategies[i].text }));
    if (customChecked && customText.trim()) out.push({ name: 'Custom', strategyText: customText });
    return out;
  }, [challengerSel, customChecked, customText]);

  const trialCount = (specInfo.exact ? 1 : Math.max(1, fills)) * Math.max(1, activeDealers.length);

  const buildConfig = useCallback((): DominanceConfig => ({
    boardSpec: spec,
    champion,
    challengers,
    deviation: scope,
    seat,
    dealers: activeDealers.length > 0 ? activeDealers : [0],
    fills,
    seed,
  }), [spec, champion, challengers, scope, seat, activeDealers, fills, seed]);

  // ── Board actions ──────────────────────────────────────────────

  const applyHandInput = () => {
    const letters = handInput.replace(/[^a-zA-Z]/g, '');
    try {
      setSpec(buildSpecFromSeatHand(letters, seat));
    } catch (e) {
      // Over 12 cards: keep the old spec, the status line reports it.
      setSpec(EMPTY_SPEC);
    }
  };

  const randomiseSeatHand = () => {
    const deck = generateRandomDeckUrl();
    const letters = seatLetters(deck, seat);
    setHandInput(letters);
    setSpec(buildSpecFromSeatHand(letters, seat));
  };

  // ── Run ────────────────────────────────────────────────────────

  const handleRun = async () => {
    abortRef.current = false;
    setRunning(true);
    setReport(null);
    setExpanded(null);
    setProgress({ completed: 0, total: trialCount });
    // The engine reports every trial; re-rendering the page that often
    // costs more than the simulation itself, so the bar updates at ~10Hz.
    let lastPaint = 0;
    try {
      const result = await runDominanceCheck(
        buildConfig(),
        (completed, total) => {
          const now = Date.now();
          if (completed === total || now - lastPaint > 100) {
            lastPaint = now;
            setProgress({ completed, total });
          }
        },
        () => abortRef.current,
      );
      setReport(result);
    } catch (err) {
      console.error('Dominance check failed:', err);
    } finally {
      setRunning(false);
    }
  };

  const searchOptions = useCallback((): DominanceSearchOptions => ({
    boardSpec: spec,
    champion,
    seat,
    deviation: scope,
    dealers: activeDealers.length > 0 ? activeDealers : [0],
    trainFills: Math.max(1, Math.round(fills / 2)),
    holdoutFills: Math.max(1, Math.round(fills / 2)),
    populationSize: population,
    eliteSize: Math.max(2, Math.round(population / 3)),
    generations,
    mutationRate: 0.25,
    finalistCount: 6,
    seed,
    seedConfigs: SIGNAL_LAB_PRESETS,
  }), [spec, champion, seat, scope, activeDealers, fills, population, generations, seed]);

  const handleSearch = async () => {
    searchAbortRef.current = false;
    setSearching(true);
    setSearchReport(null);
    setConfirmations({});
    setGenLog([]);
    try {
      const result = await runDominanceSearch(
        searchOptions(),
        snap => setGenLog(prev => [...prev, snap]),
        () => searchAbortRef.current,
      );
      setSearchReport(result);
    } catch (err) {
      console.error('Dominance search failed:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleConfirm = async (finalist: FinalistReport) => {
    setConfirming(finalist.name);
    try {
      // Fresh seed and double the fills: an independent re-test of a hit
      // that survived a selection stage, so the number stands on its own.
      const result = await confirmFinalist(searchOptions(), finalist, fills * 2, (seed ^ 0x9e3779b9) >>> 0);
      setConfirmations(prev => ({ ...prev, [finalist.name]: result }));
    } finally {
      setConfirming(null);
    }
  };

  // ── Derived display ────────────────────────────────────────────

  const maxAbsDelta = useMemo(() => {
    if (!report) return 1;
    return Math.max(1, ...report.challengers.map(c => Math.abs(c.meanDelta)));
  }, [report]);

  const parityBroken = report?.parity != null && (report.parity.wins > 0 || report.parity.losses > 0);

  const verdictStyle: Record<string, { bg: string; fg: string; label: string; blurb: string }> = {
    dominant: {
      bg: 'rgba(34, 197, 94, 0.15)', fg: '#4ade80', label: 'DOMINANT',
      blurb: `No challenger profited by deviating from ${champion.name} on this board.`,
    },
    contested: {
      bg: 'rgba(234, 179, 8, 0.15)', fg: '#fbbf24', label: 'CONTESTED',
      blurb: 'No significant refutation, but a challenger beat the champion on individual deals. Raise the fill count or open the row to see which.',
    },
    refuted: {
      bg: 'rgba(239, 68, 68, 0.15)', fg: '#f87171', label: 'REFUTED',
      blurb: `A challenger profits by deviating. ${champion.name} is not a best response on this board.`,
    },
    error: {
      bg: 'rgba(239, 68, 68, 0.15)', fg: '#f87171', label: 'ERROR',
      blurb: report?.championParseError ?? 'The run could not start.',
    },
  };

  const canRun = specInfo.valid && challengers.length > 0 && !running;

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div style={{ height: '100%', overflowY: 'auto', backgroundColor: '#0f1f15', padding: '24px 16px', color: '#e5e7eb' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Dominance Lab</h1>
        <p style={{ color: '#9ca3af', marginBottom: 20, fontSize: 13, maxWidth: 760, lineHeight: 1.6 }}>
          Pin a hand or a full board, then ask whether any other strategy would rather be played from
          your seat. The champion sits in all four seats as the baseline; each challenger swaps into the
          deviating seat only, everyone else still playing champion. A challenger that scores more than the
          baseline is a refutation — the champion is not a best response here.
        </p>

        {/* ── Board ─────────────────────────────────────────────── */}
        <div style={panel}>
          <div style={sectionTitle}>1 · Board</div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ flex: '1 1 260px', minWidth: 220 }}>
              <label style={labelStyle}>{SEAT_LABELS[seat]}&rsquo;s hand (card letters, up to 12)</label>
              <input
                value={handInput}
                onChange={e => setHandInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyHandInput(); }}
                placeholder="e.g. abcdefgnopqr"
                style={{ ...inputBase, width: '100%' }}
              />
            </div>
            <button onClick={applyHandInput} style={{ ...btn, backgroundColor: '#3b82f6' }}>
              Pin hand
            </button>
            <button onClick={randomiseSeatHand} style={btn}>Random hand</button>
            <button onClick={() => { const d = generateRandomDeckUrl(); setSpec(d); setHandInput(seatLetters(d, seat)); }} style={btn}>
              Random full board
            </button>
            <button onClick={() => { setSpec(EMPTY_SPEC); setHandInput(''); }} style={btn}>Clear</button>
          </div>

          <label style={labelStyle}>Board spec — 52 characters, &lsquo;_&rsquo; for unknown</label>
          <input
            value={spec}
            onChange={e => setSpec(e.target.value)}
            spellCheck={false}
            style={{
              ...inputBase,
              width: '100%',
              letterSpacing: '1px',
              borderColor: specInfo.valid ? '#4b5563' : '#f87171',
            }}
          />

          <div style={{ marginTop: 8, fontSize: 12, color: specInfo.valid ? '#9ca3af' : '#f87171' }}>
            {!specInfo.valid ? specInfo.error : specInfo.exact ? (
              <>Board is fully specified — every hand is deterministic, so the {activeDealers.length} dealer
                {activeDealers.length === 1 ? '' : 's'} below are the complete answer, not a sample.</>
            ) : (
              <>{specInfo.wildcards} unknown cards — filled by seeded Monte Carlo.
                {' '}{trialCount.toLocaleString()} trials per challenger
                {' '}({fills} fills &times; {activeDealers.length} dealer{activeDealers.length === 1 ? '' : 's'}).</>
            )}
          </div>

          {/* Seat preview */}
          {specInfo.valid && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
              {[0, 1, 2, 3].map(p => {
                const isDeviator = deviatingSeats.includes(p);
                return (
                  <div
                    key={p}
                    style={{
                      backgroundColor: '#0f1f15',
                      borderRadius: 6,
                      padding: 10,
                      border: isDeviator ? '1px solid #fbbf24' : '1px solid #263c2d',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: isDeviator ? '#fbbf24' : p % 2 === 0 ? '#93c5fd' : '#fca5a5' }}>
                      {SEAT_LABELS[p]}{isDeviator ? ' · deviates' : ''}
                    </div>
                    <SeatCards letters={seatLetters(spec, p)} />
                  </div>
                );
              })}
              <div style={{ backgroundColor: '#0f1f15', borderRadius: 6, padding: 10, border: '1px solid #263c2d' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#9ca3af' }}>Kitty</div>
                <SeatCards letters={kittyLetters(spec)} />
              </div>
            </div>
          )}
        </div>

        {/* ── Deviation ─────────────────────────────────────────── */}
        <div style={panel}>
          <div style={sectionTitle}>2 · Deviation</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <label style={labelStyle}>Deviating seat</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {SEAT_LABELS.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => setSeat(i)}
                    style={{ ...btn, backgroundColor: seat === i ? '#3b82f6' : '#374151', minWidth: 58 }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={labelStyle}>Scope</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setScope('seat')}
                  style={{ ...btn, backgroundColor: scope === 'seat' ? '#3b82f6' : '#374151' }}
                  title="Strictest best-response test: only this seat swaps, the partner keeps playing champion."
                >
                  Seat only
                </button>
                <button
                  onClick={() => setScope('team')}
                  style={{ ...btn, backgroundColor: scope === 'team' ? '#3b82f6' : '#374151' }}
                  title="Both seats of the deviating team swap to the challenger."
                >
                  Whole team
                </button>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Dealer positions</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {SEAT_LABELS.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => setDealers(d => d.map((v, j) => (j === i ? !v : v)))}
                    style={{ ...btn, backgroundColor: dealers[i] ? '#065f46' : '#374151', minWidth: 44 }}
                    title={`Deal with ${name} as dealer`}
                  >
                    {SEAT_SHORT[i]}
                  </button>
                ))}
              </div>
            </div>

            {!specInfo.exact && (
              <div>
                <label style={labelStyle}>Fills: {fills}</label>
                <input
                  type="range" min={10} max={2000} step={10}
                  value={fills}
                  onChange={e => setFills(Number(e.target.value))}
                  style={{ width: 180 }}
                />
              </div>
            )}

            <div>
              <label style={labelStyle}>Seed</label>
              <input
                type="number"
                value={seed}
                onChange={e => setSeed(Number(e.target.value))}
                style={{ ...inputBase, width: 110 }}
              />
            </div>
          </div>
        </div>

        {/* ── Champion ──────────────────────────────────────────── */}
        <div style={panel}>
          <div style={sectionTitle}>3 · Champion — the strategy asserted dominant</div>
          <select
            value={championSel}
            onChange={e => setChampionSel(e.target.value)}
            style={{ ...inputBase, fontFamily: 'inherit', minWidth: 260 }}
          >
            {bidWhistStrategies.map((s, i) => (
              <option key={i} value={String(i)}>{s.name}</option>
            ))}
            <option value={CUSTOM_VALUE}>Custom…</option>
          </select>
          {championSel === CUSTOM_VALUE && (
            <textarea
              value={championCustom}
              onChange={e => setChampionCustom(e.target.value)}
              rows={10}
              placeholder="Paste .cstrat strategy here…"
              style={{ ...textareaBase, marginTop: 8 }}
            />
          )}
        </div>

        {/* ── Challengers ───────────────────────────────────────── */}
        <div style={panel}>
          <div style={sectionTitle}>4 · Challengers — {challengers.length} selected</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onClick={() => setChallengerSel(new Set(bidWhistStrategies.map((_, i) => i)))} style={btn}>
              Select all
            </button>
            <button onClick={() => setChallengerSel(new Set())} style={btn}>Clear</button>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '2px 12px',
            backgroundColor: '#0f1f15',
            borderRadius: 6,
            padding: 10,
            maxHeight: 220,
            overflowY: 'auto',
          }}>
            {bidWhistStrategies.map((s, i) => (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', padding: '2px 0' }}>
                <input
                  type="checkbox"
                  checked={challengerSel.has(i)}
                  onChange={() => setChallengerSel(prev => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i); else next.add(i);
                    return next;
                  })}
                  style={{ accentColor: '#3b82f6' }}
                />
                <span style={{ color: s.name === champion.name ? '#6ee7b7' : '#e5e7eb' }}>
                  {s.name}{s.name === champion.name ? ' (champion — parity check)' : ''}
                </span>
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', padding: '2px 0' }}>
              <input
                type="checkbox"
                checked={customChecked}
                onChange={() => setCustomChecked(c => !c)}
                style={{ accentColor: '#3b82f6' }}
              />
              Custom
            </label>
          </div>
          {customChecked && (
            <textarea
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              rows={8}
              placeholder="Paste a challenger .cstrat strategy here…"
              style={{ ...textareaBase, marginTop: 8 }}
            />
          )}
        </div>

        {/* ── Run ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <button
            onClick={handleRun}
            disabled={!canRun}
            style={{
              ...btn,
              padding: '10px 24px',
              fontSize: 14,
              backgroundColor: canRun ? '#10b981' : '#374151',
              cursor: canRun ? 'pointer' : 'not-allowed',
            }}
          >
            {running ? 'Running…' : 'Test dominance'}
          </button>
          {running && (
            <>
              <button onClick={() => { abortRef.current = true; }} style={{ ...btn, backgroundColor: '#7f1d1d' }}>
                Cancel
              </button>
              <div style={{ flex: 1, height: 8, backgroundColor: '#374151', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%`,
                  backgroundColor: '#10b981',
                  transition: 'width 0.1s',
                }} />
              </div>
              <span style={{ fontSize: 12, color: '#9ca3af', minWidth: 90 }}>
                {progress.completed}/{progress.total} trials
              </span>
            </>
          )}
          {!running && (
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              {(trialCount * (challengers.length + 2)).toLocaleString()} hands to simulate
            </span>
          )}
        </div>

        {/* ── Results ───────────────────────────────────────────── */}
        {report && (
          <>
            <div style={{
              ...panel,
              backgroundColor: verdictStyle[report.verdict].bg,
              borderLeft: `4px solid ${verdictStyle[report.verdict].fg}`,
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: verdictStyle[report.verdict].fg, marginBottom: 4 }}>
                {verdictStyle[report.verdict].label}
              </div>
              <div style={{ fontSize: 13, color: '#d1d5db', lineHeight: 1.6 }}>
                {verdictStyle[report.verdict].blurb}
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
                {champion.name} · {SEAT_LABELS[seat]} deviates ({scope === 'team' ? 'whole team' : 'seat only'}) ·
                {' '}{report.trialsPerChallenger.toLocaleString()} trials per challenger ·
                {' '}{report.exact ? 'exact board' : `seed ${seed}`}
              </div>
              {parityBroken && (
                <div style={{ marginTop: 10, padding: 8, borderRadius: 4, backgroundColor: 'rgba(239,68,68,0.2)', fontSize: 12, color: '#fca5a5' }}>
                  <strong>Parity broken.</strong> The champion played against itself produced nonzero deltas
                  ({report.parity!.wins}W / {report.parity!.losses}L). Something in the simulation is
                  nondeterministic, so every number below is suspect.
                </div>
              )}
            </div>

            <div style={{ ...panel, overflowX: 'auto' }}>
              <div style={sectionTitle}>Registry challengers</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Challenger</th>
                    <th style={{ ...th, textAlign: 'right' }}>mean Δ</th>
                    <th style={th}></th>
                    <th style={{ ...th, textAlign: 'right' }}>95% CI</th>
                    <th style={{ ...th, textAlign: 'right' }}>W / T / L</th>
                    <th style={th}>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {report.challengers.map(c => {
                    const isOpen = expanded === c.name;
                    return (
                      <React.Fragment key={c.name}>
                        <tr
                          onClick={() => setExpanded(isOpen ? null : c.name)}
                          style={{ cursor: 'pointer', backgroundColor: c.refutes ? 'rgba(239,68,68,0.10)' : 'transparent' }}
                        >
                          <td style={{ ...td, fontWeight: 600 }}>
                            <span style={{ color: '#6b7280', marginRight: 6 }}>{isOpen ? '▾' : '▸'}</span>
                            {c.name}
                            {c.parseError && <span style={{ color: '#f87171', fontWeight: 400 }}> — parse error</span>}
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: c.meanDelta > 0 ? '#f87171' : c.meanDelta < 0 ? '#4ade80' : '#9ca3af' }}>
                            {c.meanDelta > 0 ? '+' : ''}{c.meanDelta.toFixed(2)}
                          </td>
                          <td style={td}><DeltaBar value={c.meanDelta} max={maxAbsDelta} /></td>
                          <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: '#9ca3af' }}>
                            {report.exact ? 'exact' : `±${c.ci95.toFixed(2)}`}
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: '#9ca3af' }}>
                            {c.wins} / {c.ties} / {c.losses}
                          </td>
                          <td style={td}>
                            {c.refutes ? (
                              <span style={{ color: '#f87171', fontWeight: 700 }}>REFUTES</span>
                            ) : c.beatsOnSome ? (
                              <span style={{ color: '#fbbf24' }}>beats on {c.wins}</span>
                            ) : (
                              <span style={{ color: '#4ade80' }}>held</span>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={6} style={{ padding: 0, backgroundColor: '#0f1f15' }}>
                              <TrialTable
                                challenger={c}
                                team={report.deviatingTeam}
                                exact={report.exact}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 10, lineHeight: 1.6 }}>
                Δ is the deviating team&rsquo;s net hand points minus the same team&rsquo;s points in the
                all-champion baseline, averaged over trials. Positive (red) means deviating paid off.
                A whisting counts as {'±'}21 — the game-winning value scoreHand books no points for.
                Click a row for the deal-by-deal detail.
              </div>
            </div>
          </>
        )}

        {/* ── Search ────────────────────────────────────────────── */}
        <div style={panel}>
          <div
            style={{ ...sectionTitle, marginBottom: searchOpen ? 10 : 0, cursor: 'pointer' }}
            onClick={() => setSearchOpen(o => !o)}
          >
            {searchOpen ? '▾' : '▸'} 5 · Explore new strategies — evolve a refuter
          </div>

          {searchOpen && (
            <>
              <p style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.6, marginBottom: 12, maxWidth: 760 }}>
                The table above only answers &ldquo;does any strategy I already wrote beat the champion here?&rdquo;.
                This searches the Signal Lab parameter space for one that does. Candidates are evolved against a
                training set of fills, then re-scored on a disjoint holdout set — with enough generations a search
                will always beat the champion on the fills it trained on, and only the holdout number means anything.
              </p>

              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Generations: {generations}</label>
                  <input type="range" min={2} max={40} value={generations} onChange={e => setGenerations(Number(e.target.value))} style={{ width: 150 }} />
                </div>
                <div>
                  <label style={labelStyle}>Population: {population}</label>
                  <input type="range" min={6} max={40} value={population} onChange={e => setPopulation(Number(e.target.value))} style={{ width: 150 }} />
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {specInfo.exact
                    ? 'Exact board — deterministic, so no holdout stage is needed.'
                    : `${Math.max(1, Math.round(fills / 2))} training + ${Math.max(1, Math.round(fills / 2))} holdout fills`}
                </div>
                <button
                  onClick={handleSearch}
                  disabled={searching || !specInfo.valid}
                  style={{
                    ...btn,
                    padding: '8px 20px',
                    backgroundColor: searching || !specInfo.valid ? '#374151' : '#8b5cf6',
                    cursor: searching || !specInfo.valid ? 'not-allowed' : 'pointer',
                  }}
                >
                  {searching ? 'Searching…' : 'Search for a refuter'}
                </button>
                {searching && (
                  <button onClick={() => { searchAbortRef.current = true; }} style={{ ...btn, backgroundColor: '#7f1d1d' }}>
                    Cancel
                  </button>
                )}
              </div>

              {genLog.length > 0 && (
                <div style={{
                  backgroundColor: '#0f1f15',
                  borderRadius: 6,
                  padding: 10,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  maxHeight: 140,
                  overflowY: 'auto',
                  marginBottom: 12,
                }}>
                  {genLog.map(g => (
                    <div key={g.generation} style={{ color: '#9ca3af' }}>
                      gen {String(g.generation).padStart(2)} · best Δ{' '}
                      <span style={{ color: g.bestDelta > 0 ? '#f87171' : '#4ade80' }}>{g.bestDelta.toFixed(2)}</span>
                      {' '}· pop mean Δ {g.meanDelta.toFixed(2)}
                    </div>
                  ))}
                </div>
              )}

              {searchReport && (
                <>
                  <div style={{
                    padding: 10,
                    borderRadius: 6,
                    marginBottom: 12,
                    backgroundColor: searchReport.refuter ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.12)',
                    color: searchReport.refuter ? '#fca5a5' : '#86efac',
                    fontSize: 13,
                  }}>
                    {searchReport.refuter ? (
                      <>Search found a refuter that survived holdout validation:{' '}
                        <strong>{searchReport.refuter.summary || searchReport.refuter.name}</strong>{' '}
                        (holdout Δ {(searchReport.refuter.holdout ?? searchReport.refuter.train).meanDelta.toFixed(2)}).
                      </>
                    ) : (
                      <>No evolved candidate survived holdout validation. {champion.name} held against{' '}
                        {(generations * population).toLocaleString()} generated challengers on this board.</>
                    )}
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Evolved candidate</th>
                          <th style={{ ...th, textAlign: 'right' }}>train Δ</th>
                          <th style={{ ...th, textAlign: 'right' }}>holdout Δ</th>
                          <th style={{ ...th, textAlign: 'right' }}>W / T / L</th>
                          <th style={th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchReport.finalists.map(f => {
                          const h = f.holdout;
                          const confirmed = confirmations[f.name];
                          return (
                            <React.Fragment key={f.name}>
                              <tr style={{ backgroundColor: f.refutes ? 'rgba(239,68,68,0.10)' : 'transparent' }}>
                                <td style={{ ...td, fontFamily: 'monospace' }}>{f.summary || f.name}</td>
                                <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: '#9ca3af' }}>
                                  {f.train.meanDelta.toFixed(2)}
                                </td>
                                <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: h && h.meanDelta > 0 ? '#f87171' : '#4ade80' }}>
                                  {h ? `${h.meanDelta > 0 ? '+' : ''}${h.meanDelta.toFixed(2)} ±${h.ci95.toFixed(2)}` : 'exact'}
                                </td>
                                <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: '#9ca3af' }}>
                                  {h ? `${h.wins} / ${h.ties} / ${h.losses}` : `${f.train.wins} / ${f.train.ties} / ${f.train.losses}`}
                                </td>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                  {f.refutes && (
                                    <button
                                      onClick={() => handleConfirm(f)}
                                      disabled={confirming === f.name}
                                      style={{ ...btn, padding: '3px 10px', fontSize: 12, marginRight: 6, backgroundColor: '#1e40af' }}
                                    >
                                      {confirming === f.name ? 'Confirming…' : 'Confirm'}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => navigator.clipboard?.writeText(f.strategyText)}
                                    style={{ ...btn, padding: '3px 10px', fontSize: 12 }}
                                    title="Copy the generated .cstrat so you can paste it into a Custom slot"
                                  >
                                    Copy .cstrat
                                  </button>
                                </td>
                              </tr>
                              {confirmed && (
                                <tr>
                                  <td colSpan={5} style={{ ...td, backgroundColor: '#0f1f15', fontSize: 12, color: '#d1d5db' }}>
                                    Independent re-test at seed {((seed ^ 0x9e3779b9) >>> 0)} over {fills * 2} fills:
                                    {' '}mean Δ <strong style={{ color: confirmed.meanDelta > 0 ? '#f87171' : '#4ade80' }}>
                                      {confirmed.meanDelta > 0 ? '+' : ''}{confirmed.meanDelta.toFixed(2)}
                                    </strong> ±{confirmed.ci95.toFixed(2)}
                                    {' '}({confirmed.wins}W / {confirmed.ties}T / {confirmed.losses}L) —
                                    {' '}{confirmed.refutes ? 'refutation holds.' : 'does not survive; the search hit was selection noise.'}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Trial detail table ───────────────────────────────────────────────

const TrialTable: React.FC<{
  challenger: ChallengerReport;
  team: number;
  exact: boolean;
}> = ({ challenger, team, exact }) => {
  if (challenger.parseError) {
    return (
      <div style={{ padding: 12, color: '#f87171', fontSize: 12, fontFamily: 'monospace' }}>
        {challenger.parseError}
      </div>
    );
  }

  // On a Monte Carlo board there can be thousands of trials; the ones
  // worth reading are the deals where the deviation actually changed
  // something, biggest gain first.
  const shown: TrialOutcome[] = exact
    ? challenger.trials
    : [...challenger.trials].filter(t => t.delta !== 0).sort((a, b) => b.delta - a.delta).slice(0, 20);

  if (shown.length === 0) {
    return (
      <div style={{ padding: 12, color: '#6b7280', fontSize: 12 }}>
        Every trial was a tie — the challenger played this board identically to the champion.
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 12px 12px' }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
        {exact
          ? `All ${shown.length} trials.`
          : `Top ${shown.length} of ${challenger.trials.length - challenger.ties} deals where the deviation changed the result.`}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, fontSize: 11 }}>Dealer</th>
            <th style={{ ...th, fontSize: 11 }}>Baseline (champion)</th>
            <th style={{ ...th, fontSize: 11 }}>Deviated (challenger)</th>
            <th style={{ ...th, fontSize: 11, textAlign: 'right' }}>pts</th>
            <th style={{ ...th, fontSize: 11, textAlign: 'right' }}>Δ</th>
            <th style={{ ...th, fontSize: 11 }}>Deal</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t, i) => (
            <tr key={i}>
              <td style={{ ...td, fontSize: 12 }}>{SEAT_SHORT[t.dealer]}</td>
              <td style={{ ...td, fontSize: 12, fontFamily: 'monospace' }}>{describeOutcome(t.baseline, team)}</td>
              <td style={{ ...td, fontSize: 12, fontFamily: 'monospace' }}>{describeOutcome(t.deviated, team)}</td>
              <td style={{ ...td, fontSize: 12, textAlign: 'right', fontFamily: 'monospace', color: '#9ca3af' }}>
                {t.basePayoff} → {t.devPayoff}
              </td>
              <td style={{
                ...td, fontSize: 12, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700,
                color: t.delta > 0 ? '#f87171' : t.delta < 0 ? '#4ade80' : '#9ca3af',
              }}>
                {t.delta > 0 ? '+' : ''}{t.delta}
              </td>
              <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>
                <a
                  href={`/bidwhist#${t.deckUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#93c5fd', marginRight: 8 }}
                  title="Play this deal"
                >
                  play
                </a>
                <button
                  onClick={() => navigator.clipboard?.writeText(t.deckUrl)}
                  style={{ ...btn, padding: '1px 8px', fontSize: 11 }}
                >
                  copy
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
