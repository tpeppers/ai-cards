/**
 * Room codes for Jackbox-style matchmaking.
 *
 * There is no create/join distinction: everyone types the same phrase and
 * lands at the same table, so two people typing "baggle bytes" and
 * "Baggle  Bytes" have to resolve to one room. normalizeRoomCode() produces
 * the map key; displayRoomCode() is what players see.
 */

const MAX_LENGTH = 20;
const VALID = /^[A-Z0-9 ]{1,20}$/;

/**
 * Canonical key for a room code: trimmed, inner whitespace collapsed to a
 * single space, upper-cased. Returns '' for anything unusable.
 */
function normalizeRoomCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Whether a normalized code is acceptable: 1-20 chars of A-Z, 0-9 and
 * spaces. Call this on the output of normalizeRoomCode().
 */
function isValidRoomCode(normalized) {
  return typeof normalized === 'string' && VALID.test(normalized);
}

/**
 * Normalize and validate in one step.
 * @returns {{ ok: true, code: string } | { ok: false, error: string }}
 */
function parseRoomCode(raw) {
  const code = normalizeRoomCode(raw);
  if (!code) {
    return { ok: false, error: 'Enter a room code' };
  }
  if (code.length > MAX_LENGTH) {
    return { ok: false, error: `Room codes are at most ${MAX_LENGTH} characters` };
  }
  if (!isValidRoomCode(code)) {
    return { ok: false, error: 'Room codes can use letters, numbers and spaces only' };
  }
  return { ok: true, code };
}

/** Title-ish form for display; the key stays upper-case. */
function displayRoomCode(normalized) {
  return normalized;
}

module.exports = {
  MAX_LENGTH,
  normalizeRoomCode,
  isValidRoomCode,
  parseRoomCode,
  displayRoomCode,
};
