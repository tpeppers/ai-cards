/**
 * Fuller aces-signal experiment, plus sig17-aware receiver boosts, bid-4
 * on length+strength, and a leading-strongest-nontrump play variant.
 *
 * The goal is to address the feedback from the previous aces-signal
 * sweep: "the signal informs partner more than declarer, and partner
 * mostly reacts in seat-3 push or dealer-take, but the current strategy
 * doesn't use the aces signal in those places". This run wires the aces
 * signal into seat-3 push and dealer-take, tests multiple ace-count
 * thresholds, and adds orthogonal experiments on the bid-4 and lead
 * rules.
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

// Leading-strongest-nontrump variant applies a string transform to the
// rendered strategy text — swaps the final "hand.nontrump.weakest" lead
// rule to "hand.nontrump.strongest". Affects the leading section only.
function applyLeadingStrongest(text: string): string {
  return text.replace(
    '    when hand.nontrump.count > 0:\n      play hand.nontrump.weakest',
    '    when hand.nontrump.count > 0:\n      play hand.nontrump.strongest',
  );
}

interface Variant {
  key: string;
  label: string;
  rationale: string;
  params: FamilyPoweredParams;
  leadTransform?: boolean;
}

const ACES_FULL_RECEIVER: Partial<FamilyPoweredParams> = {
  bid3Mode: 'aces',
  bid3Threshold: 1,
  trumpBid3Aware: true,
  bid3ReceiverSeat3: true,
  bid3ReceiverDealer: true,
};

const VARIANTS: Variant[] = [
  // ── Aces-full-receiver at multiple thresholds ──
  {
    key: 'F2_aces_full_2',
    label: 'Aces full-receiver, threshold ≥ 2',
    rationale: 'Full receiver wiring: trump rules + seat-3 push + dealer take, all for partner_bid==3. Threshold 2 — signal fires on ~20% of hands.',
    params: { ...BASELINE_PARAMS, ...ACES_FULL_RECEIVER, bid3AceCount: 2 },
  },
  {
    key: 'F3_aces_full_3',
    label: 'Aces full-receiver, threshold ≥ 3',
    rationale: 'Same but tightened to 3 aces (~1.5% fire rate). Rarer, more specific signal.',
    params: { ...BASELINE_PARAMS, ...ACES_FULL_RECEIVER, bid3AceCount: 3 },
  },
  {
    key: 'F4_aces_full_4',
    label: 'Aces full-receiver, threshold ≥ 4',
    rationale: 'Extremely rare (~0.25%) — essentially "4 aces in one hand". Sanity check.',
    params: { ...BASELINE_PARAMS, ...ACES_FULL_RECEIVER, bid3AceCount: 4 },
  },

  // ── Sig17 receiver boost ──
  {
    key: 'G_sig17_boost',
    label: 'Sig-17 receiver boost (bid 1/2 → "3+ winners")',
    rationale: 'Adds seat-3 push + dealer take rules that fire on `hand_power(matching_direction) >= 8` when partner_bid ∈ {1,2}. Exploits the fact that at sig=17, partner\'s signal implies real strength.',
    params: { ...BASELINE_PARAMS, sig17ReceiverBoost: true },
  },

  // ── Bid 4 on sig + length ──
  {
    key: 'H4_bid4_sig_4',
    label: 'Bid 4 on hand_power >= sig AND 4+ suit',
    rationale: 'Direct bid 4 on sig-strong hand with 4-card suit. Commits to contract 10 without going through bid 2/bid 1 signal phase.',
    params: { ...BASELINE_PARAMS, bid4OnSigAndSuit: 4 },
  },
  {
    key: 'H5_bid4_sig_5',
    label: 'Bid 4 on hand_power >= sig AND 5+ suit',
    rationale: 'More conservative than H4 — requires 5-card suit before committing to bid 4 via strength.',
    params: { ...BASELINE_PARAMS, bid4OnSigAndSuit: 5 },
  },

  // ── Lead strongest nontrump ──
  {
    key: 'I_lead_strongest',
    label: 'Leading: strongest non-trump (not weakest)',
    rationale: 'Change the final "when hand.nontrump.count > 0" lead rule from `hand.nontrump.weakest` to `hand.nontrump.strongest`. Tests the "partner-of-declarer, having control, plays strong-to-weak (excluding trump)" idea.',
    params: { ...BASELINE_PARAMS },
    leadTransform: true,
  },

  // ── Combo: aces full-receiver at 3 + sig17 boost ──
  {
    key: 'J_aces3_sig17',
    label: 'Aces (≥3) full-receiver + sig17 receiver boost',
    rationale: 'Combines the strongest aces-signal variant (threshold 3) with the sig17 receiver boost — tests whether the two are orthogonal.',
    params: { ...BASELINE_PARAMS, ...ACES_FULL_RECEIVER, bid3AceCount: 3, sig17ReceiverBoost: true },
  },
];

interface Row {
  variant: Variant;
  wins: number; losses: number; games: number;
  winRate: number; ci95: number;
}

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
  return `${label.padEnd(42)}  ${r.wins}W-${r.losses}L/${r.games}  ${(r.winRate * 100).toFixed(2)}% ±${(r.ci95 * 100).toFixed(2)}%`;
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

function renderHtml(rows: Row[], baseline: Result, combined?: Result): string {
  const rowHtml = (r: Row) => {
    const delta = (r.winRate - baseline.winRate) * 100;
    const lb = (r.winRate - r.ci95) * 100;
    const ub = (r.winRate + r.ci95) * 100;
    const verdict = lb > baseline.winRate * 100
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
<td>${verdict}</td>
<td>${vsFamily}</td>
</tr>`;
  };

  const winners = rows.filter(r => (r.winRate - r.ci95) > baseline.winRate);
  const losers = rows.filter(r => (r.winRate + r.ci95) < baseline.winRate);
  const bestPoint = [...rows].sort((a, b) => b.winRate - a.winRate)[0];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Full Receiver — hand_power signaling report</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <h1>hand_power signaling: finding the optimal threshold</h1>
  ${navBar('aces-full.html')}
</header>
<main>

<section>
  <h2>Addressing the earlier aces-signal critique</h2>
  <p>
    The <a href="aces-signal.html">previous aces-signal page</a> noted:
    "<em>The signal informs partner more than declarer — and partner mostly reacts in seat-3
    (push to 5) or as dealer (take). The current strategy doesn't use the aces signal in
    those places, so the receiver-side gain here is partially wasted.</em>"
  </p>
  <p>
    This page fixes that: the new <code>bid3ReceiverSeat3</code> and
    <code>bid3ReceiverDealer</code> flags wire <code>partner_bid == 3</code> into the seat-3
    push rules and dealer-take rules, in addition to the trump selection rules. Tested at
    three ace-count thresholds (2, 3, 4) to isolate the "rare but highly specific" sweet spot.
  </p>
  <p>
    Three orthogonal ideas are also on this page:
  </p>
  <ul>
    <li>
      <strong>Sig-17 receiver boost</strong> — at sig=17, partner's bid 1 or bid 2 represents
      "3+ winners in the signaled direction". The receiver rules were tuned for Family's
      weaker <code>king_ace_count() ≥ 3</code> semantics; this variant adds stronger push /
      take rules that exploit the higher-information signal.
    </li>
    <li>
      <strong>Bid 4 on hand_power + length</strong> — if I have a sig-strong hand AND a 4 or
      5-card suit, skip the bid 2/bid 1 signal and commit directly to bid 4. Tests whether
      some of those "signal 2 → partner pushes to 4" flows would be better served by a
      pre-committed bid 4.
    </li>
    <li>
      <strong>Leading strongest non-trump</strong> — flip the final lead rule from
      <code>hand.nontrump.weakest</code> to <code>hand.nontrump.strongest</code>, per the
      "partner-of-declarer, on control, plays strongest-to-weakest excluding trump" heuristic
      some players use.
    </li>
  </ul>
</section>

<section>
  <h2>Results (N = ${HANDS.toLocaleString()} games per config vs Family)</h2>
  <div class="kpi">
    <div class="box"><div class="value">${winners.length}</div><div class="label">Beat baseline</div></div>
    <div class="box"><div class="value">${losers.length}</div><div class="label">Worse than baseline</div></div>
    <div class="box"><div class="value">${(bestPoint.winRate * 100).toFixed(2)}%</div><div class="label">Best point estimate</div></div>
    <div class="box"><div class="value">${((bestPoint.winRate - baseline.winRate) * 100 >= 0 ? '+' : '')}${((bestPoint.winRate - baseline.winRate) * 100).toFixed(2)}pp</div><div class="label">Best Δ from baseline</div></div>
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

${combined ? `<section>
  <h2>Combined: all winners together</h2>
  <p>If multiple variants beat baseline at p&lt;0.05, combining them may stack their gains.</p>
  <table>
    <thead><tr><th>Config</th><th>Win rate</th><th>Δ baseline</th><th>vs Family</th></tr></thead>
    <tbody>
      <tr class="highlight-row"><td>baseline</td><td class="num">${(baseline.winRate * 100).toFixed(2)}% ±${(baseline.ci95 * 100).toFixed(2)}%</td><td class="num">—</td><td>${(baseline.winRate - baseline.ci95) > 0.5 ? '<span class="tag made">beats</span>' : '<span class="tag family">tied</span>'}</td></tr>
      <tr><td>all winners combined</td><td class="num">${(combined.winRate * 100).toFixed(2)}% ±${(combined.ci95 * 100).toFixed(2)}%</td><td class="num">${((combined.winRate - baseline.winRate) * 100 >= 0 ? '+' : '')}${((combined.winRate - baseline.winRate) * 100).toFixed(2)}pp</td><td>${(combined.winRate - combined.ci95) > 0.5 ? '<span class="tag made">beats Family</span>' : '<span class="tag family">tied</span>'}</td></tr>
    </tbody>
  </table>
</section>` : ''}

<section>
  <h2>Per-variant rationales</h2>
  <table>
    <thead><tr><th>Key</th><th>Rationale</th></tr></thead>
    <tbody>
${rows.map(r => `      <tr><td><code>${esc(r.variant.key)}</code></td><td>${esc(r.variant.rationale)}</td></tr>`).join('\n')}
    </tbody>
  </table>
</section>

<section>
  <h2>Reproduce</h2>
  <pre>node scripts/aces-full-sweep.js
# html-only regen:
node scripts/aces-full-sweep.js -- --html-only</pre>
</section>

</main>
<footer>
  Generated from <code>scripts/aces-full-sweep.js</code>. Source:
  <code>src/simulation/runAcesFullSweep.ts</code>.
</footer>
</body>
</html>`;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  const htmlOnly = process.argv.includes('--html-only');
  const jsonPath = path.join(OUT, 'aces-full-data.json');
  if (htmlOnly && fs.existsSync(jsonPath)) {
    realLog(`--html-only: regenerating from ${jsonPath}`);
    const cached = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const rows: Row[] = cached.rows.map((r: any) => {
      const v = VARIANTS.find(x => x.key === r.variantKey)!;
      return { variant: v, wins: r.wins, losses: r.losses, games: r.games, winRate: r.winRate, ci95: r.ci95 };
    });
    fs.writeFileSync(path.join(OUT, 'aces-full.html'), renderHtml(rows, cached.baseline, cached.combined));
    realLog(`Wrote ${path.join(OUT, 'aces-full.html')}`);
    return;
  }

  realLog('Pre-flight parse check...');
  for (const v of VARIANTS) {
    let text = generateFamilyPoweredTuned(v.params);
    if (v.leadTransform) text = applyLeadingStrongest(text);
    try { parseStrategy(text); }
    catch (e) { throw new Error(`Variant ${v.key} unparseable: ${(e as Error).message}`); }
  }
  realLog(`  all ${VARIANTS.length} variants parse OK`);
  realLog('');

  const pool = generateDeckPool(POOL, SEED);

  realLog(`Baseline (${HANDS.toLocaleString()} games vs Family)...`);
  const baseline = await evalStrategy('baseline', generateFamilyPoweredTuned(BASELINE_PARAMS), pool);
  realLog(`  ${fmtRow('baseline', baseline)}`);
  realLog('');

  realLog(`${VARIANTS.length} variants...`);
  const rows: Row[] = [];
  for (const v of VARIANTS) {
    let text = generateFamilyPoweredTuned(v.params);
    if (v.leadTransform) text = applyLeadingStrongest(text);
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

  // Combine winners
  let combined: Result | undefined;
  if (winners.length >= 2) {
    realLog('Combining winners...');
    // Merge params from each winner; apply lead transform if any winner had it
    let combinedParams: FamilyPoweredParams = { ...BASELINE_PARAMS };
    let combinedLead = false;
    for (const w of winners) {
      combinedParams = { ...combinedParams, ...w.variant.params };
      if (w.variant.leadTransform) combinedLead = true;
    }
    let text = generateFamilyPoweredTuned(combinedParams);
    if (combinedLead) text = applyLeadingStrongest(text);
    try {
      parseStrategy(text);
      combined = await evalStrategy('combined', text, pool);
      realLog(`  ${fmtRow('combined', combined)}`);
    } catch (e) {
      realLog(`  combined transforms conflict: ${(e as Error).message}`);
    }
  }

  const html = renderHtml(rows, baseline, combined);
  fs.writeFileSync(path.join(OUT, 'aces-full.html'), html);
  fs.writeFileSync(path.join(OUT, 'aces-full-data.json'), JSON.stringify({
    meta: { hands: HANDS, pool: POOL, seed: SEED, timestamp: new Date().toISOString() },
    baseline,
    rows: rows.map(r => ({
      variantKey: r.variant.key,
      wins: r.wins, losses: r.losses, games: r.games,
      winRate: r.winRate, ci95: r.ci95,
    })),
    combined,
  }, null, 2));
  realLog(`Wrote ${path.join(OUT, 'aces-full.html')}`);
}

main().catch(err => {
  console.error('Aces-full sweep failed:', err);
  process.exit(1);
});
