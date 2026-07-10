import { Card } from '../types/CardGame.ts';
import {
  StrategyAST, RuleBlock, Action, Expression,
  PlayAction, BidAction, ChooseAction, KeepAction, DropAction,
  StrategyContext, CardSet,
} from './types.ts';
import { postTrumpCardValue } from '../simulation/handStrength.ts';

// ── Debug Logging ───────────────────────────────────────────────────

let strategyDebugEnabled = true;

export function setStrategyDebug(enabled: boolean): void {
  strategyDebugEnabled = enabled;
}

function debugLog(...args: any[]): void {
  if (strategyDebugEnabled) console.log('[Strategy]', ...args);
}

function debugGroup(label: string): void {
  if (strategyDebugEnabled) console.groupCollapsed('[Strategy]', label);
}

function debugGroupEnd(): void {
  if (strategyDebugEnabled) console.groupEnd();
}

// ── Rule Tracing ────────────────────────────────────────────────────

export type RuleTraceEntry = {
  phase: 'bid' | 'trump' | 'discard' | 'play';
  subSection?: 'leading' | 'following' | 'void';
  playerId: number;
  ruleIndex: number;       // 0+ for matched rule, -1 for default, -2 for no match
  conditionText?: string;  // human-readable condition (from formatExpr)
};

let traceCollector: RuleTraceEntry[] | null = null;

export function enableTracing(): void { traceCollector = []; }
export function disableTracing(): RuleTraceEntry[] {
  const entries = traceCollector || [];
  traceCollector = null;
  return entries;
}

// ── Seen/outstanding card accounting ────────────────────────────────

/**
 * Card ids this player has seen leave play (or holds): completed tricks,
 * the trick in progress, their own hand, and — declarer only — their own
 * kitty discards. Every other card of a suit is "outstanding": possibly in
 * an opponent's hand, possibly buried in the kitty.
 */
function seenCardIds(ctx: StrategyContext): Set<string> {
  const seen = new Set<string>();
  for (const c of ctx.playedCards) seen.add(c.id);
  for (const c of ctx.hand) seen.add(c.id);
  for (const p of ctx.currentTrick) seen.add(p.card.id);
  for (const c of ctx.myDiscards) seen.add(c.id);
  return seen;
}

function outstandingInSuit(suit: string, seen: Set<string>): Card[] {
  const out: Card[] = [];
  for (let rank = 1; rank <= 13; rank++) {
    const id = `${suit}_${rank}`;
    if (seen.has(id)) continue;
    out.push({ suit, rank, id });
  }
  return out;
}

// ── Direction-aware card values ─────────────────────────────────────
// Mirrors BidWhistGame.getCardValue so role primitives can analyze a hand
// under a hypothetical direction during bidding (before trump/direction are
// set, ctx.getCardValue still reflects the table default).

function directionCardValue(direction: string): ((c: Card) => number) | null {
  if (direction === 'uptown') return c => (c.rank === 1 ? 14 : c.rank);
  if (direction === 'downtown') return c => (c.rank === 1 ? 14 : 14 - c.rank);
  // Ace = 0 (not 1) so it sits strictly below the King's 14 - 13 = 1,
  // matching BidWhistGame.getCardValue.
  if (direction === 'downtown-noaces') return c => (c.rank === 1 ? 0 : 14 - c.rank);
  return null;
}

function valueFnFor(ctx: StrategyContext, direction?: unknown): (c: Card) => number {
  if (typeof direction === 'string') {
    const fn = directionCardValue(direction);
    if (fn) return fn;
  }
  return ctx.getCardValue;
}

// ── CardSet helpers ─────────────────────────────────────────────────

function makeCardSet(cards: Card[]): CardSet {
  return { cards: [...cards] };
}

function filterSuit(cs: CardSet, suit: string): CardSet {
  return { cards: cs.cards.filter(c => c.suit === suit) };
}

function filterTrump(cs: CardSet, trumpSuit: string | null): CardSet {
  if (!trumpSuit) return { cards: [] };
  return filterSuit(cs, trumpSuit);
}

function filterNonTrump(cs: CardSet, trumpSuit: string | null): CardSet {
  if (!trumpSuit) return cs;
  return { cards: cs.cards.filter(c => c.suit !== trumpSuit) };
}

function filterHearts(cs: CardSet): CardSet {
  return filterSuit(cs, 'hearts');
}

function cardSetHighest(cs: CardSet, getCardValue: (c: Card) => number): Card | null {
  if (cs.cards.length === 0) return null;
  return cs.cards.reduce((h, c) => getCardValue(c) > getCardValue(h) ? c : h);
}

function cardSetLowest(cs: CardSet, getCardValue: (c: Card) => number): Card | null {
  if (cs.cards.length === 0) return null;
  return cs.cards.reduce((l, c) => getCardValue(c) < getCardValue(l) ? c : l);
}

function cardSetWinners(cs: CardSet, ctx: StrategyContext): CardSet {
  if (ctx.currentTrick.length === 0) return cs;
  const winIdx = ctx.evaluateCurrentWinner();
  if (winIdx < 0) return cs;
  const winCard = ctx.currentTrick[winIdx].card;
  return {
    cards: cs.cards.filter(c => ctx.compareCards(c, winCard) > 0)
  };
}

function cardSetLosers(cs: CardSet, ctx: StrategyContext): CardSet {
  if (ctx.currentTrick.length === 0) return cs;
  const winIdx = ctx.evaluateCurrentWinner();
  if (winIdx < 0) return cs;
  const winCard = ctx.currentTrick[winIdx].card;
  return {
    cards: cs.cards.filter(c => ctx.compareCards(c, winCard) <= 0)
  };
}

function cardSetBoss(cs: CardSet, ctx: StrategyContext, direction?: unknown): CardSet {
  const seen = seenCardIds(ctx);
  const valueFn = valueFnFor(ctx, direction);

  return {
    cards: cs.cards.filter(card => {
      const val = valueFn(card);
      for (const outCard of outstandingInSuit(card.suit, seen)) {
        if (outCard.id === card.id) continue;
        // This card is still out there in an opponent's hand
        if (valueFn(outCard) > val) {
          return false; // A higher card of this suit is still unplayed
        }
      }
      return true;
    })
  };
}

function cardSetAbove(cs: CardSet, card: Card, getCardValue: (c: Card) => number): CardSet {
  const val = getCardValue(card);
  return { cards: cs.cards.filter(c => c.suit === card.suit && getCardValue(c) > val) };
}

function cardSetBelow(cs: CardSet, card: Card, getCardValue: (c: Card) => number): CardSet {
  const val = getCardValue(card);
  return { cards: cs.cards.filter(c => c.suit === card.suit && getCardValue(c) < val) };
}

function highestSafe(cs: CardSet, ctx: StrategyContext): Card | null {
  // Highest card that does NOT beat partner by exactly 1 rank
  const partnerCard = getPartnerCard(ctx);
  if (!partnerCard) return cardSetHighest(cs, ctx.getCardValue);

  const partnerVal = ctx.getCardValue(partnerCard);
  const safe = cs.cards.filter(c => {
    const val = ctx.getCardValue(c);
    // Don't beat partner by exactly 1
    if (c.suit === partnerCard.suit && val === partnerVal + 1) return false;
    return true;
  });

  if (safe.length === 0) return cardSetHighest(cs, ctx.getCardValue);
  return safe.reduce((h, c) => ctx.getCardValue(c) > ctx.getCardValue(h) ? c : h);
}

function getPartnerCard(ctx: StrategyContext): Card | null {
  const partnerId = (ctx.playerId + 2) % 4;
  const play = ctx.currentTrick.find(p => p.playerId === partnerId);
  return play ? play.card : null;
}

// ── Built-in Functions ──────────────────────────────────────────────

function cardsAbove(card: Card, ctx: StrategyContext): number {
  // Count unseen cards that rank above this card in its suit
  const seen = seenCardIds(ctx);
  const val = ctx.getCardValue(card);
  let count = 0;

  for (const outCard of outstandingInSuit(card.suit, seen)) {
    if (outCard.id === card.id) continue;
    if (ctx.getCardValue(outCard) > val) {
      count++;
    }
  }
  return count;
}

function gap(a: Card, b: Card, ctx: StrategyContext): number {
  return Math.abs(ctx.getCardValue(a) - ctx.getCardValue(b));
}

function suitCount(suit: string, ctx: StrategyContext): number {
  return ctx.hand.filter(c => c.suit === suit).length;
}

function bestSuit(ctx: StrategyContext, direction?: string): string {
  if (direction) {
    // Direction-aware: score each suit by summing postTrumpCardValue for its cards
    const scores: { [suit: string]: number } = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
    ctx.hand.forEach(c => {
      if (scores[c.suit] !== undefined) {
        // TODO: Figure out if this produces "the right" feel for hands that get made...
        scores[c.suit] += postTrumpCardValue(c.rank, true, direction) + 13; // NOTE: MANUALLY Added +13 here as BIAS for long-not-strong
      }
    });
    let best = 'spades';
    let max = -1;
    for (const [suit, score] of Object.entries(scores)) {
      if (score > max) { max = score; best = suit; }
    }
    return best;
  }
  // No direction: fall back to longest suit (original behavior)
  const counts: { [suit: string]: number } = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  ctx.hand.forEach(c => { if (counts[c.suit] !== undefined) counts[c.suit]++; });
  let best = 'spades';
  let max = 0;
  for (const [suit, count] of Object.entries(counts)) {
    if (count > max) { max = count; best = suit; }
  }
  return best;
}

function lowCount(ctx: StrategyContext): number {
  return ctx.hand.filter(c => c.rank >= 2 && c.rank <= 5).length;
}

function highCount(ctx: StrategyContext): number {
  return ctx.hand.filter(c => c.rank === 1 || c.rank >= 11).length;
}

function aceCount(ctx: StrategyContext): number {
  return ctx.hand.filter(c => c.rank === 1).length;
}

function haveCard(cardId: string, ctx: StrategyContext): boolean {
  return ctx.hand.some(c => c.id === cardId);
}

function deuceTreyCount(ctx: StrategyContext): number {
  return ctx.hand.filter(c => c.rank === 2 || c.rank === 3).length;
}

function kingAceCount(ctx: StrategyContext): number {
  return ctx.hand.filter(c => c.rank === 13 || c.rank === 1).length;
}

function kingCount(ctx: StrategyContext): number {
  return ctx.hand.filter(c => c.rank === 13).length;
}

function countOutstandingThreats(ctx: StrategyContext): number {
  // Count cards held by opponents that could beat the current trick winner.
  // Threats are: higher same-suit cards, plus any outstanding trump (if winner is non-trump).
  if (ctx.currentTrick.length === 0) return 0;
  const winIdx = ctx.evaluateCurrentWinner();
  if (winIdx < 0) return 0;
  const winCard = ctx.currentTrick[winIdx].card;

  const seen = seenCardIds(ctx);
  const winVal = ctx.getCardValue(winCard);
  let count = 0;

  // Higher cards of the same suit as the winner
  for (const outCard of outstandingInSuit(winCard.suit, seen)) {
    if (ctx.getCardValue(outCard) > winVal) {
      count++;
    }
  }

  // If winner is non-trump, any outstanding trump card also beats it
  if (ctx.trumpSuit && winCard.suit !== ctx.trumpSuit) {
    count += outstandingInSuit(ctx.trumpSuit, seen).length;
  }

  return count;
}

function countOutstandingTrump(ctx: StrategyContext): number {
  if (!ctx.trumpSuit) return 0;
  return outstandingInSuit(ctx.trumpSuit, seenCardIds(ctx)).length;
}

function maxSuitCount(ctx: StrategyContext): number {
  const counts: { [suit: string]: number } = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  ctx.hand.forEach(c => { if (counts[c.suit] !== undefined) counts[c.suit]++; });
  return Math.max(...Object.values(counts));
}

function minSuitCount(ctx: StrategyContext): number {
  const counts: { [suit: string]: number } = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  ctx.hand.forEach(c => { if (counts[c.suit] !== undefined) counts[c.suit]++; });
  const nonZero = Object.values(counts).filter(v => v > 0);
  return nonZero.length > 0 ? Math.min(...nonZero) : 0;
}

// ── Power scoring ──────────────────────────────────────────────────
// Integer point weights indexed by rank (1=A, 13=K). Missing rank → 0.
// These match the human-readable mental model A=4/K=3/Q=2/J=1 (uptown) and
// the mirror for downtown. Distinct from the fractional postTrumpCardValue
// used for best_suit / analysis tooling.
const POINTS_UPTOWN: Record<number, number> = { 1: 4, 13: 3, 12: 2, 11: 1 };
const POINTS_DOWNTOWN: Record<number, number> = { 1: 4, 2: 3, 3: 2, 4: 1 };
const POINTS_DOWNTOWN_NOACES: Record<number, number> = { 2: 4, 3: 3, 4: 2, 5: 1 };

function pointsTable(direction: string): Record<number, number> {
  if (direction === 'uptown') return POINTS_UPTOWN;
  if (direction === 'downtown') return POINTS_DOWNTOWN;
  if (direction === 'downtown-noaces') return POINTS_DOWNTOWN_NOACES;
  return {};
}

function handPower(ctx: StrategyContext, direction: string): number {
  const table = pointsTable(direction);
  return ctx.hand.reduce((sum, c) => sum + (table[c.rank] ?? 0), 0);
}

function suitPower(ctx: StrategyContext, suit: string, direction: string): number {
  const table = pointsTable(direction);
  return ctx.hand.reduce(
    (sum, c) => sum + (c.suit === suit ? (table[c.rank] ?? 0) : 0),
    0,
  );
}

function trumpPower(ctx: StrategyContext, direction: string): number {
  if (!ctx.trumpSuit) return 0;
  return suitPower(ctx, ctx.trumpSuit, direction);
}

/**
 * Sluff-candidate filter: returns the non-trump cards that are "safe to
 * discard" in a void-play situation, specifically for defensive play.
 *
 * For each non-trump suit in my hand:
 *   - If I hold only 1 card in the suit: it IS a sluff candidate (there's
 *     no backing card to preserve; the single card is expendable).
 *   - If I hold 2+ cards in the suit AND my highest card is already boss:
 *     all cards in the suit are sluff candidates (no backing needed).
 *   - If I hold 2+ cards AND my highest has at least one higher card still
 *     outstanding: the highest card is a "potential winner" (becomes boss
 *     after the outstanding higher cards are played) and the LOWEST card
 *     is its "backing card" (protects the potential winner when its
 *     higher card is led against us). Cards in the MIDDLE of that suit
 *     are sluff candidates.
 *
 * The idea: when on defense against a likely-whisting hand, preserving
 * the K+2 of a non-trump suit (with A outstanding) gives your team a
 * single guaranteed book — preventing the whisting.
 */
function computeSluffCandidates(ctx: StrategyContext): CardSet {
  const protectedIds = new Set<string>();
  const bySuit: Record<string, Card[]> = {};
  for (const c of ctx.hand) {
    if (c.suit === ctx.trumpSuit) continue; // trump not sluff-able here
    if (!bySuit[c.suit]) bySuit[c.suit] = [];
    bySuit[c.suit].push(c);
  }

  for (const suit of Object.keys(bySuit)) {
    const cards = bySuit[suit].slice()
      .sort((a, b) => ctx.getCardValue(b) - ctx.getCardValue(a)); // high → low
    if (cards.length < 2) continue; // singleton — no backing to protect
    const highest = cards[0];
    if (cardsAbove(highest, ctx) === 0) continue; // already boss
    // Protect both the potential winner and the backing card
    protectedIds.add(highest.id);
    protectedIds.add(cards[cards.length - 1].id);
  }

  return {
    cards: ctx.hand.filter(c => c.suit !== ctx.trumpSuit && !protectedIds.has(c.id)),
  };
}

// ── Suit-role analysis: winners / holes / backing ───────────────────
//
// Partitions the hand into the roles human players use to describe a
// holding. A/K/10/9/5/3 with Q/J outstanding is "2 winners (A/K), a 2-hole
// (Q/J), and 2-with-backing (10/9 promote once the 5/3 are fed to the
// tricks the Q/J win)":
//
//   boss    — no outstanding higher card in the suit; wins if the suit is
//             led and nobody trumps.
//   backed  — holesAbove(c) > 0 but I hold at least that many LOWER cards
//             of the suit: each hole card wins at most one trick of this
//             suit, I feed a low card to each, and then c is boss.
//   backing — the H HIGHEST cards strictly below the backed run (H = holes
//             above the lowest backed card). These are reserved as feeds:
//             sluffing or discarding them demotes the backed cards above.
//             Any H cards below the backed run do the feeding job equally,
//             and holding the higher ones weakly dominates (a bigger feed
//             shrinks the opponents' duck space) — so the suit's LOWEST
//             cards are the ones released as spare, matching the human
//             discipline of throwing from the bottom.
//   spare   — none of the above; no structural job in the suit, so the
//             safest discards/sluffs.
//
// Within a suit the roles are always layered top-down as
// [boss][backed][backing][spare]: holesAbove only grows as you go down
// while the count of lower cards shrinks, so boss and backed each form a
// contiguous run and the backing block sits directly beneath them.
//
// Trump override: once trump is set, every trump card has a ruffing job
// regardless of its in-suit structure, so `.spare` never returns trump and
// `.working` always includes all of it. The structural roles (boss / backed
// / backing) stay rank-honest for trump — boss trump still matters for
// pulling.
//
// Caveats (deliberate — this is the human counting model, not a solver):
// backed counts are an OPTIMISTIC bound. They assume each hole card spends
// itself winning a fed trick; a defender who ducks the feed (plays low,
// keeps the A over your K/Q) can hold a backed card to fewer tricks. They
// also ignore cross-suit trumping and tempo/entries — strategies gate on
// enemy_has_trump / outstanding_trump() for that.

interface SuitRoles {
  boss: Set<string>;
  backed: Set<string>;
  backing: Set<string>;
  spare: Set<string>;
}

function computeSuitRoles(ctx: StrategyContext, valueFn: (c: Card) => number): SuitRoles {
  const roles: SuitRoles = { boss: new Set(), backed: new Set(), backing: new Set(), spare: new Set() };
  const seen = seenCardIds(ctx);

  const bySuit: Record<string, Card[]> = {};
  for (const c of ctx.hand) {
    if (!bySuit[c.suit]) bySuit[c.suit] = [];
    bySuit[c.suit].push(c);
  }

  for (const suit of Object.keys(bySuit)) {
    const mine = bySuit[suit].slice().sort((a, b) => valueFn(b) - valueFn(a)); // high → low
    const outstandingVals = outstandingInSuit(suit, seen).map(valueFn);

    let lowestBackedHoles = 0;
    let lowestBackedIdx = -1;
    mine.forEach((card, i) => {
      const v = valueFn(card);
      const holes = outstandingVals.filter(o => o > v).length;
      const lowerMine = mine.length - 1 - i;
      if (holes === 0) {
        roles.boss.add(card.id);
      } else if (lowerMine >= holes) {
        roles.backed.add(card.id);
        lowestBackedHoles = holes;
        lowestBackedIdx = i;
      }
    });

    // Reserve the `lowestBackedHoles` highest cards below the backed run
    // as backing feeds; anything beneath them is spare.
    for (let i = lowestBackedIdx + 1; i <= lowestBackedIdx + lowestBackedHoles && i < mine.length; i++) {
      roles.backing.add(mine[i].id);
    }
    for (const card of mine) {
      if (!roles.boss.has(card.id) && !roles.backed.has(card.id) && !roles.backing.has(card.id)) {
        roles.spare.add(card.id);
      }
    }
  }
  return roles;
}

type RoleName = 'boss' | 'backed' | 'backing' | 'spare' | 'working';

// Roles are facts about the FULL hand; applying a role property to a
// filtered set (hand.nontrump.spare) intersects that set with the role.
function filterByRole(cs: CardSet, ctx: StrategyContext, role: RoleName, direction?: unknown): CardSet {
  const roles = computeSuitRoles(ctx, valueFnFor(ctx, direction));
  const isTrump = (c: Card) => ctx.trumpSuit !== null && c.suit === ctx.trumpSuit;
  const structurallyWorking = (id: string) =>
    roles.boss.has(id) || roles.backed.has(id) || roles.backing.has(id);
  const inRole = (c: Card) =>
    role === 'working' ? structurallyWorking(c.id) || isTrump(c)
    : role === 'spare' ? roles.spare.has(c.id) && !isTrump(c)
    : roles[role].has(c.id);
  return { cards: cs.cards.filter(inRole) };
}

/**
 * The size of the hole blocking my best non-boss card in the suit: for
 * A/K/10/9/5/3 with Q/J out, the highest non-boss card is the 10 and the
 * hole is 2 (Q, J). 0 when void in the suit or when everything is boss.
 *
 * When holes interleave my backed cards (A/K/J/9 with Q and 10 out), this
 * reports only the gap above the FIRST candidate (1: the Q) — the total
 * feed requirement for the whole suit is `.backing.count` (2 here).
 */
function holeCount(suit: string, ctx: StrategyContext, valueFn: (c: Card) => number): number {
  const seen = seenCardIds(ctx);
  const mine = ctx.hand.filter(c => c.suit === suit)
    .sort((a, b) => valueFn(b) - valueFn(a));
  const outstandingVals = outstandingInSuit(suit, seen).map(valueFn);

  for (const card of mine) {
    const holes = outstandingVals.filter(o => o > valueFn(card)).length;
    if (holes > 0) return holes; // highest non-boss card found
  }
  return 0;
}

function suitMakeableTricks(suit: string, ctx: StrategyContext, valueFn: (c: Card) => number): number {
  const roles = computeSuitRoles(ctx, valueFn);
  return ctx.hand.filter(c => c.suit === suit && (roles.boss.has(c.id) || roles.backed.has(c.id))).length;
}

// "Books I can see in my hand": boss + backed winners across all suits.
// An optimistic bound, not a guarantee — see the ducking caveat above.
// Trump-independent, so usable at bid time — but ALWAYS pass an explicit
// direction there; before trump selection ctx.getCardValue is just the
// table default, which says nothing about the call you're weighing.
function makeableTrickCount(ctx: StrategyContext, valueFn: (c: Card) => number): number {
  const roles = computeSuitRoles(ctx, valueFn);
  return roles.boss.size + roles.backed.size;
}

// The human trump-selection rule: pick the suit that makes the most tricks
// AS TRUMP. Length comes FIRST — a low trump is nearly a full trick once
// opponents are stripped, which the per-suit role math cannot see (it
// ignores ruffs/exhaustion by design). The v1 blended key (tricks + length)
// traded length for structure on split-length hands and LOST 48.25%±0.68 to
// the length-first best_suit (report/trump-sweep.json), so structure only
// breaks length ties: key = (length, makeable tricks, honor power).
function bestSuitByTricks(ctx: StrategyContext, direction?: string): string {
  const valueFn = valueFnFor(ctx, direction);
  const roles = computeSuitRoles(ctx, valueFn);
  const powerDirection = direction ?? ctx.bidDirection;

  let best = 'spades';
  let bestKey: [number, number, number] | null = null;
  for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
    const suitCards = ctx.hand.filter(c => c.suit === suit);
    const tricks = suitCards.filter(c => roles.boss.has(c.id) || roles.backed.has(c.id)).length;
    const key: [number, number, number] = [suitCards.length, tricks, suitPower(ctx, suit, powerDirection)];
    if (!bestKey || key[0] > bestKey[0] ||
        (key[0] === bestKey[0] && key[1] > bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])) {
      bestKey = key;
      best = suit;
    }
  }
  return best;
}

// ── Signal-aware trump selection ─────────────────────────────────────
//
// Implements the exclusion-information model from
// report/bayesian-trump-selection.md. A direction signal (bid 1 = low,
// bid 2 = high) says the signaler holds ~4 makeable winners in that
// direction — necessarily drawn from the direction's TOP cards that I
// don't hold. My own cards therefore sharpen everyone's signals:
//   - the fewer tops I leave outstanding, the more precisely a signal
//     localizes the signaler's holding (posterior concentration), and
//   - per suit, signaled strength distributes over the OUTSTANDING tops,
//     so a suit whose tops I hold gets little partner coverage and poses
//     little enemy threat ("they can't have what I'm holding").
//
// score(S, D) = own structure (makeable tricks + trump length + trump-suit
// makeable) + partner's expected top coverage − enemy-held tops in my
// trump (unruffable, 1.25×) − enemy side-suit winners (ruffable, 0.75×,
// halved when diffuse/unsignaled) + a counterpick bonus when D devalues
// the enemy's signaled direction − a penalty when it devalues partner's.
// Weights are v1 round numbers — see the report's caveats.

const TRUMP_CALL_SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const TRUMP_CALL_DIRECTIONS = ['uptown', 'downtown', 'downtown-noaces'];

// Bid-signal group for a direction: bid 2 signals high (uptown), bid 1
// signals low (both downtown variants).
function directionSignalGroup(direction: string): number {
  return direction === 'uptown' ? 2 : 1;
}

// lenWeight scales the trump-length term. v1 used 1.0 (length blended with
// structure) and lost 48.01%±0.69 to the length-first champion — see
// report/trump-sweep.json and the bestSuitByTricks comment. Higher weights
// make length progressively more sovereign, with signals deciding between
// similar-length calls; at 13 the suit choice is effectively length-first
// with signal tiebreaks (direction choice is unaffected by the length term,
// which cancels across directions for a fixed suit).
// Exclusion-aware signal analysis for one direction, shared by the scored
// model (signalAwareScore) and the scalar cover primitives. All quantities
// are computed over the direction's outstanding top-3-per-suit cards.
interface SignalCover {
  outTop: (suit: string) => number;
  totalOutTop: number;
  partnerShare: number;
  enemyShare: number;   // both enemies combined
  partnerTops: number;  // expected top cards held by partner
  enemyTops: number;    // expected top cards held by the SIGNALING enemy
  partnerMatches: boolean;
  enemyMatches: boolean;
  partnerSignaled: boolean;
  enemySignaled: boolean;
}

function computeSignalCover(ctx: StrategyContext, direction: string): SignalCover {
  const valueFn = directionCardValue(direction) ?? ctx.getCardValue;
  const seen = seenCardIds(ctx);

  // The direction's 3 top ranks (uptown: A,K,Q; downtown: A,2,3; noaces: 2,3,4)
  const topRanks = Array.from({ length: 13 }, (_, i) => i + 1)
    .sort((a, b) => valueFn({ suit: 'spades', rank: b, id: '' }) - valueFn({ suit: 'spades', rank: a, id: '' }))
    .slice(0, 3);
  const outTop = (suit: string) => topRanks.filter(r => !seen.has(`${suit}_${r}`)).length;
  const totalOutTop = TRUMP_CALL_SUITS.reduce((sum, s) => sum + outTop(s), 0);

  const dg = directionSignalGroup(direction);
  const partnerSignaled = ctx.partnerBid === 1 || ctx.partnerBid === 2;
  const enemySignaled = ctx.enemyBid === 1 || ctx.enemyBid === 2;
  const partnerMatches = partnerSignaled && ctx.partnerBid === dg;
  const enemyMatches = enemySignaled && ctx.enemyBid === dg;

  // Share of the outstanding tops we expect each unseen hand to hold:
  // signals tilt the split (matching signaler 2.0, opposite 0.3, silent 1.0;
  // the second, non-signaling enemy is always 1.0).
  const partnerW = partnerSignaled ? (partnerMatches ? 2.0 : 0.3) : 1.0;
  const enemyW = enemySignaled ? (enemyMatches ? 2.0 : 0.3) : 1.0;
  const partnerShare = partnerW / (partnerW + enemyW + 1.0);
  const enemy1Share = enemyW / (partnerW + enemyW + 1.0);
  const enemyShare = 1 - partnerShare;

  // Posterior concentration: a matching signal means ~4 winners, however
  // few tops remain outstanding for them to be made of.
  const concentrate = (matches: boolean, share: number) =>
    totalOutTop === 0 ? 0
      : matches
        ? Math.min(totalOutTop, Math.max(4, share * totalOutTop))
        : share * totalOutTop;

  return {
    outTop, totalOutTop, partnerShare, enemyShare,
    partnerTops: concentrate(partnerMatches, partnerShare),
    enemyTops: concentrate(enemyMatches, enemy1Share),
    partnerMatches, enemyMatches, partnerSignaled, enemySignaled,
  };
}

function signalAwareScore(ctx: StrategyContext, trumpSuit: string, direction: string, lenWeight: number = 1): number {
  const valueFn = directionCardValue(direction)!;
  const roles = computeSuitRoles(ctx, valueFn);
  const cover = computeSignalCover(ctx, direction);
  const { outTop, totalOutTop, enemyShare, partnerTops, partnerMatches, enemyMatches, partnerSignaled, enemySignaled } = cover;

  const myTricks = roles.boss.size + roles.backed.size;
  const trumpLen = ctx.hand.filter(c => c.suit === trumpSuit).length;
  const trumpTricks = ctx.hand.filter(c =>
    c.suit === trumpSuit && (roles.boss.has(c.id) || roles.backed.has(c.id))).length;

  const trumpTopRisk = outTop(trumpSuit) * enemyShare * 1.25;
  const sideThreat = (totalOutTop - outTop(trumpSuit)) * enemyShare * 0.75
    * (enemyMatches ? 1.0 : 0.5);

  const counterpick = enemySignaled && !enemyMatches ? 1.0 : 0;
  const partnerWaste = partnerSignaled && !partnerMatches ? 1.0 : 0;

  return myTricks + lenWeight * trumpLen + trumpTricks
    + partnerTops - trumpTopRisk - sideThreat + counterpick - partnerWaste;
}

function signalAwareBestCall(ctx: StrategyContext, lenWeight: number = 1): { suit: string; direction: string } {
  let best = { suit: 'spades', direction: 'uptown' };
  let bestScore = -Infinity;
  for (const direction of TRUMP_CALL_DIRECTIONS) {
    for (const suit of TRUMP_CALL_SUITS) {
      const score = signalAwareScore(ctx, suit, direction, lenWeight);
      if (score > bestScore) {
        bestScore = score;
        best = { suit, direction };
      }
    }
  }
  return best;
}

// The card in a set with the FEWEST outstanding cards that beat it in its
// suit ("least beaten") — the human counting heuristic for what to throw
// when you have control: a near-boss card (K with only the A unseen) wins
// the trick unless the one beater appears, and is dead weight later; a
// backed card should be held instead (its promotion is already secured),
// which callers express by selecting from .spare. Ties break toward the
// higher card (bigger equity to cash), then fixed suit order.
function cardSetLeastBeaten(cs: CardSet, ctx: StrategyContext): Card | null {
  let best: Card | null = null;
  let bestKey: [number, number, number] | null = null;
  const suitOrder: Record<string, number> = { spades: 0, hearts: 1, diamonds: 2, clubs: 3 };
  for (const card of cs.cards) {
    const key: [number, number, number] = [
      cardsAbove(card, ctx),
      -ctx.getCardValue(card),
      suitOrder[card.suit] ?? 4,
    ];
    if (!bestKey ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2])) {
      bestKey = key;
      best = card;
    }
  }
  return best;
}

// The non-trump suit with the most outstanding top cards under the given
// direction (default: the played direction). By exclusion, this is where a
// direction-signaling PARTNER's strength most likely concentrates — their
// signaled winners can only be made of tops I don't hold — so leading low
// in this suit is the "pass control to partner" play. Ties break by fixed
// suit order.
function partnerCoverSuit(ctx: StrategyContext, direction?: string): string {
  const dir = direction ?? ctx.bidDirection;
  const cover = computeSignalCover(ctx, dir);
  let best = 'spades';
  let bestOut = -1;
  for (const suit of TRUMP_CALL_SUITS) {
    if (ctx.trumpSuit !== null && suit === ctx.trumpSuit) continue;
    const out = cover.outTop(suit);
    if (out > bestOut) {
      bestOut = out;
      best = suit;
    }
  }
  return best;
}

// Argmax of raw honor density (suit_power) — the "strength not length"
// picker for calling into a contested direction. Ties break by length,
// then fixed suit order.
function bestSuitByPower(ctx: StrategyContext, direction?: string): string {
  const powerDirection = direction ?? ctx.bidDirection;
  let best = 'spades';
  let bestKey: [number, number] | null = null;
  for (const suit of TRUMP_CALL_SUITS) {
    const key: [number, number] = [
      suitPower(ctx, suit, powerDirection),
      ctx.hand.filter(c => c.suit === suit).length,
    ];
    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      bestKey = key;
      best = suit;
    }
  }
  return best;
}

// ── Expression Evaluator ────────────────────────────────────────────

function evalExpr(expr: Expression, ctx: StrategyContext): any {
  switch (expr.type) {
    case 'literal':
      return expr.value;

    case 'variable':
      return resolveVariable(expr.name, ctx);

    case 'binary':
      return evalBinary(expr, ctx);

    case 'unary':
      if (expr.op === 'not') return !evalExpr(expr.operand, ctx);
      return null;

    case 'call':
      return evalCall(expr.name, expr.args.map(a => evalExpr(a, ctx)), ctx);

    case 'property':
      return evalProperty(expr, ctx);
  }
}

function resolveVariable(name: string, ctx: StrategyContext): any {
  switch (name) {
    case 'hand': return makeCardSet(ctx.hand);
    case 'lead_suit': return ctx.leadSuit;
    case 'trump_suit': return ctx.trumpSuit;
    case 'declarer': return ctx.declarer;
    case 'partner_winning': return ctx.partnerWinning;
    case 'partner_led': return ctx.partnerLed;
    case 'on_declarer_team': return ctx.onDeclarerTeam;
    case 'am_declarer': return ctx.amDeclarer;
    case 'partner_is_declarer': return ctx.partnerIsDeclarer;
    case 'is_dealer': return ctx.isDealer;
    case 'has_trump': return ctx.hasTrump;
    case 'is_first_trick': return ctx.isFirstTrick;
    case 'hearts_broken': return ctx.heartsBroken;
    case 'partner_bid': return ctx.partnerBid;
    case 'enemy_bid': return ctx.enemyBid;
    case 'bid_count': return ctx.bidCount;
    case 'have_signaled': return ctx.haveSignaled;
    case 'partner_signal': return ctx.partnerSignal;
    case 'enemy_signal_1': return ctx.enemySignal1;
    case 'enemy_signal_2': return ctx.enemySignal2;
    case 'enemy_has_trump': return ctx.enemyHasTrump;
    case 'partner_has_trump': return ctx.partnerHasTrump;
    case 'partner_shortsuit': {
      const shortCards = ctx.hand.filter(c => ctx.partnerVoidSuits.includes(c.suit));
      return makeCardSet(shortCards);
    }
    case 'bid_direction': return ctx.bidDirection;
    case 'me': return { id: ctx.playerId };
    // Direction literals (parsed as variable references, resolve to themselves)
    case 'downtown': return 'downtown';
    case 'uptown': return 'uptown';
    case 'downtown-noaces': return 'downtown-noaces';
    default:
      // Fall through to strategy-declared `let` constants. Built-ins above
      // shadow constants, so a `let is_dealer = 1` in the strategy text
      // won't override the context value.
      if (ctx.constants && name in ctx.constants) return ctx.constants[name];
      return undefined;
  }
}

function evalBinary(expr: any, ctx: StrategyContext): any {
  const left = evalExpr(expr.left, ctx);
  const right = evalExpr(expr.right, ctx);

  switch (expr.op) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    case 'and': return left && right;
    case 'or': return left || right;
    case '+': return left + right;
    case '-': return left - right;
    default: return false;
  }
}

function evalCall(name: string, args: any[], ctx: StrategyContext): any {
  let result: any;
  switch (name) {
    case 'cards_above':
      result = typeof args[0] === 'object' && args[0]?.id ? cardsAbove(args[0] as Card, ctx) : 0; break;
    case 'gap':
      result = (args[0] && args[1]) ? gap(args[0] as Card, args[1] as Card, ctx) : 0; break;
    case 'suit_count':
      result = typeof args[0] === 'string' ? suitCount(args[0], ctx) : 0; break;
    case 'best_suit':
      result = bestSuit(ctx, typeof args[0] === 'string' ? args[0] : undefined); break;
    case 'low_count':
      result = lowCount(ctx); break;
    case 'high_count':
      result = highCount(ctx); break;
    case 'ace_count':
      result = aceCount(ctx); break;
    case 'have':
      result = typeof args[0] === 'string' ? haveCard(args[0], ctx) : false; break;
    case 'min':
      result = Math.min(args[0], args[1]); break;
    case 'max':
      result = Math.max(args[0], args[1]); break;
    case 'partner_card':
      result = getPartnerCard(ctx); break;
    case 'best_direction':
      result = lowCount(ctx) > highCount(ctx) ? 'downtown' : 'uptown'; break;
    case 'deuce_trey_count':
      result = deuceTreyCount(ctx); break;
    case 'king_ace_count':
      result = kingAceCount(ctx); break;
    case 'king_count':
      result = kingCount(ctx); break;
    case 'max_suit_count':
      result = maxSuitCount(ctx); break;
    case 'min_suit_count':
      result = minSuitCount(ctx); break;
    case 'stopper_cards':
      result = computeStopperCards(ctx); break;
    case 'suit_keepers':
      result = computeSuitKeepers(typeof args[0] === 'number' ? args[0] : 1, ctx); break;
    case 'void_candidates':
      result = computeVoidCandidates(ctx); break;
    case 'outstanding_trump':
      result = countOutstandingTrump(ctx); break;
    case 'outstanding_threats':
      result = countOutstandingThreats(ctx); break;
    case 'hand_power':
      result = typeof args[0] === 'string' ? handPower(ctx, args[0]) : 0; break;
    case 'suit_power':
      result = (typeof args[0] === 'string' && typeof args[1] === 'string')
        ? suitPower(ctx, args[0], args[1]) : 0; break;
    case 'trump_power':
      result = typeof args[0] === 'string' ? trumpPower(ctx, args[0]) : 0; break;
    case 'sluff_candidates':
      result = computeSluffCandidates(ctx); break;
    case 'hole_count':
      result = typeof args[0] === 'string' ? holeCount(args[0], ctx, valueFnFor(ctx, args[1])) : 0; break;
    case 'suit_makeable_tricks':
      result = typeof args[0] === 'string' ? suitMakeableTricks(args[0], ctx, valueFnFor(ctx, args[1])) : 0; break;
    case 'makeable_trick_count':
      result = makeableTrickCount(ctx, valueFnFor(ctx, args[0])); break;
    case 'best_suit_by_tricks':
      result = bestSuitByTricks(ctx, typeof args[0] === 'string' ? args[0] : undefined); break;
    case 'best_suit_by_power':
      result = bestSuitByPower(ctx, typeof args[0] === 'string' ? args[0] : undefined); break;
    case 'partner_cover':
      // Expected count of the direction's top cards in partner's hand,
      // signal- and exclusion-conditioned. The scalar "direction lean"
      // form of the coverage model — see computeSignalCover.
      result = typeof args[0] === 'string' && directionCardValue(args[0])
        ? computeSignalCover(ctx, args[0]).partnerTops : 0;
      break;
    case 'enemy_cover':
      // Same for the signaling enemy.
      result = typeof args[0] === 'string' && directionCardValue(args[0])
        ? computeSignalCover(ctx, args[0]).enemyTops : 0;
      break;
    case 'partner_cover_suit':
      result = partnerCoverSuit(ctx, typeof args[0] === 'string' ? args[0] : undefined); break;
    case 'signal_aware_direction':
      // Optional numeric arg = lenWeight (see signalAwareScore).
      result = signalAwareBestCall(ctx, typeof args[0] === 'number' ? args[0] : 1).direction; break;
    case 'signal_aware_suit': {
      // Args: optional direction string, optional numeric lenWeight — in
      // either order. With a direction: best suit under that direction.
      // Without: the suit of the globally best (suit, direction) call, so
      // it composes consistently with signal_aware_direction().
      const dirArg = args.find((a: any) => typeof a === 'string' && directionCardValue(a));
      const lenWeight = args.find((a: any) => typeof a === 'number') ?? 1;
      if (typeof dirArg === 'string') {
        let bestSuit = 'spades';
        let bestScore = -Infinity;
        for (const suit of TRUMP_CALL_SUITS) {
          const score = signalAwareScore(ctx, suit, dirArg, lenWeight);
          if (score > bestScore) { bestScore = score; bestSuit = suit; }
        }
        result = bestSuit;
      } else {
        result = signalAwareBestCall(ctx, lenWeight).suit;
      }
      break;
    }
    default:
      result = undefined;
  }
  if (strategyDebugEnabled) {
    const argStr = args.map(a => typeof a === 'object' && a?.id ? a.id : JSON.stringify(a)).join(', ');
    const resStr = typeof result === 'object' && result?.cards
      ? `CardSet(${result.cards.length})`
      : typeof result === 'object' && result?.id ? result.id : JSON.stringify(result);
    debugLog(`    ${name}(${argStr}) → ${resStr}`);
  }
  return result;
}

function evalProperty(expr: any, ctx: StrategyContext): any {
  const obj = evalExpr(expr.object, ctx);
  const prop = expr.property;
  const args = expr.args ? expr.args.map((a: Expression) => evalExpr(a, ctx)) : [];

  // Handle CardSet pipeline
  if (obj && typeof obj === 'object' && 'cards' in obj) {
    const cs = obj as CardSet;

    switch (prop) {
      case 'trump': return filterTrump(cs, ctx.trumpSuit);
      case 'nontrump': return filterNonTrump(cs, ctx.trumpSuit);
      case 'hearts': return filterHearts(cs);
      case 'suit':
        return args.length > 0 ? filterSuit(cs, args[0] as string) : cs;
      case 'strongest': return cardSetHighest(cs, ctx.getCardValue);
      case 'weakest': return cardSetLowest(cs, ctx.getCardValue);
      case 'least_beaten': return cardSetLeastBeaten(cs, ctx);
      case 'strongest_safe': return highestSafe(cs, ctx);
      case 'winners': return cardSetWinners(cs, ctx);
      case 'losers': return cardSetLosers(cs, ctx);
      case 'boss': return cardSetBoss(cs, ctx, args[0]);
      case 'backed': return filterByRole(cs, ctx, 'backed', args[0]);
      case 'backing': return filterByRole(cs, ctx, 'backing', args[0]);
      case 'spare': return filterByRole(cs, ctx, 'spare', args[0]);
      case 'working': return filterByRole(cs, ctx, 'working', args[0]);
      case 'count': return cs.cards.length;
      case 'above':
        return args.length > 0 ? cardSetAbove(cs, args[0] as Card, ctx.getCardValue) : cs;
      case 'below':
        return args.length > 0 ? cardSetBelow(cs, args[0] as Card, ctx.getCardValue) : cs;
    }
  }

  // Handle nested object properties (e.g., me.id, bid.current, trick.winner)
  if (obj && typeof obj === 'object') {
    if (prop in obj) return (obj as any)[prop];
  }

  // Handle bid.current, bid.X as special namespace
  if (expr.object.type === 'variable' && expr.object.name === 'bid') {
    switch (prop) {
      case 'current': return ctx.currentHighBid;
    }
  }

  if (expr.object.type === 'variable' && expr.object.name === 'trick') {
    switch (prop) {
      case 'winner': {
        const idx = ctx.evaluateCurrentWinner();
        return idx >= 0 ? ctx.currentTrick[idx].card : null;
      }
    }
  }

  return undefined;
}

// ── Discard Helper Functions ────────────────────────────────────────

/**
 * Compute stopper cards: cards involved in stopper structures.
 * For each non-trump suit, find the best card and determine how many
 * protectors it needs (= number of higher unseen cards). Collect the
 * best card + its protectors as the stopper set.
 */
function computeStopperCards(ctx: StrategyContext): CardSet {
  const trumpSuit = ctx.trumpSuit;
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'].filter(s => s !== trumpSuit);
  const seen = seenCardIds(ctx);
  const stopperCards: Card[] = [];

  for (const suit of suits) {
    const suitCards = ctx.hand.filter(c => c.suit === suit);
    if (suitCards.length === 0) continue;

    // Sort by value descending
    suitCards.sort((a, b) => ctx.getCardValue(b) - ctx.getCardValue(a));
    const bestCard = suitCards[0];
    const bestVal = ctx.getCardValue(bestCard);

    // Count outstanding cards with higher value
    let protectorsNeeded = 0;
    for (const outCard of outstandingInSuit(suit, seen)) {
      if (ctx.getCardValue(outCard) > bestVal) {
        protectorsNeeded++;
      }
    }

    // If protectorsNeeded == 0, it's a boss card - naturally kept by value
    if (protectorsNeeded === 0) continue;

    // Collect the best card + up to protectorsNeeded lower-value cards
    stopperCards.push(bestCard);
    for (let i = 1; i < suitCards.length && i <= protectorsNeeded; i++) {
      stopperCards.push(suitCards[i]);
    }
  }

  return { cards: stopperCards };
}

/**
 * Compute suit keepers: the n weakest cards from each non-trump suit.
 * This enables "keep at least n cards of each suit" strategies.
 */
function computeSuitKeepers(n: number, ctx: StrategyContext): CardSet {
  const trumpSuit = ctx.trumpSuit;
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'].filter(s => s !== trumpSuit);
  const keepers: Card[] = [];

  for (const suit of suits) {
    const suitCards = ctx.hand.filter(c => c.suit === suit);
    if (suitCards.length === 0) continue;

    // Sort by value ascending, take n weakest
    suitCards.sort((a, b) => ctx.getCardValue(a) - ctx.getCardValue(b));
    for (let i = 0; i < Math.min(n, suitCards.length); i++) {
      keepers.push(suitCards[i]);
    }
  }

  return { cards: keepers };
}

/**
 * Compute void candidates: all cards in the shortest non-trump suit(s).
 * Used for voiding a suit to enable trumping.
 */
function computeVoidCandidates(ctx: StrategyContext): CardSet {
  const trumpSuit = ctx.trumpSuit;
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'].filter(s => s !== trumpSuit);

  const suitCounts: { [suit: string]: number } = {};
  for (const suit of suits) {
    suitCounts[suit] = ctx.hand.filter(c => c.suit === suit).length;
  }

  // Find the minimum non-zero count
  const nonZeroCounts = Object.values(suitCounts).filter(v => v > 0);
  if (nonZeroCounts.length === 0) return { cards: [] };
  const minCount = Math.min(...nonZeroCounts);

  // Collect all cards from suits with the minimum count
  const candidates: Card[] = [];
  for (const suit of suits) {
    if (suitCounts[suit] === minCount) {
      candidates.push(...ctx.hand.filter(c => c.suit === suit));
    }
  }

  return { cards: candidates };
}

// ── Strategy Evaluator ──────────────────────────────────────────────

export type PlayResult = Card | null;
export type BidResult = number | null; // number = bid amount, -1 = take, 0 = pass
export type TrumpResult = { suit: string; direction: string } | null;

export function formatExpr(expr: Expression): string {
  switch (expr.type) {
    case 'literal': return JSON.stringify(expr.value);
    case 'variable': return expr.name;
    case 'binary': return `${formatExpr((expr as any).left)} ${(expr as any).op} ${formatExpr((expr as any).right)}`;
    case 'unary': return `${(expr as any).op} ${formatExpr((expr as any).operand)}`;
    case 'call': return `${expr.name}(${(expr as any).args.map(formatExpr).join(', ')})`;
    case 'property': return `${formatExpr((expr as any).object)}.${(expr as any).property}`;
    default: return '?';
  }
}

function evalRuleBlock(block: RuleBlock, ctx: StrategyContext): { action: Action | null; ruleIndex: number } {
  for (let i = 0; i < block.rules.length; i++) {
    const rule = block.rules[i];
    const condResult = evalExpr(rule.condition, ctx);
    if (strategyDebugEnabled) {
      debugLog(`  rule ${i}: ${formatExpr(rule.condition)} → ${condResult}`);
    }
    if (condResult) {
      debugLog(`  ✓ matched rule ${i}, action: ${rule.action.type}`);
      return { action: rule.action, ruleIndex: i };
    }
  }
  if (block.defaultAction) {
    debugLog(`  → default action: ${block.defaultAction.type}`);
    return { action: block.defaultAction, ruleIndex: -1 };
  }
  debugLog(`  → no match, no default`);
  return { action: null, ruleIndex: -2 };
}

// Thread strategy-level `let` constants into the evaluation context. Done
// once at each public entry point so internal helpers (resolveVariable) can
// look them up without plumbing the AST through every call.
function withConstants(ast: StrategyAST, ctx: StrategyContext): StrategyContext {
  if (!ast.constants) return ctx;
  return { ...ctx, constants: ast.constants };
}

export function evaluatePlay(ast: StrategyAST, ctxIn: StrategyContext): PlayResult {
  if (!ast.play) return null;
  const ctx = withConstants(ast, ctxIn);

  // Determine which sub-section to use
  let block: RuleBlock | undefined;
  let section = 'leading';

  if (ctx.currentTrick.length === 0) {
    block = ast.play.leading;
  } else {
    const hasSuit = ctx.leadSuit ? ctx.hand.some(c => c.suit === ctx.leadSuit) : false;
    if (hasSuit) {
      section = 'following';
      block = ast.play.following;
    } else {
      section = 'void';
      block = ast.play.void;
    }
  }

  debugGroup(`evaluatePlay P${ctx.playerId} [${section}] lead=${ctx.leadSuit || 'none'} trump=${ctx.trumpSuit || 'none'}`);

  if (!block) { debugLog('no block'); debugGroupEnd(); return null; }

  const { action, ruleIndex } = evalRuleBlock(block, ctx);

  if (traceCollector) {
    traceCollector.push({
      phase: 'play', subSection: section as 'leading' | 'following' | 'void',
      playerId: ctx.playerId, ruleIndex,
      conditionText: ruleIndex >= 0 ? formatExpr(block.rules[ruleIndex].condition) : undefined,
    });
  }

  if (!action) { debugGroupEnd(); return null; }

  if (action.type === 'play') {
    const result = evalExpr((action as PlayAction).cardExpr, ctx);
    if (result && typeof result === 'object') {
      if ('id' in result) {
        debugLog(`→ play ${(result as Card).id}`);
        debugGroupEnd();
        return result as Card;
      }
      if ('cards' in result) {
        const cs = result as CardSet;
        const card = cs.cards.length > 0 ? cs.cards[0] : null;
        debugLog(`→ play ${card?.id || 'null'} (from CardSet)`);
        debugGroupEnd();
        return card;
      }
    }
    debugGroupEnd();
    return null;
  }

  debugGroupEnd();
  return null;
}

export function evaluateBid(ast: StrategyAST, ctxIn: StrategyContext): BidResult {
  if (!ast.bid) return null;
  const ctx = withConstants(ast, ctxIn);

  debugGroup(`evaluateBid P${ctx.playerId} bidCount=${ctx.bidCount} currentHigh=${ctx.currentHighBid} isDealer=${ctx.isDealer}`);

  const { action, ruleIndex } = evalRuleBlock(ast.bid, ctx);

  if (traceCollector) {
    traceCollector.push({
      phase: 'bid', playerId: ctx.playerId, ruleIndex,
      conditionText: ruleIndex >= 0 ? formatExpr(ast.bid!.rules[ruleIndex].condition) : undefined,
    });
  }

  if (!action) { debugGroupEnd(); return null; }

  if (action.type === 'bid') {
    const amount = evalExpr((action as BidAction).amountExpr, ctx);
    debugLog(`→ bid ${amount}`);
    debugGroupEnd();
    return typeof amount === 'number' ? amount : null;
  }

  if (action.type === 'pass') {
    debugLog(`→ pass`);
    debugGroupEnd();
    return 0;
  }

  debugGroupEnd();
  return null;
}

export function evaluateTrump(ast: StrategyAST, ctxIn: StrategyContext): TrumpResult {
  if (!ast.trump) return null;
  const ctx = withConstants(ast, ctxIn);

  debugGroup(`evaluateTrump P${ctx.playerId} partnerBid=${ctx.partnerBid} enemyBid=${ctx.enemyBid}`);

  const { action, ruleIndex } = evalRuleBlock(ast.trump, ctx);

  if (traceCollector) {
    traceCollector.push({
      phase: 'trump', playerId: ctx.playerId, ruleIndex,
      conditionText: ruleIndex >= 0 ? formatExpr(ast.trump!.rules[ruleIndex].condition) : undefined,
    });
  }

  if (!action) { debugGroupEnd(); return null; }

  if (action.type === 'choose') {
    const chooseAction = action as ChooseAction;
    const suit = evalExpr(chooseAction.suitExpr, ctx);
    const direction = evalExpr(chooseAction.directionExpr, ctx);
    if (typeof suit === 'string' && typeof direction === 'string') {
      debugLog(`→ choose ${suit} ${direction}`);
      debugGroupEnd();
      return { suit, direction };
    }
    debugLog(`→ choose FAILED: suit=${suit} direction=${direction}`);
    debugGroupEnd();
    return null;
  }

  debugGroupEnd();
  return null;
}

/**
 * Evaluate the discard: section using collect-all-matches semantics.
 * Unlike play/bid/trump (which stop at first match), discard evaluates
 * ALL matching rules and collects keep/drop card sets additively.
 * Returns the IDs of the 4 lowest-scored cards to discard, or null if
 * no discard section exists.
 */
export function evaluateDiscard(ast: StrategyAST, ctxIn: StrategyContext): string[] | null {
  if (!ast.discard) return null;
  const ctx = withConstants(ast, ctxIn);

  debugGroup(`evaluateDiscard P${ctx.playerId} trump=${ctx.trumpSuit || 'none'}`);

  const block = ast.discard;
  const keepIds = new Set<string>();
  const dropIds = new Set<string>();

  // Collect cards from the default action (always applies)
  if (block.defaultAction) {
    collectDiscardAction(block.defaultAction, ctx, keepIds, dropIds);
  }

  // Evaluate ALL rules (collect-all-matches, not first-match)
  for (let i = 0; i < block.rules.length; i++) {
    const rule = block.rules[i];
    const condResult = evalExpr(rule.condition, ctx);
    if (strategyDebugEnabled) {
      debugLog(`  discard rule: ${formatExpr(rule.condition)} → ${condResult}`);
    }
    if (condResult) {
      collectDiscardAction(rule.action, ctx, keepIds, dropIds);
      if (traceCollector) {
        traceCollector.push({
          phase: 'discard', playerId: ctx.playerId, ruleIndex: i,
          conditionText: formatExpr(rule.condition),
        });
      }
    }
  }

  // Score each card in hand
  const scored = ctx.hand.map(card => {
    let score = ctx.getCardValue(card);
    // Trump bonus
    if (ctx.trumpSuit && card.suit === ctx.trumpSuit) {
      score += 100;
    }
    // Keep bonus
    if (keepIds.has(card.id)) {
      score += 1000;
    }
    // Drop penalty
    if (dropIds.has(card.id)) {
      score -= 1000;
    }
    return { id: card.id, score };
  });

  // Sort ascending by score, take 4 lowest
  scored.sort((a, b) => a.score - b.score);
  const discards = scored.slice(0, 4).map(s => s.id);
  debugLog(`→ discard: ${discards.join(', ')} | keep: ${[...keepIds].join(', ')} | drop: ${[...dropIds].join(', ')}`);
  debugGroupEnd();
  return discards;
}

function collectDiscardAction(
  action: Action,
  ctx: StrategyContext,
  keepIds: Set<string>,
  dropIds: Set<string>
): void {
  if (action.type === 'keep') {
    const result = evalExpr((action as KeepAction).cardSetExpr, ctx);
    if (result && typeof result === 'object' && 'cards' in result) {
      for (const card of (result as CardSet).cards) {
        keepIds.add(card.id);
      }
    }
  } else if (action.type === 'drop') {
    const result = evalExpr((action as DropAction).cardSetExpr, ctx);
    if (result && typeof result === 'object' && 'cards' in result) {
      for (const card of (result as CardSet).cards) {
        dropIds.add(card.id);
      }
    }
  }
}
