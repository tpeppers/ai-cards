// URL-based game state management for Hearts
// Encoding schema: a-m=Spades(1-13), n-z=Hearts(1-13), A-M=Clubs(1-13), N-Z=Diamonds(1-13)

/**
 * Card encoding schema:
 * Spades: a-m (ranks 1-13)
 * Hearts: n-z (ranks 1-13) 
 * Clubs: A-M (ranks 1-13)
 * Diamonds: N-Z (ranks 1-13)
 */


const LETTER_TO_SUIT = {
  // Hearts: a-m
  a: 'hearts', b: 'hearts', c: 'hearts', d: 'hearts', e: 'hearts', f: 'hearts',
  g: 'hearts', h: 'hearts', i: 'hearts', j: 'hearts', k: 'hearts', l: 'hearts', m: 'hearts',
  // Spades: n-z
  n: 'spades', o: 'spades', p: 'spades', q: 'spades', r: 'spades', s: 'spades',
  t: 'spades', u: 'spades', v: 'spades', w: 'spades', x: 'spades', y: 'spades', z: 'spades',
  // Clubs: A-M
  A: 'clubs', B: 'clubs', C: 'clubs', D: 'clubs', E: 'clubs', F: 'clubs',
  G: 'clubs', H: 'clubs', I: 'clubs', J: 'clubs', K: 'clubs', L: 'clubs', M: 'clubs',
  // Diamonds: N-Z
  N: 'diamonds', O: 'diamonds', P: 'diamonds', Q: 'diamonds', R: 'diamonds', S: 'diamonds',
  T: 'diamonds', U: 'diamonds', V: 'diamonds', W: 'diamonds', X: 'diamonds', Y: 'diamonds', Z: 'diamonds'
};

/**
 * Converts a card to its letter representation
 * @param {Object} card - Card object with suit and rank properties
 * @returns {string} Single letter representing the card
 */
export const cardToLetter = (card) => {
  const { suit, rank } = card;
  
  switch (suit) {
    case 'hearts':
      return String.fromCharCode('a'.charCodeAt(0) + rank - 1);
    case 'spades':
      return String.fromCharCode('n'.charCodeAt(0) + rank - 1);
    case 'clubs':
      return String.fromCharCode('A'.charCodeAt(0) + rank - 1);
    case 'diamonds':
      return String.fromCharCode('N'.charCodeAt(0) + rank - 1);
    default:
      throw new Error(`Unknown suit: ${suit}`);
  }
};

/**
 * Converts a letter to its card representation
 * @param {string} letter - Single letter representing a card
 * @returns {Object} Card object with suit, rank, and id properties
 */
export const letterToCard = (letter) => {
  const suit = LETTER_TO_SUIT[letter];
  if (!suit) {
    throw new Error(`Invalid card letter: ${letter}`);
  }
  
  let rank;
  if (letter >= 'a' && letter <= 'm') {
    // Hearts: a-m
    rank = letter.charCodeAt(0) - 'a'.charCodeAt(0) + 1;
  } else if (letter >= 'n' && letter <= 'z') {
    // Spades: n-z
    rank = letter.charCodeAt(0) - 'n'.charCodeAt(0) + 1;
  } else if (letter >= 'A' && letter <= 'M') {
    // Clubs: A-M
    rank = letter.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
  } else if (letter >= 'N' && letter <= 'Z') {
    // Diamonds: N-Z
    rank = letter.charCodeAt(0) - 'N'.charCodeAt(0) + 1;
  } else {
    throw new Error(`Invalid card letter: ${letter}`);
  }
  
  return {
    suit,
    rank,
    id: `${suit}_${rank}`
  };
};

/**
 * Encodes a deck of cards to URL string
 * @param {Array} deck - Array of card objects
 * @returns {string} URL-encoded string representing the deck
 */
export const encodeDeckToUrl = (deck) => {
  if (deck.length !== 52) {
    throw new Error('Deck must contain exactly 52 cards');
  }
  
  return deck.map(card => cardToLetter(card)).join('');
};

/**
 * Decodes URL string to deck of cards
 * @param {string} urlString - URL string of 52 letters
 * @returns {Array} Array of card objects
 */
export const decodeUrlToDeck = (urlString) => {
  if (urlString.length !== 52) {
    throw new Error('URL string must contain exactly 52 characters');
  }
  
  const cards = [];
  const usedCards = new Set();
  
  for (let i = 0; i < urlString.length; i++) {
    const letter = urlString[i];
    const card = letterToCard(letter);
    
    // Ensure no duplicate cards
    if (usedCards.has(card.id)) {
      throw new Error(`Duplicate card found: ${card.id}`);
    }
    usedCards.add(card.id);
    
    cards.push(card);
  }
  
  // Validate we have exactly 52 unique cards
  if (cards.length !== 52 || usedCards.size !== 52) {
    throw new Error('Invalid deck: must contain exactly 52 unique cards');
  }
  
  return cards;
};

/**
 * Validates if a URL string represents a valid deck
 * @param {string} urlString - URL string to validate
 * @returns {boolean} True if valid, false otherwise
 */
export const isValidDeckUrl = (urlString) => {
  try {
    decodeUrlToDeck(urlString);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Gets the current game state from URL hash
 * @returns {string|null} URL string from hash or null if not present
 */
export const getGameStateFromUrl = () => {
  const hash = window.location.hash;
  if (hash.startsWith('#')) {
    return hash.substring(1);
  }
  return null;
};

/**
 * Updates URL hash with current game state
 * @param {string} gameState - URL string representing game state
 */
export const updateUrlWithGameState = (gameState) => {
  window.history.replaceState(null, '', `#${gameState}`);
};

/**
 * Generates a random valid deck URL for testing
 * @returns {string} Random valid deck URL
 */
export const generateRandomDeckUrl = () => {
  const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
  const deck = [];
  
  // Create a complete deck
  suits.forEach(suit => {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ suit, rank, id: `${suit}_${rank}` });
    }
  });
  
  // Shuffle the deck
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return encodeDeckToUrl(deck);
};

/**
 * Creates example URLs for testing
 * @returns {Object} Object containing example URLs
 */
export const getExampleUrls = () => {
  return {
    // Standard order: all spades (a-m), all hearts (n-z), all clubs (A-M), all diamonds (N-Z)
    standardOrder: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    
    // Random but valid deck
    random: generateRandomDeckUrl(),
    
    // Alternating suits (for testing distribution)
    alternating: 'aAnNbBoBcCpCdDqDeCrEfFsF...' // This would need to be completed
  };
};