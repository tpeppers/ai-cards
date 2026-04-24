/**
 * Unit tests for deck reconstruction. Runs as a plain Node script
 * (no jest) because the server lives outside the react-scripts test
 * scope. Invoke: `node server/deckReconstruct.test.js`.
 */
const assert = require('assert');
const { reconstructDeck, cardStringToLetter, normalizeCard, dedupAndValidateSeat } = require('./deckReconstruct');

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

console.log('deckReconstruct');

test('cardStringToLetter maps common cards correctly', () => {
  assert.strictEqual(cardStringToLetter('Ah'), 'a');
  assert.strictEqual(cardStringToLetter('Kh'), 'm');
  assert.strictEqual(cardStringToLetter('As'), 'n');
  assert.strictEqual(cardStringToLetter('Ks'), 'z');
  assert.strictEqual(cardStringToLetter('Ac'), 'A');
  assert.strictEqual(cardStringToLetter('Kc'), 'M');
  assert.strictEqual(cardStringToLetter('Ad'), 'N');
  assert.strictEqual(cardStringToLetter('Kd'), 'Z');
  assert.strictEqual(cardStringToLetter('2h'), 'b');
  assert.strictEqual(cardStringToLetter('10s'), 'w');
  assert.strictEqual(cardStringToLetter('QD'), 'Y'); // case-insensitive suit
});

test('normalize is case-insensitive on rank and suit', () => {
  assert.strictEqual(normalizeCard('kh'), 'm');
  assert.strictEqual(normalizeCard('KH'), 'm');
  assert.strictEqual(normalizeCard('Kh'), 'm');
});

test('dedup within seat: duplicates collapse', () => {
  const hand = ['Ah', 'Ah', 'Kh', 'Qh', 'Jh', '10h', '9h', '8h', '7h', '6h', '5h', '4h', '3h'];
  // 13 detections, 12 unique (the duplicate Ah)
  const letters = dedupAndValidateSeat('dealer', hand);
  assert.strictEqual(letters.size, 12);
});

test('dedup rejects seat with < 12 unique cards', () => {
  const hand = ['Ah', 'Kh', 'Qh']; // only 3 cards
  assert.throws(() => dedupAndValidateSeat('dealer', hand), /12/);
});

test('dedup rejects seat with > 12 unique cards', () => {
  const hand = [
    'Ah','Kh','Qh','Jh','10h','9h','8h','7h','6h','5h','4h','3h','2h',
  ]; // 13 unique
  assert.throws(() => dedupAndValidateSeat('dealer', hand), /12/);
});

// Build a valid 4-seat scenario from a deterministic 48-card split.
function splitDeck() {
  // Distribute all 52 cards so each player gets 12. Kitty = 4.
  // Dealer (player 0): hearts 1-12 (A-Q)
  // 1st bidder (player 1): spades 1-12
  // 2nd bidder (player 2): clubs 1-12
  // 3rd bidder (player 3): diamonds 1-12
  // Kitty: K of each suit (4 cards)
  const rank = r => r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);
  const build = (suitCh) => Array.from({ length: 12 }, (_, i) => `${rank(i + 1)}${suitCh}`);
  return {
    dealer: build('h'),
    bid1: build('s'),
    bid2: build('c'),
    bid3: build('d'),
  };
}

test('reconstructs a 52-char URL with 4 valid seats', () => {
  const r = reconstructDeck(splitDeck());
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.url.length, 52);
  // Positions 48-51 should be underscores (kitty)
  assert.strictEqual(r.url.slice(48), '____');
  // Every position 0-47 should be a valid letter
  assert.match(r.url.slice(0, 48), /^[a-zA-Z]{48}$/);
});

test('cards get placed at the right player-index positions', () => {
  const r = reconstructDeck(splitDeck());
  const url = r.url;
  // Dealer (player 0) has hearts 1-12 → positions 0,4,8,...,44
  // Each of those positions should be a lowercase a-l (hearts 1-12)
  for (let i = 0; i < 48; i += 4) {
    assert.match(url[i], /[a-l]/, `pos ${i} should be hearts 1-12, got ${url[i]}`);
  }
  // 1st bidder (player 1) has spades → positions 1,5,9,...,45
  for (let i = 1; i < 48; i += 4) {
    assert.match(url[i], /[n-y]/, `pos ${i} should be spades 1-12, got ${url[i]}`);
  }
  // 2nd bidder (player 2) has clubs → positions 2,6,...
  for (let i = 2; i < 48; i += 4) {
    assert.match(url[i], /[A-L]/, `pos ${i} should be clubs 1-12, got ${url[i]}`);
  }
  // 3rd bidder (player 3) has diamonds → positions 3,7,...
  for (let i = 3; i < 48; i += 4) {
    assert.match(url[i], /[N-Y]/, `pos ${i} should be diamonds 1-12, got ${url[i]}`);
  }
});

test('rejects cross-seat duplicates (same card in two hands)', () => {
  const hands = splitDeck();
  hands.bid1[0] = 'Ah'; // now hearts ace appears in both dealer and bid1
  const r = reconstructDeck(hands);
  assert.strictEqual(r.url, null);
  assert(r.errors.some(e => /appears in both/i.test(e)), `expected cross-seat error, got: ${r.errors.join('; ')}`);
});

test('rejects missing seats', () => {
  const hands = splitDeck();
  delete hands.bid2;
  const r = reconstructDeck(hands);
  assert.strictEqual(r.url, null);
  assert(r.errors.some(e => /Missing seat: bid2/i.test(e)));
});

test('dedup within-image handles rotated-card double detections', () => {
  // A common real case: ML detects the Kh from both ends of the same
  // physical card (double-exposure). Dedup keeps just one.
  const letters = dedupAndValidateSeat('dealer', [
    'Kh', 'Kh', 'Qh', 'Jh', '10h', '9h', '8h', '7h', '6h', '5h', '4h', '3h', '2h',
  ]);
  assert.strictEqual(letters.size, 12);
  // King is in there
  assert.ok(letters.has('m'));
  assert.ok(letters.has('b'));
});

test('accepts "T" as alternate for 10 via ML output quirks', () => {
  // Some recognizers emit "T" for 10. Make sure our canonical card
  // strings handle it — currently we don't (we expect "10"), so this
  // test documents the CURRENT behavior and can fail if the ML output
  // changes.
  assert.throws(() => cardStringToLetter('Th'), /Invalid rank/);
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) process.exit(1);
