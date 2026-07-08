/**
 * Leading-section sweep: candidate leading: blocks vs the reigning champion
 * "ClaudeFam (Roles+MTC+CP)", using the same benchmark conventions as
 * src/simulation/runTrumpSweep.ts.
 *
 * Every variant is identical to the champion (roles toggles all on,
 * MTC_BID_SECTION bid block, mtc_sig = 4, COUNTERPICK_TRUMP_SECTION trump
 * block) except for the leading section.
 *   parity          — no leadingSection override; must be byte-identical to
 *                      BIDWHIST_CLAUDEFAM_ROLES_MTC_CP (throws otherwise).
 *   establish       — inserts an "Establishment" rule (spend a backing feed
 *                      to force holes out and promote backed winners) once
 *                      enemy trump is gone, ahead of the partner-short-suit
 *                      and signal-suit leads.
 *   establish-open  — same rule, ungated on enemy trump (fires any time we
 *                      hold both a backed winner and its backing feed).
 *
 * Usage: node scripts/lead-sweep.js
 *        REPORT_HANDS=40000 node scripts/lead-sweep.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { BatchRunner } from './BatchRunner.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import {
  BIDWHIST_CLAUDEFAM_ROLES_MTC_CP,
  COUNTERPICK_TRUMP_SECTION,
  MTC_BID_SECTION,
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

const OPPONENT = { name: 'ClaudeFam (Roles+MTC+CP)', text: BIDWHIST_CLAUDEFAM_ROLES_MTC_CP };

// ── establish ────────────────────────────────────────────────────────────
// Identical to the champion's leading: block, with one rule inserted after
// "Cash boss non-trump cards" and before "Lead partner's short suit": once
// enemy trump is gone and we hold a backed winner plus its backing feed,
// spend the backing card to force the holes out and promote the winner.
const ESTABLISH_LEADING_SECTION = `  leading:
    # Last-run: one non-trump left — run out trump and then play it.
    when on_declarer_team and has_trump and hand.nontrump.count == 1:
      play hand.trump.strongest
    # Pull trump aggressively when enemies still have any.
    when on_declarer_team and has_trump and enemy_has_trump and outstanding_trump() > 0:
      play hand.trump.strongest
    # Cash boss non-trump cards before they lose tempo value.
    when hand.boss.nontrump.count > 0:
      play hand.boss.nontrump.weakest
    # Establishment: enemy trump is gone and I hold backed winners — spend a
    # backing feed to force the holes out and promote them.
    when not enemy_has_trump and hand.nontrump.backed.count > 0 and hand.nontrump.backing.count > 0:
      play hand.nontrump.backing.weakest
    # Lead partner's short suit if we called trump and partner still
    # has trump — lets partner trump that suit to grab the trick.
    when on_declarer_team and partner_has_trump and partner_shortsuit.count > 0:
      play partner_shortsuit.weakest
    # Lead partner's signal suit (from their first void discard).
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).weakest
    # Throwaway lead: burn a spare, not a backing card that a backed
    # winner depends on.
    when hand.nontrump.spare.count > 0:
      play hand.nontrump.spare.weakest
    when hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest
`;

// ── establish-open ───────────────────────────────────────────────────────
// Same as establish, but the Establishment rule's condition drops the
// "not enemy_has_trump" gate — it fires any time we hold a backed winner
// and its backing feed, not just once enemy trump is exhausted.
const ESTABLISH_OPEN_LEADING_SECTION = `  leading:
    # Last-run: one non-trump left — run out trump and then play it.
    when on_declarer_team and has_trump and hand.nontrump.count == 1:
      play hand.trump.strongest
    # Pull trump aggressively when enemies still have any.
    when on_declarer_team and has_trump and enemy_has_trump and outstanding_trump() > 0:
      play hand.trump.strongest
    # Cash boss non-trump cards before they lose tempo value.
    when hand.boss.nontrump.count > 0:
      play hand.boss.nontrump.weakest
    # Establishment (ungated): spend a backing feed to force holes out early.
    when hand.nontrump.backed.count > 0 and hand.nontrump.backing.count > 0:
      play hand.nontrump.backing.weakest
    # Lead partner's short suit if we called trump and partner still
    # has trump — lets partner trump that suit to grab the trick.
    when on_declarer_team and partner_has_trump and partner_shortsuit.count > 0:
      play partner_shortsuit.weakest
    # Lead partner's signal suit (from their first void discard).
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).weakest
    # Throwaway lead: burn a spare, not a backing card that a backed
    # winner depends on.
    when hand.nontrump.spare.count > 0:
      play hand.nontrump.spare.weakest
    when hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest
`;

const ROLES_ALL: { rolesDiscard: boolean; rolesSluff: boolean; rolesLead: boolean } = {
  rolesDiscard: true,
  rolesSluff: true,
  rolesLead: true,
};

const CHAMPION_OVERRIDES = {
  bidSection: MTC_BID_SECTION,
  extraLets: 'let mtc_sig = 4',
  trumpSection: COUNTERPICK_TRUMP_SECTION,
};

interface SweepConfig {
  key: string;
  axis: 'parity' | 'lead';
  threshold: number | null;
  text: string;
}

// Parity: champion overrides WITHOUT leadingSection — must be byte-identical
// to BIDWHIST_CLAUDEFAM_ROLES_MTC_CP. If this throws, the claudeFamRoles.ts
// leadingSection refactor changed the template output.
const PARITY_TEXT = buildRolesVariant('ClaudeFam (Roles+MTC+CP)', ROLES_ALL, CHAMPION_OVERRIDES);
if (PARITY_TEXT !== BIDWHIST_CLAUDEFAM_ROLES_MTC_CP) {
  throw new Error('Parity config text does not match BIDWHIST_CLAUDEFAM_ROLES_MTC_CP — claudeFamRoles.ts refactor changed template output');
}

const CONFIGS: SweepConfig[] = [
  { key: 'parity', axis: 'parity', threshold: null, text: PARITY_TEXT },
  {
    key: 'establish',
    axis: 'lead',
    threshold: null,
    text: buildRolesVariant('Lead Establish', ROLES_ALL, { ...CHAMPION_OVERRIDES, leadingSection: ESTABLISH_LEADING_SECTION }),
  },
  {
    key: 'establish-open',
    axis: 'lead',
    threshold: null,
    text: buildRolesVariant('Lead Establish Open', ROLES_ALL, { ...CHAMPION_OVERRIDES, leadingSection: ESTABLISH_OPEN_LEADING_SECTION }),
  },
];

interface MatchupResult {
  config: string;
  axis: 'parity' | 'lead';
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
      { name: `lead-${cfg.key}`, strategyText: cfg.text },
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
  realLog(`  [${dt}s] ${r.config.padEnd(15)} vs ${OPPONENT.name.padEnd(21)} ` +
    `${r.wins}W-${r.losses}L/${r.games}  ${(r.winRate * 100).toFixed(2)}% ±${(r.ci95 * 100).toFixed(2)}%  ${verdict}`);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  realLog('── Lead section sweep ──');
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

  fs.writeFileSync(path.join(OUT, 'lead-sweep.json'), JSON.stringify({
    meta: { hands: HANDS, pool: POOL, seed: SEED, holdoutSeed: HOLDOUT_SEED },
    results,
    holdout,
  }, null, 2));
  realLog('');
  realLog(`Wrote ${path.join(OUT, 'lead-sweep.json')}`);
}

main().catch(err => {
  console.error('Lead sweep failed:', err);
  process.exit(1);
});
