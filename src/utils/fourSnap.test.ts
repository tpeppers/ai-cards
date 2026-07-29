import {
  buildFourSnapCompletionPayload,
  cardProgressPercent,
  cardToDetectedString,
  detectedStringToCard,
  duplicateCardsAcrossSnaps,
  extractDetectionCards,
  inferExpectedCardCount,
  normalizeDetectedCardString,
  uniqueDetectedCards,
} from './fourSnap';

describe('Four-Snap Table card helpers', () => {
  test('normalizes detector strings, suit names, and alpha letters', () => {
    expect(normalizeDetectedCardString('ah')).toBe('Ah');
    expect(normalizeDetectedCardString('10_of_hearts')).toBe('10h');
    expect(normalizeDetectedCardString('Q-spades')).toBeNull();
    expect(normalizeDetectedCardString('a')).toBe('Ah');
    expect(normalizeDetectedCardString('n')).toBe('As');
    expect(normalizeDetectedCardString('A')).toBe('Ac');
    expect(normalizeDetectedCardString('N')).toBe('Ad');
  });

  test('extracts and deduplicates mixed API card shapes', () => {
    expect(extractDetectionCards({
      detectedCards: [
        'Ah',
        'ah',
        { rank_name: '10', suit: 'spades' },
        { name: 'Qc' },
        { alpha: 'Z' },
      ],
    })).toEqual(['Ah', '10s', 'Qc', 'Kd']);

    expect(uniqueDetectedCards(['2h', '2H', '3s'])).toEqual(['2h', '3s']);
  });

  test('infers expected count and clamps progress', () => {
    expect(inferExpectedCardCount(12)).toBe(12);
    expect(inferExpectedCardCount(13)).toBe(16);
    expect(cardProgressPercent(10, 12)).toBe(83);
    expect(cardProgressPercent(18, 16)).toBe(100);
  });

  test('finds cards already accepted in earlier snaps', () => {
    expect(duplicateCardsAcrossSnaps(
      ['Ah', '2s', '3c'],
      [{ cards: ['Kd', 'AH'] }, { cards: ['2s'] }],
    )).toEqual(['Ah', '2s']);
  });

  test('round-trips between detector strings and Card objects', () => {
    const card = detectedStringToCard('Jd');
    expect(card).toEqual({ suit: 'diamonds', rank: 11, id: 'diamonds_11' });
    expect(cardToDetectedString(card!)).toBe('Jd');
  });

  test('splits a 16-card snap into 12 hand cards and four kitty cards', () => {
    const cards = [
      'Ah', '2h', '3h', '4h', '5h', '6h', '7h', '8h',
      '9h', '10h', 'Jh', 'Qh', 'Kh', 'As', '2s', '3s',
    ];
    expect(buildFourSnapCompletionPayload([{
      seat: 'bid2',
      cards,
      kittyCards: ['Kh', 'As', '2s', '3s'],
    }])).toEqual({
      snaps: [{
        seat: 'bid2',
        cards: cards.slice(0, 12),
        kittyCards: ['Kh', 'As', '2s', '3s'],
      }],
    });
  });
});
