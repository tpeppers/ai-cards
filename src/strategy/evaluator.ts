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

function cardSetBoss(cs: CardSet, ctx: StrategyContext): CardSet {
  const playedIds = new Set(ctx.playedCards.map(c => c.id));
  const myIds = new Set(ctx.hand.map(c => c.id));
  const trickIds = new Set(ctx.currentTrick.map(p => p.card.id));

  return {
    cards: cs.cards.filter(card => {
      const val = ctx.getCardValue(card);
      for (let rank = 1; rank <= 13; rank++) {
        const id = `${card.suit}_${rank}`;
        if (id === card.id) continue;
        if (playedIds.has(id) || myIds.has(id) || trickIds.has(id)) continue;
        // This card is still out there in an opponent's hand
        const tempCard: Card = { suit: card.suit, rank, id };
        if (ctx.getCardValue(tempCard) > val) {
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
  const playedIds = new Set(ctx.playedCards.map(c => c.id));
  const myIds = new Set(ctx.hand.map(c => c.id));
  const trickIds = new Set(ctx.currentTrick.map(p => p.card.id));

  const val = ctx.getCardValue(card);
  let count = 0;

  // There are 13 cards per suit. Any with higher value that are not in hand, played, or current trick
  for (let rank = 1; rank <= 13; rank++) {
    const id = `${card.suit}_${rank}`;
    if (id === card.id) continue;
    if (playedIds.has(id) || myIds.has(id) || trickIds.has(id)) continue;
    // Create a temporary card to evaluate
    const tempCard: Card = { suit: card.suit, rank, id };
    if (ctx.getCardValue(tempCard) > val) {
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

  const playedIds = new Set(ctx.playedCards.map(c => c.id));
  const myIds = new Set(ctx.hand.map(c => c.id));
  const trickIds = new Set(ctx.currentTrick.map(p => p.card.id));

  const winVal = ctx.getCardValue(winCard);
  let count = 0;

  // Higher cards of the same suit as the winner
  for (let rank = 1; rank <= 13; rank++) {
    const id = `${winCard.suit}_${rank}`;
    if (playedIds.has(id) || myIds.has(id) || trickIds.has(id)) continue;
    const tempCard: Card = { suit: winCard.suit, rank, id };
    if (ctx.getCardValue(tempCard) > winVal) {
      count++;
    }
  }

  // If winner is non-trump, any outstanding trump card also beats it
  if (ctx.trumpSuit && winCard.suit !== ctx.trumpSuit) {
    for (let rank = 1; rank <= 13; rank++) {
      const id = `${ctx.trumpSuit}_${rank}`;
      if (playedIds.has(id) || myIds.has(id) || trickIds.has(id)) continue;
      count++;
    }
  }

  return count;
}

function countOutstandingTrump(ctx: StrategyContext): number {
  if (!ctx.trumpSuit) return 0;
  const playedIds = new Set(ctx.playedCards.map(c => c.id));
  const myIds = new Set(ctx.hand.map(c => c.id));
  const trickIds = new Set(ctx.currentTrick.map(p => p.card.id));

  let count = 0;
  for (let rank = 1; rank <= 13; rank++) {
    const id = `${ctx.trumpSuit}_${rank}`;
    if (playedIds.has(id) || myIds.has(id) || trickIds.has(id)) continue;
    count++;
  }
  return count;
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
      case 'strongest_safe': return highestSafe(cs, ctx);
      case 'winners': return cardSetWinners(cs, ctx);
      case 'losers': return cardSetLosers(cs, ctx);
      case 'boss': return cardSetBoss(cs, ctx);
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
  const playedIds = new Set(ctx.playedCards.map(c => c.id));
  const myIds = new Set(ctx.hand.map(c => c.id));
  const stopperCards: Card[] = [];

  for (const suit of suits) {
    const suitCards = ctx.hand.filter(c => c.suit === suit);
    if (suitCards.length === 0) continue;

    // Sort by value descending
    suitCards.sort((a, b) => ctx.getCardValue(b) - ctx.getCardValue(a));
    const bestCard = suitCards[0];
    const bestVal = ctx.getCardValue(bestCard);

    // Count cards with higher value that are NOT in hand and NOT played
    let protectorsNeeded = 0;
    for (let rank = 1; rank <= 13; rank++) {
      const id = `${suit}_${rank}`;
      if (myIds.has(id) || playedIds.has(id)) continue;
      const tempCard: Card = { suit, rank, id };
      if (ctx.getCardValue(tempCard) > bestVal) {
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

function formatExpr(expr: Expression): string {
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

function evalRuleBlock(block: RuleBlock, ctx: StrategyContext): Action | null {
  for (let i = 0; i < block.rules.length; i++) {
    const rule = block.rules[i];
    const condResult = evalExpr(rule.condition, ctx);
    if (strategyDebugEnabled) {
      debugLog(`  rule ${i}: ${formatExpr(rule.condition)} → ${condResult}`);
    }
    if (condResult) {
      debugLog(`  ✓ matched rule ${i}, action: ${rule.action.type}`);
      return rule.action;
    }
  }
  if (block.defaultAction) {
    debugLog(`  → default action: ${block.defaultAction.type}`);
    return block.defaultAction;
  }
  debugLog(`  → no match, no default`);
  return null;
}

export function evaluatePlay(ast: StrategyAST, ctx: StrategyContext): PlayResult {
  if (!ast.play) return null;

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

  const action = evalRuleBlock(block, ctx);
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

export function evaluateBid(ast: StrategyAST, ctx: StrategyContext): BidResult {
  if (!ast.bid) return null;

  debugGroup(`evaluateBid P${ctx.playerId} bidCount=${ctx.bidCount} currentHigh=${ctx.currentHighBid} isDealer=${ctx.isDealer}`);

  const action = evalRuleBlock(ast.bid, ctx);
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

export function evaluateTrump(ast: StrategyAST, ctx: StrategyContext): TrumpResult {
  if (!ast.trump) return null;

  debugGroup(`evaluateTrump P${ctx.playerId} partnerBid=${ctx.partnerBid} enemyBid=${ctx.enemyBid}`);

  const action = evalRuleBlock(ast.trump, ctx);
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
export function evaluateDiscard(ast: StrategyAST, ctx: StrategyContext): string[] | null {
  if (!ast.discard) return null;

  debugGroup(`evaluateDiscard P${ctx.playerId} trump=${ctx.trumpSuit || 'none'}`);

  const block = ast.discard;
  const keepIds = new Set<string>();
  const dropIds = new Set<string>();

  // Collect cards from the default action (always applies)
  if (block.defaultAction) {
    collectDiscardAction(block.defaultAction, ctx, keepIds, dropIds);
  }

  // Evaluate ALL rules (collect-all-matches, not first-match)
  for (const rule of block.rules) {
    const condResult = evalExpr(rule.condition, ctx);
    if (strategyDebugEnabled) {
      debugLog(`  discard rule: ${formatExpr(rule.condition)} → ${condResult}`);
    }
    if (condResult) {
      collectDiscardAction(rule.action, ctx, keepIds, dropIds);
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
