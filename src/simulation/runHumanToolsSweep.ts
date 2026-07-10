/**
 * Human-tools sweep: candidate uses of the two new "human toolkit"
 * primitives (CardSet .least_beaten, partner_cover_suit()) plus a 3-bid
 * clubs convention, vs the then-champion "Claude Omni" (at sweep time
 * AST-identical to BIDWHIST_CLAUDEFAM_ROLES_MTC_CP), using the same
 * benchmark conventions as src/simulation/runLeadSweep.ts.
 *
 * OUTCOME: probe-lead won (51.37%±0.30 pooled over five 20k pools) and was
 * adopted as ClaudeFam (Roles+MTC+CP+PL) / folded into Claude Omni. This
 * sweep predates that adoption: its baseline stays the historical
 * Roles+MTC+CP text, and the probe-lead config runs from the promoted
 * PROBE_LEADING_SECTION export.
 *
 * Every variant is identical to the champion (roles toggles all on,
 * MTC_BID_SECTION bid block, mtc_sig = 4, COUNTERPICK_TRUMP_SECTION trump
 * block) except for the stated override.
 *   parity        — champion overrides only; must be byte-identical to
 *                    BIDWHIST_CLAUDEFAM_ROLES_MTC_CP (throws otherwise).
 *   probe-lead    — leadingSection: the spare throwaway lead plays
 *                    .least_beaten instead of .weakest (win now or force
 *                    the beater out; junk stays for later).
 *   pass-control  — leadingSection: after the partner-signal lead, pass
 *                    control toward a same-direction-signaling partner by
 *                    leading low in partner_cover_suit().
 *   clubs3-5      — bid + trump sections: a 3-bid signals 5+ clubs;
 *                    partner answers with clubs on 3+ support.
 *   clubs3-4      — same convention at a 4+ clubs threshold.
 *
 * The clubs variants are built by string surgery on the imported
 * MTC_BID_SECTION / COUNTERPICK_TRUMP_SECTION constants; every anchor the
 * surgery splits on is asserted to occur exactly once at module load, so
 * any drift in the source sections throws instead of silently mis-building.
 *
 * Usage: node scripts/human-tools-sweep.js
 *        REPORT_HANDS=40000 node scripts/human-tools-sweep.js
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
  PROBE_LEADING_SECTION,
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

const OPPONENT = { name: 'Claude Omni', text: BIDWHIST_CLAUDEFAM_ROLES_MTC_CP };

// ── string surgery helper ────────────────────────────────────────────────
// Inserts `insertion` immediately after `anchor` in `source`. Throws at
// module load unless the anchor occurs exactly once.
function insertAfterAnchor(source: string, anchor: string, insertion: string, label: string): string {
  const parts = source.split(anchor);
  if (parts.length !== 2) {
    throw new Error(`${label}: anchor found ${parts.length - 1} times, expected exactly 1`);
  }
  return parts[0] + anchor + insertion + parts[1];
}

// ── champion leading block ───────────────────────────────────────────────
// Verbatim copy of the champion's assembled leading: block (PLAY_LEADING_BASE
// + LEAD_DEFAULT_ROLES are module-private to claudeFamRoles.ts). Asserted
// below to appear inside BIDWHIST_CLAUDEFAM_ROLES_MTC_CP so drift throws.
const CHAMPION_LEADING_SECTION = `  leading:
    # Last-run: one non-trump left — run out trump and then play it.
    when on_declarer_team and has_trump and hand.nontrump.count == 1:
      play hand.trump.strongest
    # Pull trump aggressively when enemies still have any.
    when on_declarer_team and has_trump and enemy_has_trump and outstanding_trump() > 0:
      play hand.trump.strongest
    # Cash boss non-trump cards before they lose tempo value.
    when hand.boss.nontrump.count > 0:
      play hand.boss.nontrump.weakest
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
if (!BIDWHIST_CLAUDEFAM_ROLES_MTC_CP.includes(CHAMPION_LEADING_SECTION)) {
  throw new Error('CHAMPION_LEADING_SECTION is not a verbatim slice of BIDWHIST_CLAUDEFAM_ROLES_MTC_CP — champion leading block drifted');
}

// ── probe-lead ───────────────────────────────────────────────────────────
// Identical to the champion's leading block except the spare throwaway
// lead plays .least_beaten instead of .weakest. The text was authored here,
// won the sweep, and was promoted to claudeFamRoles.ts as the exported
// PROBE_LEADING_SECTION (byte-verified before the local copy was deleted);
// the config now runs from that import.

// ── pass-control ─────────────────────────────────────────────────────────
// Champion's leading block with two rules inserted between the
// partner-signal-suit rule and the spare-lead rule.
const PASS_CONTROL_LEADING_SECTION = insertAfterAnchor(
  CHAMPION_LEADING_SECTION,
  `      play hand.suit(partner_signal).weakest
`,
  `    # Pass control toward a same-direction-signaling partner once my boss
    # is spent: lead low where the outstanding tops (their likely strength)
    # concentrate, instead of burning a spare.
    when partner_bid == 2 and bid_direction == "uptown" and hand.suit(partner_cover_suit()).count > 0:
      play hand.suit(partner_cover_suit()).weakest
    when partner_bid == 1 and bid_direction != "uptown" and hand.suit(partner_cover_suit()).count > 0:
      play hand.suit(partner_cover_suit()).weakest
`,
  'pass-control leading',
);

// ── clubs convention (bid + trump surgery) ───────────────────────────────
// Bid side: one rule inserted directly after the two makeable_trick_count
// signal rules (bid 2, bid 1) and before the bid_count == 2 hot-seat rule.
function buildClubsBidSection(minClubs: number): string {
  return insertAfterAnchor(
    MTC_BID_SECTION,
    `  when bid_count < 2 and makeable_trick_count(downtown) >= mtc_sig and bid.current < 1:
    bid 1
`,
    `  # Convention: a 3-bid means "${minClubs}+ clubs" (nothing else is signal-able at 3).
  when bid_count < 2 and suit_count("clubs") >= ${minClubs} and bid.current < 3:
    bid 3
`,
    `clubs3-${minClubs} bid`,
  );
}

// Trump side: three receiver rules at the very top, right after `trump:`.
// partner_bid == 3 is disjoint from every existing rule's partner_bid
// checks, so nothing below is shadowed.
const CLUBS3_TRUMP_SECTION = insertAfterAnchor(
  COUNTERPICK_TRUMP_SECTION,
  `trump:
`,
  `  # Partner's 3-bid = 5+ clubs: with any club support, call clubs in my
  # own hand's direction (8+ team clubs).
  when partner_bid == 3 and suit_count("clubs") >= 3 and low_count() > high_count() and ace_count() >= 2:
    choose suit: "clubs" direction: downtown
  when partner_bid == 3 and suit_count("clubs") >= 3 and low_count() > high_count():
    choose suit: "clubs" direction: downtown-noaces
  when partner_bid == 3 and suit_count("clubs") >= 3:
    choose suit: "clubs" direction: uptown
`,
  'clubs3 trump',
);

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
  axis: 'parity' | 'tools';
  threshold: number | null;
  text: string;
}

// Parity: champion overrides only — must be byte-identical to
// BIDWHIST_CLAUDEFAM_ROLES_MTC_CP. If this throws, the claudeFamRoles.ts
// template changed underneath us. NOTE: this sweep predates the +PL
// adoption, so its baseline is deliberately the historical Roles+MTC+CP
// text (probe-lead's win over it is what MADE +PL the champion).
const PARITY_TEXT = buildRolesVariant('ClaudeFam (Roles+MTC+CP)', ROLES_ALL, CHAMPION_OVERRIDES);
if (PARITY_TEXT !== BIDWHIST_CLAUDEFAM_ROLES_MTC_CP) {
  throw new Error('Parity config text does not match BIDWHIST_CLAUDEFAM_ROLES_MTC_CP — claudeFamRoles.ts template output changed');
}

const CONFIGS: SweepConfig[] = [
  { key: 'parity', axis: 'parity', threshold: null, text: PARITY_TEXT },
  {
    key: 'probe-lead',
    axis: 'tools',
    threshold: null,
    text: buildRolesVariant('Probe Lead', ROLES_ALL, { ...CHAMPION_OVERRIDES, leadingSection: PROBE_LEADING_SECTION }),
  },
  {
    key: 'pass-control',
    axis: 'tools',
    threshold: null,
    text: buildRolesVariant('Pass Control', ROLES_ALL, { ...CHAMPION_OVERRIDES, leadingSection: PASS_CONTROL_LEADING_SECTION }),
  },
  {
    key: 'clubs3-5',
    axis: 'tools',
    threshold: 5,
    text: buildRolesVariant('Clubs Convention 5', ROLES_ALL, { ...CHAMPION_OVERRIDES, bidSection: buildClubsBidSection(5), trumpSection: CLUBS3_TRUMP_SECTION }),
  },
  {
    key: 'clubs3-4',
    axis: 'tools',
    threshold: 4,
    text: buildRolesVariant('Clubs Convention 4', ROLES_ALL, { ...CHAMPION_OVERRIDES, bidSection: buildClubsBidSection(4), trumpSection: CLUBS3_TRUMP_SECTION }),
  },
];

interface MatchupResult {
  config: string;
  axis: 'parity' | 'tools';
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
      { name: `tools-${cfg.key}`, strategyText: cfg.text },
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

  realLog('── Human-tools sweep ──');
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

  fs.writeFileSync(path.join(OUT, 'human-tools-sweep.json'), JSON.stringify({
    meta: { hands: HANDS, pool: POOL, seed: SEED, holdoutSeed: HOLDOUT_SEED },
    results,
    holdout,
  }, null, 2));
  realLog('');
  realLog(`Wrote ${path.join(OUT, 'human-tools-sweep.json')}`);
}

main().catch(err => {
  console.error('Human-tools sweep failed:', err);
  process.exit(1);
});
