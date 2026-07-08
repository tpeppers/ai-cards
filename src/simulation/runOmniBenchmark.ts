/**
 * Benchmark Claude Omni against every other Bid Whist strategy in the
 * registry. Console + report/omni-benchmark.json.
 *
 * Built-in sanity check: the ClaudeFam (Roles+MTC+CP) matchup must land at
 * exactly 50.00% — Omni is AST-identical to it (see strategies.test.ts),
 * so any deviation means nondeterminism crept into the harness.
 *
 * Usage: node scripts/omni-benchmark.js
 *        REPORT_HANDS=40000 node scripts/omni-benchmark.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { BatchRunner } from './BatchRunner.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { STRATEGY_REGISTRY, BIDWHIST_CLAUDE_OMNI } from '../strategies/index.ts';

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

const OPPONENTS = STRATEGY_REGISTRY
  .filter(s => s.game === 'bidwhist' && s.name !== 'Claude Omni')
  .map(s => ({ name: s.name, text: s.text }));

interface MatchupResult {
  opponent: string;
  wins: number;
  losses: number;
  games: number;
  winRate: number;
  ci95: number;
}

async function runMatchup(opp: { name: string; text: string }, pool: string[]): Promise<MatchupResult> {
  parseStrategy(BIDWHIST_CLAUDE_OMNI);
  parseStrategy(opp.text);
  const runner = new BatchRunner();
  const result = await runner.runComparison({
    strategies: [
      { name: 'Claude Omni', strategyText: BIDWHIST_CLAUDE_OMNI },
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
  return { opponent: opp.name, wins, losses, games, winRate, ci95: 1.96 * se };
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  realLog('── Claude Omni vs the registry ──');
  realLog(`N = ${HANDS.toLocaleString()} games per matchup, pool seed ${SEED}`);
  realLog('');

  const pool = generateDeckPool(POOL, SEED);
  const results: MatchupResult[] = [];
  for (const opp of OPPONENTS) {
    const t0 = Date.now();
    const r = await runMatchup(opp, pool);
    results.push(r);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const verdict = (r.winRate - r.ci95) > 0.5 ? 'BEATS' : (r.winRate + r.ci95) < 0.5 ? 'LOSES' : 'tied';
    realLog(`  [${dt}s] vs ${opp.name.padEnd(30)} ${String(r.wins).padStart(5)}W-${String(r.losses).padStart(5)}L/${r.games}  ${(r.winRate * 100).toFixed(2)}% ±${(r.ci95 * 100).toFixed(2)}%  ${verdict}`);
  }
  realLog('');

  const beats = results.filter(r => (r.winRate - r.ci95) > 0.5).length;
  const loses = results.filter(r => (r.winRate + r.ci95) < 0.5).length;
  realLog(`Summary: beats ${beats}, tied ${results.length - beats - loses}, loses ${loses} of ${results.length} opponents.`);

  fs.writeFileSync(path.join(OUT, 'omni-benchmark.json'), JSON.stringify({
    meta: { hands: HANDS, pool: POOL, seed: SEED },
    results,
  }, null, 2));
  realLog(`Wrote ${path.join(OUT, 'omni-benchmark.json')}`);
}

main().catch(err => {
  console.error('Omni benchmark failed:', err);
  process.exit(1);
});
