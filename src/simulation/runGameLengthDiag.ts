/**
 * Quick diagnostic: how many hands do simulated games actually take
 * under the current first-to-21-with-mercy rules? Confirms that the
 * MAX_HANDS=100 safety cap is never the deciding factor.
 */
import { BidWhistSimulator } from './BidWhistSimulator.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { BIDWHIST_FAMILY, BIDWHIST_CLAUDEFAM } from '../strategies/index.ts';

setStrategyDebug(false);
const NOISE = ['[Strategy]', 'Bid Whist dealing deck', 'Trick ended, winner'];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? (args[0] as string) : '';
  for (const p of NOISE) if (first.startsWith(p)) return;
  realLog(...args);
};

async function main(): Promise<void> {
  const pool = generateDeckPool(500, 12345);
  const family = parseStrategy(BIDWHIST_FAMILY);
  const claudeFam = parseStrategy(BIDWHIST_CLAUDEFAM);

  const sim = new BidWhistSimulator();
  const lengths: number[] = [];
  const endReasons: Record<string, number> = { whisting: 0, mercy: 0, twentyone: 0, cap: 0 };
  let gamesRun = 0;

  for (let i = 0; i < pool.length; i++) {
    // Play both ways for fairness (ClaudeFam as team0, Family as team1, and reverse)
    for (const [t0, t1] of [[claudeFam, family], [family, claudeFam]]) {
      const result = sim.simulateGame(pool[i], [t0, t1, t0, t1], pool.slice(i, i + 20), 0, 0);
      lengths.push(result.handsPlayed);
      gamesRun++;

      // Classify end reason
      const scores = result.teamScores;
      if (result.hands.some(h => h.booksWon[0] + h.booksWon[1] === 12 && (h.booksWon[0] === 12 || h.booksWon[1] === 12))) {
        endReasons.whisting++;
      } else if ((scores[0] >= 11 && scores[1] === 0) || (scores[1] >= 11 && scores[0] === 0)) {
        endReasons.mercy++;
      } else if (scores[0] >= 21 || scores[1] >= 21) {
        endReasons.twentyone++;
      } else {
        endReasons.cap++;
      }
    }
  }

  // Histogram
  const max = Math.max(...lengths);
  const min = Math.min(...lengths);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const median = [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)];

  realLog(`Games simulated: ${gamesRun}`);
  realLog(`handsPlayed: min=${min}, median=${median}, avg=${avg.toFixed(2)}, max=${max}`);
  realLog(``);
  realLog(`End reasons:`);
  for (const [k, v] of Object.entries(endReasons)) {
    realLog(`  ${k.padEnd(10)} ${v.toString().padStart(5)} (${((v / gamesRun) * 100).toFixed(1)}%)`);
  }
  realLog(``);

  // Hands-per-game histogram
  const bins: Record<string, number> = {};
  for (const n of lengths) {
    const bucket = n <= 2 ? '1-2' : n <= 4 ? '3-4' : n <= 6 ? '5-6' : n <= 8 ? '7-8' : n <= 10 ? '9-10' : n <= 15 ? '11-15' : n <= 25 ? '16-25' : '26+';
    bins[bucket] = (bins[bucket] ?? 0) + 1;
  }
  realLog(`Hands-per-game distribution:`);
  for (const k of ['1-2', '3-4', '5-6', '7-8', '9-10', '11-15', '16-25', '26+']) {
    const n = bins[k] ?? 0;
    const bar = '█'.repeat(Math.round(n / gamesRun * 60));
    realLog(`  ${k.padEnd(7)} ${n.toString().padStart(5)} ${bar}`);
  }

  if (max >= 100) realLog(`\n⚠ WARNING: at least one game hit the MAX_HANDS=100 cap`);
  else realLog(`\n✓ MAX_HANDS cap (100) never hit; max observed = ${max}`);
}

main().catch(err => { console.error(err); process.exit(1); });
