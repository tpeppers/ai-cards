/**
 * Focused sweep: does the "lead strongest non-trump" rule help when
 * correctly gated on partner_is_declarer (the intended usage) versus
 * applied blanket (the previous implementation)?
 *
 * Uses the newly-added `am_declarer` and `partner_is_declarer` DSL
 * variables to express the nuanced form cleanly.
 *
 * Baseline: sig=17, trust=3, bid3 disabled (the proven best).
 */

import * as fs from 'fs';
import * as path from 'path';
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

const BASELINE_PARAMS: FamilyPoweredParams = {
  sigThreshold: 17, trustBonus: 3, oppPassThreshold: 99,
  dealerLongSuit: 5, minStoppers: 0,
  bid3Threshold: 99, bid3Mode: 'hand_power',
  defensiveTakeThreshold: 99, defensiveTakeAt5Threshold: 99,
  contestedPushThreshold: 99,
};

const BASELINE_TEXT = generateFamilyPoweredTuned(BASELINE_PARAMS);

// ── Transforms ──────────────────────────────────────────────────────────

// Blanket: change the final lead rule to strongest non-trump (what we
// tested before — applies to ALL leading situations).
function transformBlanket(text: string): string {
  return text.replace(
    '    when hand.nontrump.count > 0:\n      play hand.nontrump.weakest',
    '    when hand.nontrump.count > 0:\n      play hand.nontrump.strongest',
  );
}

// Nuanced: insert a new rule BEFORE the fallback, firing only when
// partner_is_declarer. The fallback stays weakest for all other cases.
function transformPartnerDeclarer(text: string): string {
  return text.replace(
    '    when hand.nontrump.count > 0:\n      play hand.nontrump.weakest',
    `    when partner_is_declarer and hand.nontrump.count > 0:
      play hand.nontrump.strongest
    when hand.nontrump.count > 0:
      play hand.nontrump.weakest`,
  );
}

// Alternative formulation: on_declarer_team AND not am_declarer —
// behaviorally identical to partner_is_declarer, included as a sanity
// check on the DSL (same outcome means the derived boolean is right).
function transformOnTeamNotMe(text: string): string {
  return text.replace(
    '    when hand.nontrump.count > 0:\n      play hand.nontrump.weakest',
    `    when on_declarer_team and not am_declarer and hand.nontrump.count > 0:
      play hand.nontrump.strongest
    when hand.nontrump.count > 0:
      play hand.nontrump.weakest`,
  );
}

// Dual-variant: partner_is_declarer leads strongest, AND when am_declarer
// pulls trump first (existing behavior). Tests the "both roles play
// differently" idea.
function transformDualRole(text: string): string {
  return text.replace(
    '    when hand.nontrump.count > 0:\n      play hand.nontrump.weakest',
    `    when partner_is_declarer and hand.nontrump.count > 0:
      play hand.nontrump.strongest
    when am_declarer and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    when hand.nontrump.count > 0:
      play hand.nontrump.weakest`,
  );
}

interface Variant {
  key: string;
  label: string;
  rationale: string;
  transform: (text: string) => string;
}

const VARIANTS: Variant[] = [
  {
    key: 'I_blanket',
    label: 'Blanket: always lead strongest non-trump',
    rationale: 'The previous implementation — a single string transform that affects ALL leading situations, regardless of declarer role. Included as a comparison baseline for the nuanced variants.',
    transform: transformBlanket,
  },
  {
    key: 'I_partner_declarer',
    label: 'Nuanced: lead strongest only when partner_is_declarer',
    rationale: 'The INTENDED heuristic: when my partner is the declarer and I have control, cash my winners top-to-bottom — partner called trump with the expectation of supporting my side suits. Uses the new `partner_is_declarer` DSL variable.',
    transform: transformPartnerDeclarer,
  },
  {
    key: 'I_on_team_not_me',
    label: 'Equivalent formulation (on_declarer_team and not am_declarer)',
    rationale: 'Same behavior as partner_is_declarer expressed via the older variables. Included to sanity-check the new DSL variable matches the derived expression exactly.',
    transform: transformOnTeamNotMe,
  },
  {
    key: 'I_dual_role',
    label: 'Dual-role: strongest when partner declares, weakest when I do',
    rationale: 'Explicit role-split: partner-of-declarer cashes, I-as-declarer ducks. Functionally identical to partner_is_declarer variant (the am_declarer rule just preserves existing behavior) but serves as scaffolding for role-specific future rules.',
    transform: transformDualRole,
  },
];

interface Result { wins: number; losses: number; games: number; winRate: number; ci95: number; }

async function evalStrategy(label: string, text: string, pool: string[]): Promise<Result> {
  parseStrategy(text);
  const runner = new BatchRunner();
  const result = await runner.runComparison({
    strategies: [
      { name: label, strategyText: text },
      { name: 'Family', strategyText: BIDWHIST_FAMILY },
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
  return { wins, losses, games, winRate, ci95: 1.96 * se };
}

function fmtRow(label: string, r: Result): string {
  return `${label.padEnd(50)}  ${r.wins}W-${r.losses}L/${r.games}  ${(r.winRate * 100).toFixed(2)}% ±${(r.ci95 * 100).toFixed(2)}%`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function navBar(active: string): string {
  const pages: Array<[string, string]> = [
    ['index.html', 'Overview'],
    ['sweep.html', 'Sweep Data'],
    ['cases.html', 'Case Studies'],
    ['playable.html', 'Playable Hands'],
    ['addendum.html', 'Addendum'],
    ['variants.html', 'Variants'],
    ['bid3-analysis.html', 'Bid 3 Deep-dive'],
    ['aces-signal.html', 'Aces Signal'],
    ['aces-full.html', 'Full Receiver'],
    ['lead-declarer.html', 'Lead Role-Aware'],
  ];
  return `<nav>${pages.map(([href, label]) => {
    const cls = href === active ? ' class="active"' : '';
    return `<a href="${href}"${cls}>${label}</a>`;
  }).join('')}</nav>`;
}

interface Row { variant: Variant; wins: number; losses: number; games: number; winRate: number; ci95: number; }

function renderHtml(rows: Row[], baseline: Result): string {
  const rowHtml = (r: Row) => {
    const delta = (r.winRate - baseline.winRate) * 100;
    const lb = (r.winRate - r.ci95) * 100;
    const ub = (r.winRate + r.ci95) * 100;
    const vsBase = lb > baseline.winRate * 100
      ? '<span class="tag made">beats baseline</span>'
      : ub < baseline.winRate * 100
      ? '<span class="tag failed">worse than baseline</span>'
      : '<span class="tag family">tied</span>';
    const vsFamily = (r.winRate - r.ci95) > 0.5
      ? '<span class="tag made">beats Family</span>'
      : (r.winRate + r.ci95) < 0.5
      ? '<span class="tag failed">loses to Family</span>'
      : '<span class="tag family">tied</span>';
    const deltaCls = delta > 0.3 ? 'good' : delta < -0.3 ? 'bad' : '';
    return `<tr>
<td><code>${esc(r.variant.key)}</code></td>
<td>${esc(r.variant.label)}</td>
<td class="num">${(r.winRate * 100).toFixed(2)}% ±${(r.ci95 * 100).toFixed(2)}%</td>
<td class="num ${deltaCls}">${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp</td>
<td>${vsBase}</td>
<td>${vsFamily}</td>
</tr>`;
  };

  const winners = rows.filter(r => (r.winRate - r.ci95) > baseline.winRate);
  const losers = rows.filter(r => (r.winRate + r.ci95) < baseline.winRate);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Lead Role-Aware — hand_power signaling report</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <h1>hand_power signaling: finding the optimal threshold</h1>
  ${navBar('lead-declarer.html')}
</header>
<main>

<section>
  <h2>Role-aware lead variants</h2>
  <p>
    The <a href="aces-full.html">Full Receiver page</a> tested a <strong>blanket</strong> "lead
    strongest non-trump" rule and it lost 3.6pp to baseline. The feedback:
    "<em>this is done by humans ONLY when their partner is the declarer — the assumption is
    that partner will support your winners</em>". The previous implementation didn't make that
    distinction.
  </p>
  <p>
    To test the nuanced form cleanly, two new DSL variables were added:
  </p>
  <ul>
    <li><code>am_declarer</code> — true only when <code>playerId == declarer</code>.</li>
    <li><code>partner_is_declarer</code> — true when my partner (but not me) is the declarer.
      Implies <code>on_declarer_team</code>.</li>
  </ul>
  <p>
    The four variants below all differ only in how they gate the "lead strongest non-trump"
    rule. Baseline is unchanged from the rest of the report.
  </p>
</section>

<section>
  <h2>Results (N = ${HANDS.toLocaleString()} games per config vs Family)</h2>
  <div class="kpi">
    <div class="box"><div class="value">${winners.length}</div><div class="label">Beat baseline</div></div>
    <div class="box"><div class="value">${losers.length}</div><div class="label">Worse than baseline</div></div>
    <div class="box"><div class="value">${rows.length - winners.length - losers.length}</div><div class="label">Tied with baseline</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Variant</th>
        <th>Description</th>
        <th>Win rate</th>
        <th>Δ baseline</th>
        <th>vs baseline</th>
        <th>vs Family</th>
      </tr>
    </thead>
    <tbody>
      <tr class="highlight-row">
        <td><code>baseline</code></td>
        <td>sig=17, bid3 disabled (proven best)</td>
        <td class="num">${(baseline.winRate * 100).toFixed(2)}% ±${(baseline.ci95 * 100).toFixed(2)}%</td>
        <td class="num">—</td>
        <td>—</td>
        <td>${(baseline.winRate - baseline.ci95) > 0.5 ? '<span class="tag made">beats Family</span>' : '<span class="tag family">tied</span>'}</td>
      </tr>
${rows.map(rowHtml).join('\n')}
    </tbody>
  </table>
</section>

<section>
  <h2>Interpretation</h2>
  ${(() => {
    const blanket = rows.find(r => r.variant.key === 'I_blanket');
    const partner = rows.find(r => r.variant.key === 'I_partner_declarer');
    const onTeam = rows.find(r => r.variant.key === 'I_on_team_not_me');
    if (!blanket || !partner || !onTeam) return '';
    const blanketDelta = (blanket.winRate - baseline.winRate) * 100;
    const partnerDelta = (partner.winRate - baseline.winRate) * 100;
    const equivalent = Math.abs(partner.winRate - onTeam.winRate) * 100 < 0.3;
    return `
    <p>
      The blanket variant costs <strong>${blanketDelta.toFixed(2)}pp</strong> versus baseline.
      The nuanced variant (partner_is_declarer only) ${partnerDelta >= 0.3
        ? `recovers to <strong>+${partnerDelta.toFixed(2)}pp</strong> above baseline`
        : partnerDelta <= -0.3
        ? `still loses <strong>${partnerDelta.toFixed(2)}pp</strong>`
        : `lands within CI of baseline (<strong>${partnerDelta >= 0 ? '+' : ''}${partnerDelta.toFixed(2)}pp</strong>)`}.
      ${equivalent
        ? 'The DSL-sanity variant (<code>on_declarer_team and not am_declarer</code>) lands at the same point estimate within noise, confirming the new <code>partner_is_declarer</code> boolean matches the derived expression.'
        : 'The DSL-sanity variant diverges slightly — worth a second look at how the two expressions differ.'}
    </p>
    <p>
      ${partnerDelta >= 0.3
        ? `So the gating matters. The "cash winners when partner declares" heuristic is sound, but applying it outside that context (e.g., when I\'m the declarer myself) is a net negative. The ${blanketDelta.toFixed(2)}pp blanket loss is dominated by declarer-self cases, where leading strongest non-trump wastes winners we\'d have used more tactically.`
        : partnerDelta >= -0.3
        ? `Restricting the rule to partner_is_declarer erases the blanket damage — the gating is ${Math.abs(blanketDelta - partnerDelta).toFixed(2)}pp of recovery vs blanket — but it doesn\'t meaningfully improve on baseline either. Family\'s "lead weakest" default is already approximately right for partner-of-declarer situations, perhaps because the boss-cash rule (which fires first) already handles the "cash my winners" case.`
        : `Even the nuanced gating doesn\'t recover baseline performance. The heuristic might be wrong as stated — or it interacts with other play rules in ways that the isolated change can\'t fix.`}
    </p>`;
  })()}
</section>

<section>
  <h2>Variant rationales</h2>
  <table>
    <thead><tr><th>Key</th><th>Rationale</th></tr></thead>
    <tbody>
${rows.map(r => `      <tr><td><code>${esc(r.variant.key)}</code></td><td>${esc(r.variant.rationale)}</td></tr>`).join('\n')}
    </tbody>
  </table>
</section>

<section>
  <h2>Reproduce</h2>
  <pre>node scripts/lead-declarer-sweep.js
# with custom N:
REPORT_HANDS=40000 node scripts/lead-declarer-sweep.js</pre>
</section>

</main>
<footer>
  Generated from <code>scripts/lead-declarer-sweep.js</code>. Source:
  <code>src/simulation/runLeadDeclarerSweep.ts</code>.
</footer>
</body>
</html>`;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  const htmlOnly = process.argv.includes('--html-only');
  const jsonPath = path.join(OUT, 'lead-declarer-data.json');
  if (htmlOnly && fs.existsSync(jsonPath)) {
    realLog(`--html-only: regenerating from ${jsonPath}`);
    const cached = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const rows: Row[] = cached.rows.map((r: any) => {
      const v = VARIANTS.find(x => x.key === r.variantKey)!;
      return { variant: v, wins: r.wins, losses: r.losses, games: r.games, winRate: r.winRate, ci95: r.ci95 };
    });
    fs.writeFileSync(path.join(OUT, 'lead-declarer.html'), renderHtml(rows, cached.baseline));
    realLog(`Wrote ${path.join(OUT, 'lead-declarer.html')}`);
    return;
  }

  realLog('Pre-flight parse check...');
  for (const v of VARIANTS) {
    const text = v.transform(BASELINE_TEXT);
    try { parseStrategy(text); }
    catch (e) { throw new Error(`Variant ${v.key} unparseable: ${(e as Error).message}`); }
  }
  realLog(`  all ${VARIANTS.length} variants parse OK`);
  realLog('');

  const pool = generateDeckPool(POOL, SEED);

  realLog(`Baseline (${HANDS.toLocaleString()} games vs Family)...`);
  const baseline = await evalStrategy('baseline', BASELINE_TEXT, pool);
  realLog(`  ${fmtRow('baseline', baseline)}`);
  realLog('');

  realLog(`${VARIANTS.length} variants...`);
  const rows: Row[] = [];
  for (const v of VARIANTS) {
    const text = v.transform(BASELINE_TEXT);
    const t0 = Date.now();
    const r = await evalStrategy(v.key, text, pool);
    rows.push({ variant: v, ...r });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    realLog(`  [${dt}s] ${fmtRow(v.key, r)}`);
  }
  realLog('');

  const winners = rows.filter(r => (r.winRate - r.ci95) > baseline.winRate);
  const losers = rows.filter(r => (r.winRate + r.ci95) < baseline.winRate);
  realLog(`Summary: ${winners.length} beat baseline, ${losers.length} worse, ${rows.length - winners.length - losers.length} tied.`);

  const html = renderHtml(rows, baseline);
  fs.writeFileSync(path.join(OUT, 'lead-declarer.html'), html);
  fs.writeFileSync(path.join(OUT, 'lead-declarer-data.json'), JSON.stringify({
    meta: { hands: HANDS, pool: POOL, seed: SEED, timestamp: new Date().toISOString() },
    baseline,
    rows: rows.map(r => ({
      variantKey: r.variant.key,
      wins: r.wins, losses: r.losses, games: r.games,
      winRate: r.winRate, ci95: r.ci95,
    })),
  }, null, 2));
  realLog(`Wrote ${path.join(OUT, 'lead-declarer.html')}`);
}

main().catch(err => {
  console.error('Lead declarer sweep failed:', err);
  process.exit(1);
});
