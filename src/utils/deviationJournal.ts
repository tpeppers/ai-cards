/**
 * Deviation journal — records every human decision in a Bid Whist game
 * alongside what the currently-selected Auto Play strategy (and also
 * ClaudeFam + Family, as fixed reference points) would have done. The
 * Settings page exports the recorded session as JSON, which
 * `scripts/journal-to-brief.js` converts to a markdown brief suitable
 * for pasting into a fresh Claude Code conversation.
 *
 * Stored in localStorage under 'deviationJournal' as a JSON array of
 * decision/outcome records. Kept self-contained so the game code just
 * calls `record*` / `finalizeHand` and doesn't have to know how the
 * data is persisted or shaped.
 */

import { Card } from '../types/CardGame.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { evaluateBid, evaluatePlay, evaluateTrump, evaluateDiscard } from '../strategy/evaluator.ts';
import { buildBidWhistContext } from '../strategy/context.ts';
import { StrategyAST } from '../strategy/types.ts';
import { BIDWHIST_FAMILY, BIDWHIST_CLAUDEFAM } from '../strategies/index.ts';

// ── Settings access ──

export type DeviationAlertMode = 'off' | 'deviation' | 'blunder';

export function getDeviationAlertMode(): DeviationAlertMode {
  const v = localStorage.getItem('deviationAlerts');
  if (v === 'deviation' || v === 'blunder') return v;
  return 'off';
}

export function setDeviationAlertMode(mode: DeviationAlertMode): void {
  if (mode === 'off') localStorage.removeItem('deviationAlerts');
  else localStorage.setItem('deviationAlerts', mode);
}

// ── Cached reference strategies ──
// Family and ClaudeFam are the fixed baselines we always record against
// (independent of whatever the user has configured as Auto Play). The
// configured Auto Play strategy is additionally recorded as
// `selectedName`.

let _familyAst: StrategyAST | null = null;
let _claudeFamAst: StrategyAST | null = null;

function familyAst(): StrategyAST {
  if (!_familyAst) _familyAst = parseStrategy(BIDWHIST_FAMILY);
  return _familyAst;
}
function claudeFamAst(): StrategyAST {
  if (!_claudeFamAst) _claudeFamAst = parseStrategy(BIDWHIST_CLAUDEFAM);
  return _claudeFamAst;
}

// ── Record types ──

export type DecisionPhase = 'bid' | 'trump' | 'discard' | 'play';

export interface DecisionRecord {
  t: number;                  // wall-clock timestamp
  handId: string;             // deckUrl of the current hand
  phase: DecisionPhase;
  // Hand context snapshot (for replay brief-writing)
  bidCount?: number;          // how many bids had been placed (for 'bid')
  currentBid?: number;        // bid.current at decision time
  trumpSuit?: string | null;
  direction?: string;
  trickNumber?: number;       // 1-12 for play phase
  leadSuit?: string | null;
  currentTrickSoFar?: Array<{ playerId: number; card: string }>;
  // What the human did, encoded as a short string
  humanChoice: string;
  // What each strategy would have done
  selectedName: string;       // the Auto Play strategy at decision time
  selectedChoice: string;
  familyChoice: string;
  claudeFamChoice: string;
  // Derived flags
  divergedFromSelected: boolean;
  divergedFromFamily: boolean;
  divergedFromClaudeFam: boolean;
}

export interface HandOutcome {
  t: number;
  handId: string;
  declarer: number;
  bidAmount: number;
  trumpSuit: string;
  direction: string;
  booksWon: [number, number];
  contract: number;
  declarerTeamBooks: number;
  made: boolean;
}

export interface JournalEntry {
  decision?: DecisionRecord;
  outcome?: HandOutcome;
}

// ── Persistence ──

const STORAGE_KEY = 'deviationJournal';

function readAll(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function append(entry: JournalEntry): void {
  const all = readAll();
  all.push(entry);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Localstorage full — drop oldest half to make room.
    const half = all.slice(Math.floor(all.length / 2));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(half)); } catch {}
  }
}

export function clearJournal(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportJournal(): JournalEntry[] {
  return readAll();
}

export function journalSize(): number {
  return readAll().length;
}

// ── Short human-readable encoding of a choice ──

function cardStr(c: Card): string {
  const r = c.rank === 1 ? 'A' : c.rank === 11 ? 'J' : c.rank === 12 ? 'Q' : c.rank === 13 ? 'K' : String(c.rank);
  const s = c.suit === 'spades' ? 'S' : c.suit === 'hearts' ? 'H' : c.suit === 'diamonds' ? 'D' : 'C';
  return r + s;
}

function bidStr(amount: number): string {
  return amount === 0 ? 'pass' : `bid ${amount}`;
}

function trumpStr(suit: string, direction: string): string {
  return `${direction} ${suit}`;
}

function discardStr(cardIds: string[]): string {
  return cardIds.slice().sort().join(',');
}

// ── Interface for the minimal game-like handle we need ──

interface GameLike {
  getGameState(): {
    players: { id: number; hand: Card[]; tricks: Card[] }[];
    currentTrick: { playerId: number; card: Card }[];
    currentPlayer: number | null;
    gameStage: string;
  };
  getTrumpSuit(): string | null;
  getBidDirection(): string;
  getDeclarer(): number | null;
  getDealer(): number;
  getBiddingState(): {
    currentHighBid: number;
    bids: any[];
    dealer: number;
  };
  getCardValue(card: Card): number;
  compareCards(a: Card, b: Card): number;
  evaluateCurrentWinner(): number;
  getPlayedCards(): Card[];
  getFirstDiscardSuits(): (string | null)[];
  getPlayerVoidSuits(): Set<string>[];
}

// ── Querying strategies ──

function queryBidStrategy(ast: StrategyAST, game: GameLike): string {
  try {
    const ctx = buildBidWhistContext(game, 0);
    const amount = evaluateBid(ast, ctx);
    if (typeof amount === 'number') return bidStr(amount);
  } catch {}
  return '?';
}

function queryTrumpStrategy(ast: StrategyAST, game: GameLike): string {
  try {
    const ctx = buildBidWhistContext(game, 0);
    const result = evaluateTrump(ast, ctx);
    if (result && result.suit && result.direction) return trumpStr(result.suit, result.direction);
  } catch {}
  return '?';
}

function queryDiscardStrategy(ast: StrategyAST, game: GameLike): string {
  try {
    const ctx = buildBidWhistContext(game, 0);
    const ids = evaluateDiscard(ast, ctx);
    if (ids) return discardStr(ids);
  } catch {}
  return '?';
}

function queryPlayStrategy(ast: StrategyAST, game: GameLike): string {
  try {
    const ctx = buildBidWhistContext(game, 0);
    const card = evaluatePlay(ast, ctx);
    if (card) return cardStr(card);
  } catch {}
  return '?';
}

// ── Public record API ──

export interface RecordContext {
  handId: string;
  selectedStrategyText: string | null; // user's configured Auto Play strategy (null = Family-equivalent default)
  selectedStrategyName: string;
}

function getSelectedAst(ctx: RecordContext): StrategyAST {
  if (ctx.selectedStrategyText) {
    try { return parseStrategy(ctx.selectedStrategyText); } catch {}
  }
  return familyAst();
}

/**
 * Record a bid decision by player 0. `humanAmount` is 0 for pass,
 * 1-6 for a numeric bid, -1 for "take".
 */
export function recordBidDecision(game: GameLike, humanAmount: number, ctx: RecordContext): DecisionRecord {
  const biddingState = game.getBiddingState();
  const sel = getSelectedAst(ctx);
  const humanChoice = humanAmount === -1 ? 'take' : bidStr(humanAmount);
  const selectedChoice = queryBidStrategy(sel, game);
  const familyChoice = queryBidStrategy(familyAst(), game);
  const claudeFamChoice = queryBidStrategy(claudeFamAst(), game);
  const rec: DecisionRecord = {
    t: Date.now(),
    handId: ctx.handId,
    phase: 'bid',
    bidCount: biddingState.bids.length,
    currentBid: biddingState.currentHighBid,
    humanChoice,
    selectedName: ctx.selectedStrategyName,
    selectedChoice,
    familyChoice,
    claudeFamChoice,
    divergedFromSelected: humanChoice !== selectedChoice && selectedChoice !== '?',
    divergedFromFamily: humanChoice !== familyChoice && familyChoice !== '?',
    divergedFromClaudeFam: humanChoice !== claudeFamChoice && claudeFamChoice !== '?',
  };
  append({ decision: rec });
  return rec;
}

export function recordTrumpDecision(game: GameLike, humanSuit: string, humanDir: string, ctx: RecordContext): DecisionRecord {
  const sel = getSelectedAst(ctx);
  const humanChoice = trumpStr(humanSuit, humanDir);
  const selectedChoice = queryTrumpStrategy(sel, game);
  const familyChoice = queryTrumpStrategy(familyAst(), game);
  const claudeFamChoice = queryTrumpStrategy(claudeFamAst(), game);
  const rec: DecisionRecord = {
    t: Date.now(),
    handId: ctx.handId,
    phase: 'trump',
    humanChoice,
    selectedName: ctx.selectedStrategyName,
    selectedChoice,
    familyChoice,
    claudeFamChoice,
    divergedFromSelected: humanChoice !== selectedChoice && selectedChoice !== '?',
    divergedFromFamily: humanChoice !== familyChoice && familyChoice !== '?',
    divergedFromClaudeFam: humanChoice !== claudeFamChoice && claudeFamChoice !== '?',
  };
  append({ decision: rec });
  return rec;
}

export function recordDiscardDecision(game: GameLike, humanCardIds: string[], ctx: RecordContext): DecisionRecord {
  const sel = getSelectedAst(ctx);
  const humanChoice = discardStr(humanCardIds);
  const selectedChoice = queryDiscardStrategy(sel, game);
  const familyChoice = queryDiscardStrategy(familyAst(), game);
  const claudeFamChoice = queryDiscardStrategy(claudeFamAst(), game);
  const rec: DecisionRecord = {
    t: Date.now(),
    handId: ctx.handId,
    phase: 'discard',
    humanChoice,
    selectedName: ctx.selectedStrategyName,
    selectedChoice,
    familyChoice,
    claudeFamChoice,
    divergedFromSelected: humanChoice !== selectedChoice && selectedChoice !== '?',
    divergedFromFamily: humanChoice !== familyChoice && familyChoice !== '?',
    divergedFromClaudeFam: humanChoice !== claudeFamChoice && claudeFamChoice !== '?',
  };
  append({ decision: rec });
  return rec;
}

export function recordPlayDecision(game: GameLike, humanCard: Card, ctx: RecordContext): DecisionRecord {
  const state = game.getGameState();
  const sel = getSelectedAst(ctx);
  const humanChoice = cardStr(humanCard);
  const selectedChoice = queryPlayStrategy(sel, game);
  const familyChoice = queryPlayStrategy(familyAst(), game);
  const claudeFamChoice = queryPlayStrategy(claudeFamAst(), game);

  // Approximate trick number: how many completed tricks players[0] has
  // taken plus any partial trick in progress (plus +1 for 1-indexed).
  const completed = Math.max(0, ...state.players.map(p => p.tricks.length - (p.id === game.getDeclarer() ? 4 : 0)));
  const trickNumber = completed + 1;

  const rec: DecisionRecord = {
    t: Date.now(),
    handId: ctx.handId,
    phase: 'play',
    trumpSuit: game.getTrumpSuit(),
    direction: game.getBidDirection(),
    trickNumber,
    leadSuit: state.currentTrick.length > 0 ? state.currentTrick[0].card.suit : null,
    currentTrickSoFar: state.currentTrick.map(p => ({ playerId: p.playerId, card: cardStr(p.card) })),
    humanChoice,
    selectedName: ctx.selectedStrategyName,
    selectedChoice,
    familyChoice,
    claudeFamChoice,
    divergedFromSelected: humanChoice !== selectedChoice && selectedChoice !== '?',
    divergedFromFamily: humanChoice !== familyChoice && familyChoice !== '?',
    divergedFromClaudeFam: humanChoice !== claudeFamChoice && claudeFamChoice !== '?',
  };
  append({ decision: rec });
  return rec;
}

export function finalizeHand(outcome: HandOutcome): void {
  append({ outcome: { ...outcome, t: Date.now() } });
}
