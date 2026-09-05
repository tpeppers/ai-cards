/**
 * Blind per-player hand seeds.
 *
 * BidWhistGame deals a 52-card deck round-robin: index i goes to seat i % 4,
 * so seat s holds indices s, s+4, ... s+44 (12 cards) and indices 48-51 are
 * the kitty. Masking everything except a seat's own indices yields the
 * "A___B___C___..." shape — and because '_' already means "fill randomly" in
 * BidWhistGame.rigDeck(), a masked seed is directly replayable as
 * "my hand, everyone else random".
 */

const DECK_SIZE = 52;
const HAND_SIZE = 12;
const SEATS = 4;
const KITTY_START = 48;

/** Deck indices dealt to a seat, in deal order. */
function seatIndices(seat) {
  const out = [];
  for (let i = seat; i < KITTY_START; i += SEATS) out.push(i);
  return out;
}

/**
 * Mask a 52-char deck string down to what one seat is allowed to see.
 *
 * Everything outside the seat's own 12 indices becomes '_', including the
 * four kitty slots — the kitty is not public until it is won.
 */
function maskDeckForSeat(deck, seat) {
  if (typeof deck !== 'string' || deck.length !== DECK_SIZE) {
    throw new Error(`maskDeckForSeat: expected a ${DECK_SIZE}-char deck, got ${deck && deck.length}`);
  }
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) {
    throw new Error(`maskDeckForSeat: seat must be 0-${SEATS - 1}, got ${seat}`);
  }

  const chars = new Array(DECK_SIZE).fill('_');
  for (const i of seatIndices(seat)) chars[i] = deck[i];
  return chars.join('');
}

/**
 * The post-game seed: the full deck plus the encoded playout, so a player can
 * paste either into the replay page.
 *
 * @param {string} deck    52-char deck actually dealt
 * @param {string|null} encodedRecord  BWR1 string, or null for an all-pass hand
 */
function buildPostgameSeed(deck, encodedRecord) {
  return {
    deal: deck,
    record: encodedRecord || null,
  };
}

module.exports = {
  DECK_SIZE,
  HAND_SIZE,
  SEATS,
  KITTY_START,
  seatIndices,
  maskDeckForSeat,
  buildPostgameSeed,
};
