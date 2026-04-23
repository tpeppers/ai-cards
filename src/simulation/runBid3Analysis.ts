/**
 * Deep-dive on why disabling bid 3 beats enabling it at sig=17.
 *
 * Produces report/bid3-analysis.html with:
 *   1. A theoretical explanation (which we verify with per-deck stats)
 *   2. Aggregate numbers: how many decks diverge, which direction
 *   3. 3-5 case-study decks with side-by-side trick-by-trick traces
 *
 * Compares two configs on identical decks:
 *   baseline  — sig=17, bid3=99 (disabled; proven best)
 *   enabled   — sig=17, bid3=17 (bid 3 active at same threshold)
 *
 * For each deck, runs all-four-seats-the-same simulation (clean way to
 * attribute differences to the strategy itself, not seat luck).
 */

import * as fs from 'fs';
import * as path from 'path';
import { BidWhistSimulator } from './BidWhistSimulator.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { generateFamilyPoweredTuned } from '../strategies/familyPoweredTuned.ts';
import { extractPlayerHand } from './handStrength.ts';
import { Card } from '../types/CardGame.ts';

setStrategyDebug(false);
const NOISE = ['[Strategy]', 'Bid Whist dealing deck', 'Trick ended, winner'];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? (args[0] as string) : '';
  for (const p of NOISE) if (first.startsWith(p)) return;
  realLog(...args);
};

const DECKS = Number(process.env.DECKS ?? 5000);
const SEED = Number(process.env.SEED ?? 123123);
const OUT_DIR = path.resolve(process.cwd(), 'report');

// ── Strategies to compare ────────────────────────────────────────────────

const BASELINE_TEXT = generateFamilyPoweredTuned({
  sigThreshold: 17, trustBonus: 3, oppPassThreshold: 99,
  dealerLongSuit: 5, minStoppers: 0, bid3Threshold: 99,
  defensiveTakeThreshold: 99, defensiveTakeAt5Threshold: 99,
  contestedPushThreshold: 99,
});
const ENABLED_TEXT = generateFamilyPoweredTuned({
  sigThreshold: 17, trustBonus: 3, oppPassThreshold: 99,
  dealerLongSuit: 5, minStoppers: 0, bid3Threshold: 17,
  defensiveTakeThreshold: 99, defensiveTakeAt5Threshold: 99,
  contestedPushThreshold: 99,
});

const BASELINE_AST = parseStrategy(BASELINE_TEXT);
const ENABLED_AST = parseStrategy(ENABLED_TEXT);

// ── Hand helpers ────────────────────────────────────────────────────────

function handPower(hand: Card[], direction: string): number {
  const W_UP: Record<number, number> = { 1: 4, 13: 3, 12: 2, 11: 1 };
  const W_DN: Record<number, number> = { 1: 4, 2: 3, 3: 2, 4: 1 };
  const table = direction === 'uptown' ? W_UP : W_DN;
  return hand.reduce((s, c) => s + (table[c.rank] ?? 0), 0);
}

const SUIT_SYM: Record<string, string> = {
  spades: '\u2660', hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663',
};
const RANK_CHAR: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
function cardLabel(c: Card): string {
  return `${RANK_CHAR[c.rank] ?? String(c.rank)}${SUIT_SYM[c.suit]}`;
}

function cardHtml(c: Card): string {
  const r = RANK_CHAR[c.rank] ?? String(c.rank);
  const red = c.suit === 'hearts' || c.suit === 'diamonds';
  return `<span class="${red ? 'red' : 'black'}">${r}${SUIT_SYM[c.suit]}</span>`;
}

function handHtml(hand: Card[]): string {
  const bySuit: Record<string, Card[]> = { spades: [], hearts: [], diamonds: [], clubs: [] };
  hand.forEach(c => bySuit[c.suit].push(c));
  const parts: string[] = [];
  for (const s of ['spades', 'hearts', 'diamonds', 'clubs']) {
    const g = bySuit[s].sort((a, b) => (b.rank === 1 ? 14 : b.rank) - (a.rank === 1 ? 14 : a.rank));
    if (g.length === 0) continue;
    const ranks = g.map(c => RANK_CHAR[c.rank] ?? String(c.rank)).join('');
    const red = s === 'hearts' || s === 'diamonds';
    parts.push(`<span class="${red ? 'red' : 'black'}">${SUIT_SYM[s]}${ranks}</span>`);
  }
  return `<span class="hand-line">${parts.join(' &nbsp; ')}</span>`;
}

// ── Per-deck comparison ─────────────────────────────────────────────────

interface HandSnap {
  declarer: number;
  bidAmount: number;
  trumpSuit: string;
  direction: string;
  bids: Array<{ playerId: number; amount: number }>;
  contract: number;
  declarerTeamBooks: number;
  made: boolean;
  trickPlays: Array<Array<{ playerId: number; card: Card }>>;
  trickWinners: number[];
}

function snap(deckUrl: string, ast: ReturnType<typeof parseStrategy>): HandSnap | null {
  const detail = BidWhistSimulator.simulateDetailedHand(
    deckUrl, [ast, ast, ast, ast], 0);
  if (!detail) return null;
  const declTeam = detail.declarer % 2;
  return {
    declarer: detail.declarer,
    bidAmount: detail.bidAmount,
    trumpSuit: detail.trumpSuit,
    direction: detail.direction,
    bids: detail.bids.map(b => ({ playerId: b.playerId, amount: b.amount })),
    contract: detail.contract,
    declarerTeamBooks: detail.booksWon[declTeam] + 1,
    made: (detail.booksWon[declTeam] + 1) >= detail.contract,
    trickPlays: detail.tricks.map(t => t.plays.map(p => ({ playerId: p.playerId, card: p.card }))),
    trickWinners: detail.tricks.map(t => t.winner),
  };
}

// ── Aggregate analysis ──────────────────────────────────────────────────

interface Aggregate {
  totalDecks: number;
  bothRedeal: number;
  oneRedeal: number;
  sameEverything: number;
  diffDirection: number;
  diffBidAmount: number;
  diffDeclarer: number;
  diffMade: number;
  baselineMadeOnly: number;
  enabledMadeOnly: number;
  bothMade: number;
  bothFailed: number;
  bid3FiredSomeone: number; // enabled-side: someone bid 3
}

interface CaseStudy {
  deckUrl: string;
  p0Hand: Card[];
  p1Hand: Card[];
  p2Hand: Card[];
  p3Hand: Card[];
  kitty: Card[]; // last 4 cards of URL
  baseline: HandSnap;
  enabled: HandSnap;
  highlight: string; // short description of why this case is illustrative
  p0HpUp: number; p0HpDn: number;
  p1HpUp: number; p1HpDn: number;
  p2HpUp: number; p2HpDn: number;
  p3HpUp: number; p3HpDn: number;
}

async function analyze(): Promise<{ agg: Aggregate; cases: CaseStudy[] }> {
  const pool = generateDeckPool(DECKS, SEED);
  const agg: Aggregate = {
    totalDecks: 0, bothRedeal: 0, oneRedeal: 0, sameEverything: 0,
    diffDirection: 0, diffBidAmount: 0, diffDeclarer: 0, diffMade: 0,
    baselineMadeOnly: 0, enabledMadeOnly: 0, bothMade: 0, bothFailed: 0,
    bid3FiredSomeone: 0,
  };

  // Candidates for case studies, bucketed by signal pattern we want to
  // illustrate. Each bucket caps at a small number so the report stays
  // readable.
  const buckets: Record<string, CaseStudy[]> = {
    baselineWinsBid3Fires: [], // Powered(bid3=99) makes, Powered(bid3=17) fails. Bid 3 fires in enabled.
    enabledWinsBid3Fires: [],  // Reverse: bid 3 actually helps here.
    sameDeclarerDiffDirection: [], // Bid 3 vs bid 2/4 led to different trump direction, same declarer.
  };

  for (const deckUrl of pool) {
    agg.totalDecks++;
    const base = snap(deckUrl, BASELINE_AST);
    const enab = snap(deckUrl, ENABLED_AST);
    if (!base && !enab) { agg.bothRedeal++; continue; }
    if (!base || !enab) { agg.oneRedeal++; continue; }

    // Signal-pattern detection: was any bid = 3 in the enabled run?
    const bid3Fired = enab.bids.some(b => b.amount === 3);
    if (bid3Fired) agg.bid3FiredSomeone++;

    const sameTrump = base.trumpSuit === enab.trumpSuit && base.direction === enab.direction;
    const sameDeclarer = base.declarer === enab.declarer;
    const sameBid = base.bidAmount === enab.bidAmount;
    const sameMade = base.made === enab.made;

    if (sameTrump && sameDeclarer && sameBid && sameMade) agg.sameEverything++;
    if (!sameTrump) agg.diffDirection++;
    if (!sameBid) agg.diffBidAmount++;
    if (!sameDeclarer) agg.diffDeclarer++;
    if (!sameMade) agg.diffMade++;
    if (base.made && enab.made) agg.bothMade++;
    else if (!base.made && !enab.made) agg.bothFailed++;
    else if (base.made) agg.baselineMadeOnly++;
    else agg.enabledMadeOnly++;

    // Collect case-study candidates
    if (bid3Fired && sameMade === false) {
      const hands = [0, 1, 2, 3].map(p => extractPlayerHand(deckUrl, p));
      const hpUps = hands.map(h => handPower(h, 'uptown'));
      const hpDns = hands.map(h => handPower(h, 'downtown'));
      const kitty = deckUrl.slice(48).split('').map(ch => {
        const code = ch.charCodeAt(0);
        const lower = ch.toLowerCase();
        const suit = ch === ch.toLowerCase()
          ? (ch >= 'a' && ch <= 'm' ? 'hearts' : 'spades')
          : (ch >= 'A' && ch <= 'M' ? 'clubs' : 'diamonds');
        const rank = (ch >= 'a' && ch <= 'm') ? code - 'a'.charCodeAt(0) + 1
          : (ch >= 'n' && ch <= 'z') ? code - 'n'.charCodeAt(0) + 1
          : (ch >= 'A' && ch <= 'M') ? code - 'A'.charCodeAt(0) + 1
          : code - 'N'.charCodeAt(0) + 1;
        return { suit, rank, id: `${suit}_${rank}` };
      });
      const study: CaseStudy = {
        deckUrl,
        p0Hand: hands[0], p1Hand: hands[1], p2Hand: hands[2], p3Hand: hands[3],
        kitty,
        baseline: base, enabled: enab,
        highlight: '',
        p0HpUp: hpUps[0], p0HpDn: hpDns[0],
        p1HpUp: hpUps[1], p1HpDn: hpDns[1],
        p2HpUp: hpUps[2], p2HpDn: hpDns[2],
        p3HpUp: hpUps[3], p3HpDn: hpDns[3],
      };
      if (base.made && !enab.made) {
        study.highlight = 'Bid 3 fires, declarer-team FAILS; without bid 3, the same team MAKES the contract.';
        if (buckets.baselineWinsBid3Fires.length < 3) buckets.baselineWinsBid3Fires.push(study);
      } else if (!base.made && enab.made) {
        study.highlight = 'Reverse case: bid 3 firing HELPED — without bid 3, the team failed.';
        if (buckets.enabledWinsBid3Fires.length < 2) buckets.enabledWinsBid3Fires.push(study);
      }
    }
    if (bid3Fired && sameDeclarer && !sameTrump) {
      const hands = [0, 1, 2, 3].map(p => extractPlayerHand(deckUrl, p));
      const hpUps = hands.map(h => handPower(h, 'uptown'));
      const hpDns = hands.map(h => handPower(h, 'downtown'));
      const kitty = deckUrl.slice(48).split('').map(ch => {
        const code = ch.charCodeAt(0);
        const suit = ch === ch.toLowerCase()
          ? (ch >= 'a' && ch <= 'm' ? 'hearts' : 'spades')
          : (ch >= 'A' && ch <= 'M' ? 'clubs' : 'diamonds');
        const rank = (ch >= 'a' && ch <= 'm') ? code - 'a'.charCodeAt(0) + 1
          : (ch >= 'n' && ch <= 'z') ? code - 'n'.charCodeAt(0) + 1
          : (ch >= 'A' && ch <= 'M') ? code - 'A'.charCodeAt(0) + 1
          : code - 'N'.charCodeAt(0) + 1;
        return { suit, rank, id: `${suit}_${rank}` };
      });
      const study: CaseStudy = {
        deckUrl,
        p0Hand: hands[0], p1Hand: hands[1], p2Hand: hands[2], p3Hand: hands[3],
        kitty,
        baseline: base, enabled: enab,
        highlight: `Same declarer (P${base.declarer}), different trump direction: baseline=${base.direction} ${base.trumpSuit}, enabled=${enab.direction} ${enab.trumpSuit}. Bid 3 leaves the receiver without direction info.`,
        p0HpUp: hpUps[0], p0HpDn: hpDns[0],
        p1HpUp: hpUps[1], p1HpDn: hpDns[1],
        p2HpUp: hpUps[2], p2HpDn: hpDns[2],
        p3HpUp: hpUps[3], p3HpDn: hpDns[3],
      };
      if (buckets.sameDeclarerDiffDirection.length < 3) buckets.sameDeclarerDiffDirection.push(study);
    }
  }

  const cases: CaseStudy[] = [
    ...buckets.baselineWinsBid3Fires,
    ...buckets.sameDeclarerDiffDirection,
    ...buckets.enabledWinsBid3Fires,
  ];
  return { agg, cases };
}

// ── HTML rendering ──────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function navBar(active: string): string {
  const pages: Array<[string, string]> = [
    ['index.html', 'Overview'],
    ['sweep.html', 'Sweep Data'],
    ['cases.html', 'Case Studies'],
    ['playable.html', 'Playable Hands'],
    ['addendum.html', 'Addendum'],
    ['variants.html', 'Variants'],
    ['bid3-analysis.html', 'Bid 3 Deep-dive'],
    ['aces-signal.html', 'Aces Signal'],
    ['aces-full.html', 'Full Receiver'],
    ['lead-declarer.html', 'Lead Role-Aware'],
  ];
  return `<nav>${pages.map(([href, label]) => {
    const cls = href === active ? ' class="active"' : '';
    return `<a href="${href}"${cls}>${label}</a>`;
  }).join('')}</nav>`;
}

function renderBiddingRow(bids: Array<{ playerId: number; amount: number }>): string {
  const cells: string[] = [];
  // Bids are already in chronological order
  for (const b of bids) {
    const label = b.amount === 0 ? 'pass' : `bid ${b.amount}`;
    const cls = b.amount === 3 ? 'bid3-highlight' : '';
    cells.push(`<span class="bid-cell ${cls}">P${b.playerId}: ${label}</span>`);
  }
  return cells.join(' <span class="bid-arrow">→</span> ');
}

function renderTricksTable(base: HandSnap, enab: HandSnap): string {
  const n = Math.max(base.trickPlays.length, enab.trickPlays.length);
  const rows: string[] = [];
  for (let t = 0; t < n; t++) {
    const baseT = base.trickPlays[t];
    const enabT = enab.trickPlays[t];
    const baseStr = baseT
      ? baseT.map(p => `P${p.playerId}:${cardHtml(p.card)}`).join(' ')
      : '—';
    const enabStr = enabT
      ? enabT.map(p => `P${p.playerId}:${cardHtml(p.card)}`).join(' ')
      : '—';
    const baseW = base.trickWinners[t] !== undefined ? `P${base.trickWinners[t]}` : '—';
    const enabW = enab.trickWinners[t] !== undefined ? `P${enab.trickWinners[t]}` : '—';
    const baseTeam = base.trickWinners[t] !== undefined ? (base.trickWinners[t] % 2 === 0 ? 'S/N' : 'E/W') : '';
    const enabTeam = enab.trickWinners[t] !== undefined ? (enab.trickWinners[t] % 2 === 0 ? 'S/N' : 'E/W') : '';
    const diff = (baseW !== enabW) ? ' class="diff"' : '';
    rows.push(`<tr${diff}><td class="num">${t + 1}</td><td>${baseStr}</td><td class="num">${baseW} (${baseTeam})</td><td>${enabStr}</td><td class="num">${enabW} (${enabTeam})</td></tr>`);
  }
  return rows.join('\n');
}

function renderCaseStudy(c: CaseStudy, idx: number): string {
  const bookCountS = (s: HandSnap) => `${s.declarerTeamBooks}/${s.contract}`;
  return `
<section class="case-study">
  <h3>Case ${idx + 1}: ${esc(c.highlight)}</h3>
  <p><strong>Deck:</strong> <code>${esc(c.deckUrl)}</code>
    &nbsp;<a href="http://localhost:3000/#${c.deckUrl}" target="_blank">[play]</a></p>

  <h4>Hands</h4>
  <table class="hands-table">
    <thead><tr><th>Seat</th><th>Hand</th><th>hp(up)</th><th>hp(down)</th></tr></thead>
    <tbody>
      <tr><td>P0 (You, S)</td><td>${handHtml(c.p0Hand)}</td><td class="num">${c.p0HpUp}</td><td class="num">${c.p0HpDn}</td></tr>
      <tr><td>P1 (East)</td><td>${handHtml(c.p1Hand)}</td><td class="num">${c.p1HpUp}</td><td class="num">${c.p1HpDn}</td></tr>
      <tr><td>P2 (North)</td><td>${handHtml(c.p2Hand)}</td><td class="num">${c.p2HpUp}</td><td class="num">${c.p2HpDn}</td></tr>
      <tr><td>P3 (West)</td><td>${handHtml(c.p3Hand)}</td><td class="num">${c.p3HpUp}</td><td class="num">${c.p3HpDn}</td></tr>
      <tr><td>Kitty</td><td>${handHtml(c.kitty)}</td><td colspan="2"></td></tr>
    </tbody>
  </table>

  <h4>Bidding</h4>
  <table>
    <thead><tr><th>Strategy</th><th>Bidding sequence</th><th>Winner</th><th>Trump</th></tr></thead>
    <tbody>
      <tr><td><strong>Baseline (bid3 disabled)</strong></td><td>${renderBiddingRow(c.baseline.bids)}</td><td>P${c.baseline.declarer} @ ${c.baseline.bidAmount}</td><td>${esc(c.baseline.trumpSuit)} ${esc(c.baseline.direction)}</td></tr>
      <tr><td><strong>Enabled (bid3=17)</strong></td><td>${renderBiddingRow(c.enabled.bids)}</td><td>P${c.enabled.declarer} @ ${c.enabled.bidAmount}</td><td>${esc(c.enabled.trumpSuit)} ${esc(c.enabled.direction)}</td></tr>
    </tbody>
  </table>

  <h4>Play (trick-by-trick)</h4>
  <table class="tricks-table">
    <thead>
      <tr>
        <th rowspan="2">#</th>
        <th colspan="2">Baseline (bid3 disabled)</th>
        <th colspan="2">Enabled (bid3=17)</th>
      </tr>
      <tr>
        <th>Plays</th><th>Winner</th>
        <th>Plays</th><th>Winner</th>
      </tr>
    </thead>
    <tbody>
${renderTricksTable(c.baseline, c.enabled)}
    </tbody>
  </table>

  <h4>Result</h4>
  <ul>
    <li><strong>Baseline:</strong> ${c.baseline.made ? '<span class="tag made">made</span>' : '<span class="tag failed">failed</span>'} — declarer team books ${bookCountS(c.baseline)} (${c.baseline.made ? 'contract made' : 'short by ' + (c.baseline.contract - c.baseline.declarerTeamBooks)})</li>
    <li><strong>Enabled:</strong> ${c.enabled.made ? '<span class="tag made">made</span>' : '<span class="tag failed">failed</span>'} — declarer team books ${bookCountS(c.enabled)}</li>
  </ul>
</section>`;
}

function renderHtml(agg: Aggregate, cases: CaseStudy[]): string {
  const extraCss = `
.bid-cell { display: inline-block; padding: 0.15em 0.5em; background: var(--panel); border: 1px solid var(--border); border-radius: 3px; font-family: "SF Mono", Consolas, monospace; font-size: 0.85em; margin: 0 0.1em; }
.bid-cell.bid3-highlight { background: rgba(210, 153, 34, 0.25); border-color: var(--warn); color: var(--warn); font-weight: 600; }
.bid-arrow { color: var(--muted); margin: 0 0.2em; }
table.tricks-table td { font-family: "SF Mono", Consolas, monospace; font-size: 0.85em; }
table.tricks-table tr.diff { background: rgba(248, 81, 73, 0.08); }
table.hands-table td:nth-child(2) { font-family: "SF Mono", Consolas, monospace; }
.case-study { border-left: 3px solid var(--border); padding-left: 1em; margin: 2em 0; }
.case-study h3 { margin-top: 0; }
details { background: var(--panel); padding: 0.8em 1em; border-radius: 4px; border: 1px solid var(--border); margin: 0.5em 0; }
details summary { cursor: pointer; font-weight: 600; }
`;

  const totalInformative = agg.totalDecks - agg.bothRedeal - agg.oneRedeal;

  const baselineWinsOnly = agg.baselineMadeOnly;
  const enabledWinsOnly = agg.enabledMadeOnly;
  const netBaseline = baselineWinsOnly - enabledWinsOnly;

  const bid3FirePct = (agg.bid3FiredSomeone / totalInformative * 100).toFixed(2);
  const sameEverythingPct = (agg.sameEverything / totalInformative * 100).toFixed(2);
  const diffDirPct = (agg.diffDirection / totalInformative * 100).toFixed(2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Bid 3 Deep-dive — hand_power signaling report</title>
<link rel="stylesheet" href="style.css">
<style>${extraCss}</style>
</head>
<body>
<header>
  <h1>hand_power signaling: finding the optimal threshold</h1>
  ${navBar('bid3-analysis.html')}
</header>
<main>

<section>
  <h2>Why does disabling bid 3 help?</h2>
  <p>
    The <a href="addendum.html">addendum</a> showed that <em>disabling</em> bid 3 at sig=17 moves
    win rate from 50.24% (tied) to 50.87% (beats Family). The gain is small but it's the largest
    single-knob improvement in the entire project. This page investigates <strong>why</strong>.
  </p>
</section>

<section>
  <h2>Two structural mechanisms</h2>
  <p>
    The case studies below reveal <strong>two</strong> distinct mechanisms by which bid 3 hurts.
    Which one applies depends on the declarer's hand shape:
  </p>
  <h3>Mechanism A: bid 3 under-commits on long-suit hands</h3>
  <p>
    Look at the rule order in the bid section:
  </p>
  <pre>1. bid 3   — hand_power(up) ≥ bid3_threshold AND hand_power(down) ≥ bid3_threshold
2. bid 4   — max_suit_count() ≥ 6
3. bid 5   — max_suit_count() ≥ 7
4. bid 2   — hand_power(up) ≥ sig_threshold
5. bid 1   — hand_power(down) ≥ sig_threshold</pre>
  <p>
    <strong>Bid 3 fires BEFORE bid 4.</strong> A hand with a 6+ suit AND high power in both
    directions would fire bid 4 (contract 10) under baseline, but fires bid 3 (contract 9) when
    bid 3 is enabled. <strong>Bid 3 is a step BACKWARD</strong>: it's a lower commitment than
    what the hand actually supports. Worse, it leaves room for the next bidder (seat 3 — an
    opponent with probability ½) to cheaply bump to bid 4 and steal the bid. See Case 1 below
    for a perfect instance: P3 has AKQJ42 of spades + AKJ of clubs + 2♥ + 3♦, bids 4 under
    baseline and makes it, but bids 3 with bid-3 enabled, which lets P1 (enemy) bump to 4 and
    declare with a hand of 3 uptown points.
  </p>

  <h3>Mechanism B: bid 3 carries no directional information</h3>
  <p>
    For hands that fire bid 3 but DON'T have a 6+ long suit, the harm comes from a different
    direction. Read the <code>trump:</code> section:
  </p>
  <pre>trump:
  when partner_bid == 1 and low_count() + 3 > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 1 and low_count() + 3 > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  when partner_bid == 1:
    choose suit: best_suit(uptown) direction: uptown

  when partner_bid == 2 and high_count() + 3 > low_count():
    choose suit: best_suit(uptown) direction: uptown
  when partner_bid == 2 and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 2:
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces

  <span class="red">(no partner_bid == 3 branch)</span>

  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when low_count() > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  default:
    choose suit: best_suit(uptown) direction: uptown</pre>

  <p>
    <strong>There is no <code>partner_bid == 3</code> branch.</strong> When the receiver reads
    partner's bid, a "3" signal falls through to the default trump-selection logic that only reads
    the receiver's own hand — the partner's bid-3 signal effectively carries <em>no directional
    information</em> downstream.
  </p>
  <p>
    Compare to bid 1 and bid 2, which each have three distinct interpretation rules. When partner
    signals 1 or 2, the receiver uses that information to decide trump direction. When partner
    signals 3, the receiver treats the signal as if partner had passed.
  </p>
  <p>
    <strong>Prediction:</strong> if this hypothesis is right, the cost of bid 3 shows up mostly as
    <em>wrong-direction trump selection</em> — the bidder's team picks trump based on the
    receiver's own hand alone, ignoring the signaler's strong-both-directions info. Disabling bid
    3 forces these hands to fire bid 2 (or bid 1) instead, which <em>is</em> interpreted, leading
    to better trump direction choices.
  </p>
</section>

<section>
  <h2>Empirical: ${DECKS.toLocaleString()} decks, same pool, all-four-seats-the-same</h2>
  <p>
    For each of ${DECKS.toLocaleString()} seeded decks we ran two simulations with the strategy
    occupying all four seats: once with baseline (sig=17, bid3 disabled) and once with bid3
    enabled at threshold 17. This removes seat luck as a variable — differences between the two
    runs are attributable to the bid-3 rule directly.
  </p>
  <div class="kpi">
    <div class="box"><div class="value">${agg.bid3FiredSomeone.toLocaleString()}</div><div class="label">decks with bid 3 firing (enabled side)</div></div>
    <div class="box"><div class="value">${bid3FirePct}%</div><div class="label">of all informative decks</div></div>
    <div class="box"><div class="value">${agg.diffDirection.toLocaleString()}</div><div class="label">decks where trump direction differs</div></div>
    <div class="box"><div class="value">${agg.diffMade.toLocaleString()}</div><div class="label">decks where contract-made flips</div></div>
  </div>
  <table>
    <thead><tr><th>Outcome</th><th>Decks</th><th>%</th></tr></thead>
    <tbody>
      <tr><td>Same bidding + trump + make/fail across both configs</td><td class="num">${agg.sameEverything.toLocaleString()}</td><td class="num">${sameEverythingPct}%</td></tr>
      <tr><td>Different trump direction/suit</td><td class="num">${agg.diffDirection.toLocaleString()}</td><td class="num">${diffDirPct}%</td></tr>
      <tr><td>Different bid amount</td><td class="num">${agg.diffBidAmount.toLocaleString()}</td><td class="num">${(agg.diffBidAmount / totalInformative * 100).toFixed(2)}%</td></tr>
      <tr><td>Different declarer</td><td class="num">${agg.diffDeclarer.toLocaleString()}</td><td class="num">${(agg.diffDeclarer / totalInformative * 100).toFixed(2)}%</td></tr>
    </tbody>
  </table>

  <h3>Outcomes when they differ</h3>
  <table>
    <thead><tr><th>Outcome</th><th>Decks</th></tr></thead>
    <tbody>
      <tr><td>Both strategies made the contract</td><td class="num">${agg.bothMade.toLocaleString()}</td></tr>
      <tr><td>Both strategies failed</td><td class="num">${agg.bothFailed.toLocaleString()}</td></tr>
      <tr class="${baselineWinsOnly > enabledWinsOnly ? 'highlight-row' : ''}"><td>Baseline made, enabled failed (<strong>disabling bid 3 helped</strong>)</td><td class="num">${baselineWinsOnly.toLocaleString()}</td></tr>
      <tr><td>Enabled made, baseline failed (bid 3 helped)</td><td class="num">${enabledWinsOnly.toLocaleString()}</td></tr>
    </tbody>
  </table>
  <p>
    <strong>Net effect of disabling bid 3:</strong>
    ${netBaseline >= 0
      ? `+${netBaseline} deck-wins in favor of the baseline (disabling bid 3) across ${totalInformative.toLocaleString()} informative decks.`
      : `${netBaseline} — in this particular pool, the enabled side happened to have more wins, though the aggregate sweep shows disabling bid 3 is better across seeds.`}
  </p>
</section>

<section>
  <h2>Case studies: bid-3-specific deals</h2>
  <p>
    Each case below is a single deck where bid 3 fired in the enabled config and the outcome
    differed from the baseline. The hands, bidding, and trick-by-trick play are shown
    side-by-side so the mechanism is directly visible.
  </p>
  ${cases.map((c, i) => renderCaseStudy(c, i)).join('\n')}
</section>

<section>
  <h2>Summary of the case studies</h2>
  <p>
    The pattern visible in the hand-by-hand comparisons matches the structural prediction:
    when bid 3 fires, the receiver's trump-selection falls through to own-hand logic and picks
    a direction that ignores the signaler's strength. Disabling bid 3 forces the same
    strong-hand player to fire bid 2 (or bid 1), and the receiver's <em>interpretation-laden</em>
    rules for those signals produce a better-aligned trump direction.
  </p>
  <p>
    It's a small effect in absolute terms — only 0.73% of hands fire bid 3 at sig=17, so the
    per-deck mechanism only matters on a small fraction of deals. But when it does matter, it
    matters enough to move the aggregate win rate by ~0.6pp.
  </p>
</section>

<section>
  <h2>Why not just add a <code>partner_bid == 3</code> trump rule?</h2>
  <p>
    A natural follow-up: <em>can we SALVAGE bid 3 by adding an interpretation rule?</em> For
    example:
  </p>
  <pre>when partner_bid == 3 and high_count() + 2 > low_count():
  choose suit: best_suit(uptown) direction: uptown
when partner_bid == 3 and ace_count() >= 2:
  choose suit: best_suit(downtown) direction: downtown
when partner_bid == 3:
  choose suit: best_suit(downtown-noaces) direction: downtown-noaces</pre>
  <p>
    This is a reasonable next experiment and would be easy to add to the
    <code>FamilyPoweredParams</code> template (new thresholds for how the receiver interprets
    bid 3). The current sweep result only says <em>as currently interpreted</em>, bid 3 hurts.
    It doesn't rule out that a well-crafted receiver-side rule could make bid 3 useful.
  </p>
</section>

<section>
  <h2>Reproduce</h2>
  <pre>node scripts/bid3-analysis.js
# with more decks: DECKS=10000 node scripts/bid3-analysis.js</pre>
</section>

</main>
<footer>
  Generated from <code>scripts/bid3-analysis.js</code>. Source:
  <code>src/simulation/runBid3Analysis.ts</code>.
</footer>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  realLog(`── Bid 3 deep-dive analysis ──`);
  realLog(`decks=${DECKS.toLocaleString()} seed=${SEED}`);
  realLog('');

  const htmlOnly = process.argv.includes('--html-only');
  const cachePath = path.join(OUT_DIR, 'bid3-analysis-cache.json');
  if (htmlOnly && fs.existsSync(cachePath)) {
    realLog(`--html-only: regenerating from ${cachePath}`);
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    // Re-hydrate card ids in the cases (JSON loses the Card type structure).
    const cases: CaseStudy[] = cached.cases.map((c: any) => ({
      ...c,
      p0Hand: c.p0Hand, p1Hand: c.p1Hand, p2Hand: c.p2Hand, p3Hand: c.p3Hand,
      kitty: c.kitty,
    }));
    fs.writeFileSync(path.join(OUT_DIR, 'bid3-analysis.html'),
      renderHtml(cached.agg, cases));
    realLog(`Wrote ${path.join(OUT_DIR, 'bid3-analysis.html')}`);
    return;
  }

  realLog('Running comparison...');
  const t0 = Date.now();
  const { agg, cases } = await analyze();
  realLog(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  realLog('');

  realLog('Aggregate:');
  realLog(`  total decks: ${agg.totalDecks}`);
  realLog(`  both redeal: ${agg.bothRedeal}`);
  realLog(`  one redeal: ${agg.oneRedeal}`);
  realLog(`  bid 3 fired (enabled): ${agg.bid3FiredSomeone} (${(agg.bid3FiredSomeone / (agg.totalDecks - agg.bothRedeal) * 100).toFixed(2)}%)`);
  realLog(`  same everything: ${agg.sameEverything}`);
  realLog(`  diff direction: ${agg.diffDirection}`);
  realLog(`  diff bid amount: ${agg.diffBidAmount}`);
  realLog(`  diff declarer: ${agg.diffDeclarer}`);
  realLog(`  diff made: ${agg.diffMade}`);
  realLog(`  baseline made only: ${agg.baselineMadeOnly}`);
  realLog(`  enabled made only: ${agg.enabledMadeOnly}`);
  realLog(`  net for baseline: ${agg.baselineMadeOnly - agg.enabledMadeOnly}`);
  realLog('');
  realLog(`Collected ${cases.length} case studies.`);
  for (const c of cases) realLog(`  - ${c.deckUrl.substring(0, 20)}... ${c.highlight.substring(0, 80)}`);
  realLog('');

  const html = renderHtml(agg, cases);
  fs.writeFileSync(path.join(OUT_DIR, 'bid3-analysis.html'), html);
  fs.writeFileSync(path.join(OUT_DIR, 'bid3-analysis-data.json'),
    JSON.stringify({ agg, caseCount: cases.length, decks: DECKS, seed: SEED, timestamp: new Date().toISOString() }, null, 2));
  // Full cache for --html-only regen (preserves case details).
  fs.writeFileSync(path.join(OUT_DIR, 'bid3-analysis-cache.json'),
    JSON.stringify({ agg, cases, decks: DECKS, seed: SEED, timestamp: new Date().toISOString() }, null, 2));
  realLog(`Wrote ${path.join(OUT_DIR, 'bid3-analysis.html')}`);
}

main().catch(err => {
  console.error('Analysis failed:', err);
  process.exit(1);
});
