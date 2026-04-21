/**
 * Diagnostic: when does hand_power signaling actually win tricks?
 *
 * The sweep showed Family (Powered, sig=9) loses to Family by ~5pp.
 * The uncomfortable question is whether this comes from Q/J-heavy hands
 * being bad signals — or whether Q/J hands do make their contracts and
 * something else explains the gap.
 *
 * For N decks, simulate Family-Powered (sig=9) occupying all four
 * seats, then tabulate the outcome by the DECLARER's hand composition:
 *   - KA≥3  : declarer has 3+ kings/aces (Family would also signal)
 *   - QJonly: hand_power(uptown)≥9 but king_ace_count<3 (Powered-only)
 *   - mixed : other combinations
 * Reports contract-make rate, average books, and total count per class.
 * If QJonly makes contracts at roughly the same rate as KA≥3, the user's
 * "Q/J become stoppers as A/K are pulled" intuition is right and the
 * sweep gap comes from elsewhere.
 */

import { BidWhistSimulator } from './BidWhistSimulator.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { generateFamilyPoweredTuned } from '../strategies/familyPoweredTuned.ts';
import { BIDWHIST_FAMILY } from '../strategies/index.ts';
import { extractPlayerHand } from './handStrength.ts';
import { Card } from '../types/CardGame.ts';

setStrategyDebug(false);
const NOISE_PREFIXES = ['[Strategy]', 'Bid Whist dealing deck', 'Trick ended, winner'];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? (args[0] as string) : '';
  for (const p of NOISE_PREFIXES) if (first.startsWith(p)) return;
  realLog(...args);
};

interface Args {
  decks: number;
  seed: number;
  sig: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { decks: 5000, seed: 7777, sig: 9 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--decks': out.decks = parseInt(next, 10); i++; break;
      case '--seed':  out.seed  = parseInt(next, 10); i++; break;
      case '--sig':   out.sig   = parseInt(next, 10); i++; break;
    }
  }
  return out;
}

// ── Hand classification helpers ──────────────────────────────────────────

function kingAceCount(hand: Card[]): number {
  return hand.filter(c => c.rank === 1 || c.rank === 13).length;
}

function queenJackCount(hand: Card[]): number {
  return hand.filter(c => c.rank === 11 || c.rank === 12).length;
}

function twoThreeFourCount(hand: Card[]): number {
  return hand.filter(c => c.rank === 2 || c.rank === 3 || c.rank === 4).length;
}

function handPowerUptown(hand: Card[]): number {
  const w: Record<number, number> = { 1: 4, 13: 3, 12: 2, 11: 1 };
  return hand.reduce((s, c) => s + (w[c.rank] ?? 0), 0);
}

function handPowerDowntown(hand: Card[]): number {
  const w: Record<number, number> = { 1: 4, 2: 3, 3: 2, 4: 1 };
  return hand.reduce((s, c) => s + (w[c.rank] ?? 0), 0);
}

function maxSuitCount(hand: Card[]): number {
  const counts: Record<string, number> = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  hand.forEach(c => { counts[c.suit]++; });
  return Math.max(...Object.values(counts));
}

// ── Accumulator ─────────────────────────────────────────────────────────

interface Bucket {
  decks: number;
  contractsMade: number;
  contractsFailed: number;
  bookSum: number;
  contractSum: number;
  bidSum: number;
  deficitSum: number; // negative = overtricks
  trumpLenSum: number;
}

function newBucket(): Bucket {
  return {
    decks: 0, contractsMade: 0, contractsFailed: 0,
    bookSum: 0, contractSum: 0, bidSum: 0,
    deficitSum: 0, trumpLenSum: 0,
  };
}

function recordBucket(
  b: Bucket,
  booksTaken: number,
  contract: number,
  bid: number,
  deficit: number,
  trumpLen: number,
): void {
  b.decks++;
  if (booksTaken >= contract) b.contractsMade++; else b.contractsFailed++;
  b.bookSum += booksTaken;
  b.contractSum += contract;
  b.bidSum += bid;
  b.deficitSum += deficit;
  b.trumpLenSum += trumpLen;
}

function fmt(n: number, d = 2): string { return n.toFixed(d); }

function printBucket(label: string, b: Bucket): void {
  if (b.decks === 0) { realLog(`  ${label.padEnd(28)}  (no samples)`); return; }
  const makePct = (b.contractsMade / b.decks) * 100;
  const avgBooks = b.bookSum / b.decks;
  const avgContract = b.contractSum / b.decks;
  const avgBid = b.bidSum / b.decks;
  const avgDeficit = b.deficitSum / b.decks;
  const avgTrumpLen = b.trumpLenSum / b.decks;
  realLog(
    `  ${label.padEnd(28)}  n=${String(b.decks).padStart(5)}  ` +
    `make=${fmt(makePct, 1).padStart(5)}%  ` +
    `bid=${fmt(avgBid, 2)}  ` +
    `books=${fmt(avgBooks, 2)} / contract=${fmt(avgContract, 2)}  ` +
    `avg_margin=${fmt(-avgDeficit, 2)}  ` +
    `trump_len=${fmt(avgTrumpLen, 2)}`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const powered = parseStrategy(generateFamilyPoweredTuned({
    sigThreshold: args.sig,
    trustBonus: 3,
    oppPassThreshold: 99,
    dealerLongSuit: 5,
  }));
  const family = parseStrategy(BIDWHIST_FAMILY);

  realLog('── hand_power stopper diagnostic ──────────────────────');
  realLog(`decks=${args.decks} seed=${args.seed} signal threshold=${args.sig}`);
  realLog('Both strategies play all 4 seats; we compare what happens when a');
  realLog('Q/J-only hand becomes declarer vs when a K/A-rich hand does.');
  realLog('');

  // Buckets for Family (Powered)
  const poweredUptownKA = newBucket();
  const poweredUptownQJ = newBucket();
  const poweredUptownMixed = newBucket();
  // Same buckets for Family (baseline reference)
  const familyUptownKA = newBucket();
  const familyUptownQJ = newBucket();
  const familyUptownMixed = newBucket();

  // Also: overall summary across all declarers, by strategy
  const poweredAll = newBucket();
  const familyAll = newBucket();

  const pool = generateDeckPool(args.decks, args.seed);

  for (const deckUrl of pool) {
    // Simulate once with each strategy as all 4.
    const detailP = BidWhistSimulator.simulateDetailedHand(
      deckUrl, [powered, powered, powered, powered], 0);
    const detailF = BidWhistSimulator.simulateDetailedHand(
      deckUrl, [family, family, family, family], 0);

    const classify = (
      detail: ReturnType<typeof BidWhistSimulator.simulateDetailedHand>,
      uptownKA: Bucket, uptownQJ: Bucket, uptownMixed: Bucket, allBucket: Bucket,
    ) => {
      if (!detail) return;
      const declHand = extractPlayerHand(deckUrl, detail.declarer);
      const kac = kingAceCount(declHand);
      const qjc = queenJackCount(declHand);
      const hpUp = handPowerUptown(declHand);
      const declTeam = detail.declarer % 2;
      const booksTaken = detail.booksWon[declTeam] + 1; // +1 for kitty
      const trumpLen = declHand.filter(c => c.suit === detail.trumpSuit).length;
      recordBucket(allBucket, booksTaken, detail.contract, detail.bidAmount, detail.deficit, trumpLen);

      if (detail.direction !== 'uptown') return;

      if (kac >= 3) {
        recordBucket(uptownKA, booksTaken, detail.contract, detail.bidAmount, detail.deficit, trumpLen);
      } else if (hpUp >= args.sig && qjc >= 3) {
        // Powered-only signal class: enough uptown power from Q/J, but
        // fewer than 3 K/A
        recordBucket(uptownQJ, booksTaken, detail.contract, detail.bidAmount, detail.deficit, trumpLen);
      } else {
        recordBucket(uptownMixed, booksTaken, detail.contract, detail.bidAmount, detail.deficit, trumpLen);
      }
    };

    classify(detailP, poweredUptownKA, poweredUptownQJ, poweredUptownMixed, poweredAll);
    classify(detailF, familyUptownKA, familyUptownQJ, familyUptownMixed, familyAll);
  }

  realLog('── Family (Powered, sig=' + args.sig + ') ─ declarer hand class × uptown declarations ──');
  printBucket('KA≥3 declarer (strong)',   poweredUptownKA);
  printBucket('Q/J-heavy declarer',        poweredUptownQJ);
  printBucket('other uptown declarer',     poweredUptownMixed);
  realLog('');
  realLog('── Family (baseline) ─ declarer hand class × uptown declarations ──');
  printBucket('KA≥3 declarer (strong)',   familyUptownKA);
  printBucket('Q/J-heavy declarer',        familyUptownQJ);
  printBucket('other uptown declarer',     familyUptownMixed);
  realLog('');
  realLog('── Overall declarer stats (all directions) ──');
  printBucket('Family (Powered) all',      poweredAll);
  printBucket('Family         all',        familyAll);
  realLog('');

  // Interpretation hint.
  const pKA = poweredUptownKA.decks > 0 ? poweredUptownKA.contractsMade / poweredUptownKA.decks : 0;
  const pQJ = poweredUptownQJ.decks > 0 ? poweredUptownQJ.contractsMade / poweredUptownQJ.decks : 0;
  if (poweredUptownQJ.decks < 30) {
    realLog('NOTE: Q/J-heavy declarer sample is thin — increase --decks for tighter signal.');
  } else {
    const gap = (pKA - pQJ) * 100;
    if (Math.abs(gap) < 3) {
      realLog(`→ Q/J-heavy declarers make contracts at ~the same rate as KA≥3 (${fmt(gap, 1)}pp gap).`);
      realLog(`  The user's intuition is supported: Q/J hands do become stoppers in play.`);
    } else if (gap > 0) {
      realLog(`→ Q/J-heavy declarers make contracts ${fmt(gap, 1)}pp LESS often than KA≥3.`);
      realLog(`  Possible reasons: Q/J stoppers are contingent on A/K being drawn out (not guaranteed)`);
      realLog(`  or the bid amount implied by the signal over-commits a Q/J-only hand.`);
    } else {
      realLog(`→ Q/J-heavy declarers make contracts ${fmt(-gap, 1)}pp MORE often than KA≥3 — surprising!`);
      realLog(`  Worth looking at why: maybe Q/J hands are paired with long suits.`);
    }
  }
}

main().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
