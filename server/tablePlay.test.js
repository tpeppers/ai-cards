/**
 * Unit tests for the table play tracker and the TPS1 play string.
 * Plain Node script (the server lives outside react-scripts' jest):
 *   node server/tablePlay.test.js
 */
const assert = require('assert');
const {
  createTracker, encodePlayString, decodePlayString, mergeTimes, seatFor, normalizeSettings,
} = require('./tablePlay');

let tests = 0, failed = 0;
function test(name, fn) {
  tests++;
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

// A 1000x1000 frame; a card "at" (x,y) fires on both index corners.
const W = 1000, H = 1000;
function card(alpha, x, y, confidence = 0.9) {
  return [
    { alpha, confidence, bbox: [x - 60, y - 90, x - 30, y - 50] },
    { alpha, confidence, bbox: [x + 30, y + 50, x + 60, y + 90] },
  ];
}
function frame(t, ...cards) {
  return { t, width: W, height: H, detections: cards.flat() };
}
const BOTTOM = [500, 750], LEFT = [250, 500], TOP = [500, 250], RIGHT = [750, 500];

test('a card seen once is not yet a play; seen twice it is', () => {
  const tr = createTracker();
  assert.strictEqual(tr.addFrame(frame(0, card('a', ...BOTTOM))).newPlays.length, 0);
  const r = tr.addFrame(frame(0.5, card('a', ...BOTTOM)));
  assert.strictEqual(r.newPlays.length, 1);
  assert.strictEqual(r.newPlays[0].c, 'a');
  assert.strictEqual(r.newPlays[0].t, 0, 'timestamp is when it first appeared');
});

test('a card sitting on the table for many frames is one play', () => {
  const tr = createTracker();
  for (let i = 0; i < 20; i++) tr.addFrame(frame(i, card('a', ...BOTTOM)));
  assert.strictEqual(tr.toString(), 'TPS1.w.a-0');
});

test('a full trick, clockwise from the bottom, reads in order with seats', () => {
  const tr = createTracker({ seatAtBottom: 2 });
  const seq = [['a', BOTTOM], ['A', LEFT], ['n', TOP], ['N', RIGHT]];
  const onTable = [];
  let t = 0;
  for (const [alpha, pos] of seq) {
    onTable.push(card(alpha, ...pos));
    tr.addFrame(frame(t++, ...onTable));
    tr.addFrame(frame(t++, ...onTable));
  }
  assert.strictEqual(tr.toString(), 'TPS1.w.aAnN-2301');
});

test('low-confidence and out-of-play-area detections are ignored', () => {
  const tr = createTracker({ roi: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 } });
  for (let i = 0; i < 3; i++) {
    tr.addFrame(frame(i, card('a', ...BOTTOM, 0.3), card('b', 950, 950)));
  }
  assert.strictEqual(tr.toString(), 'TPS1.w.');
});

test('a flicker (seen, gone, seen) still confirms within the window', () => {
  const tr = createTracker({ window: 3, confirmFrames: 2 });
  tr.addFrame(frame(0, card('a', ...BOTTOM)));
  tr.addFrame(frame(1));
  tr.addFrame(frame(2, card('a', ...BOTTOM)));
  assert.strictEqual(tr.hands[0].plays.length, 1);
});

test('two cards confirmed in one frame are ordered by first appearance', () => {
  const tr = createTracker({ window: 3, confirmFrames: 2 });
  tr.addFrame(frame(0, card('b', ...LEFT)));
  tr.addFrame(frame(1, card('a', ...BOTTOM)));
  tr.addFrame(frame(2, card('a', ...BOTTOM), card('b', ...LEFT)));
  assert.deepStrictEqual(tr.hands[0].plays.map(p => p.c), ['b', 'a']);
});

test('a card in the dead centre takes its seat from the previous play', () => {
  const tr = createTracker();
  tr.addFrame(frame(0, card('a', ...BOTTOM)));
  tr.addFrame(frame(1, card('a', ...BOTTOM)));
  tr.addFrame(frame(2, card('a', ...BOTTOM), card('b', 500, 500)));
  tr.addFrame(frame(3, card('a', ...BOTTOM), card('b', 500, 500)));
  assert.deepStrictEqual(tr.hands[0].plays.map(p => p.s), [0, 1]);
});

test('a hand rolls over at 48 plays, and the last trick does not leak into the next hand', () => {
  const tr = createTracker();
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV'; // 48
  let t = 0;
  for (let i = 0; i < 48; i += 4) {
    const trick = [];
    const pos = [BOTTOM, LEFT, TOP, RIGHT];
    for (let j = 0; j < 4; j++) {
      trick.push(card(letters[i + j], ...pos[j]));
      tr.addFrame(frame(t++, ...trick));
      tr.addFrame(frame(t++, ...trick));
    }
    if (i + 4 < 48) { tr.addFrame(frame(t++)); tr.addFrame(frame(t++)); tr.addFrame(frame(t++)); }
  }
  assert.strictEqual(tr.hands[0].plays.length, 48);
  // The last trick is still lying there for a few frames.
  const last = ['S', 'T', 'U', 'V'].map((c, j) => card(c, ...[BOTTOM, LEFT, TOP, RIGHT][j]));
  for (let k = 0; k < 4; k++) tr.addFrame(frame(t++, ...last));
  assert.strictEqual(tr.hands.length, 2);
  assert.strictEqual(tr.hands[1].plays.length, 0, 'last trick is not replayed into hand 2');
  // Table cleared, then the next hand's first card.
  for (let k = 0; k < 3; k++) tr.addFrame(frame(t++));
  tr.addFrame(frame(t++, card('S', ...BOTTOM)));
  tr.addFrame(frame(t++, card('S', ...BOTTOM)));
  assert.deepStrictEqual(tr.hands[1].plays.map(p => p.c), ['S']);
});

test('newHand() mid-hand starts a new hand and ignores what is still on the table', () => {
  const tr = createTracker();
  tr.addFrame(frame(0, card('a', ...BOTTOM)));
  tr.addFrame(frame(1, card('a', ...BOTTOM)));
  tr.newHand();
  tr.addFrame(frame(2, card('a', ...BOTTOM)));
  tr.addFrame(frame(3, card('a', ...BOTTOM)));
  assert.strictEqual(tr.toString(), 'TPS1.w.a-0');
  assert.strictEqual(tr.hands.length, 2);
});

test('hearts hands are 52 plays', () => {
  const tr = createTracker({ game: 'hearts' });
  assert.ok(tr.toString().startsWith('TPS1.h.'));
});

test('seatFor maps the four sides clockwise from seatAtBottom', () => {
  const s = normalizeSettings({ seatAtBottom: 1 });
  assert.strictEqual(seatFor(0.5, 0.9, s), 1);
  assert.strictEqual(seatFor(0.1, 0.5, s), 2);
  assert.strictEqual(seatFor(0.5, 0.1, s), 3);
  assert.strictEqual(seatFor(0.9, 0.5, s), 0);
  assert.strictEqual(seatFor(0.5, 0.5, s), null);
});

test('encode/decode round-trip, with and without seats', () => {
  const hands = [
    { plays: [{ c: 'a', s: 0 }, { c: 'B', s: null }] },
    { plays: [{ c: 'z' }, { c: 'Z' }] },
  ];
  const str = encodePlayString('bidwhist', hands);
  assert.strictEqual(str, 'TPS1.w.aB-0x~zZ');
  const back = decodePlayString(str);
  assert.strictEqual(back.game, 'bidwhist');
  assert.deepStrictEqual(back.hands[0].plays, [{ c: 'a', s: 0 }, { c: 'B', s: null }]);
  assert.deepStrictEqual(back.hands[1].plays, [{ c: 'z', s: null }, { c: 'Z', s: null }]);
});

test('decode rejects malformed strings', () => {
  assert.throws(() => decodePlayString('BWR1.foo'));
  assert.throws(() => decodePlayString('TPS1.w.aa'), /twice/);
  assert.throws(() => decodePlayString('TPS1.w.ab-0'), /seats/);
  assert.throws(() => decodePlayString('TPS1.w.ab-04'), /0-3/);
  assert.throws(() => decodePlayString('TPS1.q.ab'));
});

test('mergeTimes keeps timestamps where an edit kept the card in place', () => {
  const old = [{ plays: [{ c: 'a', t: 1, s: 0 }, { c: 'b', t: 2, s: 1 }] }];
  const edited = decodePlayString('TPS1.w.ac-03').hands;
  const merged = mergeTimes(old, edited);
  assert.deepStrictEqual(merged[0].plays[0], { c: 'a', t: 1, s: 0 });
  assert.deepStrictEqual(merged[0].plays[1], { c: 'c', s: 3, t: null });
});

test('a tracker resumes from saved hands', () => {
  const tr = createTracker({}, [{ plays: [{ c: 'a', t: 0, s: 0 }] }]);
  tr.addFrame(frame(5, card('a', ...BOTTOM)));
  tr.addFrame(frame(6, card('a', ...BOTTOM)));
  tr.addFrame(frame(7, card('b', ...LEFT)));
  tr.addFrame(frame(8, card('b', ...LEFT)));
  assert.strictEqual(tr.toString(), 'TPS1.w.ab-01');
});

console.log(`\n${tests - failed}/${tests} passed`);
process.exit(failed ? 1 : 0);
