import { 
  cardToLetter, 
  letterToCard, 
  encodeDeckToUrl, 
  decodeUrlToDeck,
  isValidDeckUrl,
  generateRandomDeckUrl 
} from './urlGameState.js';

describe('URL Game State', () => {
  test('cardToLetter converts cards correctly', () => {
    expect(cardToLetter({ suit: 'spades', rank: 1 })).toBe('a');
    expect(cardToLetter({ suit: 'spades', rank: 13 })).toBe('m');
    expect(cardToLetter({ suit: 'hearts', rank: 1 })).toBe('n');
    expect(cardToLetter({ suit: 'hearts', rank: 13 })).toBe('z');
    expect(cardToLetter({ suit: 'clubs', rank: 1 })).toBe('A');
    expect(cardToLetter({ suit: 'clubs', rank: 13 })).toBe('M');
    expect(cardToLetter({ suit: 'diamonds', rank: 1 })).toBe('N');
    expect(cardToLetter({ suit: 'diamonds', rank: 13 })).toBe('Z');
  });

  test('letterToCard converts letters correctly', () => {
    expect(letterToCard('a')).toEqual({ suit: 'spades', rank: 1, id: 'spades_1' });
    expect(letterToCard('m')).toEqual({ suit: 'spades', rank: 13, id: 'spades_13' });
    expect(letterToCard('n')).toEqual({ suit: 'hearts', rank: 1, id: 'hearts_1' });
    expect(letterToCard('z')).toEqual({ suit: 'hearts', rank: 13, id: 'hearts_13' });
    expect(letterToCard('A')).toEqual({ suit: 'clubs', rank: 1, id: 'clubs_1' });
    expect(letterToCard('M')).toEqual({ suit: 'clubs', rank: 13, id: 'clubs_13' });
    expect(letterToCard('N')).toEqual({ suit: 'diamonds', rank: 1, id: 'diamonds_1' });
    expect(letterToCard('Z')).toEqual({ suit: 'diamonds', rank: 13, id: 'diamonds_13' });
  });

  test('full deck encoding/decoding works', () => {
    // Create a standard deck
    const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
    const deck = [];
    
    suits.forEach(suit => {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({ suit, rank, id: `${suit}_${rank}` });
      }
    });

    const urlString = encodeDeckToUrl(deck);
    expect(urlString).toBe('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');
    
    const decodedDeck = decodeUrlToDeck(urlString);
    expect(decodedDeck).toEqual(deck);
  });

  test('validates deck URLs correctly', () => {
    // Valid double pangram
    expect(isValidDeckUrl('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(true);
    
    // Invalid - too short
    expect(isValidDeckUrl('abc')).toBe(false);
    
    // Invalid - duplicate letters
    expect(isValidDeckUrl('aabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXY')).toBe(false);
    
    // Invalid - wrong length
    expect(isValidDeckUrl('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123')).toBe(false);
  });

  test('generates valid random URLs', () => {
    const randomUrl = generateRandomDeckUrl();
    expect(randomUrl).toHaveLength(52);
    expect(isValidDeckUrl(randomUrl)).toBe(true);
  });

  test('ABCD represents Ace through 4 of Clubs', () => {
    const cards = 'ABCD'.split('').map(letterToCard);
    expect(cards).toEqual([
      { suit: 'clubs', rank: 1, id: 'clubs_1' },   // A = Ace of Clubs
      { suit: 'clubs', rank: 2, id: 'clubs_2' },   // B = 2 of Clubs  
      { suit: 'clubs', rank: 3, id: 'clubs_3' },   // C = 3 of Clubs
      { suit: 'clubs', rank: 4, id: 'clubs_4' }    // D = 4 of Clubs
    ]);
  });
});