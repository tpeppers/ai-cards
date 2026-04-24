/**
 * Reconstructs a 52-character Bid Whist deck URL from 4 per-seat card
 * lists. Used by the Game Mode upload flow: after 4 players upload
 * photos of their dealt hands (tagged by seat), this produces the
 * canonical URL string for that game.
 *
 * Convention (per user confirmation):
 *   - Dealer anchors at player index 0 (URL positions 0,4,8,...,44)
 *   - 1st bidder → player index 1 (positions 1,5,9,...,45)
 *   - 2nd bidder → player index 2 (positions 2,6,10,...,46)
 *   - 3rd bidder → player index 3 (positions 3,7,11,...,47)
 *   - Kitty (positions 48-51) filled with `_` (random placeholder)
 *
 * Cards are matched against the 52-character URL alphabet:
 *   a-m hearts (rank 1-13), n-z spades, A-M clubs, N-Z diamonds.
 *
 * Input card format follows the ML recognizer output ("Kh", "Ac",
 * "10s", etc.) — case-insensitive rank + single-letter suit.
 */

// Rank normalization
function rankLetter(rankStr) {
  const r = String(rankStr).toUpperCase();
  if (r === 'A') return 1;
  if (r === 'J') return 11;
  if (r === 'Q') return 12;
  if (r === 'K') return 13;
  const n = parseInt(r, 10);
  if (!Number.isNaN(n) && n >= 2 && n <= 10) return n;
  throw new Error(`Invalid rank: ${rankStr}`);
}

function cardStringToLetter(cardStr) {
  if (!cardStr || typeof cardStr !== 'string') throw new Error(`Invalid card: ${cardStr}`);
  const suitChar = cardStr.slice(-1).toLowerCase();
  const rankStr = cardStr.slice(0, -1);
  const rank = rankLetter(rankStr);
  // Suit → letter base: hearts='a', spades='n', clubs='A', diamonds='N'
  if (suitChar === 'h') return String.fromCharCode('a'.charCodeAt(0) + rank - 1);
  if (suitChar === 's') return String.fromCharCode('n'.charCodeAt(0) + rank - 1);
  if (suitChar === 'c') return String.fromCharCode('A'.charCodeAt(0) + rank - 1);
  if (suitChar === 'd') return String.fromCharCode('N'.charCodeAt(0) + rank - 1);
  throw new Error(`Invalid suit: ${suitChar} in ${cardStr}`);
}

function normalizeCard(cardStr) {
  // Return the canonical URL letter for this card — used as the dedup key.
  return cardStringToLetter(cardStr);
}

const SEAT_TO_PLAYER_INDEX = {
  dealer: 0,
  bid1: 1,
  bid2: 2,
  bid3: 3,
};

const VALID_SEATS = Object.keys(SEAT_TO_PLAYER_INDEX);

/**
 * Dedup a single seat's card list, returning the set of URL letters
 * for that player's 12 cards. Throws if the seat has more or fewer
 * than 12 unique cards detected.
 */
function dedupAndValidateSeat(seat, detectedCards) {
  if (!SEAT_TO_PLAYER_INDEX.hasOwnProperty(seat)) {
    throw new Error(`Invalid seat: ${seat}. Must be one of ${VALID_SEATS.join(', ')}`);
  }
  const letters = new Set();
  for (const c of detectedCards) {
    letters.add(normalizeCard(c));
  }
  if (letters.size !== 12) {
    throw new Error(
      `Seat ${seat} has ${letters.size} unique cards after dedup; expected exactly 12. ` +
      `Detected: ${detectedCards.join(', ')}`,
    );
  }
  return letters;
}

/**
 * Reconstruct the 52-character deck URL from 4 seat submissions.
 * Returns an object with { url, errors } — url is the 52-char string
 * on success (48 dealt chars + "____" kitty), or null if reconstruction
 * failed; errors is a list of validation error messages.
 */
function reconstructDeck(seatSubmissions) {
  const errors = [];

  // Require exactly 4 seats, one of each
  const seatsProvided = Object.keys(seatSubmissions);
  for (const seat of VALID_SEATS) {
    if (!seatsProvided.includes(seat)) {
      errors.push(`Missing seat: ${seat}`);
    }
  }
  for (const seat of seatsProvided) {
    if (!VALID_SEATS.includes(seat)) {
      errors.push(`Unknown seat: ${seat}`);
    }
  }
  if (errors.length > 0) return { url: null, errors };

  // Dedup per seat
  const perSeatLetters = {};
  for (const seat of VALID_SEATS) {
    try {
      perSeatLetters[seat] = dedupAndValidateSeat(seat, seatSubmissions[seat]);
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (errors.length > 0) return { url: null, errors };

  // Check for cross-seat duplicates — a card can only be in one hand
  const seen = new Map(); // letter → seat
  for (const seat of VALID_SEATS) {
    for (const letter of perSeatLetters[seat]) {
      if (seen.has(letter)) {
        errors.push(
          `Card ${letter} appears in both ${seen.get(letter)} and ${seat}`,
        );
      } else {
        seen.set(letter, seat);
      }
    }
  }
  // Total count check
  if (seen.size !== 48 && errors.length === 0) {
    errors.push(`Total unique cards across 4 seats = ${seen.size}; expected 48`);
  }
  if (errors.length > 0) return { url: null, errors };

  // Build URL: position i → player i%4 → seat with player index (i%4)
  // Convert each seat's set to a sorted list so placement is deterministic
  // (the sort uses URL-letter ascending; any stable order works since the
  // engine re-sorts cards per player by rank on deal).
  const perSeatSorted = {};
  for (const seat of VALID_SEATS) {
    perSeatSorted[seat] = Array.from(perSeatLetters[seat]).sort();
  }
  // Consumers per seat — we'll pop from the sorted list as positions fill
  const consumers = {};
  for (const seat of VALID_SEATS) consumers[seat] = [...perSeatSorted[seat]];

  const chars = new Array(52);
  for (let i = 0; i < 48; i++) {
    const playerIdx = i % 4;
    const seat = VALID_SEATS.find(s => SEAT_TO_PLAYER_INDEX[s] === playerIdx);
    chars[i] = consumers[seat].shift();
  }
  // Kitty = 4 random placeholders (the 4 cards not detected from anyone's
  // hand). The URL decoder treats `_` as "random, picked at deal time".
  chars[48] = '_';
  chars[49] = '_';
  chars[50] = '_';
  chars[51] = '_';

  return { url: chars.join(''), errors: [] };
}

module.exports = {
  cardStringToLetter,
  normalizeCard,
  dedupAndValidateSeat,
  reconstructDeck,
  VALID_SEATS,
  SEAT_TO_PLAYER_INDEX,
};
