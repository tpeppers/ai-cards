import { Card } from '../types/CardGame.ts';

// ── Types ──────────────────────────────────────────────────────────

export interface PercentileResult {
  offensiveStrength: number;
  offensivePercentile: number;    // 0-100, or -1 if hand has unknowns
  bestTrumpSuit: string;
  bestTrumpDirection: string;
  defensiveStrength: number;
  defensivePercentile: number;    // 0-100, or -1 if hand has unknowns
  knownCount: number;             // how many of the 12 cards are known
}

// ── Constants ──────────────────────────────────────────────────────

const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];
const DIRECTIONS = ['uptown', 'downtown', 'downtown-noaces'];
const SAMPLE_SIZE = 10000;

// ── Full deck ──────────────────────────────────────────────────────

function buildFullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ suit, rank, id: `${suit}_${rank}` });
    }
  }
  return deck;
}

// ── Random hand generation ─────────────────────────────────────────

function randomHand(deck: Card[]): Card[] {
  // Fisher-Yates partial shuffle: pick 12 cards
  const copy = [...deck];
  for (let i = copy.length - 1; i > copy.length - 13; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(copy.length - 12);
}

// ── Rank position helpers (lower = better) ─────────────────────────

function positionOf(rank: number, direction: string): number {
  if (direction === 'uptown') {
    // A(0), K(1), Q(2), J(3), 10(4), ..., 2(12)
    if (rank === 1) return 0;
    return 14 - rank;
  } else if (direction === 'downtown') {
    // A(0), 2(1), 3(2), ..., K(12)
    if (rank === 1) return 0;
    return rank - 1;
  } else {
    // downtown-noaces: 2(0), 3(1), ..., K(11), A(12)
    if (rank === 1) return 12;
    return rank - 2;
  }
}

// ── Threat-aware strength ──────────────────────────────────────────
// For each card, count how many opposing cards can beat it:
//   - Trump card:  only higher-positioned trumps NOT in the hand
//   - Non-trump:   all opposing trumps + higher same-suit cards NOT in hand
// Value per card = max(0, 1.0 − threats × THREAT_DECAY)
// A card with 0 threats is a guaranteed trick winner (value 1.0).

const THREAT_DECAY = 0.10;

function computeThreatAwareStrength(
  hand: Card[],
  trumpSuit: string,
  direction: string,
): number {
  const handIds = new Set(hand.map(c => c.id));
  let total = 0;

  for (const card of hand) {
    const isTrump = card.suit === trumpSuit;
    let threats = 0;
    const myPos = positionOf(card.rank, direction);

    if (isTrump) {
      // Only threatened by better-positioned trump cards not in our hand
      for (let r = 1; r <= 13; r++) {
        if (positionOf(r, direction) < myPos && !handIds.has(`${trumpSuit}_${r}`)) {
          threats++;
        }
      }
    } else {
      // Threatened by all opposing trump cards …
      for (let r = 1; r <= 13; r++) {
        if (!handIds.has(`${trumpSuit}_${r}`)) threats++;
      }
      // … plus better same-suit cards not in our hand
      for (let r = 1; r <= 13; r++) {
        if (r !== card.rank
            && positionOf(r, direction) < myPos
            && !handIds.has(`${card.suit}_${r}`)) {
          threats++;
        }
      }
    }

    total += Math.max(0, 1.0 - threats * THREAT_DECAY);
  }

  return total;
}

// ── Compute best offensive & average defensive for a hand ──────────

interface HandMetrics {
  offensive: number;
  defensive: number;
  bestSuit: string;
  bestDirection: string;
}

function computeHandMetrics(hand: Card[]): HandMetrics {
  // Filter out unknown cards (suit === 'random') before computing
  const knownCards = hand.filter(c => c.suit !== 'random');

  let bestStrength = -Infinity;
  let bestSuit = SUITS[0];
  let bestDirection = DIRECTIONS[0];
  let totalStrength = 0;
  let count = 0;

  for (const suit of SUITS) {
    for (const direction of DIRECTIONS) {
      const strength = computeThreatAwareStrength(knownCards, suit, direction);
      totalStrength += strength;
      count++;
      if (strength > bestStrength) {
        bestStrength = strength;
        bestSuit = suit;
        bestDirection = direction;
      }
    }
  }

  return {
    offensive: bestStrength,
    defensive: totalStrength / count,
    bestSuit,
    bestDirection,
  };
}

// ── Cached distribution ────────────────────────────────────────────

let offensiveDistribution: number[] | null = null;
let defensiveDistribution: number[] | null = null;

export function initPercentileDistribution(): void {
  if (offensiveDistribution) return; // already initialized

  const deck = buildFullDeck();
  const offValues: number[] = [];
  const defValues: number[] = [];

  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const hand = randomHand(deck);
    const metrics = computeHandMetrics(hand);
    offValues.push(metrics.offensive);
    defValues.push(metrics.defensive);
  }

  offValues.sort((a, b) => a - b);
  defValues.sort((a, b) => a - b);

  offensiveDistribution = offValues;
  defensiveDistribution = defValues;
}

// ── Percentile lookup ──────────────────────────────────────────────

function percentileOf(value: number, sortedDistribution: number[]): number {
  // Binary search for insertion point
  let lo = 0;
  let hi = sortedDistribution.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedDistribution[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sortedDistribution.length) * 100;
}

// ── Main API ───────────────────────────────────────────────────────

export function computePercentiles(hand: Card[]): PercentileResult {
  initPercentileDistribution();

  const knownCount = hand.filter(c => c.suit !== 'random').length;
  const metrics = computeHandMetrics(hand);

  // Percentiles are only meaningful when all 12 cards are known
  const hasUnknowns = knownCount < hand.length;
  const offPct = hasUnknowns ? -1 : percentileOf(metrics.offensive, offensiveDistribution!);
  const defPct = hasUnknowns ? -1 : percentileOf(metrics.defensive, defensiveDistribution!);

  return {
    offensiveStrength: metrics.offensive,
    offensivePercentile: offPct,
    bestTrumpSuit: metrics.bestSuit,
    bestTrumpDirection: metrics.bestDirection,
    defensiveStrength: metrics.defensive,
    defensivePercentile: defPct,
    knownCount,
  };
}
