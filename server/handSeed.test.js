const assert = require('assert');
const { maskDeckForSeat, seatIndices, DECK_SIZE } = require('./handSeed');

let tests = 0;
let failed = 0;

function test(name, fn) {
  tests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

// A deck where every position is identifiable by its own letter.
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DECK = LETTERS.slice(0, DECK_SIZE);

console.log('\nhandSeed');

test('each seat gets 12 cards, round-robin, kitty excluded', () => {
  for (let seat = 0; seat < 4; seat++) {
    const idx = seatIndices(seat);
    assert.strictEqual(idx.length, 12);
    assert.strictEqual(idx[0], seat);
    assert.ok(Math.max(...idx) < 48);
    assert.ok(idx.every(i => i % 4 === seat));
  }
});

test('the four seats partition the 48 dealt cards exactly', () => {
  const all = [0, 1, 2, 3].flatMap(seatIndices);
  assert.strictEqual(all.length, 48);
  assert.strictEqual(new Set(all).size, 48);
});

test('mask keeps exactly the seat\'s own 12 cards', () => {
  const masked = maskDeckForSeat(DECK, 0);
  assert.strictEqual(masked.length, DECK_SIZE);
  assert.strictEqual([...masked].filter(c => c !== '_').length, 12);
  for (const i of seatIndices(0)) assert.strictEqual(masked[i], DECK[i]);
});

test('mask produces the A___B___C___ shape', () => {
  assert.strictEqual(
    maskDeckForSeat(DECK, 0),
    'a___e___i___m___q___u___y___C___G___K___O___S_______'
  );
});

test('kitty is masked for every seat', () => {
  for (let seat = 0; seat < 4; seat++) {
    assert.strictEqual(maskDeckForSeat(DECK, seat).slice(48), '____');
  }
});

test('no seat can see another seat\'s cards', () => {
  for (let seat = 0; seat < 4; seat++) {
    const masked = maskDeckForSeat(DECK, seat);
    const mine = new Set(seatIndices(seat));
    for (let i = 0; i < DECK_SIZE; i++) {
      if (!mine.has(i)) assert.strictEqual(masked[i], '_', `seat ${seat} leaked index ${i}`);
    }
  }
});

test('the four masks recombine into the original deal', () => {
  const masks = [0, 1, 2, 3].map(s => maskDeckForSeat(DECK, s));
  let merged = '';
  for (let i = 0; i < DECK_SIZE; i++) {
    const seen = masks.map(m => m[i]).find(c => c !== '_');
    merged += seen || '_';
  }
  assert.strictEqual(merged, DECK.slice(0, 48) + '____');
});

test('malformed input throws rather than silently leaking', () => {
  assert.throws(() => maskDeckForSeat('too short', 0), /52-char deck/);
  assert.throws(() => maskDeckForSeat(DECK, 4), /seat must be 0-3/);
  assert.throws(() => maskDeckForSeat(DECK, -1), /seat must be 0-3/);
  assert.throws(() => maskDeckForSeat(null, 0));
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) process.exit(1);
