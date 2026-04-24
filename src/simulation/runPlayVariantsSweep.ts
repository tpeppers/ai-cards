/**
 * Sweep targeted mutations of the best-so-far Family (Powered) strategy
 * across the bid, leading, following, void, and discard sections. Each
 * variant is a string transform on the baseline strategy text — no DSL
 * changes required. Results are appended to the report as variants.html.
 *
 * Baseline: sig=17, trust=3, bid3 disabled, everything else Family-
 * default. That's the proven-best config from the addendum (beats
 * Family at 50.87% ± 0.69% on 20k games).
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
const NOISE_PREFIXES = ['[Strategy]', 'Bid Whist dealing deck', 'Trick ended, winner'];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? (args[0] as string) : '';
  for (const p of NOISE_PREFIXES) if (first.startsWith(p)) return;
  realLog(...args);
};

const HANDS = Number(process.env.REPORT_HANDS ?? 20000);
const POOL = Number(process.env.REPORT_POOL ?? 3000);
const SEED = Number(process.env.REPORT_SEED ?? 73313);
const OUT = path.resolve(process.cwd(), 'report');

// ── Baseline ──

const BASELINE_PARAMS: FamilyPoweredParams = {
  sigThreshold: 17,
  trustBonus: 3,
  oppPassThreshold: 99,
  dealerLongSuit: 5,
  minStoppers: 0,
  bid3Threshold: 99,            // proven: disable bid 3
  defensiveTakeThreshold: 99,
  defensiveTakeAt5Threshold: 99,
  contestedPushThreshold: 99,
};

const BASELINE_TEXT = generateFamilyPoweredTuned(BASELINE_PARAMS);

// ── Variants ──

interface Variant {
  key: string;
  section: 'bid' | 'leading' | 'following' | 'void' | 'discard';
  label: string;
  rationale: string;
  transform: (text: string) => string;
}

// Tiny helper — validates that a transform actually changes something. If
// the baseline text already matched the "after" state, we'd silently
// measure the baseline again. This is a common mistake — catch it early.
function assertTransformed(before: string, after: string, variantKey: string): void {
  if (before === after) {
    throw new Error(`Variant '${variantKey}' transform was a no-op — the baseline text did not contain the string this variant tries to replace.`);
  }
}

function replaceOnce(text: string, search: string, replacement: string, key: string): string {
  if (!text.includes(search)) {
    throw new Error(`Variant '${key}' — search string not found in baseline:\n${search.substring(0, 200)}`);
  }
  return text.replace(search, replacement);
}

const VARIANTS: Variant[] = [
  // ── Bidding variants ──
  {
    key: 'bid_dealer_open_2',
    section: 'bid',
    label: 'Dealer opens with bid 2 instead of bid 1',
    rationale:
      'When all three opponents pass, the dealer currently bids 1 (downtown signal). ' +
      'This variant opens with bid 2 (uptown signal) instead. Tests the hypothesis ' +
      'that uptown is a safer default direction when the dealer has no info about ' +
      'partner strength.',
    transform: (t) => replaceOnce(t,
      'when is_dealer and bid.current == 0:\n    bid 1',
      'when is_dealer and bid.current == 0:\n    bid 2',
      'bid_dealer_open_2'),
  },
  {
    key: 'bid_no_bid5_via_length',
    section: 'bid',
    label: 'Disable the "bid 5 on 7+ long suit" rule',
    rationale:
      'The early-bidder rule "max_suit_count() >= 7 → bid 5" commits to a 5 contract ' +
      'on length alone without checking for honors. Tests whether removing it helps ' +
      '(too optimistic about bare length) or hurts (missed legit opportunities).',
    transform: (t) => replaceOnce(t,
      '  # 7+ very long suit\n  when bid_count < 2 and max_suit_count() >= 7 and bid.current < 5:\n    bid 5\n',
      '',
      'bid_no_bid5_via_length'),
  },
  {
    key: 'bid_seat3_bid_only_3',
    section: 'bid',
    label: 'Seat-3 bids 3 minimum (not 4) when below 4',
    rationale:
      'The hot-seat rule "always bid 4 if current is below 4" forces a 4 contract even ' +
      'on weak hands. This variant lets seat 3 bid 3 instead when current bid < 3, ' +
      'keeping the commitment lower until the dealer can respond.',
    transform: (t) => replaceOnce(t,
      '  # Always bid at least 4 in seat 3\n  when bid_count == 2 and bid.current < 4:\n    bid 4',
      '  # Seat 3: bid 3 (not 4) when bid is under 3; let dealer sort it out\n  when bid_count == 2 and bid.current < 3:\n    bid 3\n  when bid_count == 2 and bid.current < 4:\n    bid 4',
      'bid_seat3_bid_only_3'),
  },

  // ── Leading-play variants ──
  {
    key: 'lead_pull_trump_min2',
    section: 'leading',
    label: 'Pull trump only when 2+ outstanding',
    rationale:
      'The baseline pulls trump when enemies still have any trump at all — even a ' +
      'single outstanding card. This variant requires at least 2 outstanding before ' +
      'committing a high trump to pull. Saves trump for later trump tricks.',
    transform: (t) => replaceOnce(t,
      '    when on_declarer_team and has_trump and enemy_has_trump and outstanding_trump() > 0:\n      play hand.trump.strongest',
      '    when on_declarer_team and has_trump and enemy_has_trump and outstanding_trump() >= 2:\n      play hand.trump.strongest',
      'lead_pull_trump_min2'),
  },
  {
    key: 'lead_pull_trump_min3',
    section: 'leading',
    label: 'Pull trump only when 3+ outstanding',
    rationale: 'More conservative variant of the 2+ rule — require 3 outstanding trump.',
    transform: (t) => replaceOnce(t,
      '    when on_declarer_team and has_trump and enemy_has_trump and outstanding_trump() > 0:\n      play hand.trump.strongest',
      '    when on_declarer_team and has_trump and enemy_has_trump and outstanding_trump() >= 3:\n      play hand.trump.strongest',
      'lead_pull_trump_min3'),
  },

  // ── Following-play variants ──
  {
    key: 'follow_overtake_1_threat',
    section: 'following',
    label: 'Following: duck partner only if ≤ 1 threat (was 0)',
    rationale:
      'Currently when partner is winning the trick, we only duck (play weakest) if ' +
      'there are ZERO outstanding threats. This variant ducks even with 1 threat — ' +
      'i.e. we\'re more willing to let partner\'s winner ride. Tests whether the ' +
      'overtake logic was too trigger-happy.',
    transform: (t) => replaceOnce(t,
      '    when partner_winning and outstanding_threats() == 0:\n      play hand.suit(lead_suit).weakest',
      '    when partner_winning and outstanding_threats() <= 1:\n      play hand.suit(lead_suit).weakest',
      'follow_overtake_1_threat'),
  },

  // ── Void-play variants ──
  {
    key: 'void_no_signal_first',
    section: 'void',
    label: 'Void: remove "signal first" rule, just trump or default',
    rationale:
      'Baseline: when I\'m void on lead suit, partner isn\'t winning, and I have trump, ' +
      'I trump. Otherwise if I haven\'t signaled yet, I signal with a non-trump discard. ' +
      'This variant removes the signal-first pathway entirely — either trump or play ' +
      'weakest. Tests whether the signal is worth the trump we\'re NOT using when ' +
      'partner wins cheap.',
    transform: (t) => replaceOnce(t,
      '    when not have_signaled and hand.nontrump.count > 0:\n      play hand.nontrump.weakest\n    default:\n      play hand.weakest',
      '    default:\n      play hand.weakest',
      'void_no_signal_first'),
  },
  {
    key: 'void_trump_strongest',
    section: 'void',
    label: 'Void: trump with STRONGEST (not weakest)',
    rationale:
      'When I trump into a trick, baseline plays the weakest trump that will win. ' +
      'This variant plays the strongest trump instead. The gamble: using a big trump ' +
      'guarantees the trick (even if a bigger trump is outstanding) and drains my ' +
      'small trump as "currency" for later tricks.',
    transform: (t) => t
      .replace(
        '    when not partner_winning and has_trump:\n      play hand.trump.weakest',
        '    when not partner_winning and has_trump:\n      play hand.trump.strongest')
      .replace(
        '    when partner_winning and outstanding_threats() > 0 and has_trump:\n      play hand.trump.weakest',
        '    when partner_winning and outstanding_threats() > 0 and has_trump:\n      play hand.trump.strongest'),
  },

  // ── Discard variants ──
  {
    key: 'discard_keep_2',
    section: 'discard',
    label: 'Discard: keep 2 cards per suit (was 1)',
    rationale:
      'When partner signals, baseline keeps 1 card per suit in the discard keep-set. ' +
      'This variant keeps 2 per suit — more conservative suit retention. Tests whether ' +
      'giving up depth for void creation is the right tradeoff.',
    transform: (t) => t.split('keep suit_keepers(1)').join('keep suit_keepers(2)'),
  },
];

// ── Evaluation ──

interface Row {
  variant: Variant;
  wins: number; losses: number; games: number;
  winRate: number; ci95: number;
}

interface BaselineRow {
  wins: number; losses: number; games: number;
  winRate: number; ci95: number;
}

async function evalStrategy(name: string, text: string, pool: string[]): Promise<{
  wins: number; losses: number; games: number; winRate: number; ci95: number;
}> {
  parseStrategy(text); // sanity
  const runner = new BatchRunner();
  const result = await runner.runComparison({
    strategies: [
      { name, strategyText: text },
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

function fmtRow(label: string, wins: number, losses: number, games: number, winRate: number, ci95: number): string {
  return `${label.padEnd(50)}  ${wins}W-${losses}L/${games}  ${(winRate * 100).toFixed(2)}% ±${(ci95 * 100).toFixed(2)}%`;
}

function escapeHtml(s: string): string {
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
    ['claudefam.html', 'ClaudeFam'],
    ['defender.html', 'Defender Preservation'],
  ];
  return `<nav>${pages.map(([href, label]) => {
    const cls = href === active ? ' class="active"' : '';
    return `<a href="${href}"${cls}>${label}</a>`;
  }).join('')}</nav>`;
}

function renderVariantsHtml(rows: Row[], baselineRow: BaselineRow, bestCombined?: BaselineRow): string {
  const sectionGroups: Record<string, Row[]> = {};
  for (const r of rows) {
    const s = r.variant.section;
    if (!sectionGroups[s]) sectionGroups[s] = [];
    sectionGroups[s].push(r);
  }

  const rowHtml = (r: Row) => {
    const delta = (r.winRate - baselineRow.winRate) * 100;
    const lower = (r.winRate - r.ci95) * 100;
    const upper = (r.winRate + r.ci95) * 100;
    const verdict = lower > baselineRow.winRate * 100
      ? '<span class="tag made">beats baseline</span>'
      : upper < baselineRow.winRate * 100
      ? '<span class="tag failed">worse than baseline</span>'
      : '<span class="tag family">tied</span>';
    const vsFamily = (r.winRate - r.ci95) > 0.5
      ? '<span class="tag made">beats Family</span>'
      : (r.winRate + r.ci95) < 0.5
      ? '<span class="tag failed">loses to Family</span>'
      : '<span class="tag family">tied with Family</span>';
    const deltaCls = delta > 0.3 ? 'good' : delta < -0.3 ? 'bad' : '';
    return `
<tr>
<td><code>${escapeHtml(r.variant.key)}</code></td>
<td>${escapeHtml(r.variant.label)}</td>
<td class="num">${(r.winRate * 100).toFixed(2)}% ±${(r.ci95 * 100).toFixed(2)}%</td>
<td class="num ${deltaCls}">${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp</td>
<td>${verdict}</td>
<td>${vsFamily}</td>
</tr>`;
  };

  const bidRows = (sectionGroups.bid ?? []).map(rowHtml).join('\n');
  const leadRows = (sectionGroups.leading ?? []).map(rowHtml).join('\n');
  const followRows = (sectionGroups.following ?? []).map(rowHtml).join('\n');
  const voidRows = (sectionGroups.void ?? []).map(rowHtml).join('\n');
  const discardRows = (sectionGroups.discard ?? []).map(rowHtml).join('\n');

  // Rationales as a separate reference table
  const rationaleRows = rows.map(r => `
<tr>
<td><code>${escapeHtml(r.variant.key)}</code></td>
<td><em>${escapeHtml(r.variant.section)}</em></td>
<td>${escapeHtml(r.variant.rationale)}</td>
</tr>`).join('\n');

  const winners = rows.filter(r => (r.winRate - r.ci95) > baselineRow.winRate);
  const losers = rows.filter(r => (r.winRate + r.ci95) < baselineRow.winRate);
  const ties = rows.length - winners.length - losers.length;

  const combinedSection = bestCombined ? `
<section>
  <h2>Best-of-winners combined</h2>
  <p>
    When more than one variant beat the baseline at p&lt;0.05, their wins are treated as
    potentially orthogonal and combined into a single strategy. Combined measurement:
  </p>
  <table>
    <thead><tr><th>Config</th><th>Win rate</th><th>Δ from baseline</th><th>vs Family</th></tr></thead>
    <tbody>
      <tr class="highlight-row">
        <td>baseline (sig=17, bid3 disabled)</td>
        <td class="num">${(baselineRow.winRate * 100).toFixed(2)}% ±${(baselineRow.ci95 * 100).toFixed(2)}%</td>
        <td class="num">+0.00pp</td>
        <td><span class="tag made">beats</span></td>
      </tr>
      <tr>
        <td>all beats-baseline variants combined</td>
        <td class="num">${(bestCombined.winRate * 100).toFixed(2)}% ±${(bestCombined.ci95 * 100).toFixed(2)}%</td>
        <td class="num ${bestCombined.winRate > baselineRow.winRate ? 'good' : 'bad'}">${((bestCombined.winRate - baselineRow.winRate) * 100 >= 0 ? '+' : '')}${((bestCombined.winRate - baselineRow.winRate) * 100).toFixed(2)}pp</td>
        <td>${(bestCombined.winRate - bestCombined.ci95) > 0.5 ? '<span class="tag made">beats</span>' : '<span class="tag family">tied</span>'}</td>
      </tr>
    </tbody>
  </table>
</section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Variants — hand_power signaling report</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <h1>hand_power signaling: finding the optimal threshold</h1>
  ${navBar('variants.html')}
</header>
<main>

<section>
  <h2>Strategy variants sweep</h2>
  <p>
    The main report tuned the <strong>signal threshold</strong> (sig=17) and the
    <strong>bid-3 rule</strong> (disable). This page sweeps targeted modifications to
    <em>other</em> parts of Family — bidding refinements outside the main signal logic,
    plus the leading, following, void, and discard play sections.
  </p>
  <p>
    Each variant is a single-rule string transform on the baseline Family (Powered)
    strategy text, run head-to-head vs Family at <strong>N = ${HANDS.toLocaleString()}</strong>
    games per config on the same seeded deck pool. Baseline: sig=17 trust=3, bid3 disabled,
    everything else Family-default.
  </p>
  <div class="kpi">
    <div class="box"><div class="value">${rows.length}</div><div class="label">Variants tested</div></div>
    <div class="box"><div class="value">${winners.length}</div><div class="label">Beat baseline</div></div>
    <div class="box"><div class="value">${losers.length}</div><div class="label">Worse than baseline</div></div>
    <div class="box"><div class="value">${ties}</div><div class="label">Tied with baseline</div></div>
  </div>
</section>

<section>
  <h2>Bidding variants</h2>
  <p>
    Changes to the bid section outside the main signal thresholds already explored in
    the main report.
  </p>
  <table>
    <thead><tr><th>Variant key</th><th>Modification</th><th>Win rate</th><th>Δ baseline</th><th>vs baseline</th><th>vs Family</th></tr></thead>
    <tbody>
      <tr class="highlight-row">
        <td><code>baseline</code></td>
        <td>sig=17, bid3 disabled (proven-best from addendum)</td>
        <td class="num">${(baselineRow.winRate * 100).toFixed(2)}% ±${(baselineRow.ci95 * 100).toFixed(2)}%</td>
        <td class="num">—</td>
        <td>—</td>
        <td><span class="tag made">beats</span></td>
      </tr>
${bidRows}
    </tbody>
  </table>
</section>

<section>
  <h2>Leading-play variants</h2>
  <p>How the player chooses a card to lead a new trick.</p>
  <table>
    <thead><tr><th>Variant key</th><th>Modification</th><th>Win rate</th><th>Δ baseline</th><th>vs baseline</th><th>vs Family</th></tr></thead>
    <tbody>
${leadRows}
    </tbody>
  </table>
</section>

<section>
  <h2>Following-play variants</h2>
  <p>How the player chooses a card when following suit.</p>
  <table>
    <thead><tr><th>Variant key</th><th>Modification</th><th>Win rate</th><th>Δ baseline</th><th>vs baseline</th><th>vs Family</th></tr></thead>
    <tbody>
${followRows}
    </tbody>
  </table>
</section>

<section>
  <h2>Void-play variants</h2>
  <p>How the player plays when void in the lead suit (can trump or sluff).</p>
  <table>
    <thead><tr><th>Variant key</th><th>Modification</th><th>Win rate</th><th>Δ baseline</th><th>vs baseline</th><th>vs Family</th></tr></thead>
    <tbody>
${voidRows}
    </tbody>
  </table>
</section>

<section>
  <h2>Discard variants</h2>
  <p>Rules used by the declarer when selecting which 4 cards to discard after taking the kitty.</p>
  <table>
    <thead><tr><th>Variant key</th><th>Modification</th><th>Win rate</th><th>Δ baseline</th><th>vs baseline</th><th>vs Family</th></tr></thead>
    <tbody>
${discardRows}
    </tbody>
  </table>
</section>

${combinedSection}

<section>
  <h2>Variant rationales (full descriptions)</h2>
  <table>
    <thead><tr><th>Key</th><th>Section</th><th>Rationale</th></tr></thead>
    <tbody>
${rationaleRows}
    </tbody>
  </table>
</section>

<section>
  <h2>Reproduce</h2>
  <pre># Full sweep (~5 min)
node scripts/variants-sweep.js

# With custom N
REPORT_HANDS=40000 node scripts/variants-sweep.js</pre>
</section>

</main>
<footer>
  Generated from <code>scripts/variants-sweep.js</code>. Source:
  <code>src/simulation/runPlayVariantsSweep.ts</code>.
</footer>
</body>
</html>`;
}

// ── Main ──

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  const htmlOnly = process.argv.includes('--html-only');
  const jsonPath = path.join(OUT, 'variants-data.json');
  if (htmlOnly && fs.existsSync(jsonPath)) {
    realLog(`Using cached data from ${jsonPath} (--html-only)`);
    const cached = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    // Re-hydrate — the variant metadata needs to be re-matched since JSON
    // loses function references.
    const rows: Row[] = cached.rows.map((r: any) => {
      const v = VARIANTS.find(x => x.key === r.variantKey)!;
      return { variant: v, wins: r.wins, losses: r.losses, games: r.games, winRate: r.winRate, ci95: r.ci95 };
    });
    fs.writeFileSync(
      path.join(OUT, 'variants.html'),
      renderVariantsHtml(rows, cached.baseline, cached.bestCombined),
    );
    realLog(`Wrote ${path.join(OUT, 'variants.html')}`);
    return;
  }

  // Sanity-check all transforms parse before running the sweep — this
  // way a broken regex fails fast, not after 30 seconds of simulation.
  realLog('Pre-flight: verifying all variants parse...');
  for (const v of VARIANTS) {
    const text = v.transform(BASELINE_TEXT);
    assertTransformed(BASELINE_TEXT, text, v.key);
    try {
      parseStrategy(text);
    } catch (e) {
      throw new Error(`Variant '${v.key}' produced unparseable text: ${(e as Error).message}`);
    }
  }
  realLog(`  all ${VARIANTS.length} variants parse OK`);
  realLog('');

  const pool = generateDeckPool(POOL, SEED);

  realLog(`Running baseline (${HANDS.toLocaleString()} games vs Family)...`);
  const base = await evalStrategy('baseline', BASELINE_TEXT, pool);
  realLog(`  ${fmtRow('baseline', base.wins, base.losses, base.games, base.winRate, base.ci95)}`);
  realLog('');

  realLog(`Running ${VARIANTS.length} variants...`);
  const rows: Row[] = [];
  for (const v of VARIANTS) {
    const text = v.transform(BASELINE_TEXT);
    const t0 = Date.now();
    const r = await evalStrategy(v.key, text, pool);
    rows.push({ variant: v, ...r });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    realLog(`  [${dt}s] ${fmtRow(v.key, r.wins, r.losses, r.games, r.winRate, r.ci95)}`);
  }
  realLog('');

  // If any variant beat baseline at p<0.05, try combining them.
  const winners = rows.filter(r => (r.winRate - r.ci95) > base.winRate);
  let bestCombined: BaselineRow | undefined;
  if (winners.length >= 2) {
    realLog(`Combining ${winners.length} beats-baseline variants...`);
    let combinedText = BASELINE_TEXT;
    for (const w of winners) {
      combinedText = w.variant.transform(combinedText);
    }
    try {
      parseStrategy(combinedText);
      const r = await evalStrategy('combined-winners', combinedText, pool);
      bestCombined = r;
      realLog(`  combined: ${fmtRow('combined', r.wins, r.losses, r.games, r.winRate, r.ci95)}`);
    } catch (e) {
      realLog(`  combined transforms conflict: ${(e as Error).message}`);
    }
  } else if (winners.length === 1) {
    realLog(`Only 1 variant beat baseline — no combination needed.`);
  } else {
    realLog(`No variants beat baseline at p<0.05.`);
  }
  realLog('');

  // Write outputs
  const html = renderVariantsHtml(rows, base, bestCombined);
  fs.writeFileSync(path.join(OUT, 'variants.html'), html);

  const data = {
    meta: { hands: HANDS, pool: POOL, seed: SEED, timestamp: new Date().toISOString() },
    baseline: base,
    rows: rows.map(r => ({
      variantKey: r.variant.key,
      wins: r.wins, losses: r.losses, games: r.games,
      winRate: r.winRate, ci95: r.ci95,
    })),
    bestCombined,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  realLog(`Wrote ${path.join(OUT, 'variants.html')}`);
  realLog(`Wrote ${jsonPath}`);
}

main().catch(err => {
  console.error('Variants sweep failed:', err);
  process.exit(1);
});
