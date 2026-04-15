/**
 * CLI entry point for the strategy optimizer.
 * Bundled and executed by scripts/optimize-strategy.js.
 *
 * Usage (through the driver):
 *   node scripts/optimize-strategy.js [--pop N] [--elite K] [--gens G]
 *                                     [--hands H] [--pool P] [--mutation R]
 *                                     [--seed S] [--out path.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  runOptimizer,
  OptimizerOptions,
  evaluateFitness,
  generateDeckPool,
} from './strategyOptimizer.ts';
import { SIGNAL_LAB_PRESETS } from './signalLab.ts';
import { STRATEGY_REGISTRY } from '../strategies/index.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';

// Silence existing unconditional debug logs from the simulator so
// optimizer output stays readable. setStrategyDebug kills the
// [Strategy] rule-trace spam; the console wrapper drops the
// per-deal / per-trick lines emitted from BidWhistGame and CardGame.
setStrategyDebug(false);
const NOISE_PREFIXES = [
  '[Strategy]',
  'Bid Whist dealing deck',
  'Trick ended, winner',
];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? (args[0] as string) : '';
  for (const p of NOISE_PREFIXES) if (first.startsWith(p)) return;
  realLog(...args);
};

interface ParsedArgs {
  pop: number;
  elite: number;
  gens: number;
  hands: number;
  pool: number;
  mutation: number;
  seed: number;
  holdoutHands: number;
  holdoutSeed: number;
  out: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const defaults: ParsedArgs = {
    pop: 16,
    elite: 4,
    gens: 20,
    hands: 400,
    pool: 200,
    mutation: 0.2,
    seed: 42,
    holdoutHands: 2000,
    holdoutSeed: 9999,
    out: path.join(process.cwd(), 'optimized-strategy.json'),
  };
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--pop':           out.pop = parseInt(next, 10); i++; break;
      case '--elite':         out.elite = parseInt(next, 10); i++; break;
      case '--gens':          out.gens = parseInt(next, 10); i++; break;
      case '--hands':         out.hands = parseInt(next, 10); i++; break;
      case '--pool':          out.pool = parseInt(next, 10); i++; break;
      case '--mutation':      out.mutation = parseFloat(next); i++; break;
      case '--seed':          out.seed = parseInt(next, 10); i++; break;
      case '--holdout-hands': out.holdoutHands = parseInt(next, 10); i++; break;
      case '--holdout-seed':  out.holdoutSeed = parseInt(next, 10); i++; break;
      case '--out':           out.out = next; i++; break;
    }
  }
  return out;
}

function fmt(n: number, digits = 3): string {
  return n.toFixed(digits);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('── Strategy Optimizer ──────────────────────────────────');
  console.log(`population=${args.pop}  elite=${args.elite}  generations=${args.gens}`);
  console.log(`hands/eval=${args.hands}  deck pool=${args.pool}  mutation rate=${args.mutation}`);
  console.log(`training seed=${args.seed}  holdout seed=${args.holdoutSeed}  holdout hands=${args.holdoutHands}`);
  console.log('');

  // Seed initial population with every known preset so the optimizer
  // has strong starting points. Put the Family preset first so it
  // anchors the population even if pop size is small.
  const familyPreset = SIGNAL_LAB_PRESETS.find(p => p.name.toLowerCase().startsWith('family'));
  const otherPresets = SIGNAL_LAB_PRESETS.filter(p => p !== familyPreset);
  const seedConfigs = familyPreset ? [familyPreset, ...otherPresets] : SIGNAL_LAB_PRESETS.slice();

  // Diagnostic: evaluate every preset on the held-out pool first.
  // This tells us the ceiling of the parameter space before the
  // optimizer even starts, which is essential for interpreting the
  // gap between training and held-out fitness.
  const familyEntry = STRATEGY_REGISTRY.find(s => s.name === 'Family');
  if (!familyEntry) throw new Error('Family strategy not found in registry');

  console.log('── Preset holdout diagnostics (vs hand-written Family) ─');
  const diagPool = generateDeckPool(args.pool * 2, args.holdoutSeed);
  const seedFitnesses: Array<{ winRate: number; wins: number; losses: number; games: number }> = [];
  for (const preset of seedConfigs) {
    const f = await evaluateFitness(preset, familyEntry.text, diagPool, args.holdoutHands);
    seedFitnesses.push(f);
    console.log(
      `  ${preset.name.padEnd(38)}  ${fmt(f.winRate)}  (${f.wins}W-${f.losses}L of ${f.games})`
    );
  }
  console.log('');

  const opts: OptimizerOptions = {
    populationSize: args.pop,
    eliteSize: args.elite,
    generations: args.gens,
    handsPerEval: args.hands,
    deckPoolSize: args.pool,
    mutationRate: args.mutation,
    seed: args.seed,
    seedConfigs,
    seedFitnesses,
  };

  const startTime = Date.now();

  const { best, history } = await runOptimizer(opts, (report) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `gen ${String(report.generation).padStart(3)}/${args.gens}  ` +
      `best=${fmt(report.bestFitness)}  mean=${fmt(report.meanFitness)}  ` +
      `(${report.best.fitness.wins}W-${report.best.fitness.losses}L of ${report.best.fitness.games})  ` +
      `t=${elapsed}s`
    );
  });

  console.log('');
  console.log('── Training complete ───────────────────────────────────');
  console.log(`Best training fitness: ${fmt(best.fitness.winRate)} (${best.fitness.wins}W-${best.fitness.losses}L of ${best.fitness.games})`);
  console.log('');

  // Held-out evaluation: reuse the same pool used for diagnostics so
  // the optimizer's best is judged on exactly the same deck set as
  // the presets were at startup (apples-to-apples).
  console.log(`Evaluating best on held-out deck pool (seed=${args.holdoutSeed}, hands=${args.holdoutHands})...`);
  const holdout = await evaluateFitness(best.config, familyEntry.text, diagPool, args.holdoutHands);

  // Identify the best preset from the diagnostic for comparison.
  let bestPresetIdx = 0;
  for (let i = 1; i < seedFitnesses.length; i++) {
    if (seedFitnesses[i].winRate > seedFitnesses[bestPresetIdx].winRate) bestPresetIdx = i;
  }
  const bestPreset = seedConfigs[bestPresetIdx];
  const bestPresetFitness = seedFitnesses[bestPresetIdx];
  console.log('');
  console.log('── Baseline comparison ────────────────────────────────');
  console.log(`Best preset (${bestPreset.name}):  ${fmt(bestPresetFitness.winRate)}  (${bestPresetFitness.wins}W-${bestPresetFitness.losses}L of ${bestPresetFitness.games})`);
  console.log(`Optimizer best:  ${fmt(holdout.winRate)}  (${holdout.wins}W-${holdout.losses}L of ${holdout.games})`);
  const improvement = holdout.winRate - bestPresetFitness.winRate;
  if (improvement > 0) {
    console.log(`→ Optimizer beats best preset by ${fmt(improvement * 100, 2)} pp`);
  } else {
    console.log(`→ Optimizer did NOT beat best preset (${fmt(improvement * 100, 2)} pp)`);
  }
  console.log(`Held-out fitness: ${fmt(holdout.winRate)} (${holdout.wins}W-${holdout.losses}L of ${holdout.games})`);
  console.log('');

  // Save results
  const output = {
    meta: {
      timestamp: new Date().toISOString(),
      args,
      trainingFitness: best.fitness,
      holdoutFitness: holdout,
      elapsedSeconds: (Date.now() - startTime) / 1000,
      bestPresetName: bestPreset.name,
      bestPresetFitness,
      optimizerImprovementPp: improvement * 100,
    },
    bestConfig: best.config,
    bestPresetConfig: bestPreset,
    presetDiagnostics: seedConfigs.map((c, i) => ({
      name: c.name,
      fitness: seedFitnesses[i],
    })),
    history: history.map(h => ({
      generation: h.generation,
      bestFitness: h.bestFitness,
      meanFitness: h.meanFitness,
      bestConfigName: h.best.config.name,
    })),
  };

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Saved best config to ${outPath}`);
}

main().catch(err => {
  console.error('Optimizer failed:', err);
  process.exit(1);
});
