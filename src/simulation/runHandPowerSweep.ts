/**
 * Sweep hand_power signal thresholds + receiver trust against baseline
 * Family. Bundled and executed by scripts/sweep-hand-power.js.
 *
 * Writes a table sorted by win rate with 95% CIs so we can see whether
 * any (sig, trust, opp_pass) combination beats Family by more than
 * noise. Optionally rescans the best candidates on a fresh holdout deck
 * pool to guard against search-overfit.
 */

import { BatchRunner } from './BatchRunner.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import {
  generateFamilyPoweredTuned,
  FamilyPoweredParams,
} from '../strategies/familyPoweredTuned.ts';
import { BIDWHIST_FAMILY } from '../strategies/index.ts';

setStrategyDebug(false);
const NOISE_PREFIXES = ['[Strategy]', 'Bid Whist dealing deck', 'Trick ended, winner'];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? (args[0] as string) : '';
  for (const p of NOISE_PREFIXES) if (first.startsWith(p)) return;
  realLog(...args);
};

interface Args {
  hands: number;        // hands per config (training eval)
  holdoutHands: number; // hands for holdout confirm on top-K
  pool: number;         // training deck-pool size
  holdoutPool: number;  // holdout deck-pool size
  seed: number;
  holdoutSeed: number;
  topK: number;         // number of top configs to re-eval on holdout
  sigs: number[];
  trusts: number[];
  oppPasses: number[];
  minStoppers: number[];
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    hands: 400,
    holdoutHands: 2000,
    pool: 200,
    holdoutPool: 500,
    seed: 424242,
    holdoutSeed: 999999,
    topK: 5,
    sigs: [7, 9, 11, 13],
    trusts: [3, 5, 7],
    oppPasses: [99, 9, 11],
    minStoppers: [0],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    const parseList = (s: string): number[] => s.split(',').map(x => parseInt(x.trim(), 10)).filter(x => !Number.isNaN(x));
    switch (a) {
      case '--hands':         out.hands = parseInt(next, 10); i++; break;
      case '--holdout-hands': out.holdoutHands = parseInt(next, 10); i++; break;
      case '--pool':          out.pool = parseInt(next, 10); i++; break;
      case '--holdout-pool':  out.holdoutPool = parseInt(next, 10); i++; break;
      case '--seed':          out.seed = parseInt(next, 10); i++; break;
      case '--holdout-seed':  out.holdoutSeed = parseInt(next, 10); i++; break;
      case '--top':           out.topK = parseInt(next, 10); i++; break;
      case '--sigs':          out.sigs = parseList(next); i++; break;
      case '--trusts':        out.trusts = parseList(next); i++; break;
      case '--opp':           out.oppPasses = parseList(next); i++; break;
      case '--min-stoppers':  out.minStoppers = parseList(next); i++; break;
    }
  }
  return out;
}

interface EvalResult {
  params: FamilyPoweredParams;
  wins: number;
  losses: number;
  games: number;
  winRate: number;
  ci95: number;
}

async function evalVsFamily(
  params: FamilyPoweredParams,
  pool: string[],
  hands: number,
): Promise<EvalResult> {
  const text = generateFamilyPoweredTuned(params);
  // sanity: must parse
  parseStrategy(text);

  const runner = new BatchRunner();
  const result = await runner.runComparison({
    strategies: [
      { name: 'tuned', strategyText: text },
      { name: 'Family', strategyText: BIDWHIST_FAMILY },
    ],
    assignmentMode: 'round-robin',
    numHands: hands,
    predefinedDeckUrls: pool,
  });
  const sw = result.summary.strategyWins ?? [0, 0];
  const sg = result.summary.strategyGames ?? [0, 0];
  const wins = sw[0] ?? 0;
  const losses = sw[1] ?? 0;
  const games = sg[0] ?? (wins + losses);
  const winRate = games > 0 ? wins / games : 0;
  const se = games > 0 ? Math.sqrt(winRate * (1 - winRate) / games) : 0;
  return { params, wins, losses, games, winRate, ci95: 1.96 * se };
}

function fmt(n: number, d = 3): string { return n.toFixed(d); }

function formatRow(r: EvalResult): string {
  const p = r.params;
  const flag = r.winRate - r.ci95 > 0.5 ? '  ✓' : r.winRate + r.ci95 < 0.5 ? '  ✗' : '  ~';
  const stop = p.minStoppers ?? 0;
  return (
    `sig=${String(p.sigThreshold).padStart(2)} ` +
    `trust=${String(p.trustBonus).padStart(2)} ` +
    `opp=${String(p.oppPassThreshold).padStart(3)} ` +
    `stop=${String(stop).padStart(1)} ` +
    `→ ${r.wins.toString().padStart(4)}W-${r.losses.toString().padStart(4)}L/${r.games.toString().padStart(4)}  ` +
    `winRate=${fmt(r.winRate)} ±${fmt(r.ci95, 3)}${flag}`
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const configs: FamilyPoweredParams[] = [];
  for (const sig of args.sigs) {
    for (const trust of args.trusts) {
      for (const opp of args.oppPasses) {
        for (const minStop of args.minStoppers) {
          configs.push({
            sigThreshold: sig,
            trustBonus: trust,
            oppPassThreshold: opp,
            dealerLongSuit: 5,
            minStoppers: minStop,
          });
        }
      }
    }
  }

  realLog('── hand_power sweep ────────────────────────────────────');
  realLog(`configs=${configs.length}  hands/config=${args.hands}  pool=${args.pool}  seed=${args.seed}`);
  realLog(`grid: sigs=[${args.sigs.join(',')}] trusts=[${args.trusts.join(',')}] opp=[${args.oppPasses.join(',')}] stop=[${args.minStoppers.join(',')}]`);
  realLog(`legend: ✓ = CI clear of 0.5 (beats Family), ✗ = worse, ~ = tied/noisy`);
  realLog('');

  const pool = generateDeckPool(args.pool, args.seed);

  const trainStart = Date.now();
  const results: EvalResult[] = [];
  for (let i = 0; i < configs.length; i++) {
    const t0 = Date.now();
    const r = await evalVsFamily(configs[i], pool, args.hands);
    results.push(r);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    realLog(`[${String(i + 1).padStart(2)}/${configs.length}] ${formatRow(r)}  t=${dt}s`);
  }
  realLog(`\ntraining sweep took ${((Date.now() - trainStart) / 1000).toFixed(1)}s`);

  // Sort by win rate descending
  results.sort((a, b) => b.winRate - a.winRate);

  realLog('\n── Ranked (training eval) ─────────────────────────────');
  for (const r of results) {
    realLog(formatRow(r));
  }

  // Holdout re-eval on top K — training-set noise lets bad configs look
  // lucky at small N; a fresh deck pool with more hands tightens the CI
  // on the candidates that actually matter.
  const topConfigs = results.slice(0, Math.min(args.topK, results.length));
  if (topConfigs.length === 0 || args.holdoutHands <= 0) return;

  realLog('\n── Holdout confirmation on top ${topConfigs.length} ─────────────────');
  realLog(`fresh pool: size=${args.holdoutPool} seed=${args.holdoutSeed} hands/config=${args.holdoutHands}`);
  const holdoutPool = generateDeckPool(args.holdoutPool, args.holdoutSeed);
  const holdoutResults: EvalResult[] = [];
  for (let i = 0; i < topConfigs.length; i++) {
    const t0 = Date.now();
    const r = await evalVsFamily(topConfigs[i].params, holdoutPool, args.holdoutHands);
    holdoutResults.push(r);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    realLog(`[${String(i + 1).padStart(2)}/${topConfigs.length}] ${formatRow(r)}  t=${dt}s`);
  }

  holdoutResults.sort((a, b) => b.winRate - a.winRate);
  realLog('\n── Ranked (holdout) ──────────────────────────────────');
  for (const r of holdoutResults) {
    realLog(formatRow(r));
  }

  const best = holdoutResults[0];
  realLog('\n── Best ──────────────────────────────────────────────');
  realLog(`  sig=${best.params.sigThreshold}  trust=${best.params.trustBonus}  opp=${best.params.oppPassThreshold}`);
  realLog(`  holdout: ${best.wins}W-${best.losses}L of ${best.games}  winRate=${fmt(best.winRate)} ±${fmt(best.ci95, 3)}`);
  const lowerBound = best.winRate - best.ci95;
  if (lowerBound > 0.5) {
    realLog(`  → beats Family by at least ${fmt((lowerBound - 0.5) * 100, 2)}pp with 95% confidence`);
  } else if (best.winRate > 0.5) {
    realLog(`  → trends higher than Family but not statistically separable`);
  } else {
    realLog(`  → did NOT beat Family`);
  }
}

main().catch(err => {
  console.error('Sweep failed:', err);
  process.exit(1);
});
