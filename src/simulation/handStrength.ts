import { Card } from '../types/CardGame.ts';
import { InterestingGame } from './types.ts';
import { BidWhistSimulator } from './BidWhistSimulator.ts';
import { letterToCard } from '../urlGameState.js';

// ── Types ──────────────────────────────────────────────────────────

export interface GameHandStrength {
  preBid: [number, number, number, number];       // S, E, N, W
  preBidRanking: string;                           // e.g. "NEWS"
  postTrumpA: [number, number, number, number];    // under config A's call
  postTrumpARanking: string;
  postTrumpB: [number, number, number, number];    // under config B's call
  postTrumpBRanking: string;
}

// ── Rank Position Mappers ──────────────────────────────────────────
// rank: 1=Ace, 2-10, 11=Jack, 12=Queen, 13=King

function uptownPosition(rank: number): number {
  // Uptown: A(0), K(1), Q(2), J(3), 10(4), 9(5), 8(6), 7(7), 6(8), 5(9), 4(10), 3(11), 2(12)
  // rank 1=Ace → pos 0, rank 13=King → pos 1, rank 12=Queen → pos 2, etc.
  if (rank === 1) return 0; // Ace is best
  // rank 13(K)→1, 12(Q)→2, 11(J)→3, 10→4, 9→5, 8→6, 7→7, 6→8, 5→9, 4→10, 3→11, 2→12
  return 14 - rank;
}

function downtownPosition(rank: number): number {
  // Downtown (aces good): A(0), 2(1), 3(2), 4(3), ..., K(12)
  if (rank === 1) return 0; // Ace is best
  return rank - 1; // 2→1, 3→2, ..., 13(K)→12
}

function downtownNoAcesPosition(rank: number): number {
  // Downtown (no aces): 2(0), 3(1), ..., K(11), A(12)
  if (rank === 1) return 12; // Ace is worst
  return rank - 2; // 2→0, 3→1, ..., 13(K)→11
}

// ── Card Value Functions ───────────────────────────────────────────

export function preBidCardValue(rank: number): number {
  // Direction-agnostic: take the better of uptown/downtown potential
  const upVal = Math.max(0, 1.0 - uptownPosition(rank) * 0.15);
  const downVal = Math.max(0, 1.0 - downtownPosition(rank) * 0.15);
  return Math.max(upVal, downVal);
}

export function postTrumpCardValue(rank: number, isTrump: boolean, direction: string): number {
  let position: number;
  if (direction === 'uptown') {
    position = uptownPosition(rank);
  } else if (direction === 'downtown') {
    position = downtownPosition(rank);
  } else {
    position = downtownNoAcesPosition(rank);
  }

  if (isTrump) {
    return Math.max(0, 1.0 - position * 0.10); // wider positive range for trump
  } else {
    return Math.max(0, 1.0 - position * 0.20); // only top ~5 non-trump cards score
  }
}

// ── Hand Extraction ────────────────────────────────────────────────

export function extractPlayerHand(rotatedUrl: string, playerIndex: number): Card[] {
  const cards: Card[] = [];
  // Round-robin dealing: card i goes to player i % 4
  // Player P gets indices P, P+4, P+8, ..., P+44 (12 cards total)
  for (let i = playerIndex; i < 48; i += 4) {
    cards.push(letterToCard(rotatedUrl[i]));
  }
  return cards;
}

// ── Strength Computation ───────────────────────────────────────────

export function computePreBidStrength(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + preBidCardValue(card.rank), 0);
}

export function computePostTrumpStrength(cards: Card[], trumpSuit: string, direction: string): number {
  return cards.reduce((sum, card) => {
    const isTrump = card.suit === trumpSuit;
    return sum + postTrumpCardValue(card.rank, isTrump, direction);
  }, 0);
}

// ── Ranking ────────────────────────────────────────────────────────

const PLAYER_LABELS = ['S', 'E', 'N', 'W'];

export function buildRanking(strengths: [number, number, number, number]): string {
  const indexed = strengths.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => b.s - a.s);
  return indexed.map(x => PLAYER_LABELS[x.i]).join('');
}

// ── Main Entry Point ───────────────────────────────────────────────

export function computeAllHandStrengths(interestingGames: InterestingGame[]): GameHandStrength[] {
  return interestingGames.map(game => {
    const rotatedUrl = BidWhistSimulator.rotateDeck(game.deckUrl, game.rotation);

    // Extract all 4 player hands
    const hands = [0, 1, 2, 3].map(p => extractPlayerHand(rotatedUrl, p));

    // Pre-bid strengths (direction-agnostic)
    const preBid: [number, number, number, number] = [
      computePreBidStrength(hands[0]),
      computePreBidStrength(hands[1]),
      computePreBidStrength(hands[2]),
      computePreBidStrength(hands[3]),
    ];
    const preBidRanking = buildRanking(preBid);

    // Post-trump for config A
    const handA = game.configAResult.hands[0];
    let postTrumpA: [number, number, number, number] = [0, 0, 0, 0];
    let postTrumpARanking = '—';
    if (handA && handA.trumpSuit && handA.direction) {
      postTrumpA = [
        computePostTrumpStrength(hands[0], handA.trumpSuit, handA.direction),
        computePostTrumpStrength(hands[1], handA.trumpSuit, handA.direction),
        computePostTrumpStrength(hands[2], handA.trumpSuit, handA.direction),
        computePostTrumpStrength(hands[3], handA.trumpSuit, handA.direction),
      ];
      postTrumpARanking = buildRanking(postTrumpA);
    }

    // Post-trump for config B
    const handB = game.configBResult.hands[0];
    let postTrumpB: [number, number, number, number] = [0, 0, 0, 0];
    let postTrumpBRanking = '—';
    if (handB && handB.trumpSuit && handB.direction) {
      postTrumpB = [
        computePostTrumpStrength(hands[0], handB.trumpSuit, handB.direction),
        computePostTrumpStrength(hands[1], handB.trumpSuit, handB.direction),
        computePostTrumpStrength(hands[2], handB.trumpSuit, handB.direction),
        computePostTrumpStrength(hands[3], handB.trumpSuit, handB.direction),
      ];
      postTrumpBRanking = buildRanking(postTrumpB);
    }

    return { preBid, preBidRanking, postTrumpA, postTrumpARanking, postTrumpB, postTrumpBRanking };
  });
}
