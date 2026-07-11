/**
 * Unit tests for ML card normalization. Runs as a plain Node script
 * (no jest) because the server lives outside the react-scripts test
 * scope. Invoke: `node server/mlCards.test.js`.
 */
const assert = require('assert');
const { normalizeMlCards } = require('./mlCards');

let tests = 0, failed = 0;
function test(name, fn) {
  tests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

console.log('mlCards');

test('ML object → card string for every suit', () => {
  const cards = [
    { alpha: 'a', suit: 'hearts',   rank: 1,  rank_name: 'A',  confidence: 0.9, bbox: [0, 0, 1, 1] },
    { alpha: 'z', suit: 'spades',   rank: 13, rank_name: 'K',  confidence: 0.8, bbox: [0, 0, 1, 1] },
    { alpha: 'L', suit: 'clubs',    rank: 12, rank_name: 'Q',  confidence: 0.7, bbox: [0, 0, 1, 1] },
    { alpha: 'X', suit: 'diamonds', rank: 11, rank_name: 'J',  confidence: 0.6, bbox: [0, 0, 1, 1] },
  ];
  assert.deepStrictEqual(normalizeMlCards(cards), ['Ah', 'Ks', 'Qc', 'Jd']);
});

test('string entries pass through untouched', () => {
  assert.deepStrictEqual(normalizeMlCards(['Ah', '10s', 'Qd']), ['Ah', '10s', 'Qd']);
});

test("'10' rank_name emits a 3-char string", () => {
  const cards = [{ suit: 'hearts', rank: 10, rank_name: '10', confidence: 0.9 }];
  assert.deepStrictEqual(normalizeMlCards(cards), ['10h']);
});

test('malformed entries are dropped without throwing', () => {
  const cards = [
    { suit: 'hearts', rank_name: 'A' },   // valid
    null,
    undefined,
    42,
    { foo: 'bar' },                        // no rank_name/suit
    { rank_name: 'K' },                    // missing suit
    { suit: 'spades' },                    // missing rank_name
    { rank_name: '', suit: 'hearts' },     // empty rank_name
    { rank_name: 'Q', suit: '' },          // empty suit
    'Kd',                                  // valid string
  ];
  assert.deepStrictEqual(normalizeMlCards(cards), ['Ah', 'Kd']);
});

test('mixed objects and strings preserve order', () => {
  const cards = ['2c', { suit: 'diamonds', rank_name: '7' }, '9h'];
  assert.deepStrictEqual(normalizeMlCards(cards), ['2c', '7d', '9h']);
});

test('non-array input yields empty array', () => {
  assert.deepStrictEqual(normalizeMlCards(null), []);
  assert.deepStrictEqual(normalizeMlCards(undefined), []);
  assert.deepStrictEqual(normalizeMlCards('Ah'), []);
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) process.exit(1);
