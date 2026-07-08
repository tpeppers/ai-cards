/**
 * Sweep `makeable_trick_count(direction)` thresholds in the bid section of
 * the "ClaudeFam (Roles)" strategy, vs unmodified "ClaudeFam (Roles)" as the
 * opponent, using the same benchmark conventions as
 * src/simulation/runRolesBenchmark.ts.
 *
 * Two independent axes (each vs the same opponent):
 *   Axis A (sig)  — mtc_sig  ∈ {2,3,4,5,6,7}: replace hand_power signal/take
 *                    conditions with makeable_trick_count(<dir>) >= mtc_sig.
 *   Axis B (bid4) — mtc_bid4 ∈ {6,7,8,9}: keep classic bid section, add one
 *                    books-based bid-4 rule.
 *   parity        — run first; must be byte-identical to BIDWHIST_CLAUDEFAM_ROLES
 *                    (any deviation means the override plumbing drifted).
 *
 * Usage: node scripts/makeable-sweep.js
 *        REPORT_HANDS=40000 node scripts/makeable-sweep.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { BatchRunner } from './BatchRunner.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { BIDWHIST_CLAUDEFAM_ROLES, MTC_BID_SECTION, buildRolesVariant } from '../strategies/claudeFamRoles.ts';

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
const HOLDOUT_SEED = Number(process.env.HOLDOUT_SEED ?? 999999);
const OUT = path.resolve(process.cwd(), 'report');

const OPPONENT = { name: 'ClaudeFam (Roles)', text: BIDWHIST_CLAUDEFAM_ROLES };

// ── Axis A: signal replacement (mtc_sig) ─────────────────────────────
// The bid section text lives in claudeFamRoles.ts as MTC_BID_SECTION (it was
// promoted to the registry as ClaudeFam (Roles+MTC) after winning the sweep).

// ── Axis B: books-based bid 4 (mtc_bid4) ─────────────────────────────

const SWEEP_B_BID = `bid:
  when bid_count < 2 and max_suit_count() >= 6 and bid.current < 4:
    bid 4
  when bid_count < 2 and max_suit_count() >= 7 and bid.current < 5:
    bid 5
  when bid_count < 2 and max(makeable_trick_count(uptown), makeable_trick_count(downtown)) >= mtc_bid4 and bid.current < 4:
    bid 4
  when bid_count < 2 and hand_power(uptown) >= sig_threshold and bid.current < 2:
    bid 2
  when bid_count < 2 and hand_power(downtown) >= sig_threshold and bid.current < 1:
    bid 1
  when bid_count == 2 and bid.current < 4:
    bid 4
  when bid_count == 2 and bid.current == 4 and partner_bid == 1 and low_count() >= high_count():
    bid 5
  when bid_count == 2 and bid.current == 4 and partner_bid == 2 and high_count() > low_count():
    bid 5
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6 and hand_power(uptown) >= sig_threshold:
    bid 5
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6 and hand_power(downtown) >= sig_threshold:
    bid 5
  when bid_count == 2:
    pass
  when is_dealer and bid.current == 0:
    bid 1
  when is_dealer and partner_bid == bid.current and partner_bid > 0 and max_suit_count() <= 8:
    pass
  when is_dealer and bid.current <= 3:
    bid take
  when is_dealer and bid.current == 4 and max_suit_count() >= dealer_bid4_suit_req:
    bid take
  when is_dealer and bid.current == 4 and hand_power(uptown) >= sig_threshold:
    bid take
  when is_dealer and bid.current == 4 and hand_power(downtown) >= sig_threshold:
    bid take
  default:
    pass
`;

const ROLES_ALL: { rolesDiscard: boolean; rolesSluff: boolean; rolesLead: boolean } = {
  rolesDiscard: true,
  rolesSluff: true,
  rolesLead: true,
};

interface SweepConfig {
  key: string;
  axis: 'parity' | 'sig' | 'bid4';
  threshold: number | null;
  text: string;
}

// Parity: same override plumbing, no overrides — must be byte-identical to
// BIDWHIST_CLAUDEFAM_ROLES. If this throws, the claudeFamRoles.ts refactor
// changed the template output.
const PARITY_TEXT = buildRolesVariant('ClaudeFam (Roles)', ROLES_ALL);
if (PARITY_TEXT !== BIDWHIST_CLAUDEFAM_ROLES) {
  throw new Error('Parity config text does not match BIDWHIST_CLAUDEFAM_ROLES — claudeFamRoles.ts refactor changed template output');
}

const CONFIGS: SweepConfig[] = [
  { key: 'parity', axis: 'parity', threshold: null, text: PARITY_TEXT },
  ...[2, 3, 4, 5, 6, 7].map(n => ({
    key: `sigA-${n}`,
    axis: 'sig' as const,
    threshold: n,
    text: buildRolesVariant(`MTC Sig ${n}`, ROLES_ALL, { bidSection: MTC_BID_SECTION, extraLets: `let mtc_sig = ${n}` }),
  })),
  ...[6, 7, 8, 9].map(n => ({
    key: `bid4-${n}`,
    axis: 'bid4' as const,
    threshold: n,
    text: buildRolesVariant(`MTC Bid4 ${n}`, ROLES_ALL, { bidSection: SWEEP_B_BID, extraLets: `let mtc_bid4 = ${n}` }),
  })),
];

interface MatchupResult {
  config: string;
  axis: 'parity' | 'sig' | 'bid4';
  threshold: number | null;
  wins: number;
  losses: number;
  games: number;
  winRate: number;
  ci95: number;
}

async function runMatchup(cfg: SweepConfig, opp: { name: string; text: string }, pool: string[]): Promise<MatchupResult> {
  parseStrategy(cfg.text);
  parseStrategy(opp.text);
  const runner = new BatchRunner();
  const result = await runner.runComparison({
    strategies: [
      { name: `sweep-${cfg.key}`, strategyText: cfg.text },
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
  return { config: cfg.key, axis: cfg.axis, threshold: cfg.threshold, wins, losses, games, winRate, ci95: 1.96 * se };
}

function printResultLine(dt: string, r: MatchupResult): void {
  const verdict = (r.winRate - r.ci95) > 0.5 ? 'BEATS' : (r.winRate + r.ci95) < 0.5 ? 'LOSES' : 'tied';
  realLog(`  [${dt}s] ${r.config.padEnd(10)} vs ${OPPONENT.name.padEnd(20)} ` +
    `${r.wins}W-${r.losses}L/${r.games}  ${(r.winRate * 100).toFixed(2)}% ±${(r.ci95 * 100).toFixed(2)}%  ${verdict}`);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  realLog('── Makeable trick count threshold sweep ──');
  realLog(`N = ${HANDS.toLocaleString()} games per matchup, pool seed ${SEED}`);
  realLog('');

  const pool = generateDeckPool(POOL, SEED);
  const results: MatchupResult[] = [];

  for (const cfg of CONFIGS) {
    const t0 = Date.now();
    const r = await runMatchup(cfg, OPPONENT, pool);
    results.push(r);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    printResultLine(dt, r);
  }

  // Holdout confirmation: any non-parity config that "beats" the opponent
  // gets re-run once against a fresh, independently-seeded deck pool.
  const winners = results.filter(r => r.axis !== 'parity' && (r.winRate - r.ci95) > 0.5);
  const holdout: MatchupResult[] = [];

  if (winners.length > 0) {
    realLog('');
    realLog(`── Holdout confirmation (seed ${HOLDOUT_SEED}) ──`);
    const holdoutPool = generateDeckPool(POOL, HOLDOUT_SEED);
    const byKey = new Map(CONFIGS.map(cfg => [cfg.key, cfg]));
    for (const w of winners) {
      const cfg = byKey.get(w.config);
      if (!cfg) continue;
      const t0 = Date.now();
      const r = await runMatchup(cfg, OPPONENT, holdoutPool);
      holdout.push(r);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      printResultLine(dt, r);
    }
  }

  fs.writeFileSync(path.join(OUT, 'makeable-sweep.json'), JSON.stringify({
    meta: { hands: HANDS, pool: POOL, seed: SEED, holdoutSeed: HOLDOUT_SEED },
    results,
    holdout,
  }, null, 2));
  realLog('');
  realLog(`Wrote ${path.join(OUT, 'makeable-sweep.json')}`);
}

main().catch(err => {
  console.error('Makeable sweep failed:', err);
  process.exit(1);
});
