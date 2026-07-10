/**
 * BWR1 — compact Bid Whist hand-record format for recording
 * human-vs-strategy challenge games. See scratchpad/bwr1-spec.md for the
 * format contract. One HAND per record; a game is a sequence of records.
 *
 * Single-string form: 9 fields joined with '.', strictly [A-Za-z0-9.~-]:
 *   BWR1 . deal(52) . dealer(1) . bids(1-4) . call(2) . discards(4)
 *        . plays(0-48) . assists('~'-joined) . outcome('~'-joined)
 * All-pass records keep all 9 fields; call/discards/plays are empty.
 */

import { letterToCard } from '../urlGameState.js';
import { BidWhistGame } from '../games/BidWhistGame.ts';

export type AssistEvent =
  | { type: 'showAllOn' | 'showAllOff' | 'autoplay' | 'preview'; playIndex: number }
  | { type: 'bidAssist'; bidIndex: number }
  | { type: 'trumpAssist' }
  | { type: 'discardAssist' };

export interface HandRecord {
  deal: string;                       // 52 chars
  dealer: number;                     // 0-3
  bids: (number | 'T')[];             // bidding order, 0=pass, 'T'=take
  call: { suit: string; direction: string } | null;   // null for all-pass
  discards: string[];                 // 4 card ids, [] for all-pass
  plays: string[];                    // card ids in table order
  assists: AssistEvent[];
  outcome: {
    humanBooks: [number, number] | null;
    shadowBooks: [number, number] | null;
    flagged: boolean;
  };
}

// ── Card letter <-> id tables (via the urlGameState schema) ──────────

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTER_TO_ID = new Map<string, string>();
const ID_TO_LETTER = new Map<string, string>();
for (const ch of LETTERS) {
  const card = letterToCard(ch);
  LETTER_TO_ID.set(ch, card.id);
  ID_TO_LETTER.set(card.id, ch);
}

const SUIT_TO_CHAR: { [suit: string]: string } = {
  spades: 's', hearts: 'h', diamonds: 'd', clubs: 'c',
};
const CHAR_TO_SUIT: { [ch: string]: string } = {
  s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs',
};
const DIR_TO_CHAR: { [dir: string]: string } = {
  uptown: 'u', downtown: 'd', 'downtown-noaces': 'n',
};
const CHAR_TO_DIR: { [ch: string]: string } = {
  u: 'uptown', d: 'downtown', n: 'downtown-noaces',
};

// ── Encode ───────────────────────────────────────────────────────────

function idToLetter(id: string, what: string): string {
  const letter = ID_TO_LETTER.get(id);
  if (!letter) throw new Error(`BWR1 encode: ${what} contains unknown card id "${id}"`);
  return letter;
}

function assistToToken(a: AssistEvent): string {
  switch (a.type) {
    case 'showAllOn':     return `S${a.playIndex}`;
    case 'showAllOff':    return `s${a.playIndex}`;
    case 'autoplay':      return `A${a.playIndex}`;
    case 'preview':       return `P${a.playIndex}`;
    case 'bidAssist':     return `b${a.bidIndex}`;
    case 'trumpAssist':   return 't';
    case 'discardAssist': return 'd';
    default:
      throw new Error(`BWR1 encode: unknown assist type "${(a as { type: string }).type}"`);
  }
}

export function encodeHandRecord(r: HandRecord): string {
  if (r.deal.length !== 52) {
    throw new Error(`BWR1 encode: deal must be 52 chars, got ${r.deal.length}`);
  }
  for (const ch of r.deal) {
    if (!LETTER_TO_ID.has(ch)) throw new Error(`BWR1 encode: invalid deal letter "${ch}"`);
  }
  if (!Number.isInteger(r.dealer) || r.dealer < 0 || r.dealer > 3) {
    throw new Error(`BWR1 encode: dealer must be 0-3, got ${r.dealer}`);
  }
  if (r.bids.length < 1 || r.bids.length > 4) {
    throw new Error(`BWR1 encode: expected 1-4 bids, got ${r.bids.length}`);
  }
  const bids = r.bids.map(b => {
    if (b === 'T') return 'T';
    if (Number.isInteger(b) && b >= 0 && b <= 6) return String(b);
    throw new Error(`BWR1 encode: invalid bid "${b}"`);
  }).join('');

  let call = '';
  if (r.call !== null) {
    const suitCh = SUIT_TO_CHAR[r.call.suit];
    if (!suitCh) throw new Error(`BWR1 encode: invalid call suit "${r.call.suit}"`);
    const dirCh = DIR_TO_CHAR[r.call.direction];
    if (!dirCh) throw new Error(`BWR1 encode: invalid call direction "${r.call.direction}"`);
    call = suitCh + dirCh;
  }

  if (r.call === null) {
    if (r.discards.length !== 0) throw new Error('BWR1 encode: discards present without a trump call');
    if (r.plays.length !== 0) throw new Error('BWR1 encode: plays present without a trump call');
  } else if (r.discards.length !== 4) {
    throw new Error(`BWR1 encode: expected 4 discards, got ${r.discards.length}`);
  }
  if (r.plays.length > 48) {
    throw new Error(`BWR1 encode: expected at most 48 plays, got ${r.plays.length}`);
  }
  const discards = r.discards.map(id => idToLetter(id, 'discards')).join('');
  const plays = r.plays.map(id => idToLetter(id, 'plays')).join('');
  const assists = r.assists.map(assistToToken).join('~');

  const outcomeTokens: string[] = [];
  if (r.outcome.humanBooks !== null) {
    outcomeTokens.push(`H${r.outcome.humanBooks[0]}-${r.outcome.humanBooks[1]}`);
  }
  if (r.outcome.shadowBooks !== null) {
    outcomeTokens.push(`X${r.outcome.shadowBooks[0]}-${r.outcome.shadowBooks[1]}`);
  }
  if (r.outcome.flagged) outcomeTokens.push('F');
  const outcome = outcomeTokens.join('~');

  return ['BWR1', r.deal, String(r.dealer), bids, call, discards, plays, assists, outcome].join('.');
}

// ── Decode ───────────────────────────────────────────────────────────

function decodeCardLetters(s: string, what: string): string[] {
  const ids: string[] = [];
  for (const ch of s) {
    const id = LETTER_TO_ID.get(ch);
    if (!id) throw new Error(`BWR1 decode: invalid card letter "${ch}" in ${what}`);
    ids.push(id);
  }
  return ids;
}

function decodeAssistToken(token: string): AssistEvent {
  let m = token.match(/^S(\d+)$/);
  if (m) return { type: 'showAllOn', playIndex: parseInt(m[1], 10) };
  m = token.match(/^s(\d+)$/);
  if (m) return { type: 'showAllOff', playIndex: parseInt(m[1], 10) };
  m = token.match(/^A(\d+)$/);
  if (m) return { type: 'autoplay', playIndex: parseInt(m[1], 10) };
  m = token.match(/^P(\d+)$/);
  if (m) return { type: 'preview', playIndex: parseInt(m[1], 10) };
  m = token.match(/^b([0-3])$/);
  if (m) return { type: 'bidAssist', bidIndex: parseInt(m[1], 10) };
  if (token === 't') return { type: 'trumpAssist' };
  if (token === 'd') return { type: 'discardAssist' };
  throw new Error(`BWR1 decode: invalid assist token "${token}"`);
}

export function decodeHandRecord(s: string): HandRecord {
  const parts = s.split('.');
  if (parts.length !== 9) {
    throw new Error(`BWR1 decode: expected 9 dot-separated fields, got ${parts.length}`);
  }
  const [version, deal, dealerStr, bidsStr, callStr, discardsStr, playsStr, assistsStr, outcomeStr] = parts;

  if (version !== 'BWR1') {
    throw new Error(`BWR1 decode: unknown version tag "${version}"`);
  }

  if (deal.length !== 52) {
    throw new Error(`BWR1 decode: deal must be 52 chars, got ${deal.length}`);
  }
  decodeCardLetters(deal, 'deal');
  if (new Set(deal).size !== 52) {
    throw new Error('BWR1 decode: deal contains duplicate cards');
  }

  if (!/^[0-3]$/.test(dealerStr)) {
    throw new Error(`BWR1 decode: dealer must be a single digit 0-3, got "${dealerStr}"`);
  }
  const dealer = parseInt(dealerStr, 10);

  if (bidsStr.length < 1 || bidsStr.length > 4) {
    throw new Error(`BWR1 decode: expected 1-4 bid chars, got "${bidsStr}"`);
  }
  const bids: (number | 'T')[] = [];
  for (const ch of bidsStr) {
    if (ch === 'T') bids.push('T');
    else if (/^[0-6]$/.test(ch)) bids.push(parseInt(ch, 10));
    else throw new Error(`BWR1 decode: invalid bid char "${ch}"`);
  }

  let call: HandRecord['call'] = null;
  if (callStr !== '') {
    if (callStr.length !== 2) {
      throw new Error(`BWR1 decode: call must be 2 chars (suit + direction), got "${callStr}"`);
    }
    const suit = CHAR_TO_SUIT[callStr[0]];
    if (!suit) throw new Error(`BWR1 decode: invalid call suit char "${callStr[0]}"`);
    const direction = CHAR_TO_DIR[callStr[1]];
    if (!direction) throw new Error(`BWR1 decode: invalid call direction char "${callStr[1]}"`);
    call = { suit, direction };
  }

  if (call === null) {
    if (discardsStr !== '') throw new Error('BWR1 decode: discards present without a trump call');
    if (playsStr !== '') throw new Error('BWR1 decode: plays present without a trump call');
  } else if (discardsStr.length !== 4) {
    throw new Error(`BWR1 decode: expected 4 discard letters, got "${discardsStr}"`);
  }
  const discards = decodeCardLetters(discardsStr, 'discards');

  if (playsStr.length > 48) {
    throw new Error(`BWR1 decode: expected at most 48 play letters, got ${playsStr.length}`);
  }
  const plays = decodeCardLetters(playsStr, 'plays');

  const assists: AssistEvent[] = assistsStr === ''
    ? []
    : assistsStr.split('~').map(decodeAssistToken);

  const outcome: HandRecord['outcome'] = { humanBooks: null, shadowBooks: null, flagged: false };
  if (outcomeStr !== '') {
    for (const token of outcomeStr.split('~')) {
      let m = token.match(/^H(\d+)-(\d+)$/);
      if (m) { outcome.humanBooks = [parseInt(m[1], 10), parseInt(m[2], 10)]; continue; }
      m = token.match(/^X(\d+)-(\d+)$/);
      if (m) { outcome.shadowBooks = [parseInt(m[1], 10), parseInt(m[2], 10)]; continue; }
      if (token === 'F') { outcome.flagged = true; continue; }
      throw new Error(`BWR1 decode: invalid outcome token "${token}"`);
    }
  }

  return { deal, dealer, bids, call, discards, plays, assists, outcome };
}

// ── Replay validation ────────────────────────────────────────────────

/**
 * Feeds the record through a real BidWhistGame instance and confirms
 * every action is legal. Books are recomputed from the engine when all
 * 48 plays are present; otherwise books is null. Errors are collected
 * (not thrown); any illegality yields valid: false.
 */
export function replayHandRecord(r: HandRecord): { valid: boolean; errors: string[]; books: [number, number] | null } {
  const errors: string[] = [];
  const game = new BidWhistGame();
  game.setDealer(r.dealer);
  try {
    game.dealCards(r.deal);
  } catch (e) {
    errors.push(`deal failed: ${e instanceof Error ? e.message : String(e)}`);
    return { valid: false, errors, books: null };
  }

  // ── Bidding (starts from (dealer+3)%4, which dealCards set up) ────
  const allPass = r.bids.length === 4 && r.bids.every(b => b === 0);
  for (let i = 0; i < r.bids.length; i++) {
    const state = game.getGameState();
    if (state.gameStage !== 'bidding' || state.currentPlayer === null) {
      errors.push(`bid ${i}: engine not in bidding stage (stage=${state.gameStage})`);
      return { valid: false, errors, books: null };
    }
    const bidder = state.currentPlayer;
    const amount = r.bids[i] === 'T' ? -1 : (r.bids[i] as number);
    if (!game.placeBid(bidder, amount)) {
      errors.push(`bid ${i}: player ${bidder} bid "${r.bids[i]}" rejected by engine`);
      return { valid: false, errors, books: null };
    }
  }

  if (allPass) {
    // Everyone passed: the engine redeals (fresh bidding round, no bids).
    const state = game.getGameState();
    const bidState = game.getBiddingState();
    if (state.gameStage !== 'bidding' || bidState.bids.length !== 0) {
      errors.push(`all-pass: engine did not redeal (stage=${state.gameStage}, bids=${bidState.bids.length})`);
    }
    if (r.call !== null) errors.push('all-pass: record has a trump call');
    return { valid: errors.length === 0, errors, books: null };
  }

  if (r.call === null) {
    // Record ends during/after bidding with no call — nothing more to replay.
    return { valid: errors.length === 0, errors, books: null };
  }

  // ── Trump call ────────────────────────────────────────────────────
  let state = game.getGameState();
  if (state.gameStage !== 'trumpSelection') {
    errors.push(`trump call: engine not in trumpSelection stage (stage=${state.gameStage})`);
    return { valid: false, errors, books: null };
  }
  const declarer = game.getDeclarer();
  if (declarer === null) {
    errors.push('trump call: engine has no declarer');
    return { valid: false, errors, books: null };
  }
  if (!game.setTrumpSuitForPlayer(r.call.suit, r.call.direction as any, true)) {
    errors.push(`trump call: "${r.call.suit} ${r.call.direction}" rejected by engine`);
    return { valid: false, errors, books: null };
  }

  // ── Discards ──────────────────────────────────────────────────────
  if (!game.discardCardsForPlayer(declarer, r.discards)) {
    errors.push(`discards: [${r.discards.join(', ')}] rejected by engine for declarer ${declarer}`);
    return { valid: false, errors, books: null };
  }

  // ── Plays (table order; current player comes from the engine) ─────
  for (let i = 0; i < r.plays.length; i++) {
    state = game.getGameState();
    if (state.gameStage !== 'play' || state.currentPlayer === null) {
      errors.push(`play ${i}: engine not in play stage (stage=${state.gameStage})`);
      return { valid: false, errors, books: null };
    }
    const player = state.currentPlayer;
    const card = game.getPlayer(player)!.hand.find(c => c.id === r.plays[i]);
    if (!card) {
      errors.push(`play ${i}: card ${r.plays[i]} not in player ${player}'s hand`);
      return { valid: false, errors, books: null };
    }
    if (!game.isValidMove(player, card)) {
      errors.push(`play ${i}: card ${r.plays[i]} is not a legal play for player ${player}`);
      return { valid: false, errors, books: null };
    }
    const move = game.playCard(player, card);
    if (!move.isValid) {
      errors.push(`play ${i}: card ${r.plays[i]} rejected by engine (${move.errorMessage ?? 'no message'})`);
      return { valid: false, errors, books: null };
    }
  }

  let books: [number, number] | null = null;
  if (r.plays.length === 48) {
    const b = game.getBooksWon();
    books = [b[0], b[1]];
  }
  return { valid: errors.length === 0, errors, books };
}
