const assert = require('assert');
const {
  aggregateBurst,
  canonicalCardString,
  composeFourSnapDeck,
} = require('./fourSnap');

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

function rankName(rank) {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

function suitHand(suit) {
  return Array.from({ length: 12 }, (_, index) => `${rankName(index + 1)}${suit}`);
}

function fourHands() {
  return [
    { seat: 'dealer', cards: suitHand('h') },
    { seat: 'bid1', cards: suitHand('s') },
    { seat: 'bid2', cards: suitHand('c') },
    { seat: 'bid3', cards: suitHand('d') },
  ];
}

console.log('fourSnap');

test('canonicalCardString accepts model names and T as ten', () => {
  assert.strictEqual(canonicalCardString('Ah'), 'Ah');
  assert.strictEqual(canonicalCardString('10C'), '10c');
  assert.strictEqual(canonicalCardString('ts'), '10s');
  assert.strictEqual(canonicalCardString('joker'), null);
});

test('burst aggregation favors cards repeated across frames', () => {
  const stableCards = suitHand('h');
  const frames = [0, 1, 2].map(index => ({
    index,
    cards: stableCards.map(card => ({
      name: card,
      confidence: 0.72 + (index * 0.02),
      bbox: [index, 1, 2, 3],
    })),
  }));
  // A very confident one-frame false positive should not displace a card
  // observed consistently in all three frames.
  frames[0].cards.push({ name: 'Kc', confidence: 0.99, bbox: [9, 9, 9, 9] });

  const result = aggregateBurst(frames, 12);
  assert.strictEqual(result.expectedCount, 12);
  assert.strictEqual(result.detectedCards.length, 12);
  assert.ok(!result.detectedCards.includes('Kc'));
  assert.strictEqual(result.uniqueCards, 13);
  assert.strictEqual(result.coveragePercent, 100);
  assert.strictEqual(result.ready, true);
  assert.ok(result.detections.every(detection => detection.frameHits === 3));
});

test('burst aggregation deduplicates a card within each frame', () => {
  const result = aggregateBurst([{
    cards: [
      { name: 'Ah', confidence: 0.4 },
      { name: 'Ah', confidence: 0.9 },
      { rank_name: 'K', suit: 'spades', confidence: 0.8 },
    ],
  }], 12);
  assert.deepStrictEqual(result.allDetectedCards.sort(), ['Ah', 'Ks'].sort());
  const ace = result.allDetections.find(detection => detection.card === 'Ah');
  assert.strictEqual(ace.confidence, 0.9);
  assert.strictEqual(ace.frameHits, 1);
  assert.strictEqual(result.coveragePercent, 17);
});

test('expected count infers 16 when more than 12 identities are visible', () => {
  const cards = [
    ...suitHand('h'),
    { name: 'Kh', confidence: 0.8 },
  ];
  const result = aggregateBurst([{ cards }]);
  assert.strictEqual(result.expectedCount, 16);
  assert.strictEqual(result.selectedCount, 13);
  assert.strictEqual(result.coveragePercent, 81);
  assert.strictEqual(result.ready, false);
});

test('expected count does not use an inflated cross-frame union', () => {
  const first = suitHand('h');
  const second = [...suitHand('h').slice(0, 11), 'Kc'];
  const third = [...suitHand('h').slice(0, 11), 'Kd'];
  const result = aggregateBurst([first, second, third]);
  assert.strictEqual(result.uniqueCards, 14);
  assert.strictEqual(result.expectedCount, 12);
});

test('expected count rejects unsupported values', () => {
  assert.throws(
    () => aggregateBurst([{ cards: [{ name: 'Ah', confidence: 1 }] }], 13),
    /12 or 16/,
  );
});

test('four 12-card hands compose a 48-card URL plus four placeholders', () => {
  const result = composeFourSnapDeck(fourHands());
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.url.length, 52);
  assert.strictEqual(result.url.slice(48), '____');
  assert.strictEqual(result.uniqueCards, 48);
  assert.strictEqual(result.placeholderCount, 4);
  assert.strictEqual(result.completeDeck, false);
});

test('optional explicit kitty composes a complete 52-card alpha pangram', () => {
  const result = composeFourSnapDeck(fourHands(), ['Kh', 'Ks', 'Kc', 'Kd']);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.url.length, 52);
  assert.strictEqual(result.url.includes('_'), false);
  assert.strictEqual(new Set(result.url).size, 52);
  assert.strictEqual(result.uniqueCards, 52);
  assert.strictEqual(result.placeholderCount, 0);
  assert.strictEqual(result.completeDeck, true);
});

test('kittyCards may be attached to one snap', () => {
  const snaps = fourHands();
  snaps[3].kittyCards = ['Kh', 'Ks', 'Kc', 'Kd'];
  const result = composeFourSnapDeck(snaps);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.completeDeck, true);
});

test('16 unsplit cards explain that four cards must be marked as kitty', () => {
  const snaps = fourHands();
  snaps[0].cards = [...snaps[0].cards, 'Kh', 'Ks', 'Kc', 'Kd'];
  const result = composeFourSnapDeck(snaps);
  assert.strictEqual(result.url, null);
  assert.ok(result.errors.some(error => /split it into 12 cards plus 4 kittyCards/.test(error)));
});

test('cross-hand and kitty duplicates are rejected', () => {
  const duplicateHand = fourHands();
  duplicateHand[1].cards[0] = 'Ah';
  const handResult = composeFourSnapDeck(duplicateHand);
  assert.strictEqual(handResult.url, null);
  assert.ok(handResult.errors.some(error => /appears in both/.test(error)));

  const kittyResult = composeFourSnapDeck(fourHands(), ['Ah', 'Ks', 'Kc', 'Kd']);
  assert.strictEqual(kittyResult.url, null);
  assert.ok(kittyResult.errors.some(error => /also appears in a player hand/.test(error)));
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) process.exit(1);
