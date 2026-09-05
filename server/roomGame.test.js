/**
 * Drives a full server-authoritative table and checks the thing that matters
 * most: a player's socket never carries another seat's cards.
 *
 * HostGame paces itself with setTimeout (1-1.5s per bot move, 4s between
 * hands). Real time would make this test take minutes, so the timers are
 * swapped for an immediate queue that the test drains step by step.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

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

const bundlePath = path.join(__dirname, 'engine', 'bundle.cjs');
if (!fs.existsSync(bundlePath)) {
  console.error('\nroomGame: engine bundle missing — run "npm run build:engine" first');
  process.exit(1);
}

const { RoomGame } = require('./roomGame');
const { letterToCard } = require(bundlePath);
const { seatIndices } = require('./handSeed');

// ── Deterministic-order fake timers ──────────────────────────────────

const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;

function installFakeTimers() {
  const queue = [];
  let nextId = 1;

  global.setTimeout = (fn, delay) => {
    const id = nextId++;
    queue.push({ id, fn, delay });
    return id;
  };
  global.clearTimeout = id => {
    const i = queue.findIndex(t => t.id === id);
    if (i >= 0) queue.splice(i, 1);
  };

  return {
    queue,
    /** Run one queued callback. Returns false when the queue is empty. */
    step() {
      if (queue.length === 0) return false;
      queue.shift().fn();
      return true;
    },
    /** Run queued callbacks in causal (FIFO) order until empty or budget hit. */
    drain(maxSteps = 20000) {
      let steps = 0;
      while (steps < maxSteps && this.step()) steps++;
      return steps;
    },
    restore() {
      global.setTimeout = realSetTimeout;
      global.clearTimeout = realClearTimeout;
    },
  };
}

/** Build a table with humans on the given seats and bots everywhere else. */
function makeTable(humanSeats = [0]) {
  const toSeat = [];
  const toRoom = [];

  const timers = installFakeTimers();
  const game = new RoomGame({
    room: 'TEST ROOM',
    players: humanSeats.map(seat => ({
      socketId: `sock-${seat}`,
      name: `Human ${seat}`,
      seat,
    })),
    aiStrategy: 'Claude Omni',
    emitToSeat: (seat, event, payload) => toSeat.push({ seat, event, payload }),
    emitToRoom: (event, payload) => toRoom.push({ event, payload }),
    announcer: null,
  });

  return { game, toSeat, toRoom, timers };
}

const eventsFor = (log, seat, event) =>
  log.filter(e => e.seat === seat && e.event === event).map(e => e.payload);

/**
 * Play the table forward, answering for the human seats with the simplest
 * legal action, until the queue drains or the budget runs out.
 *
 * Human turns are answered outside the emit callback so the engine is never
 * re-entered mid-broadcast.
 */
function playOut({ game, toSeat, timers }, humanSeats, maxSteps = 4000) {
  for (let step = 0; step < maxSteps; step++) {
    let acted = false;

    for (const seat of humanSeats) {
      const states = eventsFor(toSeat, seat, 'game_state');
      const state = states[states.length - 1];
      if (!state || !state.isMyTurn) continue;

      const action = simplestAction(state);
      if (action && game.handleAction(seat, action)) acted = true;
    }

    if (acted) continue;
    if (!timers.step()) break;
  }
}

/** The least interesting legal action for a state awaiting a human. */
function simplestAction(state) {
  switch (state.turnPhase) {
    case 'bid':
      return { type: 'bid', amount: 0 }; // pass
    case 'trump':
      return { type: 'trump', suit: 'spades', direction: 'uptown' };
    case 'discard':
      return { type: 'discard', cardIds: state.myHand.slice(0, 4).map(c => c.id) };
    case 'play': {
      const move = (state.validMoves || [])[0] || state.myHand[0];
      return move ? { type: 'play', cardId: move.id } : null;
    }
    default:
      return null;
  }
}

console.log('\nroomGame');

test('a deal hands each human only their own 12 cards as a blind seed', () => {
  const { game, toSeat, timers } = makeTable([0, 1]);
  try {
    game.start();

    for (const seat of [0, 1]) {
      const seeds = eventsFor(toSeat, seat, 'pregame_seed');
      assert.strictEqual(seeds.length, 1, `seat ${seat} got ${seeds.length} seeds`);

      const { seed } = seeds[0];
      assert.strictEqual(seed.length, 52);
      assert.strictEqual(
        [...seed].filter(c => c !== '_').length,
        12,
        `seat ${seat} seed should reveal exactly 12 cards`
      );

      // Revealed positions must be exactly that seat's deal indices.
      const revealed = [...seed]
        .map((c, i) => (c === '_' ? -1 : i))
        .filter(i => i >= 0);
      assert.deepStrictEqual(revealed, seatIndices(seat));
    }
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('the kitty is hidden from everyone at deal time', () => {
  const { game, toSeat, timers } = makeTable([0, 1, 2, 3]);
  try {
    game.start();
    for (const seat of [0, 1, 2, 3]) {
      const { seed } = eventsFor(toSeat, seat, 'pregame_seed')[0];
      assert.strictEqual(seed.slice(48), '____', `seat ${seat} can see the kitty`);
    }
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('the opening game_state contains no other seat\'s cards', () => {
  const { game, toSeat, timers } = makeTable([0]);
  try {
    game.start();

    const deck = game.host.getGame().getLastDealtDeckUrl();
    const mine = new Set(seatIndices(0).map(i => letterToCard(deck[i]).id));
    const theirs = new Set();
    for (let i = 0; i < 52; i++) {
      const id = letterToCard(deck[i]).id;
      if (!mine.has(id)) theirs.add(id);
    }

    // The first state is pre-play, so every card id in it must be mine.
    const first = eventsFor(toSeat, 0, 'game_state')[0];
    assert.ok(first, 'expected an opening game_state');
    assert.strictEqual(first.myHand.length, 12);

    const wire = JSON.stringify(first);
    for (const id of theirs) {
      assert.ok(!wire.includes(`"${id}"`), `opening state leaked ${id}`);
    }
    for (const id of mine) {
      assert.ok(wire.includes(`"${id}"`), `opening state is missing my card ${id}`);
    }
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('other seats are described only by card count', () => {
  const { game, toSeat, timers } = makeTable([0]);
  try {
    game.start();
    const first = eventsFor(toSeat, 0, 'game_state')[0];
    assert.strictEqual(first.players.length, 4);
    for (let i = 1; i < 4; i++) {
      assert.strictEqual(first.players[i].cardCount, 12);
      assert.strictEqual(first.players[i].isAI, true);
      assert.strictEqual(first.players[i].hand, undefined);
    }
    // Seat 0 is the human, rotated to index 0.
    assert.strictEqual(first.players[0].isAI, false);
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('bots fill the empty seats and play a hand to completion', () => {
  const { game, toSeat, timers } = makeTable([0]);
  try {
    game.start();
    // Seat 0 only ever passes and dumps its first legal card, so the hand can
    // only reach scoring if the three bots bid, call trump and play it out.
    playOut({ game, toSeat, timers }, [0]);

    const finished = eventsFor(toSeat, 0, 'postgame_seed');
    assert.ok(finished.length >= 1, 'expected at least one completed hand');
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('a finished hand yields a 52-char deal and a replayable record', () => {
  const { game, toSeat, timers } = makeTable([0]);
  try {
    game.start();
    playOut({ game, toSeat, timers }, [0]);

    const [result] = eventsFor(toSeat, 0, 'postgame_seed');
    assert.strictEqual(result.deal.length, 52);
    assert.ok(!result.deal.includes('_'), 'the post-game deal is fully revealed');

    // The blind seed the player started with comes back alongside it.
    assert.strictEqual(result.pregame.length, 52);
    assert.strictEqual([...result.pregame].filter(c => c !== '_').length, 12);

    // All-pass hands legitimately have no record; otherwise it must decode.
    if (result.record) {
      const { decodeHandRecord } = require(bundlePath);
      const decoded = decodeHandRecord(result.record);
      assert.strictEqual(decoded.deal.length, 52);
      assert.strictEqual(decoded.deal, result.deal);
    }
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('the pregame seed replays as "my hand, everyone else random"', () => {
  const { game, toSeat, timers } = makeTable([0]);
  try {
    game.start();
    const { seed } = eventsFor(toSeat, 0, 'pregame_seed')[0];
    const deck = game.host.getGame().getLastDealtDeckUrl();

    // Feeding the masked seed back through the engine must reproduce the
    // same hand for seat 0 and fill the rest at random.
    const { BidWhistGame } = require(bundlePath);
    const replay = new BidWhistGame();
    replay.dealCards(seed);

    const originalHand = seatIndices(0).map(i => letterToCard(deck[i]).id).sort();
    const replayedHand = replay.getGameState().players[0].hand.map(c => c.id).sort();
    assert.deepStrictEqual(replayedHand, originalHand);
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('a departing human is replaced by a bot rather than stalling the table', () => {
  const { game, toSeat, timers } = makeTable([0, 1]);
  try {
    game.start();
    game.removePlayer(1);
    playOut({ game, toSeat, timers }, [0]);

    // Seat 0 still gets a completed hand even though seat 1 walked away.
    assert.ok(eventsFor(toSeat, 0, 'postgame_seed').length >= 1);
    // And seat 1 stops receiving state once it is a bot.
    const seat1States = eventsFor(toSeat, 1, 'game_state').length;
    const seat0States = eventsFor(toSeat, 0, 'game_state').length;
    assert.ok(seat0States > seat1States, 'seat 1 should stop receiving updates');
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('a human can take over a bot seat mid-hand', () => {
  const { game, toSeat, timers } = makeTable([0]);
  try {
    game.start();
    timers.step(); // let the table move at least once

    assert.deepStrictEqual(game.getBotSeats(), [1, 2, 3]);
    game.addPlayer(1, 'Late');
    assert.deepStrictEqual(game.getBotSeats(), [2, 3]);

    const states = eventsFor(toSeat, 1, 'game_state');
    assert.ok(states.length > 0, 'the new arrival should start receiving state');
    // Their own seat is rotated to index 0, and is no longer a bot.
    assert.strictEqual(states[states.length - 1].players[0].isAI, false);
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('the bot does not keep playing for a seat a human took over', () => {
  const { game, toSeat, timers } = makeTable([0]);
  try {
    game.start();
    timers.step();
    game.addPlayer(1, 'Late');

    // Answer only for seat 0. If a stale bot timer were still live for seat 1
    // it would bid and play on their behalf and the hand would finish.
    playOut({ game, toSeat, timers }, [0]);

    assert.strictEqual(
      eventsFor(toSeat, 0, 'postgame_seed').length,
      0,
      'the hand must stall waiting on the taken-over seat'
    );

    const states = eventsFor(toSeat, 1, 'game_state');
    const last = states[states.length - 1];
    assert.strictEqual(last.isMyTurn, true, 'the table should be waiting on seat 1');
  } finally {
    game.destroy();
    timers.restore();
  }
});

test("a mid-hand arrival is handed that seat's opening blind view", () => {
  const { game, toSeat, timers } = makeTable([0]);
  try {
    game.start();
    const deck = game.host.getGame().getLastDealtDeckUrl();

    game.addPlayer(2, 'Late');

    const [seed] = eventsFor(toSeat, 2, 'pregame_seed');
    assert.ok(seed, "expected the seat's opening seed");
    assert.strictEqual(seed.seat, 2);
    assert.deepStrictEqual(
      [...seed.seed].map((c, i) => (c === '_' ? -1 : i)).filter(i => i >= 0),
      seatIndices(2)
    );
    for (const i of seatIndices(2)) assert.strictEqual(seed.seed[i], deck[i]);
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('the hand boundary hook fires once a hand completes', () => {
  const { game, toSeat, timers } = makeTable([0]);
  try {
    let boundaries = 0;
    game.onHandBoundary(() => { boundaries += 1; });

    game.start();
    assert.strictEqual(boundaries, 0, 'not until a hand actually finishes');

    playOut({ game, toSeat, timers }, [0]);
    assert.ok(boundaries >= 1, 'expected at least one hand boundary');
  } finally {
    game.destroy();
    timers.restore();
  }
});

test('destroy stops the table', () => {
  const { game, toSeat, timers } = makeTable([0]);
  try {
    game.start();
    const before = toSeat.length;
    game.destroy();
    timers.drain(2000);
    assert.strictEqual(toSeat.length, before, 'no events after destroy');
  } finally {
    timers.restore();
  }
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) process.exit(1);
