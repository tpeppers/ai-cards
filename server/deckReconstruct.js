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
 * Reconstruct the 52-character deck URL from seat submissions.
 *
 * Options:
 *   allowPartial: when true, missing seats fill their positions with '_'
 *                 instead of returning a "Missing seat" error. Used by
 *                 the New Hand button to archive incomplete rounds.
 *
 * Returns { url, errors, seatsProvided }. On success url is the 52-char
 * string; on failure url is null and errors is populated.
 */
function reconstructDeck(seatSubmissions, options = {}) {
  const { allowPartial = false } = options;
  const errors = [];

  const seatsProvided = Object.keys(seatSubmissions);
  for (const seat of seatsProvided) {
    if (!VALID_SEATS.includes(seat)) {
      errors.push(`Unknown seat: ${seat}`);
    }
  }
  if (!allowPartial) {
    for (const seat of VALID_SEATS) {
      if (!seatsProvided.includes(seat)) {
        errors.push(`Missing seat: ${seat}`);
      }
    }
  }
  if (errors.length > 0) return { url: null, errors, seatsProvided: [] };

  // Dedup per provided seat. Missing seats in partial mode are skipped.
  const perSeatLetters = {};
  const seatsActuallyFilled = [];
  for (const seat of VALID_SEATS) {
    if (!seatSubmissions[seat]) {
      if (allowPartial) continue;
    }
    try {
      perSeatLetters[seat] = dedupAndValidateSeat(seat, seatSubmissions[seat]);
      seatsActuallyFilled.push(seat);
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (errors.length > 0) return { url: null, errors, seatsProvided: seatsActuallyFilled };

  // Check for cross-seat duplicates among the seats we DO have
  const seen = new Map(); // letter → seat
  for (const seat of seatsActuallyFilled) {
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
  if (!allowPartial && seen.size !== 48 && errors.length === 0) {
    errors.push(`Total unique cards across 4 seats = ${seen.size}; expected 48`);
  }
  if (errors.length > 0) return { url: null, errors, seatsProvided: seatsActuallyFilled };

  // Consumers per seat (sorted for deterministic placement).
  const consumers = {};
  for (const seat of seatsActuallyFilled) {
    consumers[seat] = Array.from(perSeatLetters[seat]).sort();
  }

  // Fill the 48 dealt positions. Missing seats leave '_' wherever their
  // player-index slots fall. Kitty (positions 48-51) is always '_'.
  const chars = new Array(52);
  for (let i = 0; i < 48; i++) {
    const playerIdx = i % 4;
    const seat = VALID_SEATS.find(s => SEAT_TO_PLAYER_INDEX[s] === playerIdx);
    if (seatsActuallyFilled.includes(seat)) {
      chars[i] = consumers[seat].shift();
    } else {
      chars[i] = '_';
    }
  }
  chars[48] = '_';
  chars[49] = '_';
  chars[50] = '_';
  chars[51] = '_';

  return { url: chars.join(''), errors: [], seatsProvided: seatsActuallyFilled };
}

module.exports = {
  cardStringToLetter,
  normalizeCard,
  dedupAndValidateSeat,
  reconstructDeck,
  VALID_SEATS,
  SEAT_TO_PLAYER_INDEX,
};
