/**
 * Table play tracker: turns a stream of per-frame card detections from a
 * camera watching a real table into a game-play string.
 *
 * The camera looks down at (or across) the middle of the table. A card
 * counts as PLAYED the first time it is seen, face up, inside the play
 * area, steadily enough to trust (seen in `confirmFrames` of the last
 * `window` samples at >= `minConfidence`). Each card is played at most
 * once per hand, so a trick sitting on the table for twenty frames is
 * still four plays, not eighty.
 *
 * Who played it is read off WHERE it landed: a card lands in front of
 * its player, so the card's centre relative to the play-area centre
 * picks a side of the table (bottom/left/top/right of the frame), and
 * `seatAtBottom` says which seat (0-3, clockwise) sits on the camera's
 * side. A card too close to the centre to call gets its seat from the
 * previous play in the trick (play passes clockwise).
 *
 * A hand ends when it reaches its play count (48 for Bid Whist, 52 for
 * Hearts) or when newHand() is called.
 *
 * ── TPS1: the table game-play string ─────────────────────────────────
 *   TPS1.<game>.<hand>~<hand>~...
 *     game  'w' = Bid Whist, 'h' = Hearts
 *     hand  <plays>[-<seats>]
 *       plays  card letters in the order they hit the table, using the
 *              urlGameState alphabet (a-m hearts, n-z spades, A-M clubs,
 *              N-Z diamonds) — the same field BWR1 calls `plays`, so a
 *              hand's plays drop straight into a BWR1 record once the
 *              deal, bids and call are known.
 *       seats  optional, one char per play: 0-3, or 'x' when unknown.
 *   e.g. TPS1.w.aAnN-0123~
 * The alphabet is [A-Za-z0-9.~-], so it is URL-safe as-is.
 */

const PLAYS_PER_HAND = { bidwhist: 48, hearts: 52 };
const GAME_TO_CHAR = { bidwhist: 'w', hearts: 'h' };
const CHAR_TO_GAME = { w: 'bidwhist', h: 'hearts' };
const CARD_LETTER = /^[A-Za-z]$/;
const SIDES = ['bottom', 'left', 'top', 'right']; // clockwise seen from above

const DEFAULTS = {
  game: 'bidwhist',
  minConfidence: 0.5,
  confirmFrames: 2,
  window: 3,
  roi: { x0: 0, y0: 0, x1: 1, y1: 1 },
  seatAtBottom: 0,
  // Fraction of the play area's half-size around the centre where the
  // side of the table is too close to call.
  deadZone: 0.12,
};

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function normalizeSettings(s = {}) {
  const out = { ...DEFAULTS, ...s };
  if (!PLAYS_PER_HAND[out.game]) out.game = DEFAULTS.game;
  const r = { ...DEFAULTS.roi, ...(s.roi || {}) };
  out.roi = {
    x0: clamp01(Math.min(r.x0, r.x1)), y0: clamp01(Math.min(r.y0, r.y1)),
    x1: clamp01(Math.max(r.x0, r.x1)), y1: clamp01(Math.max(r.y0, r.y1)),
  };
  if (out.roi.x1 - out.roi.x0 < 0.05 || out.roi.y1 - out.roi.y0 < 0.05) out.roi = { ...DEFAULTS.roi };
  out.seatAtBottom = ((Number(out.seatAtBottom) | 0) % 4 + 4) % 4;
  out.minConfidence = Math.max(0.05, Math.min(0.99, Number(out.minConfidence) || DEFAULTS.minConfidence));
  out.window = Math.max(1, Number(out.window) | 0 || DEFAULTS.window);
  out.confirmFrames = Math.max(1, Math.min(out.window, Number(out.confirmFrames) | 0 || DEFAULTS.confirmFrames));
  return out;
}

/**
 * Collapse a frame's raw detections into one entry per card, with the
 * card's centre in normalized [0,1] frame coordinates. A model usually
 * fires on both index corners of one card; averaging the corners gives
 * the middle of the card, which is where it is on the table.
 */
function cardsInFrame(frame, settings) {
  const dets = Array.isArray(frame.detections) ? frame.detections : [];
  let w = Number(frame.width) || 0;
  let h = Number(frame.height) || 0;
  if (!w || !h) {
    // No frame size: accept bboxes that are already normalized.
    w = 1; h = 1;
  }
  const byCard = new Map();
  for (const d of dets) {
    if (!d || !CARD_LETTER.test(d.alpha || '')) continue;
    const conf = Number(d.confidence) || 0;
    if (conf < settings.minConfidence) continue;
    const b = d.bbox;
    if (!Array.isArray(b) || b.length < 4) continue;
    const cx = ((b[0] + b[2]) / 2) / w;
    const cy = ((b[1] + b[3]) / 2) / h;
    const e = byCard.get(d.alpha) || { alpha: d.alpha, n: 0, sx: 0, sy: 0, conf: 0 };
    e.n++; e.sx += cx; e.sy += cy; e.conf = Math.max(e.conf, conf);
    byCard.set(d.alpha, e);
  }
  const { roi } = settings;
  const out = [];
  for (const e of byCard.values()) {
    const x = e.sx / e.n;
    const y = e.sy / e.n;
    if (x < roi.x0 || x > roi.x1 || y < roi.y0 || y > roi.y1) continue;
    out.push({ alpha: e.alpha, x, y, conf: e.conf });
  }
  return out;
}

/** Which seat (0-3) a card at normalized (x,y) was played from, or null. */
function seatFor(x, y, settings) {
  const { roi } = settings;
  const hx = (roi.x1 - roi.x0) / 2;
  const hy = (roi.y1 - roi.y0) / 2;
  const dx = (x - (roi.x0 + hx)) / hx;
  const dy = (y - (roi.y0 + hy)) / hy;
  if (Math.hypot(dx, dy) < settings.deadZone) return null;
  let side;
  if (Math.abs(dy) >= Math.abs(dx)) side = dy > 0 ? 'bottom' : 'top';
  else side = dx < 0 ? 'left' : 'right';
  return (settings.seatAtBottom + SIDES.indexOf(side)) % 4;
}

function createTracker(settings = {}, initialHands = null) {
  const s = normalizeSettings(settings);
  const hands = Array.isArray(initialHands) && initialHands.length
    ? initialHands.map(h => ({ plays: (h.plays || []).map(p => ({ ...p })) }))
    : [{ plays: [] }];
  let sample = 0;
  const hits = new Map(); // alpha -> sample numbers it was seen in (recent)
  const firstSeen = new Map(); // alpha -> { t, x, y }
  // Cards on the table when a hand ended (the last trick, usually): not
  // plays of the next hand, so they are ignored until they leave view.
  const suppressed = new Set();

  const current = () => hands[hands.length - 1];
  const playedInHand = () => new Set(current().plays.map(p => p.c));
  const perHand = () => PLAYS_PER_HAND[s.game];
  if (current().plays.length >= perHand()) hands.push({ plays: [] });

  function newHand() {
    if (current().plays.length > 0) hands.push({ plays: [] });
    for (const alpha of hits.keys()) suppressed.add(alpha);
    firstSeen.clear();
  }

  function appendPlay(alpha, t, x, y, conf) {
    const hand = current();
    let seat = seatFor(x, y, s);
    const posInTrick = hand.plays.length % 4;
    if (seat === null && posInTrick > 0) {
      const prev = hand.plays[hand.plays.length - 1];
      if (prev.s !== null && prev.s !== undefined) seat = (prev.s + 1) % 4;
    }
    const play = { c: alpha, t: Math.round(t * 100) / 100, s: seat, conf: Math.round(conf * 1000) / 1000 };
    hand.plays.push(play);
    return play;
  }

  /**
   * Feed one sampled frame: { t (seconds), width, height, detections:
   * [{ alpha, confidence, bbox: [x1,y1,x2,y2] }] }. Returns the plays
   * this frame confirmed and what was visible in the play area.
   */
  function addFrame(frame) {
    sample++;
    const t = Number(frame.t) || 0;
    const visible = cardsInFrame(frame, s);
    for (const v of visible) {
      const list = hits.get(v.alpha) || [];
      list.push(sample);
      hits.set(v.alpha, list);
      if (!firstSeen.has(v.alpha)) firstSeen.set(v.alpha, { t, x: v.x, y: v.y, conf: v.conf });
    }
    // Drop hits that fell out of the window; forget cards no longer seen.
    for (const [alpha, list] of hits) {
      const recent = list.filter(n => n > sample - s.window);
      if (recent.length) hits.set(alpha, recent);
      else { hits.delete(alpha); firstSeen.delete(alpha); suppressed.delete(alpha); }
    }

    const played = playedInHand();
    const ready = [];
    for (const [alpha, list] of hits) {
      if (played.has(alpha) || suppressed.has(alpha)) continue;
      if (list.length >= s.confirmFrames) ready.push(alpha);
    }
    // Several confirmed at once (a skipped frame, a fast trick): order by
    // when each card first appeared.
    ready.sort((a, b) => firstSeen.get(a).t - firstSeen.get(b).t);
    const seen = new Map(ready.map(a => [a, firstSeen.get(a)]));

    const newPlays = [];
    for (const alpha of ready) {
      if (suppressed.has(alpha)) continue; // the hand ended under it
      const f = seen.get(alpha);
      const vis = visible.find(v => v.alpha === alpha);
      newPlays.push({ hand: hands.length - 1, ...appendPlay(alpha, f.t, f.x, f.y, vis ? vis.conf : f.conf) });
      if (current().plays.length >= perHand()) newHand();
    }
    return { newPlays, visible };
  }

  return {
    settings: s,
    addFrame,
    newHand,
    get hands() { return hands; },
    toString() { return encodePlayString(s.game, hands); },
  };
}

function encodePlayString(game, hands) {
  const g = GAME_TO_CHAR[game] || GAME_TO_CHAR.bidwhist;
  const parts = (hands || []).map(h => {
    const plays = h.plays || [];
    const letters = plays.map(p => p.c).join('');
    const anySeat = plays.some(p => p.s !== null && p.s !== undefined);
    if (!anySeat) return letters;
    return `${letters}-${plays.map(p => (p.s === null || p.s === undefined ? 'x' : String(p.s))).join('')}`;
  });
  // A trailing empty hand (the one waiting for the next deal) says
  // nothing; drop it unless it is the only one.
  while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return `TPS1.${g}.${parts.join('~')}`;
}

/**
 * Parse a TPS1 string. Throws on malformed input. Plays carry no
 * timestamps (the string does not hold them); callers that keep times
 * merge them back by position.
 */
function decodePlayString(str) {
  const m = /^TPS1\.([wh])\.([A-Za-z0-9~x-]*)$/.exec(String(str || '').trim());
  if (!m) throw new Error('not a TPS1 play string (expected TPS1.<w|h>.<plays>)');
  const game = CHAR_TO_GAME[m[1]];
  const perHand = PLAYS_PER_HAND[game];
  const hands = m[2].split('~').map((part, i) => {
    const [letters, seats, extra] = part.split('-');
    if (extra !== undefined) throw new Error(`hand ${i + 1}: more than one '-'`);
    if (!/^[A-Za-z]*$/.test(letters)) throw new Error(`hand ${i + 1}: plays must be card letters`);
    if (letters.length > perHand) throw new Error(`hand ${i + 1}: ${letters.length} plays, at most ${perHand}`);
    if (new Set(letters).size !== letters.length) throw new Error(`hand ${i + 1}: a card is played twice`);
    if (seats !== undefined) {
      if (!/^[0-3x]*$/.test(seats)) throw new Error(`hand ${i + 1}: seats must be 0-3 or x`);
      if (seats.length !== letters.length) throw new Error(`hand ${i + 1}: ${seats.length} seats for ${letters.length} plays`);
    }
    return {
      plays: [...letters].map((c, j) => ({
        c, s: seats === undefined || seats[j] === 'x' ? null : Number(seats[j]),
      })),
    };
  });
  return { game, hands };
}

/** Keep timestamps from `oldHands` where an edited string still has the same card in the same place. */
function mergeTimes(oldHands, newHands) {
  return newHands.map((h, i) => ({
    plays: h.plays.map((p, j) => {
      const old = oldHands && oldHands[i] && oldHands[i].plays[j];
      return old && old.c === p.c ? { ...old, s: p.s } : { ...p, t: null };
    }),
  }));
}

module.exports = {
  createTracker,
  encodePlayString,
  decodePlayString,
  mergeTimes,
  normalizeSettings,
  seatFor,
  cardsInFrame,
  PLAYS_PER_HAND,
  DEFAULTS,
};
