const assert = require('assert');
const {
  normalizeRoomCode,
  isValidRoomCode,
  parseRoomCode,
} = require('./roomCode');

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

console.log('\nroomCode');

test('normalize upper-cases and trims', () => {
  assert.strictEqual(normalizeRoomCode('  baggle bytes '), 'BAGGLE BYTES');
});

test('normalize collapses inner whitespace', () => {
  assert.strictEqual(normalizeRoomCode('baggle bytes'), 'BAGGLE BYTES');
  assert.strictEqual(normalizeRoomCode('Baggle  Bytes'), 'BAGGLE BYTES');
  assert.strictEqual(normalizeRoomCode('BAGGLE\tBYTES'), 'BAGGLE BYTES');
});

test('normalize returns empty string for unusable input', () => {
  for (const bad of ['   ', '', null, undefined, 42, {}]) {
    assert.strictEqual(normalizeRoomCode(bad), '');
  }
});

test('valid codes are letters, numbers and spaces up to 20 chars', () => {
  assert.ok(isValidRoomCode('BAGGLE BYTES'));
  assert.ok(isValidRoomCode('ROOM 42'));
  assert.ok(isValidRoomCode('A'));
  assert.ok(isValidRoomCode('12345678901234567890'));
});

test('invalid codes are rejected', () => {
  assert.ok(!isValidRoomCode('baggle bytes'), 'lower-case is not normalized');
  assert.ok(!isValidRoomCode('BAGGLE-BYTES'));
  assert.ok(!isValidRoomCode('BAGGLE_BYTES'));
  assert.ok(!isValidRoomCode('EMOJI \u{1F0A1}'));
  assert.ok(!isValidRoomCode('123456789012345678901'));
  assert.ok(!isValidRoomCode(''));
});

test('parse normalizes and accepts in one step', () => {
  assert.deepStrictEqual(parseRoomCode(' Baggle  Bytes '), { ok: true, code: 'BAGGLE BYTES' });
});

test('all four players typing variants reach the same room', () => {
  const typed = ['baggle bytes', 'BAGGLE BYTES', ' Baggle Bytes', 'baggle  BYTES  '];
  const keys = new Set(typed.map(t => parseRoomCode(t).code));
  assert.strictEqual(keys.size, 1);
  assert.strictEqual([...keys][0], 'BAGGLE BYTES');
});

test('parse reports why a code was rejected', () => {
  assert.deepStrictEqual(parseRoomCode('   '), { ok: false, error: 'Enter a room code' });
  assert.ok(/at most 20/.test(parseRoomCode('a'.repeat(25)).error));
  assert.ok(/letters, numbers and spaces/.test(parseRoomCode('room#1').error));
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) process.exit(1);
