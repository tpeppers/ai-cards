import React, { useMemo } from 'react';
import { StrategyComparisonResult, InterestingWhisting, StrategyConfig } from '../simulation/types.ts';
import { BidWhistSimulator, DetailedHandData } from '../simulation/BidWhistSimulator.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { Card } from '../types/CardGame.ts';

interface WhistingsTabProps {
  result: StrategyComparisonResult;
}

// ── Constants ─────────────────────────────────────────────────────

const PLAYER_LABELS = ['S', 'E', 'N', 'W'];

const SUIT_SYMBOLS: { [key: string]: string } = {
  spades: '\u2660', hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663',
};

const SUIT_COLORS: { [key: string]: string } = {
  spades: '#a0aec0', hearts: '#f56565', diamonds: '#f6ad55', clubs: '#68d391',
};

const RANK_LABELS: { [r: number]: string } = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};

const DIRECTION_LABELS: { [key: string]: string } = {
  'uptown': '\u2191 Uptown',
  'downtown': '\u2193 Downtown (Aces Good)',
  'downtown-noaces': '\u2193 Downtown (No Aces)',
};

// ── Helpers ──────────────────────────────────────────────────────

function renderCard(card: Card, trumpSuit?: string): React.ReactNode {
  const symbol = SUIT_SYMBOLS[card.suit] || '?';
  const color = SUIT_COLORS[card.suit] || '#e5e7eb';
  const isTrump = card.suit === trumpSuit;
  return (
    <span style={{ fontWeight: isTrump ? 'bold' : 'normal' }}>
      {RANK_LABELS[card.rank] ?? card.rank}
      <span style={{ color, fontWeight: 'bold' }}>{symbol}</span>
    </span>
  );
}

function renderHandBySuit(cards: Card[], trumpSuit: string): React.ReactNode {
  const suitOrder = [trumpSuit, ...['spades', 'hearts', 'diamonds', 'clubs'].filter(s => s !== trumpSuit)];
  const grouped: { [suit: string]: Card[] } = {};
  for (const c of cards) {
    if (!grouped[c.suit]) grouped[c.suit] = [];
    grouped[c.suit].push(c);
  }

  const elements: React.ReactNode[] = [];
  for (const suit of suitOrder) {
    const suitCards = grouped[suit];
    if (!suitCards || suitCards.length === 0) continue;
    suitCards.sort((a, b) => {
      const av = a.rank === 1 ? 14 : a.rank;
      const bv = b.rank === 1 ? 14 : b.rank;
      return bv - av;
    });
    if (elements.length > 0) elements.push(<span key={`sep-${suit}`}>&nbsp;&nbsp;</span>);
    elements.push(
      <span key={suit}>
        {suitCards.map((c, i) => (
          <React.Fragment key={c.id}>
            {i > 0 && ' '}
            {renderCard(c, trumpSuit)}
          </React.Fragment>
        ))}
      </span>
    );
  }
  return <>{elements}</>;
}

// ── Main Component ──────────────────────────────────────────────

const WhistingsTab: React.FC<WhistingsTabProps> = ({ result }) => {
  const { whistings, interestingWhistings } = result;

  const parsedStrategies = useMemo(() =>
    result.config.strategies.map(s => {
      try { return parseStrategy(s.strategyText); }
      catch { return null; }
    }),
  [result.config.strategies]);

  // Re-simulate interesting whistings for detailed view (top 10)
  const topInteresting = useMemo(() => interestingWhistings.slice(0, 10), [interestingWhistings]);

  const detailedHands = useMemo(() => {
    return topInteresting.map(iw => {
      // Re-simulate the whisting config's hand
      const whistingStrats = [
        parsedStrategies[iw.team0StrategyIndex] ?? null,
        parsedStrategies[iw.team1StrategyIndex] ?? null,
        parsedStrategies[iw.team0StrategyIndex] ?? null,
        parsedStrategies[iw.team1StrategyIndex] ?? null,
      ];
      const whistingDetail = BidWhistSimulator.simulateDetailedHand(
        iw.deckUrl,
        whistingStrats,
        iw.whistingHand.dealer,
      );
      if (whistingDetail) {
        whistingDetail.gameIndex = iw.gameIndex;
        whistingDetail.handIndex = iw.handIndex;
        whistingDetail.deckUrl = iw.deckUrl;
        whistingDetail.strategyNames = [
          result.config.strategies[iw.team0StrategyIndex]?.name ?? 'A',
          result.config.strategies[iw.team1StrategyIndex]?.name ?? 'B',
        ];
        whistingDetail.team0StrategyIndex = iw.team0StrategyIndex;
        whistingDetail.team1StrategyIndex = iw.team1StrategyIndex;
      }

      // Re-simulate the non-whisting config's hand (swapped strategies)
      const nonWhistingStrats = [
        parsedStrategies[iw.team1StrategyIndex] ?? null,
        parsedStrategies[iw.team0StrategyIndex] ?? null,
        parsedStrategies[iw.team1StrategyIndex] ?? null,
        parsedStrategies[iw.team0StrategyIndex] ?? null,
      ];
      const nonWhistingDetail = BidWhistSimulator.simulateDetailedHand(
        iw.deckUrl,
        nonWhistingStrats,
        iw.nonWhistingHand.dealer,
      );
      if (nonWhistingDetail) {
        nonWhistingDetail.gameIndex = iw.gameIndex;
        nonWhistingDetail.handIndex = iw.handIndex;
        nonWhistingDetail.deckUrl = iw.deckUrl;
        nonWhistingDetail.strategyNames = [
          result.config.strategies[iw.team1StrategyIndex]?.name ?? 'A',
          result.config.strategies[iw.team0StrategyIndex]?.name ?? 'B',
        ];
        nonWhistingDetail.team0StrategyIndex = iw.team1StrategyIndex;
        nonWhistingDetail.team1StrategyIndex = iw.team0StrategyIndex;
      }

      return { whistingDetail, nonWhistingDetail };
    });
  }, [topInteresting, parsedStrategies, result.config.strategies]);

  const panelStyle: React.CSSProperties = {
    backgroundColor: '#162b1e',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    border: '1px solid #374151',
  };

  const openReplay = (
    deckUrl: string,
    t0StratIdx: number,
    t1StratIdx: number,
    dealer: number,
  ) => {
    const t0 = result.config.strategies[t0StratIdx];
    const t1 = result.config.strategies[t1StratIdx];
    sessionStorage.setItem('replay-config', JSON.stringify({
      deckUrl,
      dealer,
      team0StrategyText: t0?.strategyText ?? '',
      team0StrategyName: t0?.name ?? `Strategy ${t0StratIdx}`,
      team1StrategyText: t1?.strategyText ?? '',
      team1StrategyName: t1?.name ?? `Strategy ${t1StratIdx}`,
    }));
    window.open(`/replay#${deckUrl}`, '_blank');
  };

  if (whistings.length === 0 && interestingWhistings.length === 0) {
    return (
      <div style={{ padding: '24px', color: '#9ca3af', textAlign: 'center' }}>
        No whistings (13 books) occurred in this comparison.
      </div>
    );
  }

  return (
    <div>
      {/* Summary */}
      <div style={panelStyle}>
        <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
          Whisting Summary
        </h3>
        <p style={{ margin: '4px 0', fontSize: '13px' }}>
          Total whistings: <strong>{whistings.length}</strong>
        </p>
        <p style={{ margin: '4px 0', fontSize: '13px' }}>
          Interesting whistings (one strategy achieved it, the other didn't): <strong style={{ color: '#fbbf24' }}>{interestingWhistings.length}</strong>
        </p>
        {interestingWhistings.length > 0 && (
          <p style={{ margin: '4px 0', fontSize: '12px', color: '#9ca3af' }}>
            These are hands where one strategy won all 13 books but the other didn't — showing where strategy made the difference between a whisting and a non-whisting.
          </p>
        )}
      </div>

      {/* All whistings list */}
      {whistings.length > 0 && (
        <div style={panelStyle}>
          <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
            All Whistings ({whistings.length})
          </h3>
          <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #374151', position: 'sticky', top: 0, backgroundColor: '#162b1e' }}>
                  <th style={{ padding: '3px 6px', textAlign: 'left', fontSize: '11px' }}>#</th>
                  <th style={{ padding: '3px 6px', textAlign: 'left', fontSize: '11px' }}>Config</th>
                  <th style={{ padding: '3px 6px', textAlign: 'left', fontSize: '11px' }}>Gm.Hd</th>
                  <th style={{ padding: '3px 6px', textAlign: 'left', fontSize: '11px' }}>Declarer</th>
                  <th style={{ padding: '3px 6px', textAlign: 'left', fontSize: '11px' }}>Bid</th>
                  <th style={{ padding: '3px 6px', textAlign: 'left', fontSize: '11px' }}>Trump</th>
                  <th style={{ padding: '3px 6px', textAlign: 'center', fontSize: '11px' }}></th>
                </tr>
              </thead>
              <tbody>
                {whistings.map((w, idx) => {
                  const trumpSym = SUIT_SYMBOLS[w.hand.trumpSuit] || '?';
                  const trumpCol = SUIT_COLORS[w.hand.trumpSuit] || '#e5e7eb';
                  const playUrl = `/bidwhist#${w.deckUrl}`;
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid #2d3748' }}>
                      <td style={{ padding: '2px 6px', fontSize: '11px' }}>{idx + 1}</td>
                      <td style={{ padding: '2px 6px', fontSize: '11px' }}>{w.configLabel}</td>
                      <td style={{ padding: '2px 6px', fontSize: '11px', color: '#6b7280' }}>{w.gameIndex + 1}.{w.handIndex + 1}</td>
                      <td style={{ padding: '2px 6px', fontSize: '11px' }}>{PLAYER_LABELS[w.hand.bidWinner]} (T{w.declarerTeam})</td>
                      <td style={{ padding: '2px 6px', fontSize: '11px' }}>{w.hand.bidAmount}</td>
                      <td style={{ padding: '2px 6px', fontSize: '11px' }}>
                        <span style={{ color: trumpCol, fontWeight: 'bold' }}>{trumpSym}</span>
                      </td>
                      <td style={{ padding: '2px 6px', fontSize: '11px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <a href={playUrl} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#60a5fa', textDecoration: 'underline', fontSize: '10px' }}>Play</a>
                        {' '}
                        <button onClick={() => openReplay(w.deckUrl, w.team0StrategyIndex, w.team1StrategyIndex, w.hand.dealer)}
                          style={{ color: '#a78bfa', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: 0 }}>
                          Replay
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Interesting whistings — detailed */}
      {topInteresting.length > 0 && (
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
            Interesting Whistings — Strategy Made the Difference
          </h3>
          <p style={{ color: '#9ca3af', marginBottom: '16px', fontSize: '13px' }}>
            Top {topInteresting.length} hands where one strategy achieved a whisting but the other didn't.
          </p>
          {topInteresting.map((iw, idx) => {
            const { whistingDetail, nonWhistingDetail } = detailedHands[idx];
            return (
              <InterestingWhistingCard
                key={idx}
                rank={idx + 1}
                iw={iw}
                whistingDetail={whistingDetail}
                nonWhistingDetail={nonWhistingDetail}
                strategies={result.config.strategies}
                openReplay={openReplay}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Interesting Whisting Card ───────────────────────────────────

const TrickTable: React.FC<{
  detail: DetailedHandData;
  label: string;
  labelColor: string;
}> = ({ detail, label, labelColor }) => {
  const thStyle: React.CSSProperties = {
    padding: '4px 8px',
    textAlign: 'left',
    borderBottom: '1px solid #4b5563',
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#9ca3af',
  };

  const tdStyle: React.CSSProperties = {
    padding: '4px 8px',
    fontSize: '13px',
    borderBottom: '1px solid #1f2937',
  };

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '12px', fontWeight: 'bold', color: labelColor, marginBottom: '4px' }}>
        {label} — Starting Hands
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px',
        fontSize: '12px', backgroundColor: '#0f1f15', padding: '6px 8px', borderRadius: '4px',
        marginBottom: '8px',
      }}>
        {[0, 1, 2, 3].map(p => (
          <div key={p}>
            <span style={{ fontWeight: 'bold', color: p % 2 === detail.declarer % 2 ? labelColor : '#9ca3af' }}>
              {PLAYER_LABELS[p]}:
            </span>{' '}
            {renderHandBySuit(detail.startingHands[p], detail.trumpSuit)}
          </div>
        ))}
      </div>
      <div style={{ fontSize: '12px', fontWeight: 'bold', color: labelColor, marginBottom: '4px' }}>
        Tricks
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>#</th>
            <th style={thStyle}>Leader</th>
            <th style={thStyle}>Cards</th>
            <th style={thStyle}>Won</th>
            <th style={thStyle}>Books</th>
          </tr>
        </thead>
        <tbody>
          {detail.tricks.map(trick => (
            <tr key={trick.number}>
              <td style={tdStyle}>{trick.number}</td>
              <td style={tdStyle}>{PLAYER_LABELS[trick.leader]}</td>
              <td style={tdStyle}>
                {trick.plays.map((p, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && ' '}
                    <span style={{ color: p.playerId === trick.winner ? '#68d391' : '#e5e7eb' }}>
                      {renderCard(p.card, detail.trumpSuit)}
                    </span>
                  </React.Fragment>
                ))}
              </td>
              <td style={{ ...tdStyle, fontWeight: 'bold' }}>{PLAYER_LABELS[trick.winner]}</td>
              <td style={{ ...tdStyle, color: '#6b7280' }}>{trick.team0Books}-{trick.team1Books}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const InterestingWhistingCard: React.FC<{
  rank: number;
  iw: InterestingWhisting;
  whistingDetail: DetailedHandData | null;
  nonWhistingDetail: DetailedHandData | null;
  strategies: StrategyConfig[];
  openReplay: (deckUrl: string, t0: number, t1: number, dealer: number) => void;
}> = ({ rank, iw, whistingDetail, nonWhistingDetail, strategies, openReplay }) => {
  const trumpSym = SUIT_SYMBOLS[iw.whistingHand.trumpSuit] || '?';
  const trumpCol = SUIT_COLORS[iw.whistingHand.trumpSuit] || '#e5e7eb';
  const dirLabel = DIRECTION_LABELS[iw.whistingHand.direction] || iw.whistingHand.direction;
  const playUrl = `/bidwhist#${iw.deckUrl}`;

  const panelStyle: React.CSSProperties = {
    backgroundColor: '#162b1e',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    border: '1px solid #374151',
  };

  const btnStyle: React.CSSProperties = {
    textDecoration: 'underline', background: 'none', border: 'none',
    cursor: 'pointer', fontSize: '12px', padding: 0,
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px' }}>
          #{rank} — <span style={{ color: '#fbbf24' }}>{iw.whistingConfig}</span> whistings (13 books),{' '}
          <span style={{ color: '#9ca3af' }}>{iw.nonWhistingConfig}</span> got {iw.nonWhistingBooks} books
        </div>
        <div style={{ fontSize: '13px', color: '#9ca3af' }}>
          Bid {iw.whistingHand.bidAmount} | Declarer: {PLAYER_LABELS[iw.whistingHand.bidWinner]}
          {' | '}Game {iw.gameIndex + 1}, Hand {iw.handIndex + 1}
          {' | '}Trump:{' '}
          <span style={{ color: trumpCol, fontWeight: 'bold' }}>{trumpSym}</span>
          {' '}{dirLabel}
        </div>
      </div>

      {/* Play/Replay buttons for both sides */}
      <div style={{
        display: 'flex', gap: '24px', marginBottom: '12px',
        fontSize: '12px', backgroundColor: '#0f1f15', padding: '8px 12px', borderRadius: '4px',
      }}>
        <div>
          <span style={{ fontWeight: 'bold', color: '#fbbf24' }}>{iw.whistingConfig}</span>
          <span style={{ color: '#9ca3af' }}> (whisting):</span>
          {' '}Books {iw.whistingHand.booksWon[0]}-{iw.whistingHand.booksWon[1]}
          <span style={{ marginLeft: '8px' }}>
            <a href={playUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: '#60a5fa', textDecoration: 'underline', fontSize: '12px' }}>Play</a>
            {' '}
            <button onClick={() => openReplay(iw.deckUrl, iw.team0StrategyIndex, iw.team1StrategyIndex, iw.whistingHand.dealer)}
              style={{ ...btnStyle, color: '#a78bfa' }}>
              Replay
            </button>
          </span>
        </div>
        <div>
          <span style={{ fontWeight: 'bold', color: '#f87171' }}>{iw.nonWhistingConfig}</span>
          <span style={{ color: '#9ca3af' }}> (stopped):</span>
          {' '}Books {iw.nonWhistingHand.booksWon[0]}-{iw.nonWhistingHand.booksWon[1]} ({iw.nonWhistingBooks} for declarer)
          <span style={{ marginLeft: '8px' }}>
            <a href={playUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: '#60a5fa', textDecoration: 'underline', fontSize: '12px' }}>Play</a>
            {' '}
            <button onClick={() => openReplay(iw.deckUrl, iw.team1StrategyIndex, iw.team0StrategyIndex, iw.nonWhistingHand.dealer)}
              style={{ ...btnStyle, color: '#a78bfa' }}>
              Replay
            </button>
          </span>
        </div>
      </div>

      {/* Detailed hand views side-by-side (if available) */}
      {(whistingDetail || nonWhistingDetail) && (
        <div style={{ display: 'flex', gap: '16px' }}>
          {whistingDetail && (
            <TrickTable detail={whistingDetail} label={`${iw.whistingConfig} (whisting)`} labelColor="#fbbf24" />
          )}
          {nonWhistingDetail && (
            <TrickTable detail={nonWhistingDetail} label={`${iw.nonWhistingConfig} (stopped)`} labelColor="#f87171" />
          )}
        </div>
      )}
    </div>
  );
};

export default WhistingsTab;
