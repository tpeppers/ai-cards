/**
 * Trump-section sweep: candidate trump: blocks vs the reigning champion
 * "ClaudeFam (Roles+MTC)", using the same benchmark conventions as
 * src/simulation/runMakeableSweep.ts.
 *
 * Every variant is identical to the champion (roles toggles all on,
 * MTC_BID_SECTION bid block, mtc_sig = 4) except for the trump section.
 * v2 config list (v1 lost across the board — trump length must stay
 * sovereign; the evaluator scorers were re-keyed accordingly):
 *   parity       — no trumpSection override; must be byte-identical to
 *                  BIDWHIST_CLAUDEFAM_ROLES_MTC (throws otherwise).
 *   tricksb      — TRUMP_SECTION with best_suit( → best_suit_by_tricks(
 *                  (same text as v1 `tricks`; the scorer is now keyed
 *                  (length, tricks, power)).
 *   counterpickb — counterpick/strength rule shape from v1 `counterpick`,
 *                  but with plain best_suit( everywhere except the three
 *                  contested-direction best_suit_by_power( rules, isolating
 *                  the counterpick + strength-not-length ideas from the
 *                  suit-picker change.
 *   signal3      — signal_aware_suit(3) / signal_aware_direction(3).
 *   signal-dir   — champion's best_suit() suit pick, but DIRECTION chosen by
 *                  the exclusion model. Isolates the signal-conditioned
 *                  direction choice (lenWeight 13 vs 3 was measured to change
 *                  <0.1% of calls, so a second full-model config was a dup).
 *
 * Usage: node scripts/trump-sweep.js
 *        REPORT_HANDS=40000 node scripts/trump-sweep.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { BatchRunner } from './BatchRunner.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import {
  BIDWHIST_CLAUDEFAM_ROLES_MTC,
  COUNTERPICK_TRUMP_SECTION,
  MTC_BID_SECTION,
  TRUMP_SECTION,
  buildRolesVariant,
} from '../strategies/claudeFamRoles.ts';

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

const OPPONENT = { name: 'ClaudeFam (Roles+MTC)', text: BIDWHIST_CLAUDEFAM_ROLES_MTC };

// ── tricksb — best_suit( → best_suit_by_tricks( ─────────────────────
// NOTE: the task spec said 10 occurrences, but the actual TRUMP_SECTION
// text contains 9 (3 partner-low rules, 3 partner-high rules, 2 own-hand
// rules, 1 default). Assert the verified count so any drift in
// TRUMP_SECTION still throws at module load.
const EXPECTED_BEST_SUIT_OCCURRENCES = 9;
let bestSuitReplacements = 0;
const TRICKS_TRUMP = TRUMP_SECTION.replace(/best_suit\(/g, () => {
  bestSuitReplacements++;
  return 'best_suit_by_tricks(';
});
if (bestSuitReplacements !== EXPECTED_BEST_SUIT_OCCURRENCES) {
  throw new Error(`Expected ${EXPECTED_BEST_SUIT_OCCURRENCES} best_suit( occurrences in TRUMP_SECTION, found ${bestSuitReplacements}`);
}

// ── counterpickb ─────────────────────────────────────────────────────
// The trump section text lives in claudeFamRoles.ts as
// COUNTERPICK_TRUMP_SECTION (it was promoted to the registry as
// ClaudeFam (Roles+MTC+CP) after winning the sweep).

// ── signal3 / signal13 — signal-aware call with explicit lenWeight ───

const SIGNAL3_TRUMP = `trump:
  default:
    choose suit: signal_aware_suit(3) direction: signal_aware_direction(3)
`;

const SIGNAL_DIR_TRUMP = `trump:
  default:
    choose suit: best_suit(signal_aware_direction(13)) direction: signal_aware_direction(13)
`;

const ROLES_ALL: { rolesDiscard: boolean; rolesSluff: boolean; rolesLead: boolean } = {
  rolesDiscard: true,
  rolesSluff: true,
  rolesLead: true,
};

const CHAMPION_OVERRIDES = { bidSection: MTC_BID_SECTION, extraLets: 'let mtc_sig = 4' };

interface SweepConfig {
  key: string;
  axis: 'parity' | 'trump';
  threshold: number | null;
  text: string;
}

// Parity: champion overrides WITHOUT trumpSection — must be byte-identical to
// BIDWHIST_CLAUDEFAM_ROLES_MTC. If this throws, the claudeFamRoles.ts
// trumpSection refactor changed the template output.
const PARITY_TEXT = buildRolesVariant('ClaudeFam (Roles+MTC)', ROLES_ALL, CHAMPION_OVERRIDES);
if (PARITY_TEXT !== BIDWHIST_CLAUDEFAM_ROLES_MTC) {
  throw new Error('Parity config text does not match BIDWHIST_CLAUDEFAM_ROLES_MTC — claudeFamRoles.ts refactor changed template output');
}

const CONFIGS: SweepConfig[] = [
  { key: 'parity', axis: 'parity', threshold: null, text: PARITY_TEXT },
  {
    key: 'tricksb',
    axis: 'trump',
    threshold: null,
    text: buildRolesVariant('Trump Tricks', ROLES_ALL, { ...CHAMPION_OVERRIDES, trumpSection: TRICKS_TRUMP }),
  },
  {
    key: 'counterpickb',
    axis: 'trump',
    threshold: null,
    text: buildRolesVariant('Trump Counterpick', ROLES_ALL, { ...CHAMPION_OVERRIDES, trumpSection: COUNTERPICK_TRUMP_SECTION }),
  },
  {
    key: 'signal3',
    axis: 'trump',
    threshold: null,
    text: buildRolesVariant('Trump Signal 3', ROLES_ALL, { ...CHAMPION_OVERRIDES, trumpSection: SIGNAL3_TRUMP }),
  },
  {
    key: 'signal-dir',
    axis: 'trump',
    threshold: null,
    text: buildRolesVariant('Trump Signal Direction', ROLES_ALL, { ...CHAMPION_OVERRIDES, trumpSection: SIGNAL_DIR_TRUMP }),
  },
];

interface MatchupResult {
  config: string;
  axis: 'parity' | 'trump';
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
      { name: `trump-${cfg.key}`, strategyText: cfg.text },
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
  realLog(`  [${dt}s] ${r.config.padEnd(12)} vs ${OPPONENT.name.padEnd(21)} ` +
    `${r.wins}W-${r.losses}L/${r.games}  ${(r.winRate * 100).toFixed(2)}% ±${(r.ci95 * 100).toFixed(2)}%  ${verdict}`);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  realLog('── Trump section sweep ──');
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

  fs.writeFileSync(path.join(OUT, 'trump-sweep.json'), JSON.stringify({
    meta: { hands: HANDS, pool: POOL, seed: SEED, holdoutSeed: HOLDOUT_SEED },
    results,
    holdout,
  }, null, 2));
  realLog('');
  realLog(`Wrote ${path.join(OUT, 'trump-sweep.json')}`);
}

main().catch(err => {
  console.error('Trump sweep failed:', err);
  process.exit(1);
});
