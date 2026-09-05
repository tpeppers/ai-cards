import {
  buildTrialSet,
  scoreOnTrials,
  runDominanceSearch,
  DominanceSearchOptions,
} from './dominanceSearch.ts';
import { buildSpecFromSeatHand, loadStrategy, WILDCARD, DECK_LENGTH } from './dominance.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { BIDWHIST_CURRENT_BEST } from '../strategies/index.ts';
import { SIGNAL_LAB_PRESETS } from './signalLab.ts';

setStrategyDebug(false);

const champion = { name: BIDWHIST_CURRENT_BEST.name, strategyText: BIDWHIST_CURRENT_BEST.text };
const championAst = loadStrategy(champion.strategyText).ast;
const EXACT = 'PVozZIgXJRxcnqOYBfWjNdSTteELHrbApavUshlDKkuMCmyiGQwF';
const PARTIAL = buildSpecFromSeatHand('abcdefgnopqr', 0);

describe('buildTrialSet', () => {
  it('produces one trial per (fill, dealer) pair', () => {
    const trials = buildTrialSet(PARTIAL, championAst, 0, [0, 2], 5, 1);
    expect(trials.length).toBe(10);
  });

  it('collapses an exact board to a single fill', () => {
    const trials = buildTrialSet(EXACT, championAst, 0, [0, 1, 2, 3], 100, 1);
    expect(trials.length).toBe(4);
    expect(new Set(trials.map(t => t.deckUrl)).size).toBe(1);
  });

  it('draws disjoint decks for different seeds', () => {
    const a = buildTrialSet(PARTIAL, championAst, 0, [0], 8, 111);
    const b = buildTrialSet(PARTIAL, championAst, 0, [0], 8, 222);
    const overlap = a.map(t => t.deckUrl).filter(u => b.some(t => t.deckUrl === u));
    expect(overlap.length).toBe(0);
  });

  it('is reproducible for a given seed', () => {
    const a = buildTrialSet(PARTIAL, championAst, 0, [0, 1], 4, 55);
    const b = buildTrialSet(PARTIAL, championAst, 0, [0, 1], 4, 55);
    expect(b.map(t => t.deckUrl)).toEqual(a.map(t => t.deckUrl));
    expect(b.map(t => t.basePayoff)).toEqual(a.map(t => t.basePayoff));
  });
});

describe('scoreOnTrials', () => {
  it('scores the champion against itself at exactly zero', () => {
    const trials = buildTrialSet(PARTIAL, championAst, 0, [0, 1, 2, 3], 6, 9);
    const score = scoreOnTrials(championAst, championAst, trials, [0], 0, false);
    expect(score.meanDelta).toBe(0);
    expect(score.wins).toBe(0);
    expect(score.losses).toBe(0);
    expect(score.ties).toBe(trials.length);
  });

  it('reports a floor score for an unusable candidate', () => {
    const trials = buildTrialSet(EXACT, championAst, 0, [0], 1, 1);
    expect(scoreOnTrials(null, championAst, trials, [0], 0, true).meanDelta).toBe(-Infinity);
  });
});

describe('runDominanceSearch', () => {
  const baseOpts: DominanceSearchOptions = {
    boardSpec: PARTIAL,
    champion,
    seat: 0,
    deviation: 'seat',
    dealers: [0, 2],
    trainFills: 6,
    holdoutFills: 6,
    populationSize: 6,
    eliteSize: 2,
    generations: 2,
    mutationRate: 0.25,
    finalistCount: 3,
    seed: 4242,
    seedConfigs: SIGNAL_LAB_PRESETS.slice(0, 2),
  };

  it('reports one snapshot per generation and holds out separately', async () => {
    const seen: number[] = [];
    const report = await runDominanceSearch(baseOpts, s => seen.push(s.generation));
    expect(seen).toEqual([0, 1]);
    expect(report.history.length).toBe(2);
    expect(report.trainTrials).toBe(12);
    expect(report.holdoutTrials).toBe(12);
    expect(report.finalists.length).toBeGreaterThan(0);
    // Every finalist is scored on both sets, and the verdict uses holdout.
    for (const f of report.finalists) {
      expect(f.holdout).not.toBeNull();
      expect(f.refutes).toBe(f.holdout!.lowerBound > 0);
    }
  }, 60000);

  it('skips the holdout stage on an exact board', async () => {
    const report = await runDominanceSearch({ ...baseOpts, boardSpec: EXACT, generations: 1 });
    expect(report.exact).toBe(true);
    expect(report.holdoutTrials).toBe(0);
    expect(report.finalists.every(f => f.holdout === null)).toBe(true);
  }, 60000);

  it('reproduces for a given seed', async () => {
    const a = await runDominanceSearch(baseOpts);
    const b = await runDominanceSearch(baseOpts);
    expect(b.history.map(h => h.bestDelta)).toEqual(a.history.map(h => h.bestDelta));
    expect(b.finalists.map(f => f.summary)).toEqual(a.finalists.map(f => f.summary));
  }, 90000);

  it('stops early when asked to abort', async () => {
    let calls = 0;
    const report = await runDominanceSearch(
      { ...baseOpts, generations: 20 },
      () => { calls++; },
      () => calls >= 2,
    );
    expect(report.history.length).toBeLessThan(20);
  }, 60000);

  it('refuses an invalid board spec', async () => {
    const report = await runDominanceSearch({ ...baseOpts, boardSpec: 'nope' });
    expect(report.finalists.length).toBe(0);
    expect(report.championParseError).toMatch(/52 characters/);
  });

  it('refuses a champion that would fall back to the built-in AI', async () => {
    const report = await runDominanceSearch({
      ...baseOpts,
      boardSpec: WILDCARD.repeat(DECK_LENGTH),
      champion: { name: 'broken', strategyText: 'not a strategy at all' },
    });
    expect(report.championParseError).toMatch(/built-in AI/);
    expect(report.finalists.length).toBe(0);
  });
});
