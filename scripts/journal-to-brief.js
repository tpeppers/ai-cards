#!/usr/bin/env node
/**
 * Phase 2 of the strategy improvement loop: take a deviation-journal
 * JSON export from the Settings page and turn it into a markdown brief
 * suitable for pasting into a fresh Claude Code conversation.
 *
 * The brief prioritizes decisions where the human diverged from both
 * Family AND ClaudeFam AND the hand's declarer team then made the
 * contract — those are the cases most likely to contain strategy
 * nuance that neither baseline captures.
 *
 * Usage:
 *   node scripts/journal-to-brief.js <journal.json> [--out brief.md]
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { in: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') { args.out = argv[++i]; }
    else if (!args.in) { args.in = a; }
  }
  return args;
}

function loadJournal(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('expected a JSON array of journal entries');
  return data;
}

// Group decisions by handId, attach outcomes.
function groupByHand(entries) {
  const hands = new Map();
  for (const e of entries) {
    if (e.decision) {
      const id = e.decision.handId;
      if (!hands.has(id)) hands.set(id, { handId: id, decisions: [], outcome: null });
      hands.get(id).decisions.push(e.decision);
    } else if (e.outcome) {
      const id = e.outcome.handId;
      if (!hands.has(id)) hands.set(id, { handId: id, decisions: [], outcome: null });
      hands.get(id).outcome = e.outcome;
    }
  }
  return Array.from(hands.values());
}

function pickInteresting(hands) {
  // Bucket hands by "signal class":
  //   A. Diverged from both baselines and the team MADE the contract
  //      (human's choice may be correct and both strategies missed it)
  //   B. Diverged from both and the team FAILED (human chose wrong, or
  //      both strategies would have failed too — useful for counter-examples)
  //   C. Diverged from ClaudeFam only (tunable gap; ClaudeFam could be
  //      improved by learning from this)
  //   D. Diverged from Family only (ClaudeFam already captures it)
  //   E. No divergence (boring — skip)
  //
  // Cap each bucket so the brief doesn't blow up in size.
  const A = [], B = [], C = [], D = [];
  for (const h of hands) {
    if (!h.outcome) continue;
    const divBoth = h.decisions.filter(d => d.divergedFromFamily && d.divergedFromClaudeFam);
    const divClaudeOnly = h.decisions.filter(d => d.divergedFromClaudeFam && !d.divergedFromFamily);
    const divFamilyOnly = h.decisions.filter(d => d.divergedFromFamily && !d.divergedFromClaudeFam);

    if (divBoth.length > 0) {
      if (h.outcome.made) A.push({ hand: h, divergences: divBoth });
      else B.push({ hand: h, divergences: divBoth });
    }
    if (divClaudeOnly.length > 0) C.push({ hand: h, divergences: divClaudeOnly });
    if (divFamilyOnly.length > 0) D.push({ hand: h, divergences: divFamilyOnly });
  }

  const cap = (arr, n) => arr.slice(0, n);
  return {
    bothDivergedAndMade: cap(A, 8),
    bothDivergedAndFailed: cap(B, 5),
    claudeFamDivergedOnly: cap(C, 5),
    familyDivergedOnly: cap(D, 3),
  };
}

function fmtDecision(d) {
  const phase = d.phase === 'bid' ? `Bid ${d.bidCount === 0 ? '1st' : d.bidCount === 1 ? '2nd' : d.bidCount === 2 ? '3rd' : 'dealer'}`
    : d.phase === 'trump' ? 'Trump'
    : d.phase === 'discard' ? 'Discard'
    : `Trick ${d.trickNumber ?? '?'}`;
  const trick = d.currentTrickSoFar && d.currentTrickSoFar.length > 0
    ? ` (lead ${d.leadSuit}, played: ${d.currentTrickSoFar.map(p => `P${p.playerId}:${p.card}`).join(' ')})`
    : '';
  return `**${phase}${trick}** — you: \`${d.humanChoice}\` · ${d.selectedName}: \`${d.selectedChoice}\` · Family: \`${d.familyChoice}\` · ClaudeFam: \`${d.claudeFamChoice}\``;
}

function fmtOutcome(o) {
  if (!o) return '(outcome not recorded)';
  return `**${o.made ? 'MADE' : 'FAILED'}** contract ${o.contract} at ${o.direction} ${o.trumpSuit}; declarer P${o.declarer}; books ${o.declarerTeamBooks}/${o.contract}`;
}

function fmtHandSection(bucket, title) {
  if (bucket.length === 0) return `\n### ${title}\n\n_(none)_\n`;
  const chunks = bucket.map(({ hand, divergences }) => {
    const lines = [
      `#### Deck \`${hand.handId}\``,
      `Replay: \`http://localhost:3000/#${hand.handId}\``,
      `Outcome: ${fmtOutcome(hand.outcome)}`,
      ``,
      ...divergences.map(d => `- ${fmtDecision(d)}`),
    ];
    return lines.join('\n');
  });
  return `\n### ${title}\n\n${chunks.join('\n\n')}\n`;
}

function buildBrief(data) {
  const hands = groupByHand(data);
  const buckets = pickInteresting(hands);
  const totalDecisions = data.filter(e => e.decision).length;
  const totalHands = hands.length;
  const divergences = data.filter(e => e.decision && (e.decision.divergedFromSelected || e.decision.divergedFromFamily || e.decision.divergedFromClaudeFam)).length;

  const lines = [
    `# Bid Whist strategy review — ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `_Generated by \`scripts/journal-to-brief.js\` from a deviation-journal export._`,
    ``,
    `## Session summary`,
    ``,
    `- **Hands played**: ${totalHands}`,
    `- **Human decisions recorded**: ${totalDecisions}`,
    `- **Decisions where human diverged from at least one reference strategy**: ${divergences}`,
    `- **Diverged from BOTH Family and ClaudeFam AND contract made**: ${buckets.bothDivergedAndMade.length}`,
    `- **Diverged from BOTH and contract failed**: ${buckets.bothDivergedAndFailed.length}`,
    ``,
    `## Instructions for the reader`,
    ``,
    `This brief is the "Observe" output of an OODA-loop strategy improvement process.`,
    `The hands below are the ones most likely to contain strategic nuance not captured`,
    `in either \`Family\` or \`ClaudeFam\` as currently implemented. For each bucket:`,
    ``,
    `1. Read the decisions and the outcome.`,
    `2. If the human's choice was right, identify WHY neither baseline saw it.`,
    `3. Propose either a new DSL primitive or a new rule in ClaudeFam that would capture it.`,
    `4. Validate via \`scripts/claudefam-benchmark.js\` or \`scripts/sweep-hand-power.js\`.`,
    `5. If the validation beats baseline at p<0.05 across 20k-game sweeps, commit.`,
    ``,
    `The current best strategy is ClaudeFam — see \`src/strategies/claudeFam.ts\` for the`,
    `annotated source and \`report/claudefam.html\` for benchmarks.`,
    ``,
    fmtHandSection(buckets.bothDivergedAndMade, 'A. Human diverged from BOTH baselines — contract MADE (primary signal)'),
    fmtHandSection(buckets.bothDivergedAndFailed, 'B. Human diverged from BOTH baselines — contract FAILED (counter-examples)'),
    fmtHandSection(buckets.claudeFamDivergedOnly, 'C. Human diverged from ClaudeFam only (ClaudeFam may be missing this)'),
    fmtHandSection(buckets.familyDivergedOnly, 'D. Human diverged from Family only (ClaudeFam already captures this)'),
  ];
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.in) {
    console.error('Usage: node scripts/journal-to-brief.js <journal.json> [--out brief.md]');
    process.exit(1);
  }
  const data = loadJournal(path.resolve(args.in));
  const brief = buildBrief(data);
  const outPath = args.out ? path.resolve(args.out)
    : path.resolve(path.dirname(args.in), path.basename(args.in, path.extname(args.in)) + '-brief.md');
  fs.writeFileSync(outPath, brief);
  console.log(`Wrote ${outPath}`);
  console.log(`${data.length} journal entries → ${brief.split('\n').length} lines of markdown`);
}

main();
