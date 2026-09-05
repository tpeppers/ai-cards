/**
 * End-to-end matchmaking test over real sockets.
 *
 * Boots the multiplayer server on an ephemeral port and drives it with actual
 * socket.io clients, so the wire contract is exercised rather than mocked.
 * Only the lobby, the opening deal and the join policies are covered here —
 * playing a hand out is roomGame.test.js's job.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { io: ioClient } = require('socket.io-client');

const bundlePath = path.join(__dirname, 'engine', 'bundle.cjs');
if (!fs.existsSync(bundlePath)) {
  console.error('\nmultiplayer.e2e: engine bundle missing — run "npm run build:engine" first');
  process.exit(1);
}

const { initMultiplayer, rooms } = require('./multiplayer');
const { seatIndices } = require('./handSeed');

let tests = 0;
let failed = 0;

async function test(name, fn) {
  tests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

/** Resolve on the next occurrence of `event`, or reject after `ms`. */
function once(socket, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, ms);
    const handler = payload => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

const settle = ms => new Promise(resolve => setTimeout(resolve, ms));

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer();
    const io = initMultiplayer(server);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, io, port: server.address().port });
    });
  });
}

function connect(port) {
  return ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    forceNew: true,
  });
}

async function withTable(fn) {
  const { server, io, port } = await startServer();
  const sockets = [];
  const open = () => {
    const s = connect(port);
    sockets.push(s);
    return s;
  };
  try {
    await fn(open);
  } finally {
    for (const s of sockets) s.disconnect();
    io.close();
    await new Promise(resolve => server.close(resolve));
    // `rooms` is module-level: one server, one table registry. These tests
    // spin up several servers in a row, and an in-progress room is now
    // deliberately held open for reconnects, so it must be cleared between
    // them or it leaks into the next test.
    rooms.clear();
  }
}

/** Seat a host, optionally set the policy, and start the game. */
async function startedRoom(open, code, { joinPolicy } = {}) {
  const host = open();
  await once(host, 'mp_ready');
  host.emit('join_room', { roomCode: code, playerName: 'Alice', deviceId: 'dev-alice' });
  const joined = await once(host, 'room_joined');

  if (joinPolicy) {
    const updated = once(host, 'room_updated');
    host.emit('set_join_policy', { joinPolicy });
    assert.strictEqual((await updated).joinPolicy, joinPolicy);
  }

  host.emit('start_game');
  await once(host, 'game_started');
  return { host, joined };
}

async function run() {
  console.log('\nmultiplayer (e2e)');

  await test('the server advertises its capabilities on connect', () =>
    withTable(async open => {
      const ready = await once(open(), 'mp_ready');
      assert.strictEqual(ready.engineReady, true);
      assert.ok(ready.strategies.length > 0);
      assert.ok(ready.strategies.includes(ready.defaultStrategy));
      assert.deepStrictEqual(ready.joinPolicies, ['dropin', 'reconnect', 'disabled']);
      assert.ok(ready.joinPolicies.includes(ready.defaultJoinPolicy));
    })
  );

  await test('players typing the same code differently share one table', () =>
    withTable(async open => {
      const alice = open();
      const bob = open();
      await once(alice, 'mp_ready');
      await once(bob, 'mp_ready');

      alice.emit('join_room', { roomCode: 'baggle bytes', playerName: 'Alice' });
      const aliceJoin = await once(alice, 'room_joined');

      bob.emit('join_room', { roomCode: 'BAGGLE  BYTES ', playerName: 'Bob' });
      const bobJoin = await once(bob, 'room_joined');

      assert.strictEqual(aliceJoin.room, 'BAGGLE BYTES');
      assert.strictEqual(bobJoin.room, 'BAGGLE BYTES');
      assert.strictEqual(bobJoin.players.length, 2, 'both should be at one table');

      assert.strictEqual(aliceJoin.isHost, true, 'first in is host');
      assert.strictEqual(bobJoin.isHost, false);
      assert.notStrictEqual(aliceJoin.mySeat, bobJoin.mySeat);
    })
  );

  await test('a bad room code is rejected with a reason', () =>
    withTable(async open => {
      const socket = open();
      await once(socket, 'mp_ready');
      socket.emit('join_room', { roomCode: 'room#1', playerName: 'Alice' });
      const error = await once(socket, 'room_error');
      assert.match(error.message, /letters, numbers and spaces/);
    })
  );

  await test('a duplicate name at the same table is refused', () =>
    withTable(async open => {
      const alice = open();
      const clone = open();
      await once(alice, 'mp_ready');
      await once(clone, 'mp_ready');

      alice.emit('join_room', { roomCode: 'ROOM', playerName: 'Alice' });
      await once(alice, 'room_joined');

      clone.emit('join_room', { roomCode: 'ROOM', playerName: 'alice' });
      const error = await once(clone, 'room_error');
      assert.match(error.message, /already using that name/);
    })
  );

  await test('only the host can start the game', () =>
    withTable(async open => {
      const alice = open();
      const bob = open();
      await once(alice, 'mp_ready');
      await once(bob, 'mp_ready');

      alice.emit('join_room', { roomCode: 'ROOM', playerName: 'Alice' });
      await once(alice, 'room_joined');
      bob.emit('join_room', { roomCode: 'ROOM', playerName: 'Bob' });
      await once(bob, 'room_joined');

      bob.emit('start_game');
      const error = await once(bob, 'room_error');
      assert.match(error.message, /Only the host/);
    })
  );

  await test('starting deals each player their own blind seed only', () =>
    withTable(async open => {
      const alice = open();
      const bob = open();
      await once(alice, 'mp_ready');
      await once(bob, 'mp_ready');

      alice.emit('join_room', { roomCode: 'BAGGLE BYTES', playerName: 'Alice' });
      const aliceJoin = await once(alice, 'room_joined');
      bob.emit('join_room', { roomCode: 'BAGGLE BYTES', playerName: 'Bob' });
      const bobJoin = await once(bob, 'room_joined');

      const aliceSeed = once(alice, 'pregame_seed');
      const bobSeed = once(bob, 'pregame_seed');
      const started = once(alice, 'game_started');

      alice.emit('start_game');

      const startInfo = await started;
      assert.strictEqual(startInfo.botSeats.length, 2, 'two seats should be botted');

      const a = await aliceSeed;
      const b = await bobSeed;

      for (const [seed, join] of [[a, aliceJoin], [b, bobJoin]]) {
        assert.strictEqual(seed.seat, join.mySeat);
        assert.strictEqual(seed.seed.length, 52);
        assert.strictEqual([...seed.seed].filter(c => c !== '_').length, 12);
        const revealed = [...seed.seed].map((c, i) => (c === '_' ? -1 : i)).filter(i => i >= 0);
        assert.deepStrictEqual(revealed, seatIndices(join.mySeat));
      }

      const aPositions = new Set(seatIndices(aliceJoin.mySeat));
      for (const i of seatIndices(bobJoin.mySeat)) {
        assert.ok(!aPositions.has(i), 'seats must not share deck positions');
      }
      assert.notStrictEqual(a.seed, b.seed);
    })
  );

  await test('the table survives the host leaving', () =>
    withTable(async open => {
      const alice = open();
      const bob = open();
      await once(alice, 'mp_ready');
      await once(bob, 'mp_ready');

      alice.emit('join_room', { roomCode: 'HOST ROOM', playerName: 'Alice' });
      await once(alice, 'room_joined');
      bob.emit('join_room', { roomCode: 'HOST ROOM', playerName: 'Bob' });
      await once(bob, 'room_joined');

      const promoted = once(bob, 'host_promoted');
      const left = once(bob, 'player_left');
      alice.disconnect();

      await promoted;
      const info = await left;
      assert.strictEqual(info.leftName, 'Alice');
      assert.strictEqual(info.players.length, 1);
      assert.strictEqual(info.players[0].isHost, true, 'Bob should now be host');
    })
  );

  // ── Join policies ─────────────────────────────────────────────────

  await test("'disabled' refuses anyone once the game is in progress", () =>
    withTable(async open => {
      await startedRoom(open, 'DISABLED ROOM', { joinPolicy: 'disabled' });

      const late = open();
      await once(late, 'mp_ready');
      late.emit('join_room', { roomCode: 'DISABLED ROOM', playerName: 'Late' });
      const error = await once(late, 'room_error');
      assert.match(error.message, /already started/);
    })
  );

  await test("'disabled' refuses even the player who dropped out", () =>
    withTable(async open => {
      // Bob stays at the table, so the game is still going when Alice tries
      // to come back. (With nobody left the room is torn down instead, and
      // the next join legitimately opens a fresh one.)
      const alice = open();
      const bob = open();
      await once(alice, 'mp_ready');
      await once(bob, 'mp_ready');

      alice.emit('join_room', { roomCode: 'NO RETURN', playerName: 'Alice', deviceId: 'dev-alice' });
      await once(alice, 'room_joined');
      bob.emit('join_room', { roomCode: 'NO RETURN', playerName: 'Bob', deviceId: 'dev-bob' });
      await once(bob, 'room_joined');

      const updated = once(alice, 'room_updated');
      alice.emit('set_join_policy', { joinPolicy: 'disabled' });
      await updated;

      alice.emit('start_game');
      await once(alice, 'game_started');

      alice.disconnect();
      await settle(100);

      const back = open();
      await once(back, 'mp_ready');
      back.emit('join_room', { roomCode: 'NO RETURN', playerName: 'Alice', deviceId: 'dev-alice' });
      const error = await once(back, 'room_error');
      assert.match(error.message, /already started/);
    })
  );

  await test("'reconnect' makes a newcomer wait for the hand to end", () =>
    withTable(async open => {
      await startedRoom(open, 'RECONNECT ROOM', { joinPolicy: 'reconnect' });

      const late = open();
      await once(late, 'mp_ready');
      late.emit('join_room', { roomCode: 'RECONNECT ROOM', playerName: 'Late' });
      const pending = await once(late, 'join_pending');
      assert.match(pending.reason, /current hand/);
      assert.ok([1, 2, 3].includes(pending.seat));
    })
  );

  await test("'reconnect' lets the same device straight back into its seat", () =>
    withTable(async open => {
      const { host, joined } = await startedRoom(open, 'RETURN ROOM', { joinPolicy: 'reconnect' });
      const seat = joined.mySeat;

      host.disconnect();
      await settle(100);

      const back = open();
      await once(back, 'mp_ready');
      back.emit('join_room', {
        roomCode: 'RETURN ROOM',
        playerName: 'Alice',
        deviceId: 'dev-alice',
      });
      const rejoined = await once(back, 'game_joined');
      assert.strictEqual(rejoined.mySeat, seat, 'should get the same seat back');
      assert.strictEqual(rejoined.started, true);
    })
  );

  await test('a solo table is held open long enough to reconnect to', () =>
    withTable(async open => {
      // Alice plus three bots. Her dropping used to empty — and destroy — the
      // room, leaving nothing to come back to.
      const { host } = await startedRoom(open, 'SOLO ROOM', { joinPolicy: 'reconnect' });
      host.disconnect();
      await settle(150);

      assert.ok(rooms.has('SOLO ROOM'), 'the room should still exist');

      const back = open();
      await once(back, 'mp_ready');
      back.emit('join_room', { roomCode: 'SOLO ROOM', playerName: 'Alice', deviceId: 'dev-alice' });
      const rejoined = await once(back, 'game_joined');
      assert.strictEqual(rejoined.started, true);
    })
  );

  await test('a different device cannot steal a vacated seat', () =>
    withTable(async open => {
      const { host } = await startedRoom(open, 'STEAL ROOM', { joinPolicy: 'reconnect' });
      host.disconnect();
      await settle(100);

      // Same name, same machine (so the same IP) — different device token.
      const impostor = open();
      await once(impostor, 'mp_ready');
      impostor.emit('join_room', {
        roomCode: 'STEAL ROOM',
        playerName: 'Alice',
        deviceId: 'dev-mallory',
      });
      const pending = await once(impostor, 'join_pending');
      assert.match(pending.reason, /current hand/, 'should be queued, not handed the seat');
    })
  );

  await test("'dropin' routes a newcomer through the host", () =>
    withTable(async open => {
      const { host } = await startedRoom(open, 'DROPIN ROOM', { joinPolicy: 'dropin' });

      const late = open();
      await once(late, 'mp_ready');

      const request = once(host, 'dropin_request');
      const pending = once(late, 'join_pending');
      late.emit('join_room', { roomCode: 'DROPIN ROOM', playerName: 'Late', deviceId: 'dev-late' });

      const ask = await request;
      assert.strictEqual(ask.name, 'Late');
      assert.match((await pending).reason, /host/);

      const seated = once(late, 'game_joined');
      host.emit('dropin_response', { requestId: ask.requestId, accepted: true });
      assert.strictEqual((await seated).mySeat, ask.seat);
    })
  );

  await test("'dropin' lets the host decline", () =>
    withTable(async open => {
      const { host } = await startedRoom(open, 'DECLINE ROOM', { joinPolicy: 'dropin' });

      const late = open();
      await once(late, 'mp_ready');
      const request = once(host, 'dropin_request');
      late.emit('join_room', { roomCode: 'DECLINE ROOM', playerName: 'Late', deviceId: 'dev-late' });
      const ask = await request;

      const refused = once(late, 'room_error');
      host.emit('dropin_response', { requestId: ask.requestId, accepted: false });
      assert.match((await refused).message, /declined/);
    })
  );

  await test('only the host can answer a drop-in request', () =>
    withTable(async open => {
      const { host } = await startedRoom(open, 'GUARD ROOM', { joinPolicy: 'dropin' });

      const late = open();
      const other = open();
      await once(late, 'mp_ready');
      await once(other, 'mp_ready');

      const request = once(host, 'dropin_request');
      late.emit('join_room', { roomCode: 'GUARD ROOM', playerName: 'Late', deviceId: 'dev-late' });
      const ask = await request;

      // A socket that isn't the host tries to wave them in.
      other.emit('dropin_response', { requestId: ask.requestId, accepted: true });
      await settle(200);

      // The real host's approval still works, proving the first was ignored.
      const seated = once(late, 'game_joined');
      host.emit('dropin_response', { requestId: ask.requestId, accepted: true });
      assert.strictEqual((await seated).mySeat, ask.seat);
    })
  );

  await test("a mid-game arrival is dealt in with that seat's opening view", () =>
    withTable(async open => {
      const { host } = await startedRoom(open, 'SEED ROOM', { joinPolicy: 'dropin' });

      const late = open();
      await once(late, 'mp_ready');
      const request = once(host, 'dropin_request');
      late.emit('join_room', { roomCode: 'SEED ROOM', playerName: 'Late', deviceId: 'dev-late' });
      const ask = await request;

      const seed = once(late, 'pregame_seed');
      const state = once(late, 'game_state');
      host.emit('dropin_response', { requestId: ask.requestId, accepted: true });

      const got = await seed;
      assert.strictEqual(got.seat, ask.seat);
      assert.strictEqual(got.seed.length, 52);
      assert.strictEqual([...got.seed].filter(c => c !== '_').length, 12);
      assert.deepStrictEqual(
        [...got.seed].map((c, i) => (c === '_' ? -1 : i)).filter(i => i >= 0),
        seatIndices(ask.seat)
      );

      // They are a human at the table now, not a bot. Their own seat is
      // rotated to index 0 in the per-seat state.
      const gs = await state;
      assert.strictEqual(gs.players[0].isAI, false);
    })
  );

  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) process.exit(1);
}

run();
