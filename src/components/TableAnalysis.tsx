import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '../types/CardGame.ts';
import { letterToCard, isValidDeckUrl, generateRandomDeckUrl } from '../urlGameState.js';
import { extractPlayerHand } from '../simulation/handStrength.ts';
import { computePercentiles, initPercentileDistribution, PercentileResult } from '../simulation/percentileStrength.ts';

// ── Constants ──────────────────────────────────────────────────────

const PLAYER_LABELS = ['South', 'East', 'North', 'West'];
const PLAYER_SHORT = ['S', 'E', 'N', 'W'];

const SUIT_SYMBOLS: { [key: string]: string } = {
  spades: '\u2660',
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
};

const SUIT_COLORS: { [key: string]: string } = {
  spades: '#a0aec0',
  hearts: '#f56565',
  diamonds: '#f6ad55',
  clubs: '#68d391',
};

const SUIT_ORDER = ['spades', 'hearts', 'diamonds', 'clubs', 'random'];

const RANK_LABELS: { [r: number]: string } = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};

const DIRECTION_SHORT: { [key: string]: string } = {
  'uptown': 'Up',
  'downtown': 'Dn(A+)',
  'downtown-noaces': 'Dn(NoA)',
};

// ── Helpers ────────────────────────────────────────────────────────

function isUnknownCard(card: Card): boolean {
  return card.suit === 'random';
}

function sortBySuit(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const si = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit);
    if (si !== 0) return si;
    if (isUnknownCard(a) || isUnknownCard(b)) return 0;
    return a.rank - b.rank;
  });
}

function groupBySuit(cards: Card[]): { suit: string; cards: Card[] }[] {
  const groups: { [suit: string]: Card[] } = {};
  for (const suit of SUIT_ORDER) groups[suit] = [];
  for (const c of cards) {
    const key = SUIT_ORDER.includes(c.suit) ? c.suit : 'random';
    groups[key].push(c);
  }
  for (const suit of SUIT_ORDER) {
    if (suit !== 'random') groups[suit].sort((a, b) => a.rank - b.rank);
  }
  return SUIT_ORDER.map(suit => ({ suit, cards: groups[suit] })).filter(g => g.cards.length > 0);
}

function percentileColor(p: number): string {
  if (p >= 75) return '#68d391';
  if (p >= 50) return '#f6e05e';
  if (p >= 25) return '#f6ad55';
  return '#f56565';
}

function ordinal(n: number): string {
  const rounded = Math.round(n);
  if (rounded % 100 >= 11 && rounded % 100 <= 13) return `${rounded}th`;
  switch (rounded % 10) {
    case 1: return `${rounded}st`;
    case 2: return `${rounded}nd`;
    case 3: return `${rounded}rd`;
    default: return `${rounded}th`;
  }
}

function renderCard(card: Card): React.ReactNode {
  if (isUnknownCard(card)) {
    return (
      <span key={card.id} style={{ marginRight: 4, whiteSpace: 'nowrap', color: '#4b5563' }}>?</span>
    );
  }
  return (
    <span key={card.id} style={{ marginRight: 4, whiteSpace: 'nowrap' }}>
      {RANK_LABELS[card.rank] ?? card.rank}
      <span style={{ color: SUIT_COLORS[card.suit], fontWeight: 'bold' }}>{SUIT_SYMBOLS[card.suit]}</span>
    </span>
  );
}

// ── Trade computation ──────────────────────────────────────────────

interface TradeResult {
  cardA: Card;
  playerA: number;
  cardB: Card;
  playerB: number;
  delta: number;
}

function computeTrades(
  hands: Card[][],
  focusPlayer: number,
  baseResult: PercentileResult,
): TradeResult[] {
  const results: TradeResult[] = [];
  const usePercentile = baseResult.knownCount === hands[focusPlayer].length;
  const baseValue = usePercentile ? baseResult.offensivePercentile : baseResult.offensiveStrength;

  const playerPairs: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      playerPairs.push([i, j]);
    }
  }

  for (const [pA, pB] of playerPairs) {
    for (let iA = 0; iA < hands[pA].length; iA++) {
      if (isUnknownCard(hands[pA][iA])) continue;
      for (let iB = 0; iB < hands[pB].length; iB++) {
        if (isUnknownCard(hands[pB][iB])) continue;
        // Swap cards
        const newHands = hands.map(h => [...h]);
        const cardA = newHands[pA][iA];
        const cardB = newHands[pB][iB];
        newHands[pA][iA] = cardB;
        newHands[pB][iB] = cardA;

        const newResult = computePercentiles(newHands[focusPlayer]);
        const newValue = usePercentile ? newResult.offensivePercentile : newResult.offensiveStrength;
        const delta = newValue - baseValue;

        if (Math.abs(delta) > 0.01) {
          results.push({ cardA, playerA: pA, cardB, playerB: pB, delta });
        }
      }
    }
  }

  return results;
}

// ── Component ──────────────────────────────────────────────────────

export default function TableAnalysis() {
  const [input, setInput] = useState('');
  const [gameString, setGameString] = useState('');
  const [error, setError] = useState('');
  const [focusPlayer, setFocusPlayer] = useState(0);
  const [distReady, setDistReady] = useState(false);

  // Precompute the percentile distribution on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      initPercentileDistribution();
      setDistReady(true);
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Parse the game string
  const parsed = useMemo(() => {
    if (!gameString || !distReady) return null;
    try {
      if (!isValidDeckUrl(gameString)) return null;
      const hands = [0, 1, 2, 3].map(p => extractPlayerHand(gameString, p));
      const kitty: Card[] = [];
      for (let i = 48; i < 52; i++) {
        kitty.push(letterToCard(gameString[i]));
      }
      const percentiles = hands.map(h => computePercentiles(h));
      return { hands, kitty, percentiles };
    } catch {
      return null;
    }
  }, [gameString, distReady]);

  // Trade analysis
  const trades = useMemo(() => {
    if (!parsed) return { improving: [], sabotaging: [], usePercentile: true };
    const baseResult = parsed.percentiles[focusPlayer];
    const usePercentile = baseResult.knownCount === parsed.hands[focusPlayer].length;
    const all = computeTrades(parsed.hands, focusPlayer, baseResult);
    const improving = all.filter(t => t.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10);
    const sabotaging = all.filter(t => t.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10);
    return { improving, sabotaging, usePercentile };
  }, [parsed, focusPlayer]);

  function handleAnalyze() {
    const trimmed = input.trim();
    if (trimmed.length !== 52) {
      setError('Game string must be exactly 52 characters.');
      setGameString('');
      return;
    }
    if (!isValidDeckUrl(trimmed)) {
      setError('Invalid game string: contains duplicate or invalid card letters.');
      setGameString('');
      return;
    }
    setError('');
    setGameString(trimmed);
  }

  function handleRandom() {
    const url = generateRandomDeckUrl();
    setInput(url);
    setError('');
    setGameString(url);
  }

  // ── Styles ─────────────────────────────────────────────────────

  const outerStyle: React.CSSProperties = {
    minHeight: '100vh',
    backgroundColor: '#0f1f15',
    padding: '24px 16px',
    color: '#e5e7eb',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  const containerStyle: React.CSSProperties = {
    maxWidth: 1100,
    margin: '0 auto',
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: 28,
  };

  const headingStyle: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 12,
    color: '#93c5fd',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 4,
    border: '1px solid #4b5563',
    backgroundColor: '#374151',
    color: '#e5e7eb',
    fontFamily: 'monospace',
    fontSize: 14,
    boxSizing: 'border-box',
  };

  const btnStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 4,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
  };

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  };

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '8px 12px',
    borderBottom: '2px solid #4b5563',
    color: '#93c5fd',
    fontWeight: 600,
  };

  const tdStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderBottom: '1px solid #374151',
  };

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div style={outerStyle}>
    <div style={containerStyle}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Table Analysis</h1>
      <p style={{ color: '#9ca3af', marginBottom: 20, fontSize: 14 }}>
        Analyze a full 4-player deal from a 52-character game string.
      </p>

      {/* Section A: Input */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAnalyze(); }}
            placeholder="Paste 52-character game string..."
            style={{ ...inputStyle, flex: 1, minWidth: 300 }}
          />
          <button
            onClick={handleAnalyze}
            style={{ ...btnStyle, backgroundColor: '#3b82f6', color: '#fff' }}
          >
            Analyze
          </button>
          <button
            onClick={handleRandom}
            style={{ ...btnStyle, backgroundColor: '#6b7280', color: '#fff' }}
          >
            Random Deal
          </button>
        </div>
        {error && <div style={{ color: '#f56565', marginTop: 8, fontSize: 13 }}>{error}</div>}
        {!distReady && <div style={{ color: '#9ca3af', marginTop: 8, fontSize: 13 }}>Precomputing percentile distribution...</div>}
      </div>

      {parsed && (
        <>
          {/* Section B: Hand Display */}
          <div style={sectionStyle}>
            <h2 style={headingStyle}>Hands</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {parsed.hands.map((hand, pi) => (
                <div key={pi} style={{ backgroundColor: '#1f2937', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, color: pi % 2 === 0 ? '#93c5fd' : '#fca5a5' }}>
                    {PLAYER_LABELS[pi]} ({PLAYER_SHORT[pi]})
                    {pi % 2 === 0 ? ' — Team 1' : ' — Team 2'}
                  </div>
                  {groupBySuit(hand).map(({ suit, cards }) => (
                    <div key={suit} style={{ marginBottom: 4, lineHeight: 1.6 }}>
                      {suit === 'random' ? (
                        <>
                          <span style={{ color: '#4b5563', fontWeight: 'bold', marginRight: 4 }}>?</span>
                          <span style={{ color: '#4b5563' }}>{cards.length} unknown</span>
                        </>
                      ) : (
                        <>
                          <span style={{ color: SUIT_COLORS[suit], fontWeight: 'bold', marginRight: 4 }}>
                            {SUIT_SYMBOLS[suit]}
                          </span>
                          {cards.map(c => (
                            <span key={c.id} style={{ marginRight: 4 }}>{RANK_LABELS[c.rank]}</span>
                          ))}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {/* Kitty */}
              <div style={{ backgroundColor: '#1f2937', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: '#9ca3af' }}>Kitty</div>
                <div style={{ lineHeight: 1.6 }}>
                  {sortBySuit(parsed.kitty).map(c => (
                    <React.Fragment key={c.id}>{renderCard(c)} </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section C: Strength Table */}
          <div style={sectionStyle}>
            <h2 style={headingStyle}>Hand Strength</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Player</th>
                    <th style={thStyle}>Best Trump</th>
                    <th style={thStyle}>Off. Str.</th>
                    <th style={thStyle}>Off. %ile</th>
                    <th style={thStyle}>Def. Str.</th>
                    <th style={thStyle}>Def. %ile</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.percentiles.map((p: PercentileResult, pi: number) => {
                    const partial = p.knownCount < parsed.hands[pi].length;
                    const knownLabel = partial ? ` (${p.knownCount}/${parsed.hands[pi].length})` : '';
                    return (
                      <tr key={pi} style={{ backgroundColor: pi % 2 === 0 ? 'transparent' : 'rgba(55, 65, 81, 0.3)' }}>
                        <td style={{ ...tdStyle, fontWeight: 600, color: pi % 2 === 0 ? '#93c5fd' : '#fca5a5' }}>
                          {PLAYER_LABELS[pi]}
                          {partial && <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 12 }}>{knownLabel}</span>}
                        </td>
                        <td style={tdStyle}>
                          {p.knownCount === 0 ? (
                            <span style={{ color: '#4b5563' }}>{'\u2014'}</span>
                          ) : (
                            <>
                              <span style={{ color: SUIT_COLORS[p.bestTrumpSuit], fontWeight: 'bold' }}>
                                {SUIT_SYMBOLS[p.bestTrumpSuit]}
                              </span>
                              {' '}{DIRECTION_SHORT[p.bestTrumpDirection]}
                            </>
                          )}
                        </td>
                        <td style={tdStyle}>{p.offensiveStrength.toFixed(2)}</td>
                        <td style={tdStyle}>
                          {partial ? <span style={{ color: '#4b5563' }}>{'\u2014'}</span> : <PercentileBar value={p.offensivePercentile} />}
                        </td>
                        <td style={tdStyle}>{p.defensiveStrength.toFixed(2)}</td>
                        <td style={tdStyle}>
                          {partial ? <span style={{ color: '#4b5563' }}>{'\u2014'}</span> : <PercentileBar value={p.defensivePercentile} />}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Team averages */}
                  {(() => {
                    const t1HasUnknowns = parsed.percentiles[0].offensivePercentile < 0 || parsed.percentiles[2].offensivePercentile < 0;
                    const t2HasUnknowns = parsed.percentiles[1].offensivePercentile < 0 || parsed.percentiles[3].offensivePercentile < 0;
                    return (
                      <>
                        <tr style={{ borderTop: '2px solid #4b5563' }}>
                          <td style={{ ...tdStyle, fontWeight: 600, color: '#93c5fd' }}>Team 1 (S+N)</td>
                          <td style={tdStyle} />
                          <td style={tdStyle}>
                            {((parsed.percentiles[0].offensiveStrength + parsed.percentiles[2].offensiveStrength) / 2).toFixed(2)}
                          </td>
                          <td style={tdStyle}>
                            {t1HasUnknowns ? <span style={{ color: '#4b5563' }}>{'\u2014'}</span> :
                              <PercentileBar value={(parsed.percentiles[0].offensivePercentile + parsed.percentiles[2].offensivePercentile) / 2} />}
                          </td>
                          <td style={tdStyle}>
                            {((parsed.percentiles[0].defensiveStrength + parsed.percentiles[2].defensiveStrength) / 2).toFixed(2)}
                          </td>
                          <td style={tdStyle}>
                            {t1HasUnknowns ? <span style={{ color: '#4b5563' }}>{'\u2014'}</span> :
                              <PercentileBar value={(parsed.percentiles[0].defensivePercentile + parsed.percentiles[2].defensivePercentile) / 2} />}
                          </td>
                        </tr>
                        <tr>
                          <td style={{ ...tdStyle, fontWeight: 600, color: '#fca5a5' }}>Team 2 (E+W)</td>
                          <td style={tdStyle} />
                          <td style={tdStyle}>
                            {((parsed.percentiles[1].offensiveStrength + parsed.percentiles[3].offensiveStrength) / 2).toFixed(2)}
                          </td>
                          <td style={tdStyle}>
                            {t2HasUnknowns ? <span style={{ color: '#4b5563' }}>{'\u2014'}</span> :
                              <PercentileBar value={(parsed.percentiles[1].offensivePercentile + parsed.percentiles[3].offensivePercentile) / 2} />}
                          </td>
                          <td style={tdStyle}>
                            {((parsed.percentiles[1].defensiveStrength + parsed.percentiles[3].defensiveStrength) / 2).toFixed(2)}
                          </td>
                          <td style={tdStyle}>
                            {t2HasUnknowns ? <span style={{ color: '#4b5563' }}>{'\u2014'}</span> :
                              <PercentileBar value={(parsed.percentiles[1].defensivePercentile + parsed.percentiles[3].defensivePercentile) / 2} />}
                          </td>
                        </tr>
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section D: Trade Analysis */}
          <div style={sectionStyle}>
            <h2 style={headingStyle}>Trade Analysis</h2>
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 14, color: '#9ca3af' }}>Focus player:</label>
              <select
                value={focusPlayer}
                onChange={e => setFocusPlayer(Number(e.target.value))}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid #4b5563',
                  backgroundColor: '#374151',
                  color: '#e5e7eb',
                  fontSize: 14,
                }}
              >
                {PLAYER_LABELS.map((label, i) => (
                  <option key={i} value={i}>{label} ({PLAYER_SHORT[i]})</option>
                ))}
              </select>
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                {parsed.percentiles[focusPlayer].offensivePercentile >= 0
                  ? `Current off. percentile: ${ordinal(parsed.percentiles[focusPlayer].offensivePercentile)}`
                  : `Current off. strength: ${parsed.percentiles[focusPlayer].offensiveStrength.toFixed(2)} (${parsed.percentiles[focusPlayer].knownCount}/${parsed.hands[focusPlayer].length} known)`}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Improving trades */}
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: '#68d391' }}>
                  Best Improving Trades {!trades.usePercentile && <span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280' }}>(by strength)</span>}
                </h3>
                {trades.improving.length === 0 ? (
                  <div style={{ color: '#6b7280', fontSize: 13 }}>No improving trades found.</div>
                ) : (
                  <table style={{ ...tableStyle, fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, padding: '6px 8px', fontSize: 12 }}>Swap</th>
                        <th style={{ ...thStyle, padding: '6px 8px', fontSize: 12, textAlign: 'right' }}>Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.improving.map((t, i) => (
                        <tr key={i} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(55, 65, 81, 0.3)' }}>
                          <td style={{ ...tdStyle, padding: '6px 8px' }}>
                            {renderCard(t.cardA)} <span style={{ color: '#6b7280' }}>({PLAYER_SHORT[t.playerA]})</span>
                            <span style={{ margin: '0 4px', color: '#6b7280' }}>{'\u2194'}</span>
                            {renderCard(t.cardB)} <span style={{ color: '#6b7280' }}>({PLAYER_SHORT[t.playerB]})</span>
                          </td>
                          <td style={{ ...tdStyle, padding: '6px 8px', textAlign: 'right', color: '#68d391', fontWeight: 600 }}>
                            +{t.delta.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Sabotaging trades */}
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: '#f56565' }}>
                  Most Sabotaging Trades {!trades.usePercentile && <span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280' }}>(by strength)</span>}
                </h3>
                {trades.sabotaging.length === 0 ? (
                  <div style={{ color: '#6b7280', fontSize: 13 }}>No sabotaging trades found.</div>
                ) : (
                  <table style={{ ...tableStyle, fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, padding: '6px 8px', fontSize: 12 }}>Swap</th>
                        <th style={{ ...thStyle, padding: '6px 8px', fontSize: 12, textAlign: 'right' }}>Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.sabotaging.map((t, i) => (
                        <tr key={i} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(55, 65, 81, 0.3)' }}>
                          <td style={{ ...tdStyle, padding: '6px 8px' }}>
                            {renderCard(t.cardA)} <span style={{ color: '#6b7280' }}>({PLAYER_SHORT[t.playerA]})</span>
                            <span style={{ margin: '0 4px', color: '#6b7280' }}>{'\u2194'}</span>
                            {renderCard(t.cardB)} <span style={{ color: '#6b7280' }}>({PLAYER_SHORT[t.playerB]})</span>
                          </td>
                          <td style={{ ...tdStyle, padding: '6px 8px', textAlign: 'right', color: '#f56565', fontWeight: 600 }}>
                            {t.delta.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
    </div>
  );
}

// ── Percentile Bar sub-component ───────────────────────────────────

function PercentileBar({ value }: { value: number }) {
  const color = percentileColor(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 80,
        height: 10,
        backgroundColor: '#374151',
        borderRadius: 5,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: 5,
          transition: 'width 0.3s ease',
        }} />
      </div>
      <span style={{ color, fontWeight: 600, fontSize: 13, minWidth: 40 }}>
        {ordinal(value)}
      </span>
    </div>
  );
}
