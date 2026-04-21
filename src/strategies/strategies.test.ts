import { parseStrategy } from '../strategy/parser.ts';
import { BidWhistSimulator } from '../simulation/BidWhistSimulator.ts';
import { generateDeckPool } from '../simulation/strategyOptimizer.ts';
import {
  BIDWHIST_FAMILY,
  BIDWHIST_FAMILY_CONSTANTS,
  BIDWHIST_FAMILY_POWERED,
  STRATEGY_REGISTRY,
} from './index.ts';

describe('strategy registry', () => {
  it('all registered strategies parse without error', () => {
    for (const entry of STRATEGY_REGISTRY) {
      expect(() => parseStrategy(entry.text)).not.toThrow();
    }
  });

  it('Family (Constants) declares the expected let bindings', () => {
    const ast = parseStrategy(BIDWHIST_FAMILY_CONSTANTS);
    expect(ast.constants).toEqual({
      long_suit: 6,
      very_long_suit: 7,
      honor_threshold: 3,
      dealer_bid4_suit_req: 5,
    });
  });

  it('Family (Powered) declares the expected let bindings', () => {
    const ast = parseStrategy(BIDWHIST_FAMILY_POWERED);
    expect(ast.constants).toEqual({
      long_suit: 6,
      very_long_suit: 7,
      uptown_signal_threshold: 9,
      downtown_signal_threshold: 9,
      dealer_bid4_suit_req: 5,
    });
  });

  it('Family proper declares no constants', () => {
    const ast = parseStrategy(BIDWHIST_FAMILY);
    expect(ast.constants).toBeUndefined();
  });
});

describe('Family vs Family (Constants): bit-identical parity', () => {
  // The Family (Constants) strategy rewrites Family using `let` bindings
  // for every magic number the bid rules read. The predicates are
  // otherwise unchanged, so simulating a hand with either strategy
  // occupying all four seats must produce the same declarer, bid, trump,
  // discard, and trick-by-trick play. This test pins that invariant —
  // if it breaks, either the let-binding pathway drifted or the
  // Constants rewrite was edited in a way that changed semantics.
  it('50 seeded decks: every decision tuple matches', () => {
    const familyAst = parseStrategy(BIDWHIST_FAMILY);
    const constAst = parseStrategy(BIDWHIST_FAMILY_CONSTANTS);
    const pool = generateDeckPool(50, 20260421);

    for (const deckUrl of pool) {
      const a = BidWhistSimulator.simulateDetailedHand(deckUrl, [familyAst, familyAst, familyAst, familyAst], 0);
      const b = BidWhistSimulator.simulateDetailedHand(deckUrl, [constAst, constAst, constAst, constAst], 0);
      if (!a && !b) continue;
      expect(!!a).toBe(!!b); // both redeal or both don't
      if (!a || !b) continue;

      expect(b.declarer).toBe(a.declarer);
      expect(b.bidAmount).toBe(a.bidAmount);
      expect(b.trumpSuit).toBe(a.trumpSuit);
      expect(b.direction).toBe(a.direction);
      expect(b.discards.map(c => c.id).sort()).toEqual(a.discards.map(c => c.id).sort());
      expect(b.booksWon).toEqual(a.booksWon);
      expect(b.tricks.length).toBe(a.tricks.length);
      for (let t = 0; t < a.tricks.length; t++) {
        expect(b.tricks[t].plays.map(p => p.card.id)).toEqual(a.tricks[t].plays.map(p => p.card.id));
      }
    }
  });
});
