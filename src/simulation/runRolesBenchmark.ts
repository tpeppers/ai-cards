/**
 * Benchmark the suit-role primitives: ClaudeFam (Roles) variants vs
 * ClaudeFam and Family.
 *
 * Variants are cumulative toggles so each role-aware substitution's
 * contribution is isolated:
 *   parity   — all toggles OFF (must play identically to ClaudeFam; any
 *              deviation from exactly 50.00% vs ClaudeFam means the
 *              template drifted and the whole run is invalid)
 *   discard  — role-aware discard only (keep working / drop spare)
 *   sluff    — + spare-first void sluffing
 *   full     — + spare-first throwaway leads
 *
 * Usage: node scripts/roles-benchmark.js
 *        REPORT_HANDS=40000 node scripts/roles-benchmark.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { BatchRunner } from './BatchRunner.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { BIDWHIST_CLAUDEFAM, BIDWHIST_FAMILY } from '../strategies/index.ts';
import { buildRolesVariant } from '../strategies/claudeFamRoles.ts';

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
const SEED = Number(process.env.REPORT_SEED ?? 73313);
const OUT = path.resolve(process.cwd(), 'report');

const VARIANTS = [
  { key: 'parity', text: buildRolesVariant('Roles Parity', { rolesDiscard: false, rolesSluff: false, rolesLead: false }) },
  { key: 'discard', text: buildRolesVariant('Roles Discard', { rolesDiscard: true, rolesSluff: false, rolesLead: false }) },
  { key: 'sluff', text: buildRolesVariant('Roles Sluff', { rolesDiscard: true, rolesSluff: true, rolesLead: false }) },
  { key: 'full', text: buildRolesVariant('Roles Full', { rolesDiscard: true, rolesSluff: true, rolesLead: true }) },
];

const OPPONENTS = [
  { name: 'ClaudeFam', text: BIDWHIST_CLAUDEFAM },
  { name: 'Family', text: BIDWHIST_FAMILY },
];

interface MatchupResult {
  variant: string;
  opponent: string;
  wins: number;
  losses: number;
  games: number;
  winRate: number;
  ci95: number;
}

async function runMatchup(variantKey: string, variantText: string,
                          opp: { name: string; text: string }, pool: string[]): Promise<MatchupResult> {
  parseStrategy(variantText);
  parseStrategy(opp.text);
  const runner = new BatchRunner();
  const result = await runner.runComparison({
    strategies: [
      { name: `roles-${variantKey}`, strategyText: variantText },
      { name: opp.name, strategyText: opp.text },
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
  return { variant: variantKey, opponent: opp.name, wins, losses, games, winRate, ci95: 1.96 * se };
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  realLog('── Suit-role primitives benchmark ──');
  realLog(`N = ${HANDS.toLocaleString()} games per matchup, pool seed ${SEED}`);
  realLog('');

  const pool = generateDeckPool(POOL, SEED);
  const results: MatchupResult[] = [];

  for (const variant of VARIANTS) {
    // The parity variant only needs the ClaudeFam matchup (it IS ClaudeFam).
    const opponents = variant.key === 'parity' ? [OPPONENTS[0]] : OPPONENTS;
    for (const opp of opponents) {
      const t0 = Date.now();
      const r = await runMatchup(variant.key, variant.text, opp, pool);
      results.push(r);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const verdict = (r.winRate - r.ci95) > 0.5 ? 'BEATS' : (r.winRate + r.ci95) < 0.5 ? 'LOSES' : 'tied';
      realLog(`  [${dt}s] roles-${variant.key.padEnd(8)} vs ${opp.name.padEnd(10)} ` +
        `${r.wins}W-${r.losses}L/${r.games}  ${(r.winRate * 100).toFixed(2)}% ±${(r.ci95 * 100).toFixed(2)}%  ${verdict}`);
    }
  }

  fs.writeFileSync(path.join(OUT, 'roles-benchmark.json'), JSON.stringify({
    meta: { hands: HANDS, pool: POOL, seed: SEED },
    results,
  }, null, 2));
  realLog('');
  realLog(`Wrote ${path.join(OUT, 'roles-benchmark.json')}`);
}

main().catch(err => {
  console.error('Roles benchmark failed:', err);
  process.exit(1);
});
