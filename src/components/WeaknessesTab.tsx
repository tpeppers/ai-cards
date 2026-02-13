import React, { useMemo } from 'react';
import { StrategyComparisonResult, StrategyConfig } from '../simulation/types.ts';
import { BidWhistSimulator, DetailedHandData } from '../simulation/BidWhistSimulator.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { Card } from '../types/CardGame.ts';

interface WeaknessesTabProps {
  result: StrategyComparisonResult;
}

// ── Constants ─────────────────────────────────────────────────────

const PLAYER_LABELS = ['S', 'E', 'N', 'W'];
const PLAYER_NAMES = ['South', 'East', 'North', 'West'];

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

// ── Types ─────────────────────────────────────────────────────────

interface MissedBidRef {
  gameIndex: number;
  handIndex: number;
  deficit: number;
  declarer: number;
  bidAmount: number;
  booksWon: [number, number];
  game: GameResult;
  hand: HandResult;
}

// ── Helpers ───────────────────────────────────────────────────────

function findTopMissedBids(result: StrategyComparisonResult): MissedBidRef[] {
  const missed: MissedBidRef[] = [];

  for (let gi = 0; gi < result.results.length; gi++) {
    const game = result.results[gi];
    for (let hi = 0; hi < game.hands.length; hi++) {
      const hand = game.hands[hi];
      if (hand.bidWinner < 0) continue; // redeal
      if (!hand.bidAmount) continue;

      const declarerTeam = hand.bidWinner % 2;
      const declarerBooks = hand.booksWon[declarerTeam] + 1; // kitty = 1 book
      const contract = hand.bidAmount + 6;
      if (declarerBooks >= contract) continue; // bid was made

      // Exclusion: skip forced 4-bids by 3rd bidder
      // Bidding order: (dealer+3)%4, (dealer+2)%4, (dealer+1)%4, dealer
      // 3rd bidder = (dealer+1)%4
      const dealer = hand.dealer;
      if (dealer !== undefined && hand.bidAmount === 4 && hand.bidWinner === (dealer + 1) % 4) {
        continue;
      }

      const deficit = contract - declarerBooks;
      missed.push({
        gameIndex: gi,
        handIndex: hi,
        deficit,
        declarer: hand.bidWinner,
        bidAmount: hand.bidAmount,
        booksWon: hand.booksWon,
        game,
        hand,
      });
    }
  }

  missed.sort((a, b) => b.deficit - a.deficit);
  return missed.slice(0, 10);
}

function renderCard(card: Card, trumpSuit?: string, bold?: boolean): React.ReactNode {
  const symbol = SUIT_SYMBOLS[card.suit] || '?';
  const color = SUIT_COLORS[card.suit] || '#e5e7eb';
  const isTrump = card.suit === trumpSuit;
  return (
    <span style={{ fontWeight: (isTrump || bold) ? 'bold' : 'normal' }}>
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
    // Sort by rank descending (A=1 treated as high)
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

// ── Main Component ────────────────────────────────────────────────

const WeaknessesTab: React.FC<WeaknessesTabProps> = ({ result }) => {
  const topMissed = useMemo(() => findTopMissedBids(result), [result]);

  const detailedHands = useMemo(() => {
    const parsedStrategies = result.config.strategies.map(s => {
      try { return parseStrategy(s.strategyText); }
      catch { return null; }
    });

    return topMissed.map(ref => {
      const game = ref.game;
      const deckUrl = game.handDeckUrls[ref.handIndex];
      if (!deckUrl) return null;

      // Build per-player strategies for this game's config
      const playerStrats = [
        parsedStrategies[game.team0StrategyIndex] ?? null,
        parsedStrategies[game.team1StrategyIndex] ?? null,
        parsedStrategies[game.team0StrategyIndex] ?? null,
        parsedStrategies[game.team1StrategyIndex] ?? null,
      ];

      const detailed = BidWhistSimulator.simulateDetailedHand(
        deckUrl,
        playerStrats,
        ref.hand.dealer,
      );
      if (!detailed) return null;

      // Fill in source references
      detailed.gameIndex = ref.gameIndex;
      detailed.handIndex = ref.handIndex;
      detailed.deckUrl = deckUrl;
      detailed.configIndex = game.configIndex;
      detailed.strategyNames = [
        result.config.strategies[game.team0StrategyIndex]?.name ?? 'Strategy A',
        result.config.strategies[game.team1StrategyIndex]?.name ?? 'Strategy B',
      ];
      detailed.team0StrategyIndex = game.team0StrategyIndex;
      detailed.team1StrategyIndex = game.team1StrategyIndex;

      return detailed;
    });
  }, [topMissed, result]);

  if (topMissed.length === 0) {
    return (
      <div style={{ padding: '24px', color: '#9ca3af', textAlign: 'center' }}>
        No missed bids found. All contracts were made!
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: '#9ca3af', marginBottom: '16px', fontSize: '14px' }}>
        Top {topMissed.length} hands with the biggest bid-miss deficit (excluding forced 4-bids by 3rd bidder).
      </p>
      {topMissed.map((ref, idx) => {
        const detail = detailedHands[idx];
        if (!detail) {
          return (
            <div key={idx} style={{
              backgroundColor: '#162b1e', borderRadius: '8px', padding: '16px',
              marginBottom: '16px', border: '1px solid #374151',
            }}>
              <span style={{ color: '#f56565' }}>Failed to re-simulate hand (game {ref.gameIndex + 1}, hand {ref.handIndex + 1})</span>
            </div>
          );
        }
        return <HandDetailCard key={idx} rank={idx + 1} detail={detail} strategies={result.config.strategies} />;
      })}
    </div>
  );
};

// ── Hand Detail Card ──────────────────────────────────────────────

const HandDetailCard: React.FC<{ rank: number; detail: DetailedHandData; strategies: StrategyConfig[] }> = ({ rank, detail, strategies }) => {
  const declarerTeam = detail.declarer % 2;
  const declarerBooks = detail.booksWon[declarerTeam] + 1;
  const trumpSymbol = SUIT_SYMBOLS[detail.trumpSuit] || '?';
  const trumpColor = SUIT_COLORS[detail.trumpSuit] || '#e5e7eb';
  const dirLabel = DIRECTION_LABELS[detail.direction] || detail.direction;

  const playUrl = `/bidwhist#${detail.deckUrl}`;
  const openReplay = (e: React.MouseEvent) => {
    e.preventDefault();
    const t0 = strategies[detail.team0StrategyIndex];
    const t1 = strategies[detail.team1StrategyIndex];
    sessionStorage.setItem('replay-config', JSON.stringify({
      deckUrl: detail.deckUrl,
      dealer: detail.dealer,
      team0StrategyText: t0?.strategyText ?? '',
      team0StrategyName: t0?.name ?? `Strategy ${detail.team0StrategyIndex}`,
      team1StrategyText: t1?.strategyText ?? '',
      team1StrategyName: t1?.name ?? `Strategy ${detail.team1StrategyIndex}`,
    }));
    window.open(`/replay#${detail.deckUrl}`, '_blank');
  };

  const panelStyle: React.CSSProperties = {
    backgroundColor: '#162b1e',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    border: '1px solid #374151',
  };

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
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px' }}>
          #{rank} — Bid {detail.bidAmount}, Won {declarerBooks} books (needed {detail.contract}) — Deficit: {detail.deficit}
        </div>
        <div style={{ fontSize: '13px', color: '#9ca3af' }}>
          {detail.strategyNames[0]} vs {detail.strategyNames[1]}
          {' | '}Declarer: {PLAYER_LABELS[detail.declarer]} (Team {declarerTeam})
          {' | '}Dealer: {PLAYER_LABELS[detail.dealer]}
          {' | '}Game {detail.gameIndex + 1}, Hand {detail.handIndex + 1}
        </div>
        <div style={{ fontSize: '13px', marginTop: '2px' }}>
          Trump:{' '}
          <span style={{ color: trumpColor, fontWeight: 'bold' }}>{trumpSymbol}</span>
          {' '}{dirLabel}
          <span style={{ marginLeft: '16px' }}>
            <a
              href={playUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#60a5fa', textDecoration: 'underline' }}
            >
              Play
            </a>
            {' '}
            <a
              href="#"
              onClick={openReplay}
              style={{ color: '#a78bfa', textDecoration: 'underline', marginLeft: '6px' }}
            >
              Replay
            </a>
          </span>
        </div>
      </div>

      {/* Hand Strengths */}
      <div style={{
        display: 'flex', gap: '24px', marginBottom: '12px',
        fontSize: '13px', color: '#9ca3af',
        backgroundColor: '#0f1f15', padding: '8px 12px', borderRadius: '4px',
      }}>
        <div>
          <span style={{ fontWeight: 'bold', color: '#e5e7eb' }}>Pre-bid: </span>
          {[0, 1, 2, 3].map(p => (
            <span key={p} style={{
              marginRight: '8px',
              fontWeight: p === detail.declarer ? 'bold' : 'normal',
              color: p === detail.declarer ? '#fbbf24' : '#9ca3af',
            }}>
              {PLAYER_LABELS[p]} {detail.preBidStrengths[p].toFixed(1)}
            </span>
          ))}
        </div>
        <div>
          <span style={{ fontWeight: 'bold', color: '#e5e7eb' }}>Post-trump: </span>
          {[0, 1, 2, 3].map(p => (
            <span key={p} style={{
              marginRight: '8px',
              fontWeight: p === detail.declarer ? 'bold' : 'normal',
              color: p === detail.declarer ? '#fbbf24' : '#9ca3af',
            }}>
              {PLAYER_LABELS[p]} {detail.postTrumpStrengths[p].toFixed(1)}
            </span>
          ))}
        </div>
      </div>

      {/* Bid Sequence */}
      <div style={{ marginBottom: '12px', fontSize: '13px' }}>
        <span style={{ fontWeight: 'bold', color: '#e5e7eb' }}>Bids: </span>
        {detail.bids.map((bid, i) => {
          const isWinner = bid.playerId === detail.declarer && bid.amount > 0;
          return (
            <span key={i}>
              {i > 0 && ' \u2192 '}
              <span style={{ fontWeight: isWinner ? 'bold' : 'normal', color: isWinner ? '#fbbf24' : '#e5e7eb' }}>
                {PLAYER_LABELS[bid.playerId]}: {bid.amount === 0 ? 'Pass' : bid.amount}
              </span>
            </span>
          );
        })}
      </div>

      {/* Starting Hands */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '4px', color: '#e5e7eb' }}>
          Starting Hands
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[0, 1, 2, 3].map(p => (
                <th key={p} style={{
                  ...thStyle,
                  backgroundColor: p % 2 === declarerTeam ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                }}>
                  {PLAYER_LABELS[p]} {PLAYER_NAMES[p]}
                  {p === detail.declarer ? ' *' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {[0, 1, 2, 3].map(p => (
                <td key={p} style={{
                  ...tdStyle,
                  fontSize: '12px',
                  lineHeight: '1.6',
                  verticalAlign: 'top',
                  backgroundColor: p % 2 === declarerTeam ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                }}>
                  {renderHandBySuit(detail.startingHands[p], detail.trumpSuit)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Kitty */}
      {detail.kitty.length > 0 && (
        <div style={{ marginBottom: '12px', fontSize: '13px' }}>
          <span style={{ fontWeight: 'bold', color: '#e5e7eb' }}>Kitty: </span>
          {detail.kitty.map((card, i) => (
            <React.Fragment key={card.id}>
              {i > 0 && ' '}
              {renderCard(card, detail.trumpSuit)}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Discards */}
      {detail.discards.length > 0 && (
        <div style={{ marginBottom: '12px', fontSize: '13px' }}>
          <span style={{ fontWeight: 'bold', color: '#e5e7eb' }}>Discards: </span>
          {detail.discards.map((card, i) => (
            <React.Fragment key={card.id}>
              {i > 0 && ' '}
              {renderCard(card, detail.trumpSuit)}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Trick-by-Trick Table */}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '4px', color: '#e5e7eb' }}>
          Trick-by-Trick
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: '30px' }}>#</th>
              <th style={{ ...thStyle, width: '40px' }}>Lead</th>
              {[0, 1, 2, 3].map(p => (
                <th key={p} style={{
                  ...thStyle,
                  backgroundColor: p % 2 === declarerTeam ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                }}>
                  {PLAYER_LABELS[p]}
                </th>
              ))}
              <th style={{ ...thStyle, width: '50px' }}>Winner</th>
              <th style={{ ...thStyle, width: '50px' }}>Books</th>
            </tr>
          </thead>
          <tbody>
            {detail.tricks.map((trick, tIdx) => {
              const prevLeader = tIdx > 0 ? detail.tricks[tIdx - 1].leader : trick.leader;
              const controlChanged = tIdx > 0 && trick.leader !== prevLeader;
              // Determine if control changed teams
              const prevLeaderTeam = prevLeader % 2;
              const thisLeaderTeam = trick.leader % 2;
              const teamControlChanged = tIdx > 0 && thisLeaderTeam !== prevLeaderTeam;

              // Build a map of playerId -> card for this trick
              const playerCards: { [pid: number]: Card | undefined } = {};
              for (const play of trick.plays) {
                playerCards[play.playerId] = play.card;
              }

              return (
                <tr key={trick.number} style={{
                  borderLeft: controlChanged
                    ? `3px solid ${teamControlChanged ? '#f56565' : '#fbbf24'}`
                    : '3px solid transparent',
                }}>
                  <td style={{ ...tdStyle, color: '#6b7280', textAlign: 'center' }}>{trick.number}</td>
                  <td style={{ ...tdStyle, fontWeight: 'bold', textAlign: 'center' }}>
                    {PLAYER_LABELS[trick.leader]}
                  </td>
                  {[0, 1, 2, 3].map(p => {
                    const card = playerCards[p];
                    const isWinner = p === trick.winner;
                    return (
                      <td key={p} style={{
                        ...tdStyle,
                        backgroundColor: isWinner
                          ? 'rgba(34, 197, 94, 0.15)'
                          : p % 2 === declarerTeam ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                        fontWeight: isWinner ? 'bold' : 'normal',
                      }}>
                        {card ? renderCard(card, detail.trumpSuit, isWinner) : '\u2014'}
                      </td>
                    );
                  })}
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold' }}>
                    {PLAYER_LABELS[trick.winner]}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: '#9ca3af' }}>
                    {trick.team0Books}-{trick.team1Books}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default WeaknessesTab;
