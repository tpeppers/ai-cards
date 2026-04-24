/**
 * Defender-aware variants — addresses the structural gap where opponents
 * of the declarer don't "play to prevent a whisting" the way humans do.
 *
 * Four variants tested vs ClaudeFam baseline, all modifying only the
 * void-play rule to preserve "backing cards" for potential K-becomes-boss
 * winners on the non-declarer team:
 *
 *   DF1: unconditional — when on non-declarer team AND void, sluff from
 *        sluff_candidates() first (preserves K+2 of non-trump suits).
 *   DF2: hand_power gated — apply DF1 only when my hand_power in the
 *        called direction is below a threshold (weak in that direction,
 *        so defending is more valuable than signaling).
 *   DF3: DF1 but replacing the "signal first with weakest non-trump" rule
 *        — more aggressive, drops signalling in favor of preservation.
 *   DF4: DF3 + also applies when partner is declarer (catch-all defense).
 */

import * as fs from 'fs';
import * as path from 'path';
import { BatchRunner } from './BatchRunner.ts';
import { generateDeckPool } from './strategyOptimizer.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { BIDWHIST_FAMILY, BIDWHIST_CLAUDEFAM } from '../strategies/index.ts';

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

// ── Defender-aware ClaudeFam variants ──

// Anchor on a distinctive substring of the void section's signal rule.
// Target the "Safe to signal: first void discard" comment-and-rule pair
// which appears exactly once in the ClaudeFam strategy text.
const SIGNAL_ANCHOR = `    # Safe to signal: first void discard signals the suit to partner.
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest`;

function assertAnchor(text: string): void {
  if (!text.includes(SIGNAL_ANCHOR)) {
    throw new Error('ClaudeFam signal-first anchor not found — strategy text drifted');
  }
}

// DF1: on non-declarer team, prefer sluff_candidates before the existing
//      signal-first rule. Signal-first still runs as fallback.
const DF1_INSERT = `    # DF1: defender preserves potential winners + backing
    when not on_declarer_team and sluff_candidates().count > 0:
      play sluff_candidates().weakest
${SIGNAL_ANCHOR}`;

// DF2: DF1 but gated by weakness in the called direction.
const DF2_INSERT = `    # DF2: weak defender protects backing cards (uptown branch)
    when not on_declarer_team and bid_direction == "uptown" and hand_power(uptown) <= 6 and sluff_candidates().count > 0:
      play sluff_candidates().weakest
    when not on_declarer_team and bid_direction != "uptown" and hand_power(downtown) <= 6 and sluff_candidates().count > 0:
      play sluff_candidates().weakest
${SIGNAL_ANCHOR}`;

// DF3: replaces the signal-first rule for defenders entirely.
const DF3_INSERT = `    # DF3: defender prefers sluff_candidates; otherwise weakest anything
    when not on_declarer_team and sluff_candidates().count > 0:
      play sluff_candidates().weakest
    when not on_declarer_team:
      play hand.weakest
${SIGNAL_ANCHOR}`;

// DF4: apply sluff_candidates universally (both teams) BEFORE signal.
const DF4_INSERT = `    # DF4: backing preservation for both teams
    when sluff_candidates().count > 0:
      play sluff_candidates().weakest
${SIGNAL_ANCHOR}`;

function replaceVoid(baseText: string, newRuleBlock: string): string {
  assertAnchor(baseText);
  return baseText.replace(SIGNAL_ANCHOR, newRuleBlock);
}

interface Variant {
  key: string;
  label: string;
  rationale: string;
  makeText: () => string;
}

const VARIANTS: Variant[] = [
  {
    key: 'DF1_defender_unconditional',
    label: 'Defender-only, preserves backing (unconditional)',
    rationale: 'When on the non-declarer team and void, prefer sluff_candidates() (cards that are NOT a potential winner or its backing card). Preserves K+2 of a non-trump suit so the K becomes a boss after A is played — prevents the opponents from being whisted when declarer has a strong hand.',
    makeText: () => replaceVoid(BIDWHIST_CLAUDEFAM, DF1_INSERT),
  },
  {
    key: 'DF2_weak_defender_only',
    label: 'Only when I\'m weak in the called direction',
    rationale: 'Apply DF1 behavior only when I have low hand_power in the direction the declarer called (<= 6). Defensive preservation matters more when I have no realistic path to winning tricks by power.',
    makeText: () => replaceVoid(BIDWHIST_CLAUDEFAM, DF2_INSERT),
  },
  {
    key: 'DF3_defender_replace_signal',
    label: 'Defender: replace signal-first rule entirely',
    rationale: 'DF1 plus: don\'t signal via discard when on defense (the signal matters less than saving books). Preserve backing cards aggressively; sluff purely low otherwise.',
    makeText: () => replaceVoid(BIDWHIST_CLAUDEFAM, DF3_INSERT),
  },
  {
    key: 'DF4_universal',
    label: 'Preserve backing universally (both teams)',
    rationale: 'Apply sluff_candidates preference regardless of declarer team. Tests whether backing-preservation is a general good, not just a defender thing.',
    makeText: () => replaceVoid(BIDWHIST_CLAUDEFAM, DF4_INSERT),
  },
];

// ── Eval helper ──

async function evalVs(
  candidateName: string, candidateText: string,
  opponentName: string, opponentText: string,
  pool: string[],
) {
  const runner = new BatchRunner();
  const result = await runner.runComparison({
    strategies: [
      { name: candidateName, strategyText: candidateText },
      { name: opponentName, strategyText: opponentText },
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

function fmtRow(label: string, r: { wins: number; losses: number; games: number; winRate: number; ci95: number }): string {
  return `${label.padEnd(52)}  ${r.wins}W-${r.losses}L/${r.games}  ${(r.winRate * 100).toFixed(2)}% ±${(r.ci95 * 100).toFixed(2)}%`;
}

// ── HTML rendering ──

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
    ['claudefam.html', 'ClaudeFam'],
    ['defender.html', 'Defender Preservation'],
  ];
  return `<nav>${pages.map(([href, label]) => {
    const cls = href === active ? ' class="active"' : '';
    return `<a href="${href}"${cls}>${label}</a>`;
  }).join('')}</nav>`;
}

interface VariantResult {
  variant: Variant;
  vsBaseline: { wins: number; losses: number; games: number; winRate: number; ci95: number };
  vsFamily: { wins: number; losses: number; games: number; winRate: number; ci95: number };
}

function renderHtml(results: VariantResult[], baselineVsFamily: { winRate: number; ci95: number; games: number; wins: number; losses: number }): string {
  const rowHtml = (r: VariantResult) => {
    const deltaBase = r.vsBaseline.winRate - 0.5;
    const vsBaseVerdict = (r.vsBaseline.winRate - r.vsBaseline.ci95) > 0.5
      ? '<span class="tag made">beats ClaudeFam</span>'
      : (r.vsBaseline.winRate + r.vsBaseline.ci95) < 0.5
      ? '<span class="tag failed">worse than ClaudeFam</span>'
      : '<span class="tag family">tied with ClaudeFam</span>';
    const vsFamilyVerdict = (r.vsFamily.winRate - r.vsFamily.ci95) > 0.5
      ? '<span class="tag made">beats Family</span>'
      : (r.vsFamily.winRate + r.vsFamily.ci95) < 0.5
      ? '<span class="tag failed">loses to Family</span>'
      : '<span class="tag family">tied with Family</span>';
    const deltaCls = deltaBase > 0.003 ? 'good' : deltaBase < -0.003 ? 'bad' : '';
    return `<tr>
<td><code>${esc(r.variant.key)}</code></td>
<td>${esc(r.variant.label)}</td>
<td class="num">${(r.vsBaseline.winRate * 100).toFixed(2)}% ±${(r.vsBaseline.ci95 * 100).toFixed(2)}%</td>
<td class="num ${deltaCls}">${(deltaBase * 100 >= 0 ? '+' : '') + (deltaBase * 100).toFixed(2)}pp</td>
<td>${vsBaseVerdict}</td>
<td class="num">${(r.vsFamily.winRate * 100).toFixed(2)}% ±${(r.vsFamily.ci95 * 100).toFixed(2)}%</td>
<td>${vsFamilyVerdict}</td>
</tr>`;
  };

  const winners = results.filter(r => (r.vsBaseline.winRate - r.vsBaseline.ci95) > 0.5);
  const losers = results.filter(r => (r.vsBaseline.winRate + r.vsBaseline.ci95) < 0.5);
  const bestPoint = [...results].sort((a, b) => b.vsBaseline.winRate - a.vsBaseline.winRate)[0];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Defender Preservation — hand_power signaling report</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <h1>hand_power signaling: finding the optimal threshold</h1>
  ${navBar('defender.html')}
</header>
<main>

<section>
  <h2>Preventing whistings by preserving non-trump backing cards</h2>
  <p>
    The <a href="claudefam.html">ClaudeFam benchmark</a> surfaced an 18.7% whisting rate in
    simulated self-play — well above real-life Bid Whist (~2-5%). The suspected cause: defenders
    (the non-declarer team) don't "play to prevent a whisting" the way humans do. In particular,
    when a defender is void in the lead suit and sluffs non-trump, the current rule picks the
    globally-weakest non-trump card. That often throws away the <em>backing card</em> for a
    potential K-becomes-boss winner.
  </p>
  <p>
    Worked example: I hold K♥ and 2♥ (non-trump, trump is spades). Declarer called uptown. A♥
    is still outstanding. If I later have to sluff, I should sluff something OTHER than the 2♥:
    keeping K+2 means when the A♥ is eventually played, I play my 2♥ against it, and my K♥
    becomes boss — I make that book for our team later, preventing the whisting. If I sluff
    the 2♥ early, I'm left with a bare K♥ that gets beaten by the A♥ when the suit is led,
    and the K is wasted.
  </p>
  <p>
    Implementation: a new <code>sluff_candidates()</code> DSL primitive that returns my
    non-trump cards EXCLUDING the (highest, lowest) pair of each suit where the highest isn't
    already boss. Four ClaudeFam variants then modify the void-play rule to prefer
    sluff_candidates over weakest-non-trump, under different gating:
  </p>
  <ul>
    <li><strong>DF1</strong> — unconditional defender preservation</li>
    <li><strong>DF2</strong> — defender preservation only when I'm weak in the called direction</li>
    <li><strong>DF3</strong> — DF1 but replaces the signal-first rule entirely (no more discard signals when on defense)</li>
    <li><strong>DF4</strong> — applies the preference to both teams (sanity check)</li>
  </ul>
</section>

<section>
  <h2>Results (N = ${HANDS.toLocaleString()} games per matchup)</h2>
  <div class="kpi">
    <div class="box"><div class="value">${winners.length}</div><div class="label">Beat baseline</div></div>
    <div class="box"><div class="value">${losers.length}</div><div class="label">Worse than baseline</div></div>
    <div class="box"><div class="value">${(bestPoint.vsBaseline.winRate * 100).toFixed(2)}%</div><div class="label">Best vs ClaudeFam</div></div>
    <div class="box"><div class="value">${(bestPoint.vsBaseline.winRate * 100 - 50 >= 0 ? '+' : '') + ((bestPoint.vsBaseline.winRate - 0.5) * 100).toFixed(2)}pp</div><div class="label">Best Δ from ClaudeFam</div></div>
  </div>
  <p>
    <strong>Baseline ClaudeFam vs Family</strong> on the same pool/seed:
    <strong>${(baselineVsFamily.winRate * 100).toFixed(2)}% ± ${(baselineVsFamily.ci95 * 100).toFixed(2)}%</strong>
    (${baselineVsFamily.wins}W-${baselineVsFamily.losses}L/${baselineVsFamily.games}). Each variant's
    "vs Family" column compares directly to Family so you can see whether the change extends or
    erodes ClaudeFam's advantage.
  </p>
  <table>
    <thead>
      <tr>
        <th>Variant</th>
        <th>Modification</th>
        <th>vs ClaudeFam win rate</th>
        <th>Δ from 50%</th>
        <th>vs ClaudeFam</th>
        <th>vs Family win rate</th>
        <th>vs Family</th>
      </tr>
    </thead>
    <tbody>
${results.map(rowHtml).join('\n')}
    </tbody>
  </table>
</section>

<section>
  <h2>Interpretation: why the rule backfired</h2>
  <p>
    All four variants landed 1.5pp BELOW ClaudeFam. The structural hypothesis looked sound —
    and on hand-picked scenarios it does preserve the K-becomes-boss dynamic the human
    heuristic relies on. But the aggregate sweep reveals an interaction I didn't account for:
    <strong>the rule corrupts the void-signal protocol</strong>.
  </p>
  <p>
    Under the existing ClaudeFam <code>void:</code> rule, <code>hand.nontrump.weakest</code>
    naturally picks the lowest-rank card, which in most hands is from my SHORTEST non-trump
    suit (because short suits contain low cards). That discard is read by my partner via
    their leading rule:
  </p>
  <pre>leading:
  when partner_signal != "" and hand.suit(partner_signal).count &gt; 0:
    play hand.suit(partner_signal).weakest</pre>
  <p>
    — partner leads back the suit I first discarded on, expecting me to trump (because I
    appeared to be void in it). The "signal by first void discard" is the whole mechanism of
    the partnership's mid-game coordination.
  </p>
  <p>
    My new <code>sluff_candidates()</code> rule picks a middle card from a LONG non-trump
    suit (because the short suit's cards are often the protected potential-winner or its
    backing). Partner then reads "you're void in that long suit" — but I'm actually still
    holding several cards there. Partner leads it back, I follow suit instead of trumping,
    partner's tactic backfires. The value lost to corrupted signals exceeds the value
    gained from preserving backing cards.
  </p>
  <p>
    Specifically: the variants with unconditional application (DF1, DF3, DF4) all land at
    essentially the same win rate (48.5%), while the weakness-gated DF2 lost less (49.3%).
    That's consistent with the signal-corruption theory — DF2 only changes behavior on hands
    where I'm weak in the called direction, which is a smaller fraction of deals, so the
    signal corruption is narrower too.
  </p>
</section>

<section>
  <h2>What this suggests for the next iteration</h2>
  <p>
    The human heuristic is real — the issue is that it assumes the void-signal protocol
    <em>doesn't need to be preserved</em> when you're defending. In real play, an experienced
    partnership might treat "I'm on defense and declarer is threatening a whisting" as a
    context where signal-via-void is less valuable than book-preservation. Encoding that
    tradeoff would need either:
  </p>
  <ul>
    <li>A rule that sluffs from a SHORT suit with no backing issues first, only falling back
      to middle-of-long-suit when the short suit is fully protected. This would need a DSL
      primitive for the intersection of <code>void_candidates()</code> and
      <code>sluff_candidates()</code>.</li>
    <li>A "defender signal override" — recognize when the context makes the void signal
      low-value (e.g., partner won't have a chance to lead back before the hand ends) and
      apply preservation there.</li>
    <li>Leave the signal rule alone but override the FOLLOWING rule instead — when I have to
      follow suit and my only choices are "play backing card" or "play potential winner", pick
      the one that preserves the K-as-future-boss outcome. (Though I suspect the existing
      <code>hand.suit(lead_suit).weakest</code> already does this in most cases.)</li>
  </ul>
  <p>
    Another useful diagnostic would be to measure the whisting-rate change directly across
    variants: if DF1-DF4 lower the self-play whisting rate from 18.7% even while hurting win
    rate, that would confirm the primitive captures the intended behavior — it's just being
    outweighed by signal corruption. Not tested in this sweep.
  </p>
</section>

<section>
  <h2>Rationales</h2>
  <table>
    <thead><tr><th>Key</th><th>Rationale</th></tr></thead>
    <tbody>
${results.map(r => `      <tr><td><code>${esc(r.variant.key)}</code></td><td>${esc(r.variant.rationale)}</td></tr>`).join('\n')}
    </tbody>
  </table>
</section>

<section>
  <h2>Reproduce</h2>
  <pre>node scripts/defender-sweep.js
# html-only regen:
node scripts/defender-sweep.js -- --html-only</pre>
</section>

</main>
<footer>
  Generated from <code>scripts/defender-sweep.js</code>. Source:
  <code>src/simulation/runDefenderSweep.ts</code>.
</footer>
</body>
</html>`;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  const htmlOnly = process.argv.includes('--html-only');
  const jsonPath = path.join(OUT, 'defender-data.json');
  if (htmlOnly && fs.existsSync(jsonPath)) {
    realLog(`--html-only: regenerating from ${jsonPath}`);
    const cached = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const results: VariantResult[] = cached.results.map((r: any) => {
      const v = VARIANTS.find(x => x.key === r.variantKey)!;
      return { variant: v, vsBaseline: r.vsBaseline, vsFamily: r.vsFamily };
    });
    fs.writeFileSync(path.join(OUT, 'defender.html'), renderHtml(results, cached.baselineVsFamily));
    realLog(`Wrote ${path.join(OUT, 'defender.html')}`);
    return;
  }

  realLog('Pre-flight parse check...');
  for (const v of VARIANTS) {
    try { parseStrategy(v.makeText()); }
    catch (e) { throw new Error(`Variant ${v.key} unparseable: ${(e as Error).message}`); }
  }
  realLog(`  all ${VARIANTS.length} variants parse OK`);
  realLog('');

  const pool = generateDeckPool(POOL, SEED);

  realLog(`Baseline ClaudeFam vs Family (${HANDS.toLocaleString()} games)...`);
  const baselineVsFamily = await evalVs('ClaudeFam', BIDWHIST_CLAUDEFAM, 'Family', BIDWHIST_FAMILY, pool);
  realLog(`  ${fmtRow('ClaudeFam vs Family', baselineVsFamily)}`);
  realLog('');

  realLog(`${VARIANTS.length} variants, each vs ClaudeFam AND vs Family...`);
  const results: VariantResult[] = [];
  for (const v of VARIANTS) {
    const text = v.makeText();
    const t0 = Date.now();
    const vsBaseline = await evalVs(v.key, text, 'ClaudeFam', BIDWHIST_CLAUDEFAM, pool);
    const vsFamily = await evalVs(v.key, text, 'Family', BIDWHIST_FAMILY, pool);
    results.push({ variant: v, vsBaseline, vsFamily });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    realLog(`  [${dt}s] ${fmtRow(v.key, vsBaseline)}  |  vs Family: ${(vsFamily.winRate * 100).toFixed(2)}%`);
  }
  realLog('');

  const winners = results.filter(r => (r.vsBaseline.winRate - r.vsBaseline.ci95) > 0.5);
  realLog(`Summary: ${winners.length} beat ClaudeFam at p<0.05`);

  const html = renderHtml(results, baselineVsFamily);
  fs.writeFileSync(path.join(OUT, 'defender.html'), html);
  fs.writeFileSync(path.join(OUT, 'defender-data.json'), JSON.stringify({
    meta: { hands: HANDS, pool: POOL, seed: SEED, timestamp: new Date().toISOString() },
    baselineVsFamily,
    results: results.map(r => ({
      variantKey: r.variant.key,
      vsBaseline: r.vsBaseline,
      vsFamily: r.vsFamily,
    })),
  }, null, 2));
  realLog(`Wrote ${path.join(OUT, 'defender.html')}`);
}

main().catch(err => {
  console.error('Defender sweep failed:', err);
  process.exit(1);
});
