const assert = require('assert');
const {
  JOIN_POLICIES,
  isValidJoinPolicy,
  matchStrength,
  findReclaimableSeat,
  decideJoin,
} = require('./joinPolicy');

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

const TABLE_IP = '192.168.1.50'; // one WiFi, four players

function vacancy(over = {}) {
  return { name: 'Alice', deviceId: 'dev-alice', ip: TABLE_IP, ts: Date.now(), ...over };
}

console.log('\njoinPolicy');

test('the three modes are the supported set', () => {
  assert.deepStrictEqual(JOIN_POLICIES, ['dropin', 'reconnect', 'disabled']);
  assert.ok(isValidJoinPolicy('dropin'));
  assert.ok(!isValidJoinPolicy('anything-else'));
});

test('a device token identifies a returning player', () => {
  const via = matchStrength(vacancy(), { name: 'Alice', deviceId: 'dev-alice', ip: TABLE_IP });
  assert.strictEqual(via, 'device');
});

test('a device token works even from a different network', () => {
  const via = matchStrength(vacancy(), { name: 'Alice', deviceId: 'dev-alice', ip: '10.0.0.9' });
  assert.strictEqual(via, 'device');
});

test('a device token works even under a different name', () => {
  const via = matchStrength(vacancy(), { name: 'Al', deviceId: 'dev-alice', ip: TABLE_IP });
  assert.strictEqual(via, 'device');
});

test('a shared table IP alone does NOT identify anyone', () => {
  // Bob is on the same WiFi as Alice. He must not be able to take her seat.
  const via = matchStrength(vacancy(), { name: 'Bob', deviceId: 'dev-bob', ip: TABLE_IP });
  assert.strictEqual(via, null);
});

test('a mismatched device token is disqualifying, name and IP notwithstanding', () => {
  // Mallory is on the same WiFi and retypes the name that just left. The
  // token she presents is not the one that vacated, so she gets nothing.
  const via = matchStrength(vacancy(), {
    name: 'Alice',
    deviceId: 'dev-mallory',
    ip: TABLE_IP,
  });
  assert.strictEqual(via, null);
});

test('IP plus the same name is accepted when no token is available', () => {
  const via = matchStrength(vacancy({ deviceId: null }), {
    name: 'alice',
    deviceId: null,
    ip: TABLE_IP,
  });
  assert.strictEqual(via, 'ip');
});

test('IP without a matching name is rejected', () => {
  const via = matchStrength(vacancy({ deviceId: null }), {
    name: 'Mallory',
    deviceId: null,
    ip: TABLE_IP,
  });
  assert.strictEqual(via, null);
});

test('a device match beats an IP match', () => {
  const vacancies = new Map([
    [1, vacancy({ name: 'Alice', deviceId: null })],          // would match on ip+name
    [2, vacancy({ name: 'Other', deviceId: 'dev-alice' })],   // matches on device
  ]);
  const found = findReclaimableSeat(vacancies, {
    name: 'Alice',
    deviceId: 'dev-alice',
    ip: TABLE_IP,
  });
  assert.deepStrictEqual(found, { seat: 2, via: 'device' });
});

test('no vacancy means nothing to reclaim', () => {
  assert.strictEqual(findReclaimableSeat(new Map(), { name: 'A', deviceId: 'd', ip: TABLE_IP }), null);
});

// ── decideJoin ──────────────────────────────────────────────────────

const claimant = { name: 'Carol', deviceId: 'dev-carol', ip: '10.0.0.1' };

test('before the game starts, every mode just seats you', () => {
  for (const policy of JOIN_POLICIES) {
    const result = decideJoin({ policy, gameInProgress: false, claimant });
    assert.strictEqual(result.action, 'seat', policy);
  }
});

test('disabled turns away everyone once the game starts', () => {
  const result = decideJoin({
    policy: 'disabled',
    gameInProgress: true,
    claimant,
    botSeats: [2, 3],
  });
  assert.strictEqual(result.action, 'reject');
  assert.match(result.reason, /already started/);
});

test('disabled turns away even the player who dropped', () => {
  const result = decideJoin({
    policy: 'disabled',
    gameInProgress: true,
    claimant: { name: 'Alice', deviceId: 'dev-alice', ip: TABLE_IP },
    vacancies: new Map([[1, vacancy()]]),
    botSeats: [1],
  });
  assert.strictEqual(result.action, 'reject');
});

test('reconnect lets the dropped player straight back into their seat', () => {
  const result = decideJoin({
    policy: 'reconnect',
    gameInProgress: true,
    claimant: { name: 'Alice', deviceId: 'dev-alice', ip: TABLE_IP },
    vacancies: new Map([[1, vacancy()]]),
    botSeats: [1],
  });
  assert.deepStrictEqual(result, { action: 'reclaim', seat: 1, via: 'device' });
});

test('reconnect makes a newcomer wait for the hand to finish', () => {
  const result = decideJoin({
    policy: 'reconnect',
    gameInProgress: true,
    claimant,
    botSeats: [2, 3],
  });
  assert.strictEqual(result.action, 'queue');
  assert.strictEqual(result.seat, 2);
  assert.match(result.reason, /current hand/);
});

test('dropin asks the host about a newcomer', () => {
  const result = decideJoin({
    policy: 'dropin',
    gameInProgress: true,
    claimant,
    botSeats: [2, 3],
  });
  assert.strictEqual(result.action, 'ask-host');
  assert.strictEqual(result.seat, 2);
});

test('dropin does not make a returning player ask permission', () => {
  const result = decideJoin({
    policy: 'dropin',
    gameInProgress: true,
    claimant: { name: 'Alice', deviceId: 'dev-alice', ip: TABLE_IP },
    vacancies: new Map([[3, vacancy()]]),
    botSeats: [3],
  });
  assert.strictEqual(result.action, 'reclaim');
  assert.strictEqual(result.seat, 3);
});

test('a requested seat is honoured when it is free', () => {
  const result = decideJoin({
    policy: 'dropin',
    gameInProgress: true,
    claimant,
    botSeats: [1, 2, 3],
    requestedSeat: 3,
  });
  assert.strictEqual(result.seat, 3);
});

test('a requested seat that is taken falls back to a free one', () => {
  const result = decideJoin({
    policy: 'dropin',
    gameInProgress: true,
    claimant,
    botSeats: [2],
    requestedSeat: 0, // a human is sitting there
  });
  assert.strictEqual(result.seat, 2);
});

test('a table of four humans has nowhere to put anyone', () => {
  for (const policy of ['dropin', 'reconnect']) {
    const result = decideJoin({ policy, gameInProgress: true, claimant, botSeats: [] });
    assert.strictEqual(result.action, 'reject', policy);
    assert.match(result.reason, /Every seat/);
  }
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) process.exit(1);
