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
    myDiscards: [],
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

describe('sluff_candidates primitive', () => {
  // Play a rule that picks a card from sluff_candidates; inspect via evalPlay.
  // The existing test harness uses bid-phase so we test via a minimal
  // context-level check: confirm the function exists and returns a
  // CardSet, and spot-check membership.
  const { evaluatePlay } = require('./evaluator.ts');
  const { buildBidWhistContext } = require('./context.ts');
  // Construct a context directly with a fixed hand.
  const mkCtx = (hand: Card[], trumpSuit: string | null, played: Card[] = []): StrategyContext => ({
    hand,
    currentTrick: [],
    leadSuit: null,
    trumpSuit,
    playerId: 0,
    declarer: 1,
    dealer: 0,
    isDealer: false,
    onDeclarerTeam: false,
    amDeclarer: false,
    partnerIsDeclarer: false,
    hasTrump: trumpSuit !== null && hand.some(c => c.suit === trumpSuit),
    partnerWinning: false,
    partnerLed: false,
    isFirstTrick: true,
    heartsBroken: false,
    bidDirection: 'uptown',
    currentHighBid: 2,
    bids: [],
    bidCount: 0,
    partnerBid: 0,
    enemyBid: 0,
    haveSignaled: false,
    partnerSignal: '',
    enemySignal1: '',
    enemySignal2: '',
    enemyHasTrump: true,
    partnerHasTrump: true,
    partnerVoidSuits: [],
    getCardValue: (c: Card) => (c.rank === 1 ? 14 : c.rank),
    compareCards: () => 0,
    evaluateCurrentWinner: () => -1,
    playedCards: played,
    myDiscards: [],
  });

  const STRAT = `strategy "sluff"
game: bidwhist

play:
  leading:
    default:
      play sluff_candidates().weakest
  following:
    default:
      play hand.weakest
  void:
    default:
      play hand.weakest
`;

  it('returns empty when all non-trump cards are protected', () => {
    // Hand: K+2 hearts only (trump=spades). Hearts: K is potential winner,
    // 2 is backing → both protected → no sluff candidates.
    const h: Card[] = [
      { suit: 'hearts', rank: 13, id: 'hearts_13' },
      { suit: 'hearts', rank: 2, id: 'hearts_2' },
    ];
    const ast = parseStrategy(STRAT);
    const ctx = mkCtx(h, 'spades');
    const result = evaluatePlay(ast, ctx);
    // With empty sluff_candidates, picking weakest gives null → play rule returns null
    expect(result).toBeNull();
  });

  it('returns middle cards as sluff candidates, protects high + low', () => {
    // Hand: K+Q+2 hearts. K is potential winner, 2 is backing; Q is middle.
    const h: Card[] = [
      { suit: 'hearts', rank: 13, id: 'hearts_13' },
      { suit: 'hearts', rank: 12, id: 'hearts_12' },
      { suit: 'hearts', rank: 2, id: 'hearts_2' },
    ];
    const ast = parseStrategy(STRAT);
    const ctx = mkCtx(h, 'spades');
    const result = evaluatePlay(ast, ctx);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('hearts_12'); // Q is the only sluff candidate
  });

  it('singletons are sluff candidates (no backing to preserve)', () => {
    // Hand: singleton 2H + K+Q+2 clubs. Hearts 2H has no partner in hand
    // so it's always sluff-able. Clubs: K=potential winner, 2=backing, Q=middle.
    const h: Card[] = [
      { suit: 'hearts', rank: 2, id: 'hearts_2' },
      { suit: 'clubs', rank: 13, id: 'clubs_13' },
      { suit: 'clubs', rank: 12, id: 'clubs_12' },
      { suit: 'clubs', rank: 2, id: 'clubs_2' },
    ];
    const ast = parseStrategy(STRAT);
    const ctx = mkCtx(h, 'spades');
    const result = evaluatePlay(ast, ctx);
    // Weakest of {2H, QC}. Under this test's value function, 2H = 2, QC = 12.
    // So weakest = 2H.
    expect(result).not.toBeNull();
    expect(result!.id).toBe('hearts_2');
  });

  it('already-boss cards do not need backing (all sluff-able)', () => {
    // Hand: A+K+2 hearts; trump=spades. A is already boss (nothing above),
    // so no backing is protected; all three are sluff candidates.
    const h: Card[] = [
      { suit: 'hearts', rank: 1, id: 'hearts_1' },
      { suit: 'hearts', rank: 13, id: 'hearts_13' },
      { suit: 'hearts', rank: 2, id: 'hearts_2' },
    ];
    const ast = parseStrategy(STRAT);
    const ctx = mkCtx(h, 'spades');
    const result = evaluatePlay(ast, ctx);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('hearts_2');
  });
});

describe('suit-role primitives (boss / backed / backing / spare / holes)', () => {
  const { evaluatePlay, evaluateDiscard } = require('./evaluator.ts');

  // Read any numeric DSL expression through a bid action.
  function evalNum(expr: string, ctx: StrategyContext): number {
    const ast = parseStrategy(`strategy "t"\ngame: bidwhist\n\nbid:\n  default:\n    bid ${expr}\n`);
    const result = evaluateBid(ast, ctx);
    return typeof result === 'number' ? result : NaN;
  }

  // Read a card-valued DSL expression through a leading play action.
  function evalCard(expr: string, ctx: StrategyContext): string | null {
    const ast = parseStrategy(
      `strategy "t"\ngame: bidwhist\n\nplay:\n  leading:\n    default:\n      play ${expr}\n`);
    const result = evaluatePlay(ast, ctx);
    return result ? result.id : null;
  }

  function mk(suit: string, rank: number): Card {
    return { suit, rank, id: `${suit}_${rank}` };
  }

  // The canonical human example: A/K/10/9/5/3 of hearts, Q/J outstanding.
  // "2 winners (A/K), a 2-hole (Q/J), 2-with-backing (10/9), backing (5/3)."
  const canonical = [
    mk('hearts', 1), mk('hearts', 13), mk('hearts', 10),
    mk('hearts', 9), mk('hearts', 5), mk('hearts', 3),
  ];

  it('partitions the canonical A/K/10/9/5/3 holding', () => {
    const ctx = ctxFromHand(canonical);
    expect(evalNum('hand.suit("hearts").boss.count', ctx)).toBe(2);
    expect(evalNum('hand.suit("hearts").backed.count', ctx)).toBe(2);
    expect(evalNum('hand.suit("hearts").backing.count', ctx)).toBe(2);
    expect(evalNum('hand.suit("hearts").spare.count', ctx)).toBe(0);
    expect(evalNum('hand.suit("hearts").working.count', ctx)).toBe(6);
    // The backed winners are exactly the 10 and 9
    expect(evalCard('hand.suit("hearts").backed.strongest', ctx)).toBe('hearts_10');
    expect(evalCard('hand.suit("hearts").backed.weakest', ctx)).toBe('hearts_9');
    // The backing feeds are exactly the 5 and 3
    expect(evalCard('hand.suit("hearts").backing.strongest', ctx)).toBe('hearts_5');
    expect(evalCard('hand.suit("hearts").backing.weakest', ctx)).toBe('hearts_3');
    // The hole is the missing Q/J
    expect(evalNum('hole_count("hearts")', ctx)).toBe(2);
    expect(evalNum('suit_makeable_tricks("hearts")', ctx)).toBe(4);
  });

  it('cards below the needed backing are spare', () => {
    // A/K/10/9/7/5/3: same structure plus one extra low card. The two
    // HIGHEST cards below the backed run (7, 5) are reserved as feeds —
    // holding bigger feeds shrinks the opponents' duck space — and the
    // bottom card (3) is released as the spare/discard.
    const ctx = ctxFromHand([...canonical, mk('hearts', 7)]);
    expect(evalNum('hand.suit("hearts").backed.count', ctx)).toBe(2);
    expect(evalNum('hand.suit("hearts").backing.count', ctx)).toBe(2);
    expect(evalNum('hand.suit("hearts").spare.count', ctx)).toBe(1);
    expect(evalCard('hand.suit("hearts").spare.strongest', ctx)).toBe('hearts_3');
    expect(evalCard('hand.suit("hearts").backing.strongest', ctx)).toBe('hearts_7');
    expect(evalCard('hand.suit("hearts").backing.weakest', ctx)).toBe('hearts_5');
  });

  it('a half-stopper (Q/5 vs A,K out) is not backed', () => {
    const ctx = ctxFromHand([mk('hearts', 12), mk('hearts', 5)]);
    expect(evalNum('hand.suit("hearts").boss.count', ctx)).toBe(0);
    expect(evalNum('hand.suit("hearts").backed.count', ctx)).toBe(0);
    expect(evalNum('hand.suit("hearts").spare.count', ctx)).toBe(2);
    expect(evalNum('hole_count("hearts")', ctx)).toBe(2);
  });

  it('one feed can promote a whole run (K/Q/2 vs A out)', () => {
    const ctx = ctxFromHand([mk('hearts', 13), mk('hearts', 12), mk('hearts', 2)]);
    expect(evalNum('hand.suit("hearts").backed.count', ctx)).toBe(2);
    expect(evalNum('hand.suit("hearts").backing.count', ctx)).toBe(1);
    expect(evalCard('hand.suit("hearts").backing.weakest', ctx)).toBe('hearts_2');
    expect(evalNum('suit_makeable_tricks("hearts")', ctx)).toBe(2);
  });

  it('long weak suits earn backed winners (10..5 vs A,K,Q,J out)', () => {
    const ctx = ctxFromHand([10, 9, 8, 7, 6, 5].map(r => mk('hearts', r)));
    expect(evalNum('hand.suit("hearts").backed.count', ctx)).toBe(2); // 10, 9
    expect(evalNum('hand.suit("hearts").backing.count', ctx)).toBe(4); // 8,7,6,5
    expect(evalNum('hole_count("hearts")', ctx)).toBe(4);
  });

  it('hole_count is 0 for void suits and all-boss suits', () => {
    const ctx = ctxFromHand([mk('hearts', 1), mk('hearts', 13)]);
    expect(evalNum('hole_count("hearts")', ctx)).toBe(0); // A/K are boss
    expect(evalNum('hole_count("clubs")', ctx)).toBe(0);  // void
  });

  it('roles honor played cards: J promotes to boss once A/K/Q fall', () => {
    const played = [mk('hearts', 1), mk('hearts', 13), mk('hearts', 12)];
    const ctx = ctxFromHand([mk('hearts', 11), mk('hearts', 2)], { playedCards: played });
    expect(evalNum('hand.suit("hearts").boss.count', ctx)).toBe(1);
    // hole_count reports the gap above the highest NON-boss card — here the
    // junk 2, which sits under the 8 outstanding cards 10..3. A large hole
    // means "my next card is nowhere near promotion", not "no holes".
    expect(evalNum('hole_count("hearts")', ctx)).toBe(8);
  });

  it('roles honor my own kitty discards (declarer knowledge)', () => {
    // K/5 of hearts. With the A outstanding, K is only backed…
    const noInfo = ctxFromHand([mk('hearts', 13), mk('hearts', 5)]);
    expect(evalNum('hand.suit("hearts").boss.count', noInfo)).toBe(0);
    expect(evalNum('hand.suit("hearts").backed.count', noInfo)).toBe(1);
    // …but if I discarded the A myself, my K is boss.
    const discarded = ctxFromHand(
      [mk('hearts', 13), mk('hearts', 5)],
      { myDiscards: [mk('hearts', 1)] });
    expect(evalNum('hand.suit("hearts").boss.count', discarded)).toBe(1);
    // The K is boss now; the hole is what blocks the 5 (Q..6 outstanding).
    expect(evalNum('hole_count("hearts")', discarded)).toBe(7);
  });

  it('direction arguments analyze hypothetical calls at bid time', () => {
    // A/2/3 of hearts under an uptown-valued context.
    const ctx = ctxFromHand([mk('hearts', 1), mk('hearts', 2), mk('hearts', 3)]);
    // Uptown (context default): only the A is boss; 2/3 are spare.
    expect(evalNum('hand.suit("hearts").boss.count', ctx)).toBe(1);
    // Downtown: A stays highest, then 2, 3 — all three are boss.
    expect(evalNum('hand.suit("hearts").boss(downtown).count', ctx)).toBe(3);
    // Downtown-noaces: 2/3 are boss, the A is the worst card in the suit.
    expect(evalNum('hand.suit("hearts").boss(downtown-noaces).count', ctx)).toBe(2);
    expect(evalNum('makeable_trick_count(downtown)', ctx)).toBe(3);
  });

  it('downtown-noaces: the ace can serve as backing below the King', () => {
    // K/A of hearts, only the Q still outstanding (2..J played).
    // Noaces order: 2 best … K second-worst, A worst. The Q outranks my K,
    // but feeding the A to the Q's trick promotes the K.
    // Regression: A and K used to tie at value 1, misclassifying both as spare.
    const played = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(r => mk('hearts', r));
    const ctx = ctxFromHand(
      [mk('hearts', 13), mk('hearts', 1)], { playedCards: played });
    expect(evalNum('hand.suit("hearts").backed(downtown-noaces).count', ctx)).toBe(1);
    expect(evalNum('hand.suit("hearts").backing(downtown-noaces).count', ctx)).toBe(1);
    expect(evalNum('suit_makeable_tricks("hearts", downtown-noaces)', ctx)).toBe(1);
  });

  it('sure_trick_count sums boss + backed across suits', () => {
    // Hearts canonical (4) + spades A,K,Q (3 boss; no backing for more).
    const h = [...canonical, mk('spades', 1), mk('spades', 13), mk('spades', 12)];
    const ctx = ctxFromHand(h);
    expect(evalNum('makeable_trick_count()', ctx)).toBe(7);
    expect(evalNum('suit_makeable_tricks("spades")', ctx)).toBe(3);
  });

  it('best_suit_by_tricks picks the suit with the most makeable tricks', () => {
    const h = [...canonical, mk('spades', 1), mk('spades', 13), mk('spades', 12)];
    const ctx = ctxFromHand(h);
    const STRAT = `strategy "t"
game: bidwhist

trump:
  default:
    choose suit: best_suit_by_tricks(uptown) direction: uptown
`;
    const { evaluateTrump } = require('./evaluator.ts');
    const result = evaluateTrump(parseStrategy(STRAT), ctx);
    expect(result).toEqual({ suit: 'hearts', direction: 'uptown' });
  });

  it('role sets intersect with chained filters (hand.nontrump.working)', () => {
    const h = [...canonical, mk('spades', 1), mk('spades', 4)];
    const ctx = ctxFromHand(h, { trumpSuit: 'spades' });
    // Hearts working = 6; the spades are excluded by .nontrump.
    expect(evalNum('hand.nontrump.working.count', ctx)).toBe(6);
    // Trump is ALWAYS working: the structurally-jobless 4 of trump still
    // has a ruffing job, so it is working (and never spare).
    expect(evalNum('hand.trump.working.count', ctx)).toBe(2);
    expect(evalNum('hand.spare.count', ctx)).toBe(0);
  });

  it('keep working / drop spare protects backing cards in the discard', () => {
    // Declarer with 16 cards, trump = spades:
    //   spades  A,K,Q,2,3 — trump
    //   hearts  A,K,10,9,5,3 — canonical: ALL working (backing = 5,3)
    //   diamonds 8,7,2 — spare (A,K,Q,J,10,9 outstanding)
    //   clubs   J,4 — spare (A,K,Q outstanding, one card below)
    const h = [
      mk('spades', 1), mk('spades', 13), mk('spades', 12), mk('spades', 2), mk('spades', 3),
      ...canonical,
      mk('diamonds', 8), mk('diamonds', 7), mk('diamonds', 2),
      mk('clubs', 11), mk('clubs', 4),
    ];
    const ctx = ctxFromHand(h, { trumpSuit: 'spades', amDeclarer: true, declarer: 0 });
    const STRAT = `strategy "t"
game: bidwhist

discard:
  default:
    keep hand.working
  when hand.spare.count > 0:
    drop hand.spare
`;
    const discards = evaluateDiscard(parseStrategy(STRAT), ctx);
    // The naive lowest-value discard would toss 2d, 3h, 4c, 5h — destroying
    // the hearts backing. Role-aware discard keeps 3h/5h and sheds spares.
    expect(discards).toEqual(
      expect.arrayContaining(['diamonds_2', 'clubs_4', 'diamonds_7', 'diamonds_8']));
    expect(discards).not.toContain('hearts_3');
    expect(discards).not.toContain('hearts_5');
    // Low trump is never spare, so `drop hand.spare` cannot shed it.
    expect(discards).not.toContain('spades_2');
    expect(discards).not.toContain('spades_3');
  });
});

describe('signal-aware trump selection primitives', () => {
  const { evaluateTrump } = require('./evaluator.ts');

  function mk(suit: string, rank: number): Card {
    return { suit, rank, id: `${suit}_${rank}` };
  }

  function trumpChoice(ctx: StrategyContext, suitExpr: string, dirExpr: string) {
    const STRAT = `strategy "t"
game: bidwhist

trump:
  default:
    choose suit: ${suitExpr} direction: ${dirExpr}
`;
    return evaluateTrump(parseStrategy(STRAT), ctx);
  }

  it('best_suit_by_power picks honor density over length', () => {
    // 6 low hearts vs A/K/Q of spades: best_suit (length-biased) would take
    // hearts; power picks spades.
    const h = [
      ...[2, 3, 4, 5, 6, 7].map(r => mk('hearts', r)),
      mk('spades', 1), mk('spades', 13), mk('spades', 12),
    ];
    const ctx = ctxFromHand(h);
    const result = trumpChoice(ctx, 'best_suit_by_power(uptown)', 'uptown');
    expect(result).toEqual({ suit: 'spades', direction: 'uptown' });
  });

  // A roughly direction-symmetric hand: high tops in hearts, low tops in
  // spades, junk elsewhere. The signals should tip the call.
  const symmetric = [
    mk('hearts', 1), mk('hearts', 13), mk('hearts', 9), mk('hearts', 8),
    mk('spades', 2), mk('spades', 3), mk('spades', 9), mk('spades', 8),
    mk('diamonds', 13), mk('diamonds', 7), mk('clubs', 3), mk('clubs', 7),
  ];

  it('partner signal steers the direction on a balanced hand', () => {
    const high = trumpChoice(ctxFromHand(symmetric, { partnerBid: 2 }),
      'signal_aware_suit()', 'signal_aware_direction()');
    expect(high!.direction).toBe('uptown');

    const low = trumpChoice(ctxFromHand(symmetric, { partnerBid: 1 }),
      'signal_aware_suit()', 'signal_aware_direction()');
    expect(low!.direction).not.toBe('uptown');
  });

  it('enemy signal counterpicks the direction on a balanced hand', () => {
    const result = trumpChoice(ctxFromHand(symmetric, { partnerBid: 0, enemyBid: 2 }),
      'signal_aware_suit()', 'signal_aware_direction()');
    expect(result!.direction).not.toBe('uptown');
  });

  it('exclusion steers the suit: own tops beat outstanding tops (the motivating hand)', () => {
    // Dealer's 16 cards: 6 low spades, strong-high diamonds, K/Q side suits.
    // Partner signaled high (2), enemy signaled low (1). Under uptown the
    // spades are LONGER (6 vs 5) but A/K/Q of spades are all outstanding —
    // gambling the trump suit on cards 2-of-3 opponents may hold. Diamonds'
    // tops are mostly in-hand, so the model must pick diamonds.
    const h = [
      ...[2, 3, 4, 7, 9, 11].map(r => mk('spades', r)),
      mk('diamonds', 1), mk('diamonds', 12), mk('diamonds', 10), mk('diamonds', 3), mk('diamonds', 2),
      mk('hearts', 13), mk('hearts', 5),
      mk('clubs', 12), mk('clubs', 8), mk('clubs', 6),
    ];
    const ctx = ctxFromHand(h, { partnerBid: 2, enemyBid: 1, declarer: 0, amDeclarer: true });
    const result = trumpChoice(ctx, 'signal_aware_suit(uptown)', 'uptown');
    expect(result).toEqual({ suit: 'diamonds', direction: 'uptown' });
  });

  it('partner_cover / enemy_cover expose the direction lean as scalars', () => {
    const { evaluateBid: evalBid } = require('./evaluator.ts');
    const num = (expr: string, ctx: StrategyContext): number => {
      const ast = parseStrategy(`strategy "t"\ngame: bidwhist\n\nbid:\n  default:\n    bid ${expr}\n`);
      const r = evalBid(ast, ctx);
      return typeof r === 'number' ? r : NaN;
    };
    const junk = [8, 7, 6].map(r => mk('hearts', r));

    // Partner signaled high: their expected uptown tops concentrate to >= 4
    // (12 tops outstanding), and their downtown cover is depressed.
    const pHigh = ctxFromHand(junk, { partnerBid: 2 });
    expect(num('partner_cover(uptown)', pHigh)).toBeGreaterThanOrEqual(4);
    expect(num('partner_cover(downtown)', pHigh))
      .toBeLessThan(num('partner_cover(uptown)', pHigh));

    // Exclusion: if I hold most uptown tops myself, partner's cover shrinks
    // to what remains outstanding.
    const iHoldTops = ctxFromHand([
      mk('hearts', 1), mk('hearts', 13), mk('hearts', 12),
      mk('spades', 1), mk('spades', 13), mk('spades', 12),
      mk('diamonds', 1), mk('diamonds', 13), mk('diamonds', 12),
      mk('clubs', 1), mk('clubs', 13),
    ], { partnerBid: 2 });
    expect(num('partner_cover(uptown)', iHoldTops)).toBeLessThanOrEqual(1);

    // Enemy cover mirrors with the enemy signal.
    const eLow = ctxFromHand(junk, { enemyBid: 1 });
    expect(num('enemy_cover(downtown)', eLow)).toBeGreaterThanOrEqual(4);
    expect(num('enemy_cover(uptown)', eLow))
      .toBeLessThan(num('enemy_cover(downtown)', eLow));

    // No signals: both fall back to the 1-in-3 proportional prior.
    const quiet = ctxFromHand(junk);
    expect(num('partner_cover(uptown)', quiet)).toBeCloseTo(4, 5);
    expect(num('enemy_cover(uptown)', quiet)).toBeCloseTo(4, 5);
  });

  it('exclusion neutralizes the enemy signal in a suit whose tops I hold', () => {
    // I hold 2/3/4 of spades (all the noaces tops): the enemy's low signal
    // cannot threaten low spades — outTop(spades, noaces) is 0, so spades
    // must score above any suit with outstanding low tops.
    const h = [
      ...[2, 3, 4, 7, 9, 11].map(r => mk('spades', r)),
      mk('diamonds', 8), mk('diamonds', 9), mk('diamonds', 10),
      mk('hearts', 8), mk('hearts', 9), mk('clubs', 8),
    ];
    const ctx = ctxFromHand(h, { partnerBid: 0, enemyBid: 1 });
    const result = trumpChoice(ctx, 'signal_aware_suit(downtown-noaces)', 'downtown-noaces');
    expect(result).toEqual({ suit: 'spades', direction: 'downtown-noaces' });
  });
});

describe('least_beaten and partner_cover_suit primitives', () => {
  const { evaluatePlay, evaluateTrump } = require('./evaluator.ts');

  function mk(suit: string, rank: number): Card {
    return { suit, rank, id: `${suit}_${rank}` };
  }

  function playCard(expr: string, ctx: StrategyContext): string | null {
    const ast = parseStrategy(
      `strategy "t"\ngame: bidwhist\n\nplay:\n  leading:\n    default:\n      play ${expr}\n`);
    const result = evaluatePlay(ast, ctx);
    return result ? result.id : null;
  }

  it('least_beaten picks the card with fewest outstanding beaters', () => {
    // K hearts: only the A beats it (1 beater). Q spades: A,K out (2).
    // 5 diamonds: many. The K is the near-boss probe.
    const h = [mk('hearts', 13), mk('spades', 12), mk('diamonds', 5)];
    const ctx = ctxFromHand(h);
    expect(playCard('hand.least_beaten', ctx)).toBe('hearts_13');
  });

  it('least_beaten honors played cards (boss = 0 beaters wins outright)', () => {
    const h = [mk('hearts', 13), mk('spades', 12)];
    const ctx = ctxFromHand(h, { playedCards: [mk('hearts', 1)] });
    // A hearts is gone: K hearts is boss (0 beaters) vs Q spades (2).
    expect(playCard('hand.least_beaten', ctx)).toBe('hearts_13');
  });

  it('least_beaten tie-breaks by fixed suit order at equal count and value', () => {
    // K spades and K hearts each have exactly 1 beater (their ace).
    const h = [mk('hearts', 13), mk('spades', 13)];
    const ctx = ctxFromHand(h);
    expect(playCard('hand.least_beaten', ctx)).toBe('spades_13');
  });

  it('partner_cover_suit finds where the outstanding tops concentrate', () => {
    // Uptown context. I hold A/K/Q of hearts (hearts outTop = 0) and
    // A/K of diamonds (outTop 1); spades is trump (excluded); clubs is
    // untouched (outTop 3) — partner's signaled strength lives in clubs.
    const h = [
      mk('hearts', 1), mk('hearts', 13), mk('hearts', 12),
      mk('diamonds', 1), mk('diamonds', 13),
      mk('clubs', 5), mk('clubs', 4),
    ];
    const ctx = ctxFromHand(h, { trumpSuit: 'spades', partnerBid: 2 });
    const STRAT = `strategy "t"
game: bidwhist

trump:
  default:
    choose suit: partner_cover_suit(uptown) direction: uptown
`;
    const result = evaluateTrump(parseStrategy(STRAT), ctx);
    expect(result).toEqual({ suit: 'clubs', direction: 'uptown' });
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
