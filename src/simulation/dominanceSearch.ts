/**
 * Dominance search: look for a strategy that refutes the champion on a
 * given board, instead of only checking the ones already written.
 *
 * The registry check in dominance.ts answers "does any strategy I have
 * beat the champion here?". This answers the harder question: "does one
 * exist at all?" — by evolving SignalLabConfig candidates (the same
 * parameter space the Signal Lab and the strategy optimizer search) with
 * fitness set to the mean deviation payoff against the champion on this
 * specific board.
 *
 * ── Why train/holdout ────────────────────────────────────────────────
 *
 * On a partial board the trial set is a Monte Carlo sample, and a search
 * with enough generations WILL find a config that beats the champion on
 * those particular fills by luck alone. That is overfitting, and reported
 * naively it manufactures refutations that do not exist.
 *
 * So the search runs against a training trial set, and the finalists are
 * then re-scored on a disjoint holdout set drawn from a different seed.
 * Only the holdout numbers are reported as a verdict. A candidate that
 * looked strong in training and collapses on holdout was noise; one that
 * survives both is a real counterexample.
 *
 * An exact board (no wildcards) has nothing to overfit to — the deltas
 * are deterministic — so the holdout stage is skipped there and training
 * results stand as the answer.
 */

import { StrategyAST } from '../strategy/types.ts';
import { SignalLabConfig, generateSignalStrategy, configSummary } from './signalLab.ts';
import { randomConfig, mutateConfig, crossoverConfigs } from './strategyOptimizer.ts';
import {
  analyzeBoardSpec,
  resolveBoardSpec,
  playHand,
  payoffForTeam,
  makeRng,
  deviatingSeatsFor,
  DeviationScope,
  ChallengerReport,
  DominanceConfig,
  runDominanceCheck,
  loadStrategy,
  withQuietSimulation,
} from './dominance.ts';
import { StrategyConfig } from './types.ts';

// ── Trial sets ───────────────────────────────────────────────────────

/**
 * One (deck, dealer) pairing with the champion's baseline payoff already
 * computed. Baselines are shared by every candidate in the search, so a
 * generation costs one hand per candidate per trial rather than two.
 */
export interface Trial {
  deckUrl: string;
  dealer: number;
  basePayoff: number;
}

export function buildTrialSet(
  boardSpec: string,
  championAst: StrategyAST | null,
  deviatingTeam: number,
  dealers: number[],
  fills: number,
  seed: number,
): Trial[] {
  const info = analyzeBoardSpec(boardSpec);
  const effectiveFills = info.exact ? 1 : Math.max(1, fills);
  const rng = makeRng(seed);
  const trials: Trial[] = [];

  for (let f = 0; f < effectiveFills; f++) {
    const deckUrl = info.exact ? boardSpec : resolveBoardSpec(boardSpec, rng);
    for (const dealer of dealers) {
      const baseline = playHand(deckUrl, [championAst, championAst, championAst, championAst], dealer);
      trials.push({ deckUrl, dealer, basePayoff: payoffForTeam(baseline, deviatingTeam) });
    }
  }
  return trials;
}

export interface TrialScore {
  meanDelta: number;
  /** 95% half-width on meanDelta; 0 when the trial set is deterministic. */
  ci95: number;
  lowerBound: number;
  wins: number;
  ties: number;
  losses: number;
  n: number;
}

const ZERO_SCORE: TrialScore = { meanDelta: -Infinity, ci95: 0, lowerBound: -Infinity, wins: 0, ties: 0, losses: 0, n: 0 };

/** Mean deviation payoff for one candidate over a prepared trial set. */
export function scoreOnTrials(
  candidateAst: StrategyAST | null,
  championAst: StrategyAST | null,
  trials: Trial[],
  deviatingSeats: number[],
  deviatingTeam: number,
  exact: boolean,
): TrialScore {
  if (!candidateAst || trials.length === 0) return ZERO_SCORE;

  const deltas: number[] = [];
  let wins = 0, ties = 0, losses = 0;

  for (const t of trials) {
    const seats: (StrategyAST | null)[] = [championAst, championAst, championAst, championAst];
    for (const s of deviatingSeats) seats[s] = candidateAst;
    const outcome = playHand(t.deckUrl, seats, t.dealer);
    const delta = payoffForTeam(outcome, deviatingTeam) - t.basePayoff;
    deltas.push(delta);
    if (delta > 0) wins++;
    else if (delta < 0) losses++;
    else ties++;
  }

  const n = deltas.length;
  const meanDelta = deltas.reduce((a, b) => a + b, 0) / n;
  let ci95 = 0;
  if (!exact && n > 1) {
    const variance = deltas.reduce((a, d) => a + (d - meanDelta) ** 2, 0) / (n - 1);
    ci95 = 1.96 * Math.sqrt(variance / n);
  }
  return { meanDelta, ci95, lowerBound: meanDelta - ci95, wins, ties, losses, n };
}

// ── Search ───────────────────────────────────────────────────────────

export interface DominanceSearchOptions {
  boardSpec: string;
  champion: StrategyConfig;
  seat: number;
  deviation: DeviationScope;
  dealers: number[];
  /** Fills in the training trial set the search optimizes against. */
  trainFills: number;
  /** Fills in the disjoint holdout set the finalists are re-scored on. */
  holdoutFills: number;
  populationSize: number;
  eliteSize: number;
  generations: number;
  mutationRate: number;
  /** How many top training candidates to re-score on the holdout. */
  finalistCount: number;
  seed: number;
  /** Optional starting configs (e.g. Signal Lab presets). */
  seedConfigs?: SignalLabConfig[];
}

export interface SearchIndividual {
  config: SignalLabConfig;
  name: string;
  strategyText: string;
  train: TrialScore;
}

export interface GenerationSnapshot {
  generation: number;
  bestDelta: number;
  meanDelta: number;
  best: SearchIndividual;
}

export interface FinalistReport {
  config: SignalLabConfig;
  name: string;
  summary: string;
  strategyText: string;
  train: TrialScore;
  /** Re-scored on the holdout trial set. Null on an exact board. */
  holdout: TrialScore | null;
  /** True when the candidate profits significantly on the holdout. */
  refutes: boolean;
}

export interface DominanceSearchReport {
  history: GenerationSnapshot[];
  finalists: FinalistReport[];
  /** Best surviving refutation, or null if the champion held. */
  refuter: FinalistReport | null;
  exact: boolean;
  trainTrials: number;
  holdoutTrials: number;
  championParseError: string;
}

function buildCandidate(config: SignalLabConfig): { ast: StrategyAST | null; text: string } {
  try {
    const text = generateSignalStrategy(config);
    return { ast: loadStrategy(text).ast, text };
  } catch {
    return { ast: null, text: '' };
  }
}

/**
 * Evolve SignalLabConfig candidates against the champion on one board.
 *
 * Selection is by the training lower confidence bound rather than the raw
 * mean, so a candidate cannot win a generation on a lucky spread alone.
 * The final verdict still comes from the holdout.
 */
export async function runDominanceSearch(
  opts: DominanceSearchOptions,
  onGeneration?: (snapshot: GenerationSnapshot) => void,
  shouldAbort?: () => boolean,
): Promise<DominanceSearchReport> {
  return withQuietSimulation(() => runSearchLoud(opts, onGeneration, shouldAbort));
}

async function runSearchLoud(
  opts: DominanceSearchOptions,
  onGeneration?: (snapshot: GenerationSnapshot) => void,
  shouldAbort?: () => boolean,
): Promise<DominanceSearchReport> {
  const info = analyzeBoardSpec(opts.boardSpec);
  const exact = info.exact;
  const deviatingSeats = deviatingSeatsFor(opts.seat, opts.deviation);
  const deviatingTeam = opts.seat % 2;

  const loadedChampion = loadStrategy(opts.champion.strategyText);
  const championAst = loadedChampion.ast;
  const championParseError = loadedChampion.error;

  const empty: DominanceSearchReport = {
    history: [], finalists: [], refuter: null, exact,
    trainTrials: 0, holdoutTrials: 0, championParseError,
  };
  if (!info.valid) return { ...empty, championParseError: info.error };
  if (championParseError) return empty;

  const trainTrials = buildTrialSet(
    opts.boardSpec, championAst, deviatingTeam, opts.dealers, opts.trainFills, opts.seed,
  );
  // Disjoint seed so the holdout fills cannot coincide with training ones.
  const holdoutTrials = exact
    ? []
    : buildTrialSet(
        opts.boardSpec, championAst, deviatingTeam, opts.dealers, opts.holdoutFills,
        (opts.seed ^ 0x5f356495) >>> 0,
      );

  const rng = makeRng(opts.seed);
  const score = (ast: StrategyAST | null, trials: Trial[]) =>
    scoreOnTrials(ast, championAst, trials, deviatingSeats, deviatingTeam, exact);

  const evaluate = (config: SignalLabConfig): SearchIndividual => {
    const { ast, text } = buildCandidate(config);
    return { config, name: config.name, strategyText: text, train: score(ast, trainTrials) };
  };

  // Seed the population with any supplied configs, then random fill.
  let population: SearchIndividual[] = [];
  for (const c of opts.seedConfigs ?? []) {
    if (population.length >= opts.populationSize) break;
    population.push(evaluate({ ...c }));
  }
  while (population.length < opts.populationSize) {
    population.push(evaluate(randomConfig(rng, `rand-${population.length}`)));
  }

  const history: GenerationSnapshot[] = [];
  // Everything ever evaluated, so the finalists are drawn from the whole
  // search rather than only the last generation's survivors.
  const seen = new Map<string, SearchIndividual>();
  const remember = (ind: SearchIndividual) => {
    const key = JSON.stringify({ ...ind.config, name: '' });
    const prior = seen.get(key);
    if (!prior || ind.train.lowerBound > prior.train.lowerBound) seen.set(key, ind);
  };
  population.forEach(remember);

  for (let gen = 0; gen < opts.generations; gen++) {
    if (shouldAbort && shouldAbort()) break;

    population.sort((a, b) => b.train.lowerBound - a.train.lowerBound);
    const elites = population.slice(0, opts.eliteSize);

    const best = elites[0];
    const snapshot: GenerationSnapshot = {
      generation: gen,
      bestDelta: best.train.meanDelta,
      meanDelta: population.reduce((a, p) => a + p.train.meanDelta, 0) / population.length,
      best,
    };
    history.push(snapshot);
    if (onGeneration) onGeneration(snapshot);

    // Breed the next generation: elites survive, offspring fill the rest.
    const next: SearchIndividual[] = [...elites];
    let child = 0;
    while (next.length < opts.populationSize) {
      const a = elites[Math.floor(rng() * elites.length)];
      const b = elites[Math.floor(rng() * elites.length)];
      const crossed = rng() < 0.5
        ? crossoverConfigs(a.config, b.config, rng, `g${gen}-c${child}`)
        : { ...a.config, name: `g${gen}-c${child}` };
      const mutated = mutateConfig(crossed, rng, opts.mutationRate, `g${gen}-c${child}`);
      const ind = evaluate(mutated);
      remember(ind);
      next.push(ind);
      child++;
    }
    population = next;

    // Yield between generations so a browser run stays interactive.
    await new Promise(res => setTimeout(res, 0));
  }

  // Re-score the strongest distinct candidates on the holdout set.
  const pool = Array.from(seen.values()).sort((a, b) => b.train.lowerBound - a.train.lowerBound);
  const finalists: FinalistReport[] = [];
  for (const ind of pool.slice(0, Math.max(1, opts.finalistCount))) {
    const { ast } = buildCandidate(ind.config);
    const holdout = exact ? null : score(ast, holdoutTrials);
    const verdictScore = holdout ?? ind.train;
    finalists.push({
      config: ind.config,
      name: ind.name,
      summary: configSummary(ind.config),
      strategyText: ind.strategyText,
      train: ind.train,
      holdout,
      refutes: exact ? verdictScore.meanDelta > 0 : verdictScore.lowerBound > 0,
    });
    if (shouldAbort && shouldAbort()) break;
  }

  finalists.sort((a, b) => {
    const av = (a.holdout ?? a.train).meanDelta;
    const bv = (b.holdout ?? b.train).meanDelta;
    return bv - av;
  });

  return {
    history,
    finalists,
    refuter: finalists.find(f => f.refutes) ?? null,
    exact,
    trainTrials: trainTrials.length,
    holdoutTrials: holdoutTrials.length,
    championParseError: '',
  };
}

/**
 * Confirm a discovered refuter with the full dominance check, so a search
 * hit can be reported with the same numbers the registry table uses.
 */
export function confirmationConfig(
  opts: DominanceSearchOptions,
  finalist: FinalistReport,
  fills: number,
  seed: number,
): DominanceConfig {
  return {
    boardSpec: opts.boardSpec,
    champion: opts.champion,
    challengers: [{ name: `Search: ${finalist.name}`, strategyText: finalist.strategyText }],
    deviation: opts.deviation,
    seat: opts.seat,
    dealers: opts.dealers,
    fills,
    seed,
  };
}

/** Re-run one finalist through runDominanceCheck at a fresh seed. */
export async function confirmFinalist(
  opts: DominanceSearchOptions,
  finalist: FinalistReport,
  fills: number,
  seed: number,
): Promise<ChallengerReport | null> {
  const report = await runDominanceCheck(confirmationConfig(opts, finalist, fills, seed));
  return report.challengers[0] ?? null;
}
