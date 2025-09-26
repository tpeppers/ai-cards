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
  T: 'diamonds', U: 'diamonds', V: 'diamonds', W: 'diamonds', X: 'diamonds', Y: 'diamonds', Z: 'diamonds',
  // Special: Random, the card will be determined at deal-time, randomly.
  _: 'random'
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
  } else if (letter == '_')  {
    rank = '_';
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
    
    // Ensure no duplicate non-random cards
    if (card.id != 'random__' && usedCards.has(card.id)) {
      console.log(`Dupe card throw, card id was: ${card.id}`);
      throw new Error(`Duplicate card found: ${card.id}`);
    }
    usedCards.add(card.id);
    
    cards.push(card);
  }
  
  
  var randomCount = (urlString.match(new RegExp("_", "g")) || []).length;
  // RandomCount is set to -1 if > 0 because there's an extra card 
  // (the "random" card, looks like card.id === 'random__')
  if(randomCount > 0) { 
    randomCount = randomCount - 1;
  }
  // Validate we have exactly 52 unique cards,
  if (cards.length !== 52 || (usedCards.size + randomCount !== 52)) {
    console.log("Not 52 unique card throw");
    throw new Error('Invalid deck: must contain exactly 52 unique cards');
  }
  
  return cards;
};

/*** 
 * To reduce the complexity when thinking/discussing hands, it's useful to have a canonical suit order,
 * e.g., a hand of all spades or all hearts (in whist) are of equivalent strength (perfect), 
 * so there's no need to differentiate. 
 * 
 * The same goes for any set of suits, really (e.g., all hearts and one spade).
 */
export const handToCanonicalString = (handString) => {
  const nonRandomHandString = handString.split("_").join("");
  if(nonRandomHandString.length > 16) {
    throw new Error('handToCanonical is only meant for up to 16 non-random cards, so far.')
  }

  let heartsStart = [];
  let spadesStart = [];
  let clubsStart = [];
  let diamondsStart = [];


  for(let i = 0; i < handString.length; i = i + 1) {
    let theCard = letterToCard(handString[i]);
    let theSuit = theCard.suit;
    switch (theSuit) {
      case 'hearts':
        heartsStart.push(theCard);
        break;
      case 'spades':
        spadesStart.push(theCard);
        break;
      case 'clubs':
        clubsStart.push(theCard);
        break;
      case 'diamonds':
        diamondsStart.push(theCard);
        break;
      default:
        // intentionally left blank "_"/randoms aren't counted
        break;
    }
  }

  let newCanonicalHandString = "";

  // Canonical suit ordering is alphabetical:
  // clubs, diamonds, hearts, spades

  // Sort cards within each suit by rank
  clubsStart.sort((a, b) => a.rank - b.rank);
  diamondsStart.sort((a, b) => a.rank - b.rank);
  heartsStart.sort((a, b) => a.rank - b.rank);
  spadesStart.sort((a, b) => a.rank - b.rank);

  // Sort suits by count (descending) to determine canonical mapping
  const suitGroups = [
    { suit: 'clubs', cards: clubsStart, canonicalSuit: 'clubs' },
    { suit: 'diamonds', cards: diamondsStart, canonicalSuit: 'diamonds' },
    { suit: 'hearts', cards: heartsStart, canonicalSuit: 'hearts' },
    { suit: 'spades', cards: spadesStart, canonicalSuit: 'spades' }
  ].sort((a, b) => b.cards.length - a.cards.length);

  // Map suits to canonical suits based on frequency
  // Most frequent suit becomes clubs, second becomes diamonds, etc.
  const canonicalSuits = ['clubs', 'diamonds', 'hearts', 'spades'];
  suitGroups.forEach((group, index) => {
    if (index < canonicalSuits.length && group.cards.length > 0) {
      group.canonicalSuit = canonicalSuits[index];
    }
  });

  // Convert all cards to their canonical representation
  const allCanonicalCards = [];
  suitGroups.forEach(group => {
    group.cards.forEach(card => {
      const canonicalCard = {
        suit: group.canonicalSuit,
        rank: card.rank,
        id: `${group.canonicalSuit}_${card.rank}`
      };
      allCanonicalCards.push(canonicalCard);
    });
  });

  // Sort all cards by suit priority (clubs, diamonds, hearts, spades) then by rank
  allCanonicalCards.sort((a, b) => {
    const suitOrder = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };
    const suitCompare = suitOrder[a.suit] - suitOrder[b.suit];
    if (suitCompare !== 0) return suitCompare;
    return a.rank - b.rank;
  });

  // Convert cards back to their letter representation
  newCanonicalHandString = allCanonicalCards.map(card => cardToLetter(card)).join('');

  return newCanonicalHandString;
}

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