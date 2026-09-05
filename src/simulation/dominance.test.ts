import {
  analyzeBoardSpec,
  resolveBoardSpec,
  buildSpecFromSeatHand,
  seatLetters,
  kittyLetters,
  playHand,
  payoffForTeam,
  booksMarginForTeam,
  deviatingSeatsFor,
  runDominanceCheck,
  makeRng,
  DECK_LENGTH,
  WILDCARD,
  WHISTING_PAYOFF,
  HandOutcome,
} from './dominance.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { STRATEGY_REGISTRY, BIDWHIST_CURRENT_BEST } from '../strategies/index.ts';

setStrategyDebug(false);

const EMPTY = WILDCARD.repeat(DECK_LENGTH);
const EXACT = 'PVozZIgXJRxcnqOYBfWjNdSTteELHrbApavUshlDKkuMCmyiGQwF';

const champion = { name: BIDWHIST_CURRENT_BEST.name, strategyText: BIDWHIST_CURRENT_BEST.text };
const family = STRATEGY_REGISTRY.find(s => s.game === 'bidwhist' && s.name === 'Family')!;
const conservative = STRATEGY_REGISTRY.find(s => s.game === 'bidwhist' && s.name === 'Conservative (Partner Signals)')!;

describe('board specs', () => {
  it('accepts a full deck and reports it as exact', () => {
    const info = analyzeBoardSpec(EXACT);
    expect(info.valid).toBe(true);
    expect(info.exact).toBe(true);
    expect(info.wildcards).toBe(0);
  });

  it('accepts an all-unknown spec', () => {
    const info = analyzeBoardSpec(EMPTY);
    expect(info.valid).toBe(true);
    expect(info.exact).toBe(false);
    expect(info.wildcards).toBe(DECK_LENGTH);
    expect(info.unknownBySeat).toEqual([12, 12, 12, 12, 4]);
  });

  it('rejects wrong length', () => {
    expect(analyzeBoardSpec('abc').valid).toBe(false);
  });

  it('rejects duplicates', () => {
    const dup = 'a' + EXACT.slice(1);
    const info = analyzeBoardSpec(dup);
    expect(info.valid).toBe(false);
    expect(info.error).toMatch(/Duplicate/);
  });

  it('rejects invalid letters', () => {
    expect(analyzeBoardSpec('!'.repeat(DECK_LENGTH)).valid).toBe(false);
  });
});

describe('buildSpecFromSeatHand', () => {
  it('lays a hand on the seat stride-4 positions', () => {
    const spec = buildSpecFromSeatHand('abcdefgnopqr', 0);
    expect(spec).toBe('a___b___c___d___e___f___g___n___o___p___q___r_______');
    expect(spec.length).toBe(DECK_LENGTH);
    expect(seatLetters(spec, 0)).toBe('abcdefgnopqr');
    expect(seatLetters(spec, 1)).toBe(WILDCARD.repeat(12));
  });

  it('offsets for other seats', () => {
    const spec = buildSpecFromSeatHand('abc', 2);
    expect(spec[2]).toBe('a');
    expect(spec[6]).toBe('b');
    expect(spec[10]).toBe('c');
    expect(seatLetters(spec, 2).slice(0, 3)).toBe('abc');
  });

  it('rejects more than 12 cards', () => {
    expect(() => buildSpecFromSeatHand('abcdefghijklm', 0)).toThrow();
  });
});

describe('resolveBoardSpec', () => {
  it('produces a complete 52-card deck with no duplicates', () => {
    const resolved = resolveBoardSpec(EMPTY, makeRng(1));
    const info = analyzeBoardSpec(resolved);
    expect(info.valid).toBe(true);
    expect(info.exact).toBe(true);
    expect(new Set(resolved.split('')).size).toBe(DECK_LENGTH);
  });

  it('preserves the pinned cards', () => {
    const spec = buildSpecFromSeatHand('abcdefgnopqr', 0);
    const resolved = resolveBoardSpec(spec, makeRng(7));
    expect(seatLetters(resolved, 0)).toBe('abcdefgnopqr');
    expect(kittyLetters(resolved).length).toBe(4);
  });

  it('is reproducible for a given seed', () => {
    expect(resolveBoardSpec(EMPTY, makeRng(99))).toBe(resolveBoardSpec(EMPTY, makeRng(99)));
  });

  it('differs across seeds', () => {
    expect(resolveBoardSpec(EMPTY, makeRng(1))).not.toBe(resolveBoardSpec(EMPTY, makeRng(2)));
  });
});

describe('playHand', () => {
  const ast = parseStrategy(champion.strategyText);

  it('is deterministic on an exact board', () => {
    const a = playHand(EXACT, [ast, ast, ast, ast], 0);
    const b = playHand(EXACT, [ast, ast, ast, ast], 0);
    expect(b).toEqual(a);
  });

  it('deals all 13 books between the two teams', () => {
    const o = playHand(EXACT, [ast, ast, ast, ast], 1);
    expect(o.passedOut).toBe(false);
    expect(o.booksWon[0] + o.booksWon[1]).toBe(12); // the kitty book is the 13th
  });

  it('scores exactly one team on a decided hand', () => {
    const o = playHand(EXACT, [ast, ast, ast, ast], 0);
    if (o.whistTeam < 0) {
      expect(Math.min(o.teamPoints[0], o.teamPoints[1])).toBe(0);
      expect(Math.max(o.teamPoints[0], o.teamPoints[1])).toBeGreaterThan(0);
    }
  });

  it('changes outcome with the dealer', () => {
    const outcomes = [0, 1, 2, 3].map(d => playHand(EXACT, [ast, ast, ast, ast], d));
    // Different first bidder, so at minimum the declarer should not be
    // identical across all four rotations of this board.
    expect(new Set(outcomes.map(o => o.declarer)).size).toBeGreaterThan(1);
  });
});

describe('payoffForTeam', () => {
  const base: HandOutcome = {
    declarer: 0, bidAmount: 4, trumpSuit: 'spades', direction: 'uptown',
    booksWon: [9, 3], teamPoints: [4, 0], whistTeam: -1, passedOut: false, bids: [],
  };

  it('is the signed point difference', () => {
    expect(payoffForTeam(base, 0)).toBe(4);
    expect(payoffForTeam(base, 1)).toBe(-4);
  });

  it('substitutes the game-winning value for a whisting', () => {
    const whist = { ...base, whistTeam: 0, teamPoints: [0, 0] as [number, number] };
    expect(payoffForTeam(whist, 0)).toBe(WHISTING_PAYOFF);
    expect(payoffForTeam(whist, 1)).toBe(-WHISTING_PAYOFF);
  });

  it('counts the declarer kitty book in the books margin', () => {
    expect(booksMarginForTeam(base, 0)).toBe(10 - 3);
    expect(booksMarginForTeam(base, 1)).toBe(3 - 10);
  });
});

describe('deviatingSeatsFor', () => {
  it('swaps one seat in seat scope', () => {
    expect(deviatingSeatsFor(0, 'seat')).toEqual([0]);
    expect(deviatingSeatsFor(3, 'seat')).toEqual([3]);
  });

  it('swaps both partners in team scope', () => {
    expect(deviatingSeatsFor(0, 'team')).toEqual([0, 2]);
    expect(deviatingSeatsFor(1, 'team')).toEqual([1, 3]);
  });
});

describe('runDominanceCheck', () => {
  it('reports zero delta when the champion is its own challenger', async () => {
    const report = await runDominanceCheck({
      boardSpec: EXACT,
      champion,
      challengers: [{ name: 'self', strategyText: champion.strategyText }],
      deviation: 'seat',
      seat: 0,
      dealers: [0, 1, 2, 3],
      fills: 1,
      seed: 1,
    });
    expect(report.exact).toBe(true);
    expect(report.challengers[0].meanDelta).toBe(0);
    expect(report.challengers[0].wins).toBe(0);
    expect(report.challengers[0].losses).toBe(0);
    expect(report.verdict).toBe('dominant');
  });

  it('keeps the built-in parity row clean on an exact board', async () => {
    const report = await runDominanceCheck({
      boardSpec: EXACT,
      champion,
      challengers: [{ name: family.name, strategyText: family.text }],
      deviation: 'seat',
      seat: 0,
      dealers: [0, 1, 2, 3],
      fills: 1,
      seed: 1,
    });
    expect(report.parity).not.toBeNull();
    expect(report.parity!.wins).toBe(0);
    expect(report.parity!.losses).toBe(0);
  });

  it('keeps the parity row clean across Monte Carlo fills', async () => {
    const report = await runDominanceCheck({
      boardSpec: buildSpecFromSeatHand('abcdefgnopqr', 0),
      champion,
      challengers: [{ name: family.name, strategyText: family.text }],
      deviation: 'seat',
      seat: 0,
      dealers: [0, 2],
      fills: 12,
      seed: 4242,
    });
    expect(report.exact).toBe(false);
    expect(report.parity!.wins).toBe(0);
    expect(report.parity!.losses).toBe(0);
    expect(report.parity!.ties).toBe(24);
  });

  it('runs one trial per (fill, dealer) pair', async () => {
    const report = await runDominanceCheck({
      boardSpec: EMPTY,
      champion,
      challengers: [{ name: family.name, strategyText: family.text }],
      deviation: 'seat',
      seat: 0,
      dealers: [0, 1, 2],
      fills: 5,
      seed: 8,
    });
    expect(report.trialsPerChallenger).toBe(15);
    expect(report.challengers[0].trials.length).toBe(15);
  });

  it('reproduces exactly for a given seed', async () => {
    const config = {
      boardSpec: buildSpecFromSeatHand('abcdefgnopqr', 0),
      champion,
      challengers: [{ name: conservative.name, strategyText: conservative.text }],
      deviation: 'seat' as const,
      seat: 0,
      dealers: [0, 1, 2, 3],
      fills: 10,
      seed: 777,
    };
    const a = await runDominanceCheck(config);
    const b = await runDominanceCheck(config);
    expect(b.challengers[0].meanDelta).toBe(a.challengers[0].meanDelta);
    expect(b.challengers[0].trials.map(t => t.delta)).toEqual(a.challengers[0].trials.map(t => t.delta));
  });

  it('scores the deviating team, not always team 0', async () => {
    const shared = {
      boardSpec: EXACT,
      champion,
      challengers: [{ name: conservative.name, strategyText: conservative.text }],
      deviation: 'seat' as const,
      dealers: [0, 1, 2, 3],
      fills: 1,
      seed: 3,
    };
    const south = await runDominanceCheck({ ...shared, seat: 0 });
    const east = await runDominanceCheck({ ...shared, seat: 1 });
    expect(south.deviatingTeam).toBe(0);
    expect(east.deviatingTeam).toBe(1);
    expect(east.deviatingSeats).toEqual([1]);
  });

  it('swaps both partners under team scope', async () => {
    const report = await runDominanceCheck({
      boardSpec: EXACT,
      champion,
      challengers: [{ name: conservative.name, strategyText: conservative.text }],
      deviation: 'team',
      seat: 0,
      dealers: [0],
      fills: 1,
      seed: 3,
    });
    expect(report.deviatingSeats).toEqual([0, 2]);
  });

  it('surfaces a challenger parse error without aborting the run', async () => {
    const report = await runDominanceCheck({
      boardSpec: EXACT,
      champion,
      challengers: [
        { name: 'broken', strategyText: 'this is not a strategy' },
        { name: family.name, strategyText: family.text },
      ],
      deviation: 'seat',
      seat: 0,
      dealers: [0],
      fills: 1,
      seed: 1,
    });
    const broken = report.challengers.find(c => c.name === 'broken')!;
    expect(broken.parseError).not.toBe('');
    expect(broken.trials.length).toBe(0);
    expect(report.challengers.find(c => c.name === family.name)!.trials.length).toBe(1);
  });

  it('reports an invalid board spec instead of running', async () => {
    const report = await runDominanceCheck({
      boardSpec: 'nope',
      champion,
      challengers: [{ name: family.name, strategyText: family.text }],
      deviation: 'seat',
      seat: 0,
      dealers: [0],
      fills: 1,
      seed: 1,
    });
    expect(report.verdict).toBe('error');
    expect(report.championParseError).toMatch(/52 characters/);
  });
});
