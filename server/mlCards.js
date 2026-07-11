/**
 * Normalization for ML service card detections.
 *
 * The ML inference server returns card OBJECTS:
 *   { alpha, suit: 'hearts', rank, rank_name: 'A'|'2'..'10'|'J'|'Q'|'K',
 *     confidence, bbox }
 * but gameMode/deckReconstruct consume card STRINGS like '10h' / 'As'.
 * normalizeMlCards converts a mixed array to the string form:
 *   - strings pass through untouched
 *   - objects with rank_name + suit become `${rank_name}${suitInitial}`
 *     (hearts/spades/clubs/diamonds → h/s/c/d — all distinct)
 *   - anything else is dropped (no throw)
 */

function normalizeMlCards(cards) {
  if (!Array.isArray(cards)) return [];
  const out = [];
  for (const c of cards) {
    if (typeof c === 'string') {
      out.push(c);
      continue;
    }
    if (
      c && typeof c === 'object' &&
      typeof c.rank_name === 'string' && c.rank_name.length > 0 &&
      typeof c.suit === 'string' && c.suit.length > 0
    ) {
      out.push(`${c.rank_name}${c.suit.charAt(0).toLowerCase()}`);
      continue;
    }
    // Neither a card string nor a recognizable ML object — drop it.
  }
  return out;
}

module.exports = { normalizeMlCards };
