const {
  cardStringToLetter,
  reconstructDeck,
  VALID_SEATS,
} = require('./deckReconstruct');

const EXPECTED_CARD_COUNTS = new Set([12, 16]);

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function canonicalCardString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 2) return null;

  const suit = trimmed.slice(-1).toLowerCase();
  let rank = trimmed.slice(0, -1).toUpperCase();
  if (rank === 'T') rank = '10';

  const card = `${rank}${suit}`;
  try {
    cardStringToLetter(card);
    return card;
  } catch (_error) {
    return null;
  }
}

function detectionCardString(detection) {
  if (typeof detection === 'string') return canonicalCardString(detection);
  if (!detection || typeof detection !== 'object') return null;

  if (typeof detection.card === 'string') {
    const card = canonicalCardString(detection.card);
    if (card) return card;
  }
  if (typeof detection.name === 'string') {
    const card = canonicalCardString(detection.name);
    if (card) return card;
  }

  const rank = detection.rank_name ?? detection.rankName ?? detection.rank;
  const suit = detection.suit;
  if (rank === undefined || typeof suit !== 'string' || suit.length === 0) return null;

  const rankName = Number(rank) === 1 ? 'A'
    : Number(rank) === 11 ? 'J'
      : Number(rank) === 12 ? 'Q'
        : Number(rank) === 13 ? 'K'
          : String(rank);
  return canonicalCardString(`${rankName}${suit.charAt(0)}`);
}

function normalizeExpectedCount(value, observedCount) {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    const parsed = Number(value);
    if (!EXPECTED_CARD_COUNTS.has(parsed)) {
      throw new Error('expectedCount must be 12 or 16');
    }
    return parsed;
  }
  return observedCount > 12 ? 16 : 12;
}

/**
 * Combine detections from several frames captured around one shutter press.
 *
 * A card can only contribute once per frame. Repeated observations are
 * intentionally favored over a single high-confidence flash detection.
 */
function aggregateBurst(frameResults, expectedCountValue) {
  if (!Array.isArray(frameResults) || frameResults.length === 0) {
    throw new Error('At least one frame result is required');
  }

  const aggregate = new Map();
  const normalizedFrames = [];

  frameResults.forEach((frame, frameIndex) => {
    const rawDetections = Array.isArray(frame)
      ? frame
      : (frame && (frame.cards || frame.detections)) || [];
    const perFrame = new Map();

    for (const raw of rawDetections) {
      const card = detectionCardString(raw);
      if (!card) continue;
      const confidenceValue = typeof raw === 'object' && raw !== null
        ? Number(raw.confidence)
        : 1;
      const confidence = Number.isFinite(confidenceValue)
        ? Math.max(0, Math.min(1, confidenceValue))
        : 0;
      const previous = perFrame.get(card);
      if (!previous || confidence > previous.confidence) {
        perFrame.set(card, {
          card,
          confidence,
          bbox: raw && Array.isArray(raw.bbox) ? raw.bbox.slice() : undefined,
        });
      }
    }

    const frameCards = Array.from(perFrame.values())
      .sort((a, b) => cardStringToLetter(a.card).localeCompare(cardStringToLetter(b.card)));
    normalizedFrames.push({
      index: frame && Number.isInteger(frame.index) ? frame.index : frameIndex,
      uniqueCards: frameCards.length,
      cards: frameCards.map(item => item.card),
    });

    for (const item of frameCards) {
      let entry = aggregate.get(item.card);
      if (!entry) {
        entry = {
          card: item.card,
          confidences: [],
          frameIndexes: [],
          confidence: 0,
          bbox: undefined,
        };
        aggregate.set(item.card, entry);
      }
      entry.confidences.push(item.confidence);
      entry.frameIndexes.push(frameIndex);
      if (item.confidence >= entry.confidence) {
        entry.confidence = item.confidence;
        entry.bbox = item.bbox;
      }
    }
  });

  const detections = Array.from(aggregate.values()).map(entry => {
    const averageConfidence = entry.confidences.reduce((sum, value) => sum + value, 0)
      / entry.confidences.length;
    const frameHits = entry.frameIndexes.length;
    const stability = frameHits / frameResults.length;
    return {
      card: entry.card,
      confidence: round(entry.confidence),
      averageConfidence: round(averageConfidence),
      frameHits,
      frameIndexes: entry.frameIndexes.slice(),
      score: round((0.65 * stability) + (0.35 * averageConfidence)),
      ...(entry.bbox ? { bbox: entry.bbox } : {}),
    };
  }).sort((a, b) =>
    b.score - a.score
    || b.frameHits - a.frameHits
    || b.averageConfidence - a.averageConfidence
    || cardStringToLetter(a.card).localeCompare(cardStringToLetter(b.card))
  );

  // Infer from the fullest single frame, not the cross-frame union. A
  // moving camera may produce different false positives in each frame;
  // allowing that union to choose the mode can turn a 12-card hand into
  // a spurious 16-card target.
  const maximumFrameCount = normalizedFrames.reduce(
    (maximum, frame) => Math.max(maximum, frame.uniqueCards),
    0,
  );
  const expectedCount = normalizeExpectedCount(expectedCountValue, maximumFrameCount);
  const selected = detections.slice(0, expectedCount);
  const detectedCards = selected.map(item => item.card);
  const allDetectedCards = detections.map(item => item.card);
  const coverage = Math.min(1, detectedCards.length / expectedCount);

  return {
    expectedCount,
    detectedCards,
    cards: detectedCards.slice(),
    allDetectedCards,
    detections: selected,
    allDetections: detections,
    uniqueCards: detections.length,
    selectedCount: detectedCards.length,
    count: detectedCards.length,
    totalFrames: frameResults.length,
    coverage: round(coverage),
    coveragePercent: Math.round(coverage * 100),
    ready: detectedCards.length === expectedCount,
    frameResults: normalizedFrames,
  };
}

function normalizeSnapInputs(snaps) {
  if (!Array.isArray(snaps)) {
    return { errors: ['snaps must be an array'], seatSubmissions: {}, nestedKitty: [] };
  }
  if (snaps.length !== 4) {
    return {
      errors: [`Exactly 4 snaps are required (got ${snaps.length})`],
      seatSubmissions: {},
      nestedKitty: [],
    };
  }

  const errors = [];
  const seatSubmissions = {};
  const nestedKitty = [];

  snaps.forEach((snapValue, index) => {
    const snap = Array.isArray(snapValue) ? { cards: snapValue } : (snapValue || {});
    const seat = snap.seat || VALID_SEATS[index];
    if (!VALID_SEATS.includes(seat)) {
      errors.push(`Snap ${index + 1} has invalid seat: ${seat}`);
      return;
    }
    if (seatSubmissions[seat]) {
      errors.push(`Seat ${seat} appears more than once`);
      return;
    }
    if (!Array.isArray(snap.cards)) {
      errors.push(`Snap ${index + 1} (${seat}) cards must be an array`);
      return;
    }
    if (snap.cards.length === 16 && (!Array.isArray(snap.kittyCards) || snap.kittyCards.length === 0)) {
      errors.push(
        `Snap ${index + 1} (${seat}) has 16 cards; split it into 12 cards plus 4 kittyCards`,
      );
    }
    seatSubmissions[seat] = snap.cards;
    if (Array.isArray(snap.kittyCards)) nestedKitty.push(...snap.kittyCards);
  });

  for (const seat of VALID_SEATS) {
    if (!seatSubmissions[seat]) errors.push(`Missing seat: ${seat}`);
  }

  return { errors, seatSubmissions, nestedKitty };
}

/**
 * Compose four 12-card hands into the game's 52-character URL.
 * With no kitty, the final four positions are "____". With a verified
 * four-card kitty, the result is a complete 52-card alpha pangram.
 */
function composeFourSnapDeck(snaps, kittyCardsValue) {
  const { errors, seatSubmissions, nestedKitty } = normalizeSnapInputs(snaps);
  const topLevelKitty = Array.isArray(kittyCardsValue) ? kittyCardsValue : [];
  const kittyCards = [...topLevelKitty, ...nestedKitty];

  if (topLevelKitty.length > 0 && nestedKitty.length > 0) {
    errors.push('Provide kittyCards either at the top level or on a snap, not both');
  }
  if (kittyCards.length !== 0 && kittyCards.length !== 4) {
    errors.push(`Kitty must contain exactly 4 cards when provided (got ${kittyCards.length})`);
  }
  if (errors.length > 0) return { url: null, errors };

  const reconstruction = reconstructDeck(seatSubmissions);
  if (!reconstruction.url) {
    return { url: null, errors: reconstruction.errors };
  }

  let kittyLetters = [];
  if (kittyCards.length === 4) {
    try {
      kittyLetters = kittyCards.map(cardStringToLetter);
    } catch (error) {
      return { url: null, errors: [error.message] };
    }
    if (new Set(kittyLetters).size !== 4) {
      return { url: null, errors: ['Kitty must contain 4 unique cards'] };
    }

    const handLetters = new Set(reconstruction.url.slice(0, 48).split(''));
    const duplicate = kittyLetters.find(letter => handLetters.has(letter));
    if (duplicate) {
      return { url: null, errors: [`Kitty card ${duplicate} also appears in a player hand`] };
    }
    kittyLetters.sort();
  }

  const url = reconstruction.url.slice(0, 48)
    + (kittyLetters.length === 4 ? kittyLetters.join('') : '____');
  const completeDeck = kittyLetters.length === 4;

  return {
    url,
    deckUrl: url,
    errors: [],
    uniqueCards: completeDeck ? 52 : 48,
    placeholderCount: completeDeck ? 0 : 4,
    completeDeck,
    snaps: VALID_SEATS.map(seat => ({ seat, count: seatSubmissions[seat].length })),
  };
}

module.exports = {
  aggregateBurst,
  canonicalCardString,
  composeFourSnapDeck,
  detectionCardString,
  normalizeExpectedCount,
};
