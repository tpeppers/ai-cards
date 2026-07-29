import { Card } from '../types/CardGame';

export type ExpectedCardCount = 12 | 16;

export const FOUR_SNAP_SEATS = ['dealer', 'bid1', 'bid2', 'bid3'] as const;

export const FOUR_SNAP_ROLE_LABELS = [
  'Dealer',
  '1st bidder',
  '2nd bidder',
  '3rd bidder',
] as const;

const SUIT_CHAR_TO_NAME: Record<string, string> = {
  h: 'hearts',
  s: 'spades',
  c: 'clubs',
  d: 'diamonds',
};

const SUIT_NAME_TO_CHAR: Record<string, string> = {
  hearts: 'h',
  spades: 's',
  clubs: 'c',
  diamonds: 'd',
};

const rankName = (rank: number): string => {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
};

const alphaToDetectedString = (alpha: string): string | null => {
  if (!/^[a-zA-Z]$/.test(alpha)) return null;

  const code = alpha.charCodeAt(0);
  if (code >= 97 && code <= 109) return `${rankName(code - 96)}h`;
  if (code >= 110 && code <= 122) return `${rankName(code - 109)}s`;
  if (code >= 65 && code <= 77) return `${rankName(code - 64)}c`;
  if (code >= 78 && code <= 90) return `${rankName(code - 77)}d`;
  return null;
};

export const normalizeDetectedCardString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (/^[a-zA-Z]$/.test(trimmed)) {
    return alphaToDetectedString(trimmed);
  }

  const compact = trimmed
    .replace(/\s+/g, '')
    .replace(/(?:_of_|-of-)/i, '');
  const match = compact.match(/^(A|[2-9]|10|J|Q|K)(h|s|c|d|hearts?|spades?|clubs?|diamonds?)$/i);
  if (!match) return null;

  const suitText = match[2].toLowerCase();
  const suitChar = suitText.length === 1
    ? suitText
    : SUIT_NAME_TO_CHAR[suitText.endsWith('s') ? suitText : `${suitText}s`];
  if (!suitChar) return null;

  return `${match[1].toUpperCase()}${suitChar}`;
};

const normalizeApiCard = (value: unknown): string | null => {
  if (typeof value === 'string') return normalizeDetectedCardString(value);
  if (!value || typeof value !== 'object') return null;

  const card = value as Record<string, unknown>;
  for (const key of ['name', 'card', 'label']) {
    const normalized = normalizeDetectedCardString(card[key]);
    if (normalized) return normalized;
  }

  if (typeof card.alpha === 'string') {
    const normalized = alphaToDetectedString(card.alpha);
    if (normalized) return normalized;
  }

  const suitText = typeof card.suit === 'string' ? card.suit.toLowerCase() : '';
  const suitChar = suitText.length === 1
    ? suitText
    : SUIT_NAME_TO_CHAR[suitText.endsWith('s') ? suitText : `${suitText}s`];
  const rankValue = card.rank_name ?? card.rankName ?? card.rank;
  const rank = typeof rankValue === 'number'
    ? rankName(rankValue)
    : typeof rankValue === 'string'
      ? rankValue.toUpperCase()
      : '';

  return normalizeDetectedCardString(`${rank}${suitChar ?? ''}`);
};

export const uniqueDetectedCards = (values: unknown[]): string[] => {
  const seen = new Set<string>();
  const cards: string[] = [];

  for (const value of values) {
    const normalized = normalizeApiCard(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      cards.push(normalized);
    }
  }

  return cards;
};

export const extractDetectionCards = (payload: unknown): string[] => {
  if (!payload || typeof payload !== 'object') return [];

  const data = payload as Record<string, any>;
  const candidates = [
    data.cards,
    data.detectedCards,
    data.detections,
    data.result?.cards,
    data.result?.detectedCards,
    data.best?.cards,
    data.best?.detectedCards,
  ];
  const values = candidates.find(value => Array.isArray(value) && value.length > 0)
    ?? candidates.find(Array.isArray);
  return values ? uniqueDetectedCards(values) : [];
};

export const inferExpectedCardCount = (found: number): ExpectedCardCount =>
  found > 12 ? 16 : 12;

export const cardProgressPercent = (
  found: number,
  expected: ExpectedCardCount,
): number => Math.min(100, Math.round((Math.max(0, found) / expected) * 100));

export const duplicateCardsAcrossSnaps = (
  candidate: string[],
  previousSnaps: Array<{ cards: string[] }>,
): string[] => {
  const previous = new Set(uniqueDetectedCards(previousSnaps.flatMap(snap => snap.cards)));
  return uniqueDetectedCards(candidate).filter(card => previous.has(card));
};

export const detectedStringToCard = (value: string): Card | null => {
  const normalized = normalizeDetectedCardString(value);
  if (!normalized) return null;

  const suit = SUIT_CHAR_TO_NAME[normalized.slice(-1)];
  const rankText = normalized.slice(0, -1);
  const rank = rankText === 'A' ? 1
    : rankText === 'J' ? 11
    : rankText === 'Q' ? 12
    : rankText === 'K' ? 13
    : Number(rankText);
  if (!suit || !Number.isInteger(rank) || rank < 1 || rank > 13) return null;

  return { suit, rank, id: `${suit}_${rank}` };
};

export const cardToDetectedString = (card: Card): string => {
  const suit = SUIT_NAME_TO_CHAR[card.suit];
  if (!suit) throw new Error(`Unknown suit: ${card.suit}`);
  return `${rankName(card.rank)}${suit}`;
};

export interface FourSnapCompletionInput {
  seat: typeof FOUR_SNAP_SEATS[number];
  cards: string[];
  kittyCards: string[];
}

export const buildFourSnapCompletionPayload = (snaps: FourSnapCompletionInput[]) => ({
  snaps: snaps.map(snap => {
    const kittySet = new Set(uniqueDetectedCards(snap.kittyCards));
    return {
      seat: snap.seat,
      cards: uniqueDetectedCards(snap.cards).filter(card => !kittySet.has(card)),
      ...(kittySet.size > 0 ? { kittyCards: Array.from(kittySet) } : {}),
    };
  }),
});
