/**
 * A server-authoritative Bid Whist table.
 *
 * Wraps the HostGame engine from the Node bundle (server/engine/bundle.cjs,
 * built by scripts/build-server-engine.js). The server deals, validates every
 * move and drives the bots, so no client — not even the room's host — ever
 * receives another seat's cards.
 *
 * Per-seat state already comes out of HostGame masked: MultiplayerGameState
 * carries only `myHand` plus other players' card counts.
 */

const path = require('path');
const { maskDeckForSeat, buildPostgameSeed } = require('./handSeed');

// Loaded lazily so `require('./roomGame')` doesn't explode when the engine
// bundle hasn't been built yet — server.js reports that as a clear error.
let engine = null;

function loadEngine() {
  if (engine) return engine;
  const bundlePath = path.join(__dirname, 'engine', 'bundle.cjs');
  try {
    engine = require(bundlePath);
  } catch (error) {
    throw new Error(
      `Multiplayer engine not built (${bundlePath}). Run "npm run build:engine". Cause: ${error.message}`
    );
  }
  return engine;
}

/** Is the engine bundle present and loadable? */
function engineAvailable() {
  try {
    loadEngine();
    return true;
  } catch {
    return false;
  }
}

/** Strategy names the host may choose for the bots. */
function availableStrategies() {
  const { STRATEGY_REGISTRY } = loadEngine();
  return STRATEGY_REGISTRY.filter(s => s.game === 'bidwhist').map(s => s.name);
}

class RoomGame {
  /**
   * @param {object} opts
   * @param {string}   opts.room        normalized room code
   * @param {Array}    opts.players     [{ socketId, name, seat }] humans only
   * @param {string}   opts.aiStrategy  strategy name for every bot
   * @param {Function} opts.emitToSeat  (seat, event, payload) => void
   * @param {Function} opts.emitToRoom  (event, payload) => void
   * @param {object}   [opts.announcer] Announcer instance
   */
  constructor({ room, players, aiStrategy, emitToSeat, emitToRoom, announcer }) {
    const { HostGame } = loadEngine();

    this.room = room;
    this.emitToSeat = emitToSeat;
    this.emitToRoom = emitToRoom;
    this.announcer = announcer || null;
    this.destroyed = false;
    this.handBoundaryCallback = null;

    // Blind seed each seat was dealt this hand, keyed by seat. Every seat is
    // stored, not just the occupied ones, so a player taking over a bot seat
    // mid-hand can still be handed that seat's opening view.
    this.pregameSeeds = new Map();
    this.handsPlayed = 0;
    this.lastRecord = null;

    this.host = new HostGame(
      players.map(p => ({ name: p.name, seat: p.seat, isHost: false })),
      aiStrategy
    );

    this.host.onBroadcast(states => {
      if (this.destroyed) return;
      for (const [seat, state] of states) {
        this.emitToSeat(seat, 'game_state', state);
      }
    });

    this.host.onLifecycle(kind => {
      if (this.destroyed) return;
      try {
        if (kind === 'deal') this._onDeal();
        else if (kind === 'handComplete') this._onHandComplete();
        else if (kind === 'gameOver') this._onGameOver();
      } catch (error) {
        // A recording or announcing fault must never stall the table.
        console.error(`[MP] ${this.room}: lifecycle ${kind} failed: ${error.message}`);
      }
    });
  }

  start() {
    this.host.startGame();
  }

  handleAction(seat, action) {
    if (this.destroyed) return false;
    return this.host.handlePlayerAction(seat, action);
  }

  /**
   * Called once per completed hand — the moment queued players can be seated
   * without disturbing a hand in flight.
   */
  onHandBoundary(callback) {
    this.handBoundaryCallback = callback;
  }

  /**
   * Hand a bot-held seat to a human, mid-hand if need be.
   *
   * They inherit the seat as the bot left it, and are given that seat's
   * opening blind seed so their end-of-hand summary is complete.
   */
  addPlayer(seat, name) {
    if (this.destroyed) return;
    this.host.addPlayer(seat, name);

    const seed = this.pregameSeeds.get(seat);
    if (seed) this.emitToSeat(seat, 'pregame_seed', { seat, seed });
  }

  /** Seats a bot is currently playing. */
  getBotSeats() {
    const humans = this.host.getHumanSeats();
    return [0, 1, 2, 3].filter(seat => !humans.has(seat));
  }

  /** A human left: their seat is taken over by a bot. */
  removePlayer(seat) {
    if (this.destroyed) return;
    this.host.removePlayer(seat);
  }

  getPlayerNames() {
    return this.host.getPlayerNames();
  }

  /** The blind seed a seat was dealt this hand, if any. */
  getPregameSeed(seat) {
    return this.pregameSeeds.get(seat) || null;
  }

  destroy() {
    this.destroyed = true;
    this.host.destroy();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Fresh hand: hand each seat only its own 12 cards, as an
   * "A___B___C___..." seed that replays as "my hand, everyone else random".
   */
  _onDeal() {
    const deck = this.host.getGame().getLastDealtDeckUrl();
    const humans = this.host.getHumanSeats();
    this.pregameSeeds.clear();

    for (let seat = 0; seat < 4; seat++) {
      const seed = maskDeckForSeat(deck, seat);
      this.pregameSeeds.set(seat, seed);
      // Stored for every seat, but only ever sent to the person sitting in it.
      if (humans.has(seat)) this.emitToSeat(seat, 'pregame_seed', { seat, seed });
    }
  }

  /**
   * Hand finished scoring. Declarer and trump are still set here, so this is
   * the only moment the hand can be encoded as a BWR1 record.
   */
  _onHandComplete() {
    const { buildHandRecord, encodeHandRecord } = loadEngine();
    const game = this.host.getGame();

    this.handsPlayed += 1;

    const record = buildHandRecord(game, [], null);
    const encoded = record ? encodeHandRecord(record) : null;
    const deal = game.getLastDealtDeckUrl();
    this.lastRecord = { deal, encoded };

    // Each player gets both seeds: the blind view they started the hand with,
    // and the full, replayable playout.
    for (const seat of this.host.getHumanSeats()) {
      this.emitToSeat(seat, 'postgame_seed', {
        seat,
        pregame: this.pregameSeeds.get(seat) || null,
        ...buildPostgameSeed(deal, encoded),
      });
    }

    // Between hands is when anyone waiting to join can be seated.
    if (this.handBoundaryCallback) this.handBoundaryCallback();
  }

  _onGameOver() {
    const game = this.host.getGame();
    const teamScores = game.getTeamScores();
    const names = this.host.getPlayerNames();

    this.emitToRoom('match_over', { teamScores, hands: this.handsPlayed });

    if (!this.announcer) return;

    const deal = this.lastRecord ? this.lastRecord.deal : '';
    const encoded = this.lastRecord ? this.lastRecord.encoded : null;

    // Fire-and-forget: the table must not wait on a Signal round trip, and
    // announcing already swallows its own failures.
    Promise.allSettled([
      this.announcer.announceScore(this.room, {
        teamScores,
        names,
        hands: this.handsPlayed,
      }),
      this.announcer.announceArchive(this.room, { encoded }),
      this.announcer.announceRedacted(this.room, {
        deal,
        teamScores,
        hands: this.handsPlayed,
      }),
    ]);
  }
}

module.exports = {
  RoomGame,
  loadEngine,
  engineAvailable,
  availableStrategies,
};
