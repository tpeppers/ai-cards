/**
 * CLI entry point: compare two strategies on a seeded deck pool and report
 * (a) head-to-head win-rate and (b) per-hand decision agreement when both
 * play as all four players on the same deck. Used to verify that
 * new-pathway strategies behave the same as their old-pathway source
 * within randomness tolerances.
 *
 * Bundled and executed by scripts/parity-check.js.
 */

import { BidWhistSimulator } from './BidWhistSimulator.ts';
import { BatchRunner } from './BatchRunner.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { StrategyAST } from '../strategy/types.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import {
  BIDWHIST_FAMILY,
  BIDWHIST_FAMILY_CONSTANTS,
  BIDWHIST_FAMILY_POWERED,
  STRATEGY_REGISTRY,
} from '../strategies/index.ts';

setStrategyDebug(false);
const NOISE_PREFIXES = [
  '[Strategy]',
  'Bid Whist dealing deck',
  'Trick ended, winner',
];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? (args[0] as string) : '';
  for (const p of NOISE_PREFIXES) if (first.startsWith(p)) return;
  realLog(...args);
};

interface Args {
  pairs: Array<[string, string]>;
  hands: number;
  pool: number;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const defaults: Args = {
    pairs: [
      ['Family', 'Family (Constants)'],
      ['Family', 'Family (Powered)'],
    ],
    hands: 2000,
    pool: 500,
    seed: 12345,
  };
  const out: Args = { ...defaults, pairs: defaults.pairs.map(p => [...p] as [string, string]) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--hands': out.hands = parseInt(next, 10); i++; break;
      case '--pool':  out.pool = parseInt(next, 10); i++; break;
      case '--seed':  out.seed = parseInt(next, 10); i++; break;
      case '--pair':
        // --pair "A,B"  — adds a comparison pair. Can be repeated.
        if (typeof next === 'string') {
          const parts = next.split(',').map(s => s.trim());
          if (parts.length === 2) out.pairs.push([parts[0], parts[1]]);
          i++;
        }
        break;
    }
  }
  return out;
}

function resolveStrategy(name: string): { name: string; text: string; ast: StrategyAST } {
  // Built-in shortcuts so CLI users can pass the nickname.
  const shortcuts: Record<string, string> = {
    Family: BIDWHIST_FAMILY,
    'Family (Constants)': BIDWHIST_FAMILY_CONSTANTS,
    'Family (Powered)': BIDWHIST_FAMILY_POWERED,
  };
  const text = shortcuts[name] ?? STRATEGY_REGISTRY.find(s => s.name === name)?.text;
  if (!text) throw new Error(`Unknown strategy: ${name}`);
  return { name, text, ast: parseStrategy(text) };
}

// ── Decision-level parity: same deck, all-4 of each strategy ─────────────
//
// For each deck in the pool, we run simulateDetailedHand with strategy A
// as all four seats, then again with strategy B. If A and B encode the
// same policy, every decision tuple we can observe from outside should
// match exactly — the deal is fixed, both runs start from identical
// state, and each ply chooses from the same set of legal cards.

interface DecisionSnapshot {
  declarer: number;
  bidAmount: number;
  trumpSuit: string;
  direction: string;
  bids: string;        // joined "(pid:amt)" for each bid
  discards: string;    // joined card ids
  tricks: string;      // joined plays across all tricks, flattened
  booksTeam0: number;
  booksTeam1: number;
}

function snapshotHand(deckUrl: string, ast: StrategyAST): DecisionSnapshot | null {
  const detail = BidWhistSimulator.simulateDetailedHand(deckUrl, [ast, ast, ast, ast], 0);
  if (!detail) return null;
  return {
    declarer: detail.declarer,
    bidAmount: detail.bidAmount,
    trumpSuit: detail.trumpSuit,
    direction: detail.direction,
    bids: detail.bids.map(b => `${b.playerId}:${b.amount}`).join(','),
    discards: detail.discards.map(c => c.id).sort().join(','),
    tricks: detail.tricks
      .map(t => t.plays.map(p => `${p.playerId}@${p.card.id}`).join('-'))
      .join('|'),
    booksTeam0: detail.booksWon[0],
    booksTeam1: detail.booksWon[1],
  };
}

interface DecisionParityReport {
  decks: number;
  bothRedeal: number;
  oneRedeal: number;
  identicalBid: number;
  identicalTrump: number;
  identicalDiscards: number;
  identicalTricks: number;
  identicalAll: number;
  firstMismatches: Array<{ deckUrl: string; field: string; a: unknown; b: unknown }>;
}

function comparePolicies(
  astA: StrategyAST,
  astB: StrategyAST,
  pool: string[],
): DecisionParityReport {
  const report: DecisionParityReport = {
    decks: 0,
    bothRedeal: 0,
    oneRedeal: 0,
    identicalBid: 0,
    identicalTrump: 0,
    identicalDiscards: 0,
    identicalTricks: 0,
    identicalAll: 0,
    firstMismatches: [],
  };

  for (const deckUrl of pool) {
    report.decks++;
    const snapA = snapshotHand(deckUrl, astA);
    const snapB = snapshotHand(deckUrl, astB);

    if (!snapA && !snapB) { report.bothRedeal++; continue; }
    if (!snapA || !snapB) {
      report.oneRedeal++;
      if (report.firstMismatches.length < 3) {
        report.firstMismatches.push({ deckUrl, field: 'redeal-asymmetry', a: !!snapA, b: !!snapB });
      }
      continue;
    }

    const bidMatch = snapA.declarer === snapB.declarer && snapA.bidAmount === snapB.bidAmount;
    const trumpMatch = snapA.trumpSuit === snapB.trumpSuit && snapA.direction === snapB.direction;
    const discardMatch = snapA.discards === snapB.discards;
    const trickMatch = snapA.tricks === snapB.tricks;

    if (bidMatch) report.identicalBid++;
    if (trumpMatch) report.identicalTrump++;
    if (discardMatch) report.identicalDiscards++;
    if (trickMatch) report.identicalTricks++;
    if (bidMatch && trumpMatch && discardMatch && trickMatch) report.identicalAll++;

    if (!bidMatch && report.firstMismatches.length < 3) {
      report.firstMismatches.push({
        deckUrl,
        field: 'bid',
        a: `declarer=${snapA.declarer} amount=${snapA.bidAmount}`,
        b: `declarer=${snapB.declarer} amount=${snapB.bidAmount}`,
      });
    }
  }

  return report;
}

// ── Head-to-head via BatchRunner ─────────────────────────────────────────

async function runHeadToHead(
  nameA: string,
  textA: string,
  nameB: string,
  textB: string,
  pool: string[],
  numHands: number,
): Promise<{ winsA: number; winsB: number; games: number }> {
  const runner = new BatchRunner();
  const result = await runner.runComparison({
    strategies: [
      { name: nameA, strategyText: textA },
      { name: nameB, strategyText: textB },
    ],
    // round-robin runs every ordered pair, populating the per-strategy
    // win/game counters we report on. by-team mode leaves them empty.
    assignmentMode: 'round-robin',
    numHands,
    predefinedDeckUrls: pool,
  });
  const sw = result.summary.strategyWins ?? [0, 0];
  const sg = result.summary.strategyGames ?? [0, 0];
  return { winsA: sw[0] ?? 0, winsB: sw[1] ?? 0, games: sg[0] ?? 0 };
}

function fmt(n: number, d = 3): string { return n.toFixed(d); }

function printDecisionReport(report: DecisionParityReport): void {
  const total = report.decks - report.bothRedeal;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  realLog(`  decision parity over ${total} non-redeal decks:`);
  realLog(`    bid match:      ${report.identicalBid.toString().padStart(5)}/${total}  (${fmt(pct(report.identicalBid), 2)}%)`);
  realLog(`    trump match:    ${report.identicalTrump.toString().padStart(5)}/${total}  (${fmt(pct(report.identicalTrump), 2)}%)`);
  realLog(`    discard match:  ${report.identicalDiscards.toString().padStart(5)}/${total}  (${fmt(pct(report.identicalDiscards), 2)}%)`);
  realLog(`    trick match:    ${report.identicalTricks.toString().padStart(5)}/${total}  (${fmt(pct(report.identicalTricks), 2)}%)`);
  realLog(`    ALL match:      ${report.identicalAll.toString().padStart(5)}/${total}  (${fmt(pct(report.identicalAll), 2)}%)`);
  if (report.oneRedeal > 0) realLog(`    (asymmetric redeal on ${report.oneRedeal} decks)`);
  if (report.firstMismatches.length > 0) {
    realLog(`    first mismatches:`);
    for (const m of report.firstMismatches) {
      realLog(`      [${m.field}] ${m.deckUrl}: A=${m.a} B=${m.b}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  realLog('── Strategy parity ─────────────────────────────────────');
  realLog(`deck pool size=${args.pool}  head-to-head hands=${args.hands}  seed=${args.seed}`);
  realLog('');

  const pool = generateDeckPool(args.pool, args.seed);

  for (const [nameA, nameB] of args.pairs) {
    realLog(`── ${nameA}  vs  ${nameB} ──`);
    let resolvedA, resolvedB;
    try {
      resolvedA = resolveStrategy(nameA);
      resolvedB = resolveStrategy(nameB);
    } catch (e) {
      realLog(`  SKIP: ${(e as Error).message}`);
      realLog('');
      continue;
    }

    const dReport = comparePolicies(resolvedA.ast, resolvedB.ast, pool);
    printDecisionReport(dReport);

    const h2h = await runHeadToHead(
      resolvedA.name, resolvedA.text,
      resolvedB.name, resolvedB.text,
      pool, args.hands,
    );
    const winRateA = h2h.games > 0 ? h2h.winsA / h2h.games : 0;
    // Simple 95% CI using normal approximation: ±1.96*sqrt(p(1-p)/N).
    const se = h2h.games > 0 ? Math.sqrt(winRateA * (1 - winRateA) / h2h.games) : 0;
    const ci = 1.96 * se;
    realLog(
      `  head-to-head: ${nameA} ${h2h.winsA}W - ${h2h.winsB}L of ${h2h.games}  ` +
      `winRate=${fmt(winRateA)}  95% CI ±${fmt(ci, 3)}`,
    );
    const within = Math.abs(winRateA - 0.5) <= ci;
    realLog(`    ${within ? '✓' : '✗'} ${within ? 'within' : 'outside'} statistical tolerance of 0.5`);
    realLog('');
  }
}

main().catch(err => {
  console.error('Parity run failed:', err);
  process.exit(1);
});
