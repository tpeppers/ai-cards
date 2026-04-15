/**
 * Strategy Optimizer: black-box search over SignalLabConfig to find a
 * variant that beats the handwritten "Family" strategy.
 *
 * Approach: (mu+lambda) evolutionary strategy with type-aware mutation
 * and uniform crossover. Fitness = head-to-head win rate vs Family,
 * evaluated via BatchRunner in round-robin mode (paired per deck+rotation
 * for variance reduction).
 */

import { BatchRunner } from './BatchRunner.ts';
import { generateSignalStrategy, SignalLabConfig, DEFAULT_CONFIG } from './signalLab.ts';
import { STRATEGY_REGISTRY } from '../strategies/index.ts';
import { ComparisonConfig } from './types.ts';

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function choice<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Deck pool generation (seeded, reproducible) ──────────────────────

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function generateSeededDeckUrl(rng: () => number): string {
  // 52-char deck URL: 48 dealt + 4 kitty
  const cards = ALPHA.split('');
  // Fisher-Yates shuffle with seeded RNG
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards.join('');
}

export function generateDeckPool(size: number, seed: number): string[] {
  const rng = makeRng(seed);
  const pool: string[] = [];
  for (let i = 0; i < size; i++) pool.push(generateSeededDeckUrl(rng));
  return pool;
}

// ── Parameter space ──────────────────────────────────────────────────

type ParamType = 'int' | 'bool' | 'enum';

interface ParamSpec {
  key: keyof SignalLabConfig;
  type: ParamType;
  min?: number;
  max?: number;
  options?: readonly (string | number | boolean)[];
}

const BASE_STYLE_OPTIONS = [
  'Family',
  'Claude',
  'Standard (All Signals)',
  'Standard (Partner Signals)',
  'Standard (Ignore Signals)',
] as const;

const BID3_MODE_OPTIONS = ['mixed', 'aces2', 'aces3', 'disabled'] as const;

export const PARAM_SPACE: ParamSpec[] = [
  { key: 'bid1Enabled',          type: 'bool' },
  { key: 'bid1Threshold',        type: 'int', min: 1, max: 4 },
  { key: 'bid2Enabled',          type: 'bool' },
  { key: 'bid2Threshold',        type: 'int', min: 1, max: 4 },
  { key: 'bid3Mode',             type: 'enum', options: BID3_MODE_OPTIONS },
  { key: 'bid3MixedThreshold',   type: 'int', min: 1, max: 4 },
  { key: 'strongSuitThreshold',  type: 'int', min: 4, max: 7 },
  { key: 'seat3MinBid',          type: 'int', min: 3, max: 5 },
  { key: 'seat3PushOnPartner',   type: 'bool' },
  { key: 'dealerTakeMax',        type: 'int', min: 1, max: 5 },
  { key: 'dealerStealProtection',type: 'bool' },
  { key: 'partnerBonus',         type: 'int', min: 0, max: 5 },
  { key: 'enemyCounter',         type: 'int', min: 0, max: 5 },
  { key: 'aceThreshold',         type: 'int', min: 1, max: 3 },
  { key: 'trustBid3Aces',        type: 'bool' },
  { key: 'baseStyle',            type: 'enum', options: BASE_STYLE_OPTIONS },
];

function randomValueFor(spec: ParamSpec, rng: () => number): string | number | boolean {
  if (spec.type === 'bool') return rng() < 0.5;
  if (spec.type === 'int') return randInt(rng, spec.min!, spec.max!);
  return choice(rng, spec.options as (string | number | boolean)[]);
}

function mutateValueFor(
  current: string | number | boolean,
  spec: ParamSpec,
  rng: () => number
): string | number | boolean {
  if (spec.type === 'bool') return !(current as boolean);
  if (spec.type === 'int') {
    // Small step: ±1 or ±2, clipped
    const step = rng() < 0.7 ? (rng() < 0.5 ? -1 : 1) : (rng() < 0.5 ? -2 : 2);
    let v = (current as number) + step;
    if (v < spec.min!) v = spec.min!;
    if (v > spec.max!) v = spec.max!;
    if (v === current) return randomValueFor(spec, rng);
    return v;
  }
  // enum: pick a different option
  const opts = spec.options as (string | number | boolean)[];
  if (opts.length <= 1) return current;
  let v = choice(rng, opts);
  let guard = 0;
  while (v === current && guard++ < 8) v = choice(rng, opts);
  return v;
}

// ── Config helpers ───────────────────────────────────────────────────

function cloneConfig(c: SignalLabConfig): SignalLabConfig {
  return { ...c };
}

export function randomConfig(rng: () => number, name: string): SignalLabConfig {
  const c: SignalLabConfig = cloneConfig(DEFAULT_CONFIG);
  c.name = name;
  for (const spec of PARAM_SPACE) {
    (c as any)[spec.key] = randomValueFor(spec, rng);
  }
  return c;
}

export function mutateConfig(
  c: SignalLabConfig,
  rng: () => number,
  mutationRate: number,
  name: string
): SignalLabConfig {
  const out = cloneConfig(c);
  out.name = name;
  // Ensure at least one mutation happens
  let mutated = false;
  for (const spec of PARAM_SPACE) {
    if (rng() < mutationRate) {
      (out as any)[spec.key] = mutateValueFor((out as any)[spec.key], spec, rng);
      mutated = true;
    }
  }
  if (!mutated) {
    const spec = choice(rng, PARAM_SPACE);
    (out as any)[spec.key] = mutateValueFor((out as any)[spec.key], spec, rng);
  }
  return out;
}

export function crossoverConfigs(
  a: SignalLabConfig,
  b: SignalLabConfig,
  rng: () => number,
  name: string
): SignalLabConfig {
  const out = cloneConfig(a);
  out.name = name;
  for (const spec of PARAM_SPACE) {
    if (rng() < 0.5) {
      (out as any)[spec.key] = (b as any)[spec.key];
    }
  }
  return out;
}

// ── Fitness ──────────────────────────────────────────────────────────

export interface FitnessResult {
  winRate: number;
  wins: number;
  losses: number;
  games: number;
}

/**
 * Add a new batch of wins/games into an existing cumulative result.
 * Used so elites accumulate low-variance fitness estimates over the
 * course of the run while still being re-evaluated each generation
 * on a fresh deck pool.
 */
export function accumulateFitness(prev: FitnessResult, next: FitnessResult): FitnessResult {
  const wins = prev.wins + next.wins;
  const losses = prev.losses + next.losses;
  const games = prev.games + next.games;
  return {
    wins,
    losses,
    games,
    winRate: games > 0 ? wins / games : 0,
  };
}

/**
 * 95% lower confidence bound on the true win rate given observed
 * wins/games. Used for selection instead of raw winRate so that
 * low-sample offspring can't unseat data-rich elites through luck.
 */
export function lowerConfidenceBound(f: FitnessResult): number {
  if (f.games <= 0) return 0;
  const p = f.winRate;
  const stderr = Math.sqrt(p * (1 - p) / f.games);
  return p - 1.96 * stderr;
}

export async function evaluateFitness(
  candidate: SignalLabConfig,
  familyText: string,
  deckPool: string[],
  numHands: number
): Promise<FitnessResult> {
  let candidateText: string;
  try {
    candidateText = generateSignalStrategy(candidate);
  } catch (e) {
    return { winRate: 0, wins: 0, losses: 0, games: 0 };
  }

  const runner = new BatchRunner();
  const comparison: ComparisonConfig = {
    strategies: [
      { name: 'candidate', strategyText: candidateText },
      { name: 'Family', strategyText: familyText },
    ],
    assignmentMode: 'round-robin',
    numHands,
    predefinedDeckUrls: deckPool,
  };

  let result;
  try {
    result = await runner.runComparison(comparison);
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

// ── Evolutionary loop ────────────────────────────────────────────────

export interface OptimizerOptions {
  populationSize: number;
  eliteSize: number;
  generations: number;
  handsPerEval: number;
  deckPoolSize: number;
  mutationRate: number;
  seed: number;
  seedConfigs?: SignalLabConfig[];
  // Per-seed starting fitness (e.g. reused from a diagnostic eval).
  // Parallel to seedConfigs. Anchors presets with low-variance
  // estimates so noise-lucky offspring can't beat them on LCB.
  seedFitnesses?: FitnessResult[];
}

export interface Individual {
  config: SignalLabConfig;
  fitness: FitnessResult;
}

export interface GenerationReport {
  generation: number;
  bestFitness: number;
  meanFitness: number;
  best: Individual;
  population: Individual[];
}

export async function runOptimizer(
  opts: OptimizerOptions,
  onGeneration?: (report: GenerationReport) => void
): Promise<{ best: Individual; history: GenerationReport[] }> {
  const rng = makeRng(opts.seed);

  // Resolve the Family strategy text from the registry
  const familyEntry = STRATEGY_REGISTRY.find(s => s.name === 'Family');
  if (!familyEntry) throw new Error('Family strategy not found in registry');
  const familyText = familyEntry.text;

  const basePoolSeed = (opts.seed ^ 0xdeadbeef) >>> 0;
  // Deck pool rotates every generation so the optimizer can't overfit
  // to a single fixed pool. Elites that survive multiple generations
  // accumulate wins/games across many pools for a low-variance
  // fitness estimate.
  let deckPool = generateDeckPool(opts.deckPoolSize, basePoolSeed);

  // Initialize population: seed configs + random fill
  const population: Individual[] = [];
  const seeds = opts.seedConfigs ?? [];
  const seedFits = opts.seedFitnesses ?? [];
  for (let i = 0; i < seeds.length && population.length < opts.populationSize; i++) {
    const preFit = seedFits[i];
    population.push({
      config: { ...seeds[i], name: `seed-${i}` },
      fitness: preFit ?? { winRate: 0, wins: 0, losses: 0, games: 0 },
    });
  }
  while (population.length < opts.populationSize) {
    population.push({
      config: randomConfig(rng, `rand-${population.length}`),
      fitness: { winRate: 0, wins: 0, losses: 0, games: 0 },
    });
  }

  // Initial evaluation on pool 0 — add to whatever seed-provided
  // fitness the individual already has so the new data augments
  // (rather than replaces) the diagnostic estimate.
  for (const ind of population) {
    const batch = await evaluateFitness(ind.config, familyText, deckPool, opts.handsPerEval);
    ind.fitness = accumulateFitness(ind.fitness, batch);
  }
  population.sort((a, b) => lowerConfidenceBound(b.fitness) - lowerConfidenceBound(a.fitness));

  const history: GenerationReport[] = [];

  for (let gen = 0; gen < opts.generations; gen++) {
    // Rotate deck pool for this generation
    deckPool = generateDeckPool(opts.deckPoolSize, (basePoolSeed + gen + 1) >>> 0);

    // Keep elites (their cumulative stats carry over)
    const elites = population.slice(0, opts.eliteSize);

    // Generate offspring to fill the rest of the population
    const offspring: Individual[] = [];
    const numChildren = opts.populationSize - elites.length;
    for (let i = 0; i < numChildren; i++) {
      let childConfig: SignalLabConfig;
      if (rng() < 0.4 && elites.length >= 2) {
        const a = choice(rng, elites).config;
        const b = choice(rng, elites).config;
        childConfig = crossoverConfigs(a, b, rng, `g${gen + 1}-x${i}`);
        childConfig = mutateConfig(childConfig, rng, opts.mutationRate * 0.5, childConfig.name);
      } else {
        const parent = choice(rng, elites).config;
        childConfig = mutateConfig(parent, rng, opts.mutationRate, `g${gen + 1}-m${i}`);
      }
      offspring.push({
        config: childConfig,
        fitness: { winRate: 0, wins: 0, losses: 0, games: 0 },
      });
    }

    // Re-evaluate elites on the new pool, accumulating stats so their
    // fitness estimate tightens with each generation they survive.
    for (const ind of elites) {
      const batch = await evaluateFitness(ind.config, familyText, deckPool, opts.handsPerEval);
      ind.fitness = accumulateFitness(ind.fitness, batch);
    }

    // Evaluate offspring on TWO back-to-back pools so their initial
    // fitness estimate has ~2x the data (and half the variance) of
    // a single-pool eval. This makes it much harder for a single
    // lucky pool to promote a mediocre offspring onto the elite set.
    const offspringPool2 = generateDeckPool(
      opts.deckPoolSize,
      (basePoolSeed + gen + 1 + 0x5a5a5a5a) >>> 0
    );
    for (const ind of offspring) {
      const batch1 = await evaluateFitness(ind.config, familyText, deckPool, opts.handsPerEval);
      const batch2 = await evaluateFitness(ind.config, familyText, offspringPool2, opts.handsPerEval);
      ind.fitness = accumulateFitness(batch1, batch2);
    }

    // Combine and keep top populationSize by lower confidence bound.
    // LCB penalizes low-sample offspring so they can't oust data-rich
    // elites through a single lucky pool.
    const combined = [...elites, ...offspring];
    combined.sort((a, b) => lowerConfidenceBound(b.fitness) - lowerConfidenceBound(a.fitness));
    population.length = 0;
    population.push(...combined.slice(0, opts.populationSize));
    // Report "best" as the highest LCB (same individual the selector
    // prefers) so training-fitness and holdout are measured on the
    // config the optimizer actually trusts.
    population.sort((a, b) => lowerConfidenceBound(b.fitness) - lowerConfidenceBound(a.fitness));

    const best = population[0];
    const meanFitness = population.reduce((s, p) => s + p.fitness.winRate, 0) / population.length;
    const report: GenerationReport = {
      generation: gen + 1,
      bestFitness: best.fitness.winRate,
      meanFitness,
      best,
      population: population.slice(),
    };
    history.push(report);
    if (onGeneration) onGeneration(report);
  }

  return { best: population[0], history };
}
