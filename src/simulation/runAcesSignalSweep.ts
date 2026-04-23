/**
 * Sweep over re-interpreted bid 3 as "2+ aces" plus related trump and
 * discard rules. Tests whether the concrete "I have 2+ aces" signal —
 * with matching receiver logic — actually beats the proven baseline
 * (sig=17, bid3 disabled).
 *
 * Variants tested, all on top of sig=17 trust=3:
 *   A. bid3Mode=aces alone (no receiver changes) — does moving the rule
 *      after long-suit and changing trigger to ace_count>=2 alone help?
 *   B. bid3Mode=aces + trumpBid3Aware — add receiver trump rules
 *   C. bid3Mode=aces + trumpBid3Aware + smartDiscardOpposite — full combo
 *   D. smartDiscardOpposite alone — isolated discard change
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
  trumpBid3Aware: false,
  smartDiscardOpposite: false,
};

interface Variant {
  key: string;
  label: string;
  params: FamilyPoweredParams;
}

const VARIANTS: Variant[] = [
  {
    key: 'A_aces_only',
    label: 'Bid 3 = aces (no receiver changes)',
    params: { ...BASELINE_PARAMS, bid3Mode: 'aces', bid3Threshold: 1 },
  },
  {
    key: 'B_aces_plus_trump',
    label: 'Bid 3 = aces + partner_bid=3 trump rules',
    params: { ...BASELINE_PARAMS, bid3Mode: 'aces', bid3Threshold: 1, trumpBid3Aware: true },
  },
  {
    key: 'C_full_combo',
    label: 'Bid 3 = aces + trump rules + smart discard',
    params: { ...BASELINE_PARAMS, bid3Mode: 'aces', bid3Threshold: 1, trumpBid3Aware: true, smartDiscardOpposite: true },
  },
  {
    key: 'D_discard_only',
    label: 'Smart discard alone (no bid 3 reintroduction)',
    params: { ...BASELINE_PARAMS, smartDiscardOpposite: true },
  },
  {
    key: 'E_aces_trump_no_discard',
    label: 'Bid 3 = aces + smart discard, no trump rules',
    params: { ...BASELINE_PARAMS, bid3Mode: 'aces', bid3Threshold: 1, smartDiscardOpposite: true },
  },
];

interface Row {
  variant: Variant;
  wins: number; losses: number; games: number;
  winRate: number; ci95: number;
}

interface BaselineRow {
  wins: number; losses: number; games: number;
  winRate: number; ci95: number;
}

async function evalConfig(label: string, params: FamilyPoweredParams, pool: string[]): Promise<BaselineRow> {
  const text = generateFamilyPoweredTuned(params);
  parseStrategy(text); // sanity
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

function fmtPct(n: number, d = 2): string { return (n * 100).toFixed(d); }
function fmtRow(label: string, r: BaselineRow): string {
  return `${label.padEnd(50)}  ${r.wins}W-${r.losses}L/${r.games}  ${fmtPct(r.winRate)}% ±${fmtPct(r.ci95)}%`;
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

function renderHtml(rows: Row[], baseline: BaselineRow): string {
  const rowHtml = (r: Row) => {
    const delta = (r.winRate - baseline.winRate) * 100;
    const lb = (r.winRate - r.ci95) * 100;
    const verdict = lb > baseline.winRate * 100
      ? '<span class="tag made">beats baseline</span>'
      : (r.winRate + r.ci95) * 100 < baseline.winRate * 100
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
<td class="num">${fmtPct(r.winRate)}% ±${fmtPct(r.ci95)}%</td>
<td class="num ${deltaCls}">${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp</td>
<td>${verdict}</td>
<td>${vsFamily}</td>
</tr>`;
  };

  const winnersOverBaseline = rows.filter(r => (r.winRate - r.ci95) > baseline.winRate);
  const losersVsBaseline = rows.filter(r => (r.winRate + r.ci95) < baseline.winRate);
  const winnersOverFamily = rows.filter(r => (r.winRate - r.ci95) > 0.5);
  const bestPoint = [...rows].sort((a, b) => b.winRate - a.winRate)[0];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Aces Signal — hand_power signaling report</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <h1>hand_power signaling: finding the optimal threshold</h1>
  ${navBar('aces-signal.html')}
</header>
<main>

<section>
  <h2>Bid 3 as "2+ aces" — can we resurrect bid 3 with a better interpretation?</h2>
  <p>
    The <a href="bid3-analysis.html">Bid 3 Deep-dive</a> ended with an obvious follow-up: since
    bid 3 hurts partly because the receiver has no <code>partner_bid == 3</code> branch and partly
    because it under-commits on long-suit hands, what if we <em>redefine</em> bid 3 as a
    concrete, actionable signal ("I have 2+ aces") and add matching receiver logic? This page
    tests that hypothesis.
  </p>
  <p>
    Three changes, tested both individually and combined, starting from the proven baseline
    (sig=17, trust=3, bid 3 disabled):
  </p>
  <ol>
    <li>
      <strong>bid3Mode = "aces":</strong> the bid-3 rule fires on <code>ace_count() &gt;= 2</code>
      instead of compound hand_power. Placed AFTER the long-suit rules so a hand with 6+ cards in
      a suit still gets bid 4 via length.
    </li>
    <li>
      <strong>trumpBid3Aware:</strong> adds receiver-side rules to the trump section — given
      partner has 2+ aces, prefer downtown (aces-good) when I can contribute at least one ace
      OR create a void, fall back to uptown when I'm predominantly high.
    </li>
    <li>
      <strong>smartDiscardOpposite:</strong> adds explicit <code>drop void_candidates()</code>
      rules for the case where partner's signal is the opposite direction from the one called
      (their low/high cards don't help in my direction, so I want to trump via a void).
    </li>
  </ol>
</section>

<section>
  <h2>Sweep results (N = ${HANDS.toLocaleString()} games per config vs Family)</h2>
  <div class="kpi">
    <div class="box"><div class="value">${winnersOverBaseline.length}</div><div class="label">Variants beat baseline</div></div>
    <div class="box"><div class="value">${winnersOverFamily.length}</div><div class="label">Variants beat Family</div></div>
    <div class="box"><div class="value">${losersVsBaseline.length}</div><div class="label">Worse than baseline</div></div>
    <div class="box"><div class="value">${fmtPct(bestPoint.winRate)}%</div><div class="label">Best point estimate</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Variant key</th>
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
        <td class="num">${fmtPct(baseline.winRate)}% ±${fmtPct(baseline.ci95)}%</td>
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
  ${winnersOverBaseline.length > 0 ? `
    <p>
      <strong>${winnersOverBaseline.length} variant(s) beat the baseline at p&lt;0.05.</strong>
      The best (<code>${bestPoint.variant.key}</code>) lands at
      <strong>${fmtPct(bestPoint.winRate)}% ± ${fmtPct(bestPoint.ci95)}%</strong>,
      ${fmtPct(bestPoint.winRate - baseline.winRate)}pp above baseline.
      This is meaningful: it means the "bid 3 = 2+ aces" interpretation
      <em>with matching receiver logic</em> genuinely recovers information that the
      disabled-bid-3 baseline was leaving on the table.
    </p>
  ` : `
    <p>
      <strong>None of the variants beat the baseline at p&lt;0.05.</strong>
      The best point estimate is <code>${bestPoint.variant.key}</code> at
      <strong>${fmtPct(bestPoint.winRate)}%</strong>, which is
      ${bestPoint.winRate > baseline.winRate
        ? `+${fmtPct(bestPoint.winRate - baseline.winRate)}pp above baseline on point estimate, but within CI noise`
        : `below baseline`}.
    </p>
    <p>
      The hypothesis was that a concrete "2+ aces" signal with matching receiver logic should
      recover the information that disabling bid 3 leaves unused. At 20k games we don't see
      an improvement — either the signal information is small (the hands that fire bid 3 were
      already making their contracts at roughly the baseline rate anyway) or the specific
      trump / discard rules added here aren't the right shape to extract the signal's value.
    </p>
  `}
  <p>
    Note that ${winnersOverFamily.length}/${rows.length + 1} of the configs
    (including baseline) beat Family at 95% confidence on this seed. When evaluating the new
    variants, the relevant comparison is vs <em>baseline</em> (not vs Family) — baseline already
    beats Family, so a new variant has to do even better to be worth adopting.
  </p>
</section>

<section>
  <h2>Why these particular trump-receiver rules?</h2>
  <p>
    The premise of "2+ aces" is a <em>specific</em> claim about stopper count. The receiver's
    rules try to exploit that specificity:
  </p>
  <ul>
    <li>
      <strong>I have ≥ 1 ace myself → downtown</strong>. Combined ace count ≥ 3. With 3+ aces
      on one team, downtown-aces-good becomes very attractive: the aces always win their tricks,
      and we want to play directions where low cards (our non-aces) are the other winners.
    </li>
    <li>
      <strong>I can void a suit (min_suit_count == 0 or ≤ 2) → downtown</strong>. If partner has
      2+ aces spread across suits, and I void a suit, I trump the voided suit while partner's
      aces stop the others. This is the scenario the user specifically identified:
      "<em>I can short-suit myself in one suit, because then I'll trump that suit and partner's
      aces stop the other 3</em>".
    </li>
    <li>
      <strong>I'm predominantly high → uptown</strong>. If I have few low cards and partner has
      aces, going uptown still works — partner's aces are high cards on both directions, so
      they're always useful.
    </li>
    <li>
      <strong>Otherwise → downtown-noaces</strong>. Conservative fallback: trust partner's aces
      to be stoppers, but don't bet on them being enough on their own for the aces-good ruleset.
    </li>
  </ul>
  <p>
    If variants don't beat baseline, one reason could be the <em>declarer</em> on bid-3 hands
    typically has a strong hand (2+ aces) already, so they'd already make their contract under a
    reasonable trump direction. The signal informs partner more than declarer — and partner
    mostly reacts in seat 3 (push to 5) or as dealer (take). The current strategy doesn't use
    the aces signal in those places, so the receiver-side gain here is partially wasted.
  </p>
</section>

<section>
  <h2>Reproduce</h2>
  <pre>node scripts/aces-signal-sweep.js
# with custom N:
REPORT_HANDS=40000 node scripts/aces-signal-sweep.js</pre>
</section>

</main>
<footer>
  Generated from <code>scripts/aces-signal-sweep.js</code>. Source:
  <code>src/simulation/runAcesSignalSweep.ts</code>.
</footer>
</body>
</html>`;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  // --html-only mode
  const htmlOnly = process.argv.includes('--html-only');
  const jsonPath = path.join(OUT, 'aces-signal-data.json');
  if (htmlOnly && fs.existsSync(jsonPath)) {
    realLog(`--html-only: regenerating from ${jsonPath}`);
    const cached = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const rows: Row[] = cached.rows.map((r: any) => {
      const v = VARIANTS.find(x => x.key === r.variantKey)!;
      return { variant: v, wins: r.wins, losses: r.losses, games: r.games, winRate: r.winRate, ci95: r.ci95 };
    });
    fs.writeFileSync(path.join(OUT, 'aces-signal.html'), renderHtml(rows, cached.baseline));
    realLog(`Wrote ${path.join(OUT, 'aces-signal.html')}`);
    return;
  }

  // Pre-flight: verify all variants parse
  realLog('Pre-flight parse check...');
  for (const v of VARIANTS) {
    const text = generateFamilyPoweredTuned(v.params);
    try { parseStrategy(text); }
    catch (e) { throw new Error(`Variant ${v.key} unparseable: ${(e as Error).message}`); }
  }
  realLog(`  all ${VARIANTS.length} variants parse OK`);
  realLog('');

  const pool = generateDeckPool(POOL, SEED);

  realLog(`Baseline (${HANDS.toLocaleString()} games vs Family)...`);
  const baseline = await evalConfig('baseline', BASELINE_PARAMS, pool);
  realLog(`  ${fmtRow('baseline', baseline)}`);
  realLog('');

  realLog(`${VARIANTS.length} variants...`);
  const rows: Row[] = [];
  for (const v of VARIANTS) {
    const t0 = Date.now();
    const r = await evalConfig(v.key, v.params, pool);
    rows.push({ variant: v, ...r });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    realLog(`  [${dt}s] ${fmtRow(v.key, r)}`);
  }
  realLog('');

  // Summarize winners / losers
  const winners = rows.filter(r => (r.winRate - r.ci95) > baseline.winRate);
  const losers = rows.filter(r => (r.winRate + r.ci95) < baseline.winRate);
  realLog(`Summary: ${winners.length} beat baseline, ${losers.length} worse, ${rows.length - winners.length - losers.length} tied.`);

  const html = renderHtml(rows, baseline);
  fs.writeFileSync(path.join(OUT, 'aces-signal.html'), html);
  fs.writeFileSync(path.join(OUT, 'aces-signal-data.json'), JSON.stringify({
    meta: { hands: HANDS, pool: POOL, seed: SEED, timestamp: new Date().toISOString() },
    baseline,
    rows: rows.map(r => ({
      variantKey: r.variant.key,
      wins: r.wins, losses: r.losses, games: r.games,
      winRate: r.winRate, ci95: r.ci95,
    })),
  }, null, 2));
  realLog(`Wrote ${path.join(OUT, 'aces-signal.html')}`);
}

main().catch(err => {
  console.error('Aces-signal sweep failed:', err);
  process.exit(1);
});
