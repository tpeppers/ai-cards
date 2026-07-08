/**
 * CLI entry point for the trump-lean weight optimizer: fits
 * TrumpLeanParams (see src/strategies/trumpLean.ts) with the generic
 * evolutionary loop, scoring candidates head-to-head against the
 * reigning champion "ClaudeFam (Roles+MTC+CP)".
 *
 * Bundled and executed by scripts/trump-lean-optimize.js.
 *
 * Usage (through the driver):
 *   node scripts/trump-lean-optimize.js [-- --pop N --elite K --gens G
 *     --hands H --pool P --mutation R --seed S
 *     --holdout-hands HH --holdout-seed HS --out path.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import { BatchRunner } from './BatchRunner.ts';
import {
  runGenericOptimizer,
  GenericOptimizerHooks,
  GenericOptimizerOptions,
  FitnessResult,
  generateDeckPool,
} from './strategyOptimizer.ts';
import { TrumpLeanParams, generateTrumpLeanStrategy } from '../strategies/trumpLean.ts';
import { BIDWHIST_CLAUDEFAM_ROLES_MTC_CP } from '../strategies/claudeFamRoles.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';

// Silence existing unconditional debug logs from the simulator so
// optimizer output stays readable.
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

const OPPONENT = { name: 'ClaudeFam (Roles+MTC+CP)', text: BIDWHIST_CLAUDEFAM_ROLES_MTC_CP };

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
    gens: 12,
    hands: 2000,
    pool: 500,
    mutation: 0.25,
    seed: 42,
    holdoutHands: 20000,
    holdoutSeed: 999999,
    out: path.join(process.cwd(), 'report', 'trump-lean-optimizer.json'),
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

// ── TrumpLeanParams hooks ────────────────────────────────────────────

function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function choice<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

type IntKey = 'pTrust' | 'eCounter' | 'upBias' | 'noacesBias';

const INT_SPECS: Array<{ key: IntKey; min: number; max: number }> = [
  { key: 'pTrust',     min: 0,  max: 5 },
  { key: 'eCounter',   min: 0,  max: 4 },
  { key: 'upBias',     min: -2, max: 2 },
  { key: 'noacesBias', min: -2, max: 2 },
];

// Field order for mutation/crossover sweeps: mode, ints, contestedPower.
const FIELD_COUNT = 2 + INT_SPECS.length;

function randomParams(rng: () => number, _name: string): TrumpLeanParams {
  return {
    mode: rng() < 0.5 ? 'net' : 'cover',
    pTrust: randInt(rng, 0, 5),
    eCounter: randInt(rng, 0, 4),
    upBias: randInt(rng, -2, 2),
    noacesBias: randInt(rng, -2, 2),
    contestedPower: rng() < 0.5,
  };
}

function mutateIntField(out: TrumpLeanParams, spec: { key: IntKey; min: number; max: number }, rng: () => number): void {
  const current = out[spec.key];
  // Small step: ±1 or ±2, clipped (mirrors mutateConfig's style).
  const step = rng() < 0.7 ? (rng() < 0.5 ? -1 : 1) : (rng() < 0.5 ? -2 : 2);
  let v = current + step;
  if (v < spec.min) v = spec.min;
  if (v > spec.max) v = spec.max;
  if (v === current) v = randInt(rng, spec.min, spec.max);
  out[spec.key] = v;
}

function mutateField(out: TrumpLeanParams, fieldIdx: number, rng: () => number): void {
  if (fieldIdx === 0) {
    out.mode = out.mode === 'net' ? 'cover' : 'net';
  } else if (fieldIdx <= INT_SPECS.length) {
    mutateIntField(out, INT_SPECS[fieldIdx - 1], rng);
  } else {
    out.contestedPower = !out.contestedPower;
  }
}

function mutateParams(c: TrumpLeanParams, rng: () => number, rate: number, _name: string): TrumpLeanParams {
  const out: TrumpLeanParams = { ...c };
  // Ensure at least one mutation happens
  let mutated = false;
  for (let f = 0; f < FIELD_COUNT; f++) {
    if (rng() < rate) {
      mutateField(out, f, rng);
      mutated = true;
    }
  }
  if (!mutated) {
    mutateField(out, randInt(rng, 0, FIELD_COUNT - 1), rng);
  }
  return out;
}

function crossoverParams(a: TrumpLeanParams, b: TrumpLeanParams, rng: () => number, _name: string): TrumpLeanParams {
  const out: TrumpLeanParams = { ...a };
  if (rng() < 0.5) out.mode = b.mode;
  for (const spec of INT_SPECS) {
    if (rng() < 0.5) out[spec.key] = b[spec.key];
  }
  if (rng() < 0.5) out.contestedPower = b.contestedPower;
  return out;
}

// Canonical short summary. Cover mode omits pTrust/eCounter (they do not
// affect the generated strategy text), so functionally identical configs
// dedupe to the same string.
function describeParams(c: TrumpLeanParams): string {
  const cp = c.contestedPower ? 'Y' : 'N';
  if (c.mode === 'cover') {
    return `cover up=${c.upBias} na=${c.noacesBias} cp=${cp}`;
  }
  return `net pT=${c.pTrust} eC=${c.eCounter} up=${c.upBias} na=${c.noacesBias} cp=${cp}`;
}

async function evaluateParams(candidate: TrumpLeanParams, pool: string[], hands: number): Promise<FitnessResult> {
  let candidateText: string;
  try {
    candidateText = generateTrumpLeanStrategy('candidate', candidate);
  } catch (e) {
    return { winRate: 0, wins: 0, losses: 0, games: 0 };
  }

  const runner = new BatchRunner();
  let result;
  try {
    result = await runner.runComparison({
      strategies: [
        { name: 'candidate', strategyText: candidateText },
        { name: OPPONENT.name, strategyText: OPPONENT.text },
      ],
      assignmentMode: 'round-robin',
      numHands: hands,
      predefinedDeckUrls: pool,
    });
  } catch (e) {
    return { winRate: 0, wins: 0, losses: 0, games: 0 };
  }

  const sw = result.summary.strategyWins ?? [0, 0];
  const sg = result.summary.strategyGames ?? [0, 0];
  const wins = sw[0] ?? 0;
  const losses = sw[1] ?? 0;
  const games = sg[0] ?? (wins + losses);
  return {
    winRate: games > 0 ? wins / games : 0,
    wins,
    losses,
    games,
  };
}

const HOOKS: GenericOptimizerHooks<TrumpLeanParams> = {
  evaluate: evaluateParams,
  mutate: mutateParams,
  crossover: crossoverParams,
  random: randomParams,
  describe: describeParams,
};

const SEED_CANDIDATES: TrumpLeanParams[] = [
  { mode: 'net',   pTrust: 2, eCounter: 1, upBias: 0, noacesBias: 0, contestedPower: true },
  { mode: 'cover', pTrust: 0, eCounter: 0, upBias: 0, noacesBias: 0, contestedPower: true },
  { mode: 'net',   pTrust: 3, eCounter: 0, upBias: 0, noacesBias: 0, contestedPower: false },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('── Trump Lean Optimizer ────────────────────────────────');
  console.log(`opponent=${OPPONENT.name}`);
  console.log(`population=${args.pop}  elite=${args.elite}  generations=${args.gens}`);
  console.log(`hands/eval=${args.hands}  deck pool=${args.pool}  mutation rate=${args.mutation}`);
  console.log(`training seed=${args.seed}  holdout seed=${args.holdoutSeed}  holdout hands=${args.holdoutHands}`);
  console.log('');

  const opts: GenericOptimizerOptions<TrumpLeanParams> = {
    populationSize: args.pop,
    eliteSize: args.elite,
    generations: args.gens,
    handsPerEval: args.hands,
    deckPoolSize: args.pool,
    mutationRate: args.mutation,
    seed: args.seed,
    hooks: HOOKS,
    seedCandidates: SEED_CANDIDATES,
  };

  const startTime = Date.now();

  const { best, history } = await runGenericOptimizer(opts, (report) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `gen ${String(report.generation).padStart(3)}/${args.gens}  ` +
      `best=${fmt(report.bestFitness)}  mean=${fmt(report.meanFitness)}  ` +
      `(${report.best.fitness.wins}W-${report.best.fitness.losses}L of ${report.best.fitness.games})  ` +
      `[${describeParams(report.best.config)}]  t=${elapsed}s`
    );
  });

  console.log('');
  console.log('── Training complete ───────────────────────────────────');
  console.log(`Best training fitness: ${fmt(best.fitness.winRate)} (${best.fitness.wins}W-${best.fitness.losses}L of ${best.fitness.games})  [${describeParams(best.config)}]`);
  console.log('');

  // Take the final population's top 3 DISTINCT configs (by describe
  // string; the population is already sorted by LCB).
  const finalPopulation = history.length > 0
    ? history[history.length - 1].population
    : [{ config: best.config, fitness: best.fitness }];
  const topDistinct: TrumpLeanParams[] = [];
  const seen = new Set<string>();
  for (const ind of finalPopulation) {
    const key = describeParams(ind.config);
    if (seen.has(key)) continue;
    seen.add(key);
    topDistinct.push(ind.config);
    if (topDistinct.length >= 3) break;
  }

  console.log(`── Holdout evaluation (seed=${args.holdoutSeed}, hands=${args.holdoutHands}) ──`);
  const holdoutPool = generateDeckPool(args.pool * 2, args.holdoutSeed);
  const holdout: Array<{
    params: TrumpLeanParams;
    wins: number; losses: number; games: number;
    winRate: number; ci95: number;
  }> = [];
  for (const params of topDistinct) {
    const t0 = Date.now();
    const f = await evaluateParams(params, holdoutPool, args.holdoutHands);
    const se = f.games > 0 ? Math.sqrt(f.winRate * (1 - f.winRate) / f.games) : 0;
    const ci95 = 1.96 * se;
    holdout.push({ params, wins: f.wins, losses: f.losses, games: f.games, winRate: f.winRate, ci95 });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const verdict = (f.winRate - ci95) > 0.5 ? 'BEATS' : (f.winRate + ci95) < 0.5 ? 'LOSES' : 'tied';
    console.log(`  [${dt}s] ${describeParams(params).padEnd(36)} vs ${OPPONENT.name.padEnd(24)} ` +
      `${f.wins}W-${f.losses}L/${f.games}  ${(f.winRate * 100).toFixed(2)}% ±${(ci95 * 100).toFixed(2)}%  ${verdict}`);
  }
  console.log('');

  const output = {
    meta: {
      timestamp: new Date().toISOString(),
      args,
      opponent: OPPONENT.name,
      elapsedSeconds: (Date.now() - startTime) / 1000,
    },
    history: history.map(h => ({
      generation: h.generation,
      bestFitness: h.bestFitness,
      meanFitness: h.meanFitness,
      bestDescribe: describeParams(h.best.config),
    })),
    holdout,
  };

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Saved results to ${outPath}`);
}

main().catch(err => {
  console.error('Trump lean optimizer failed:', err);
  process.exit(1);
});
