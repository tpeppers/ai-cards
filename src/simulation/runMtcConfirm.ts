/**
 * Third-seed confirmation for ClaudeFam (Roles+MTC): one matchup vs
 * ClaudeFam (Roles) on a fresh deck pool (default seed 555555, independent
 * of the sweep's training seed 73313 and holdout seed 999999).
 * Console output only — no JSON is written.
 *
 * Usage: node scripts/mtc-confirm.js
 *        REPORT_HANDS=40000 node scripts/mtc-confirm.js
 */

import { BatchRunner } from './BatchRunner.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { BIDWHIST_CLAUDEFAM_ROLES, BIDWHIST_CLAUDEFAM_ROLES_MTC } from '../strategies/claudeFamRoles.ts';

setStrategyDebug(false);
const NOISE = ['[Strategy]', 'Bid Whist dealing deck', 'Trick ended, winner'];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? (args[0] as string) : '';
  for (const p of NOISE) if (first.startsWith(p)) return;
  realLog(...args);
};

const HANDS = Number(process.env.REPORT_HANDS ?? 20000);
const POOL = Number(process.env.REPORT_POOL ?? 3000);
const SEED = Number(process.env.REPORT_SEED ?? 555555);

async function main(): Promise<void> {
  realLog('── ClaudeFam (Roles+MTC) third-seed confirmation ──');
  realLog(`N = ${HANDS.toLocaleString()} games, pool seed ${SEED}`);
  realLog('');

  const pool = generateDeckPool(POOL, SEED);
  parseStrategy(BIDWHIST_CLAUDEFAM_ROLES_MTC);
  parseStrategy(BIDWHIST_CLAUDEFAM_ROLES);

  const t0 = Date.now();
  const runner = new BatchRunner();
  const result = await runner.runComparison({
    strategies: [
      { name: 'ClaudeFam (Roles+MTC)', strategyText: BIDWHIST_CLAUDEFAM_ROLES_MTC },
      { name: 'ClaudeFam (Roles)', strategyText: BIDWHIST_CLAUDEFAM_ROLES },
    ],
    assignmentMode: 'round-robin',
    numHands: HANDS,
    predefinedDeckUrls: pool,
  });
  const sw = result.summary.strategyWins ?? [0, 0];
  const sg = result.summary.strategyGames ?? [0, 0];
  const wins = sw[0] ?? 0;
  const losses = sw[1] ?? 0;
  const games = sg[0] ?? (wins + losses);
  const winRate = games > 0 ? wins / games : 0;
  const se = games > 0 ? Math.sqrt(winRate * (1 - winRate) / games) : 0;
  const ci95 = 1.96 * se;
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const verdict = (winRate - ci95) > 0.5 ? 'BEATS' : (winRate + ci95) < 0.5 ? 'LOSES' : 'tied';
  realLog(`  [${dt}s] ClaudeFam (Roles+MTC) vs ClaudeFam (Roles)    ` +
    `${wins}W-${losses}L/${games}  ${(winRate * 100).toFixed(2)}% ±${(ci95 * 100).toFixed(2)}%  ${verdict}`);
}

main().catch(err => {
  console.error('MTC confirmation failed:', err);
  process.exit(1);
});
