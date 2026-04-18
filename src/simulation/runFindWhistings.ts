/**
 * CLI entry point to find deck URLs where one team takes all 13 books (whisting).
 * Bundled and executed by scripts/find-whistings.js.
 *
 * Usage (through the driver):
 *   node scripts/find-whistings.js [--n 3] [--tries 20000] [--seed 1] [--out hands.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import { BidWhistSimulator } from './BidWhistSimulator.ts';
import { generateRandomDeckUrl } from '../urlGameState.js';
import { BIDWHIST_FAMILY } from '../strategies/index.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';

setStrategyDebug(false);
const NOISE_PREFIXES = [
  '[Strategy]',
  'Bid Whist dealing deck',
  'Trick ended, winner',
  'Dupe card throw',
  'Not 52 unique card throw',
];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? (args[0] as string) : '';
  for (const p of NOISE_PREFIXES) if (first.startsWith(p)) return;
  realLog(...args);
};

interface Args {
  n: number;
  tries: number;
  seed: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    n: 3,
    tries: 20000,
    seed: 1,
    out: path.join(process.cwd(), 'whisting-hands.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--n':     out.n = parseInt(next, 10); i++; break;
      case '--tries': out.tries = parseInt(next, 10); i++; break;
      case '--seed':  out.seed = parseInt(next, 10); i++; break;
      case '--out':   out.out = next; i++; break;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const family = parseStrategy(BIDWHIST_FAMILY);
  const strategies = [family, family, family, family];

  const found: Array<{
    deckUrl: string;
    declarer: number;
    declarerTeam: number;
    bidAmount: number;
    trumpSuit: string;
    direction: string;
    booksWon: [number, number];
    contract: number;
    tricksPlayed: number;
  }> = [];

  let attempts = 0;
  let redeals = 0;
  const seenHandSignatures = new Set<string>();

  while (found.length < args.n && attempts < args.tries) {
    attempts++;
    const deckUrl = generateRandomDeckUrl();
    try {
      const detail = BidWhistSimulator.simulateDetailedHand(deckUrl, strategies, 0);
      if (!detail) { redeals++; continue; }
      const declarerTeam = detail.declarer % 2;
      const declarerBooks = detail.booksWon[declarerTeam] + 1; // kitty counts
      if (declarerBooks === 13) {
        // Want "interesting": a hand where the bidder sweeps all tricks.
        // Dedup by the full URL (shouldn't collide on random gen).
        if (!seenHandSignatures.has(deckUrl)) {
          seenHandSignatures.add(deckUrl);
          found.push({
            deckUrl,
            declarer: detail.declarer,
            declarerTeam,
            bidAmount: detail.bidAmount,
            trumpSuit: detail.trumpSuit,
            direction: detail.direction,
            booksWon: detail.booksWon,
            contract: detail.contract,
            tricksPlayed: detail.tricks.length,
          });
          realLog(
            `[${found.length}/${args.n}] whisting @ attempt ${attempts}: ` +
              `declarer=${detail.declarer} bid=${detail.bidAmount} ` +
              `trump=${detail.trumpSuit} dir=${detail.direction} url=${deckUrl}`
          );
        }
      }
    } catch (_e) {
      // skip invalid
    }
  }

  realLog(
    `\nDone. found=${found.length}/${args.n} after attempts=${attempts} (redeals=${redeals})`
  );

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ args, found }, null, 2));
  realLog(`Wrote ${outPath}`);
}

main();
