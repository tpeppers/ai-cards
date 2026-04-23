import { parseStrategy } from './parser.ts';
import { evaluateBid } from './evaluator.ts';
import { setStrategyDebug } from './evaluator.ts';
import { Card } from '../types/CardGame.ts';
import { StrategyContext } from './types.ts';
import { letterToCard } from '../urlGameState.js';

setStrategyDebug(false);

// Minimal context builder — only fields the power/count helpers read.
function ctxFromHand(cards: Card[], partial: Partial<StrategyContext> = {}): StrategyContext {
  return {
    hand: cards,
    currentTrick: [],
    leadSuit: null,
    trumpSuit: null,
    playerId: 0,
    declarer: null,
    dealer: 0,
    isDealer: false,
    onDeclarerTeam: false,
    amDeclarer: false,
    partnerIsDeclarer: false,
    hasTrump: false,
    partnerWinning: false,
    partnerLed: false,
    isFirstTrick: true,
    heartsBroken: false,
    bidDirection: 'uptown',
    currentHighBid: 0,
    bids: [],
    bidCount: 0,
    partnerBid: 0,
    enemyBid: 0,
    haveSignaled: false,
    partnerSignal: '',
    enemySignal1: '',
    enemySignal2: '',
    enemyHasTrump: false,
    partnerHasTrump: false,
    partnerVoidSuits: [],
    getCardValue: (c: Card) => (c.rank === 1 ? 14 : c.rank),
    compareCards: () => 0,
    evaluateCurrentWinner: () => -1,
    playedCards: [],
    ...partial,
  };
}

// Build a hand from the URL alphabet (cardToLetter: a-m hearts, n-z spades,
// A-M clubs, N-Z diamonds; rank 1=a/n/A/N).
function hand(letters: string): Card[] {
  return Array.from(letters).map(letterToCard);
}

// Evaluate a single bid rule and return the resulting bid amount (0 = pass).
function bidWith(strategyText: string, h: Card[]): number {
  const ast = parseStrategy(strategyText);
  const result = evaluateBid(ast, ctxFromHand(h));
  return typeof result === 'number' ? result : 0;
}

const POWER_STRAT = `strategy "Power Test"
game: bidwhist

bid:
  when hand_power(uptown) >= 10:
    bid 4
  when hand_power(uptown) >= 8:
    bid 2
  when hand_power(downtown) >= 8:
    bid 1
  default:
    pass
`;

describe('power scoring DSL', () => {
  it('AKQJ of one suit → hand_power(uptown) = 10', () => {
    // Hearts: a=A, m=K, l=Q, k=J  (letterToCard: a..m rank 1..13)
    // Wait — verify the mapping: a=1, m=13, so K=m, Q=l, J=k, T=j ...
    // 12 cards: fill out with low hearts + filler spades
    const h = hand('amlk' + 'bcdefghi' /* hearts 2..9 as filler */);
    expect(bidWith(POWER_STRAT, h)).toBe(4);
  });

  it('four aces → hand_power(uptown) = 16 (fires bid 4)', () => {
    // a=A♥, n=A♠, A=A♣, N=A♦ + 8 low filler
    const h = hand('anAN' + 'bcdefghi');
    expect(bidWith(POWER_STRAT, h)).toBe(4);
  });

  it('all junk (7..10 of each suit) → 0 points, passes', () => {
    // ranks 6..10 in hearts (f..j) + spades 6..8 (s..u) + hearts rank 5 (e)
    const h = hand('fghij' + 'stu' + 'BCDE' /* clubs 2..5 also low/junk */);
    expect(bidWith(POWER_STRAT, h)).toBe(0);
  });

  it('three kings + junk → 9 points uptown (fires bid 2)', () => {
    // m=K♥, z=K♠, M=K♣ (rank 13) + 9 junk cards
    const h = hand('mzM' + 'efghij' + 'tuv');
    expect(bidWith(POWER_STRAT, h)).toBe(2);
  });

  it('low-card hand (no honors) → high downtown, zero uptown (fires bid 1)', () => {
    // Hearts 2..4 (b,c,d) + Spades 2..4 (o,p,q) = 12 downtown, 0 uptown.
    // Filler: hearts 5..7 + spades 5..7 = zero on both scales.
    const h = hand('bcd' + 'opq' + 'efg' + 'rst');
    expect(bidWith(POWER_STRAT, h)).toBe(1);
  });

  it('suit_power isolates one suit', () => {
    const h = hand('am' + 'nz' + 'AM' + 'NZ' + 'bcde');
    const STRAT = `strategy "suit power"
game: bidwhist

bid:
  when suit_power("hearts", uptown) >= 7:
    bid 4
  default:
    pass
`;
    // hearts: a=A (4) + m=K (3) + b..e (0) = 7 → bid 4
    expect(bidWith(STRAT, h)).toBe(4);
  });

  it('trump_power returns 0 before trump is set', () => {
    const h = hand('am' + 'nz' + 'AM' + 'NZ' + 'bcde');
    const STRAT = `strategy "trump power"
game: bidwhist

bid:
  when trump_power(uptown) >= 1:
    bid 4
  default:
    pass
`;
    expect(bidWith(STRAT, h)).toBe(0);
  });
});

describe('let bindings', () => {
  it('threshold constants parse and drive rule selection', () => {
    // hand_power(uptown) = 4+3+2+1 = 10 (AKQJ of hearts)
    const h = hand('amlk' + 'bcdefghi');

    const STRAT = (threshold: number) => `strategy "let threshold"
game: bidwhist

let bid2_threshold = ${threshold}

bid:
  when hand_power(uptown) >= bid2_threshold:
    bid 2
  default:
    pass
`;
    // threshold 10: fires → bid 2. threshold 11: no fire → pass.
    expect(bidWith(STRAT(10), h)).toBe(2);
    expect(bidWith(STRAT(11), h)).toBe(0);
  });

  it('let bindings compose with arithmetic', () => {
    const h = hand('amlk' + 'bcdefghi'); // uptown power 10

    const STRAT = `strategy "arithmetic"
game: bidwhist

let base = 8
let bonus = 2

bid:
  when hand_power(uptown) >= base + bonus:
    bid 4
  default:
    pass
`;
    expect(bidWith(STRAT, h)).toBe(4);
  });

  it('built-in context variables shadow let bindings of the same name', () => {
    const h = hand('amlk' + 'bcdefghi');

    // Even though the strategy declares let partner_bid = 99, the
    // context's partnerBid (0 by default in ctxFromHand) should win.
    const STRAT = `strategy "shadow"
game: bidwhist

let partner_bid = 99

bid:
  when partner_bid >= 50:
    bid 5
  default:
    pass
`;
    expect(bidWith(STRAT, h)).toBe(0);
  });

  it('negative literal values parse', () => {
    const h = hand('amlk' + 'bcdefghi'); // uptown power 10

    const STRAT = `strategy "negative"
game: bidwhist

let offset = -5

bid:
  when hand_power(uptown) + offset >= 5:
    bid 3
  default:
    pass
`;
    // 10 + (-5) = 5 >= 5 → bid 3
    expect(bidWith(STRAT, h)).toBe(3);
  });

  it('duplicate let bindings throw at parse time', () => {
    const STRAT = `strategy "dup"
game: bidwhist

let x = 1
let x = 2

bid:
  default:
    pass
`;
    expect(() => parseStrategy(STRAT)).toThrow(/duplicate let binding/);
  });
});

describe('am_declarer / partner_is_declarer DSL variables', () => {
  const h = hand('amlk' + 'bcdefghi'); // AKQJ hearts + 8 low hearts

  // Use a bid rule that reads the declarer-state variables. During the bid
  // phase there's no declarer yet, so am_declarer/partner_is_declarer are
  // false. We have to override the context via partial to test.
  function evalWithContext(strategyText: string, partial: Partial<StrategyContext>): number {
    const ast = parseStrategy(strategyText);
    const result = evaluateBid(ast, ctxFromHand(h, partial));
    return typeof result === 'number' ? result : 0;
  }

  const STRAT = `strategy "decl test"
game: bidwhist

bid:
  when am_declarer:
    bid 5
  when partner_is_declarer:
    bid 4
  when on_declarer_team:
    bid 3
  default:
    bid 1
`;

  it('am_declarer fires only when I am the declarer', () => {
    expect(evalWithContext(STRAT, { playerId: 0, declarer: 0, onDeclarerTeam: true, amDeclarer: true, partnerIsDeclarer: false })).toBe(5);
  });

  it('partner_is_declarer fires when partner is declarer but not me', () => {
    expect(evalWithContext(STRAT, { playerId: 0, declarer: 2, onDeclarerTeam: true, amDeclarer: false, partnerIsDeclarer: true })).toBe(4);
  });

  it('on_declarer_team still fires when I am declarer (am_declarer implies on_declarer_team)', () => {
    // Bid 5 wins — first rule matches, later rules don't run even if they would
    expect(evalWithContext(STRAT, { playerId: 0, declarer: 0, onDeclarerTeam: true, amDeclarer: true, partnerIsDeclarer: false })).toBe(5);
  });

  it('neither flag fires when opponents are the declarer', () => {
    expect(evalWithContext(STRAT, { playerId: 0, declarer: 1, onDeclarerTeam: false, amDeclarer: false, partnerIsDeclarer: false })).toBe(1);
  });

  it('partnerIsDeclarer implies onDeclarerTeam (invariant check)', () => {
    // Rule order: am_declarer, partner_is_declarer, on_declarer_team, default.
    // With partnerIsDeclarer=true we expect rule 2 to fire (bid 4).
    const result = evalWithContext(STRAT, { playerId: 0, declarer: 2, onDeclarerTeam: true, amDeclarer: false, partnerIsDeclarer: true });
    expect(result).toBe(4);
  });
});
