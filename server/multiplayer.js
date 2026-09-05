/**
 * Jackbox-style matchmaking and server-authoritative Bid Whist tables.
 *
 * There is no create/join distinction: everyone types the same room code and
 * lands at the same table. Whoever arrives first is the host, and presses "go"
 * when the table looks right; bots fill whatever seats are still empty.
 *
 * The game itself runs here (see roomGame.js), not in the host's browser, so
 * each player's socket only ever receives their own cards.
 */

const { Server } = require('socket.io');
const { parseRoomCode } = require('./roomCode');
const { RoomGame, engineAvailable, availableStrategies } = require('./roomGame');
const {
  JOIN_POLICIES,
  DEFAULT_JOIN_POLICY,
  isValidJoinPolicy,
  decideJoin,
} = require('./joinPolicy');

const MAX_SEATS = 4;
const MAX_NAME_LENGTH = 20;
const IDLE_ROOM_MS = 30 * 60 * 1000;   // reap rooms nobody has touched in 30m
const REAP_INTERVAL_MS = 5 * 60 * 1000;
// How long an in-progress room with nobody left in it waits for someone to
// reconnect before it is torn down. Without this, one dropped connection in a
// solo-plus-bots game would destroy the very table they're trying to rejoin.
const EMPTY_ROOM_GRACE_MS = 2 * 60 * 1000;

/** roomCode -> room */
const rooms = new Map();

function publicPlayers(room) {
  return room.players.map(p => ({
    name: p.name,
    seat: p.seat,
    isHost: p.socketId === room.hostSocketId,
  }));
}

function roomSummary(room) {
  return {
    room: room.code,
    players: publicPlayers(room),
    aiStrategy: room.aiStrategy,
    joinPolicy: room.joinPolicy,
    started: room.started,
    hostingAnnounced: room.hostingAnnounced,
    // Seats a bot is holding — what a late arrival can ask for.
    openSeats: room.game ? room.game.getBotSeats() : freeSeats(room),
  };
}

function freeSeats(room) {
  const taken = new Set(room.players.map(p => p.seat));
  return [0, 1, 2, 3].filter(seat => !taken.has(seat));
}

/** Best-effort client address, for the weak same-network reconnect signal. */
function clientIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || '';
}

function firstOpenSeat(room) {
  const taken = new Set(room.players.map(p => p.seat));
  for (let i = 0; i < MAX_SEATS; i++) {
    if (!taken.has(i)) return i;
  }
  return -1;
}

function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * @param {import('http').Server} httpServer
 * @param {object} [options]
 * @param {object} [options.announcer] Announcer instance; announcements are
 *   skipped entirely when absent.
 * @param {Function} [options.hostUrl] () => string, used in the hosting post.
 */
function initMultiplayer(httpServer, { announcer = null, hostUrl = null } = {}) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  const engineReady = engineAvailable();
  if (!engineReady) {
    console.warn(
      '[MP] Engine bundle missing — matchmaking will run but games cannot start. Run "npm run build:engine".'
    );
  }

  const strategies = engineReady ? availableStrategies() : [];
  const defaultStrategy = strategies.includes('Claude Omni')
    ? 'Claude Omni'
    : strategies[0] || 'Family';

  function emitRoomState(room) {
    io.to(room.code).emit('room_updated', roomSummary(room));
  }

  function seatSocketId(room, seat) {
    const player = room.players.find(p => p.seat === seat);
    return player ? player.socketId : null;
  }

  function destroyRoom(room, reason) {
    cancelEmptyRoomTimer(room);
    if (room.game) room.game.destroy();
    rooms.delete(room.code);
    if (announcer) announcer.forgetRoom(room.code);
    console.log(`[MP] Room "${room.code}" closed (${reason})`);
  }

  /** The room a socket is sitting in, if any. */
  function roomOf(sock) {
    return sock.data.room ? rooms.get(sock.data.room) : null;
  }

  function cancelEmptyRoomTimer(room) {
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
  }

  /**
   * Seat a socket at the table. Mid-game this takes over a bot's seat — cards
   * and score included — and hands the arrival that seat's opening blind view.
   */
  function admitPlayer(room, sock, { name, deviceId, ip, seat }) {
    room.players.push({ socketId: sock.id, name, seat, deviceId: deviceId || null, ip: ip || '' });
    room.vacancies.delete(seat);
    room.lastActivity = Date.now();
    cancelEmptyRoomTimer(room);

    sock.data.room = room.code;
    sock.join(room.code);

    const mine = {
      ...roomSummary(room),
      isHost: room.hostSocketId === sock.id,
      mySeat: seat,
    };
    // Mid-game arrivals skip the waiting room and go straight to the table.
    sock.emit(room.game ? 'game_joined' : 'room_joined', mine);
    sock.to(room.code).emit('room_updated', roomSummary(room));

    if (room.game) room.game.addPlayer(seat, name);
  }

  /**
   * Seat whoever has been waiting for the hand to end ('reconnect' mode).
   * Called at each hand boundary.
   */
  function drainQueue(room) {
    if (room.queued.length === 0) return;

    const waiting = room.queued;
    room.queued = [];

    for (const entry of waiting) {
      const sock = io.sockets.sockets.get(entry.socketId);
      if (!sock) continue; // gave up waiting

      const botSeats = room.game ? room.game.getBotSeats() : freeSeats(room);
      const seat = botSeats.includes(entry.seat) ? entry.seat : botSeats[0];
      if (seat === undefined) {
        sock.emit('room_error', { message: 'That seat was taken while you waited' });
        continue;
      }

      admitPlayer(room, sock, { ...entry, seat });
      io.to(room.code).emit('player_returned', { ...roomSummary(room), name: entry.name, seat });
      console.log(`[MP] ${entry.name} was seated at ${seat} of "${room.code}" between hands`);
    }
  }

  /**
   * Build the table. Deliberately does NOT deal — callers announce
   * 'game_started' first, so clients are listening before the first
   * 'pregame_seed' lands.
   */
  function createRoomGame(room) {
    room.game = new RoomGame({
      room: room.code,
      players: room.players.map(p => ({ ...p })),
      aiStrategy: room.aiStrategy,
      announcer,
      emitToSeat: (seat, event, payload) => {
        const socketId = seatSocketId(room, seat);
        if (socketId) io.to(socketId).emit(event, payload);
      },
      emitToRoom: (event, payload) => io.to(room.code).emit(event, payload),
    });

    room.game.onHandBoundary(() => drainQueue(room));
    room.started = true;
  }

  io.on('connection', socket => {
    console.log(`[MP] Client connected: ${socket.id}`);
    // Kept on the socket rather than in a closure so that seating logic can
    // act on a socket other than the one handling the current event.
    socket.data.room = null;

    function currentRoom() {
      return roomOf(socket);
    }

    function isHost(room) {
      return room && room.hostSocketId === socket.id;
    }

    socket.emit('mp_ready', {
      strategies,
      defaultStrategy,
      joinPolicies: JOIN_POLICIES,
      defaultJoinPolicy: DEFAULT_JOIN_POLICY,
      engineReady,
      announcer: announcer ? announcer.adapterName : null,
    });

    // ── Matchmaking ──────────────────────────────────────────────────

    socket.on('join_room', ({ roomCode, playerName, deviceId, requestedSeat } = {}) => {
      const parsed = parseRoomCode(roomCode);
      if (!parsed.ok) {
        socket.emit('room_error', { message: parsed.error });
        return;
      }

      const name = sanitizeName(playerName);
      if (!name) {
        socket.emit('room_error', { message: 'Enter your name' });
        return;
      }

      const code = parsed.code;
      let room = rooms.get(code);

      if (!room) {
        room = {
          code,
          players: [],
          hostSocketId: socket.id,
          aiStrategy: defaultStrategy,
          joinPolicy: DEFAULT_JOIN_POLICY,
          started: false,
          game: null,
          hostingAnnounced: false,
          vacancies: new Map(),   // seat -> who left it
          queued: [],             // waiting for the hand to finish
          dropinRequests: new Map(),
          emptyTimer: null,
          lastActivity: Date.now(),
        };
        rooms.set(code, room);
        console.log(`[MP] Room "${code}" opened by ${name}`);
      }

      const claimant = { name, deviceId: deviceId || null, ip: clientIp(socket) };

      // A name already in use is only a clash if that player is actually here;
      // the same name sitting in a vacancy is the whole point of reconnecting.
      if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        socket.emit('room_error', { message: 'Someone at that table is already using that name' });
        return;
      }

      const seatOf = seat => (Number.isInteger(seat) && seat >= 0 && seat < MAX_SEATS ? seat : null);

      const decision = decideJoin({
        policy: room.joinPolicy,
        gameInProgress: !!room.game,
        claimant,
        vacancies: room.vacancies,
        botSeats: room.game ? room.game.getBotSeats() : [],
        requestedSeat: seatOf(requestedSeat),
      });

      switch (decision.action) {
        case 'seat': {
          if (room.players.length >= MAX_SEATS) {
            socket.emit('room_error', { message: 'That table is full (4 players)' });
            return;
          }
          const seat = seatOf(requestedSeat) !== null && !room.players.some(p => p.seat === requestedSeat)
            ? requestedSeat
            : firstOpenSeat(room);
          admitPlayer(room, socket, { ...claimant, seat });
          console.log(`[MP] ${name} joined "${code}" at seat ${seat}`);
          return;
        }

        case 'reclaim': {
          admitPlayer(room, socket, { ...claimant, seat: decision.seat });
          io.to(code).emit('player_returned', {
            ...roomSummary(room),
            name,
            seat: decision.seat,
          });
          console.log(`[MP] ${name} reclaimed seat ${decision.seat} in "${code}" (via ${decision.via})`);
          return;
        }

        case 'ask-host': {
          const requestId = `${socket.id}:${Date.now()}`;
          room.dropinRequests.set(requestId, { socketId: socket.id, ...claimant, seat: decision.seat });
          socket.emit('join_pending', {
            room: code,
            seat: decision.seat,
            reason: 'Waiting for the host to let you in',
          });
          io.to(room.hostSocketId).emit('dropin_request', {
            requestId,
            name,
            seat: decision.seat,
          });
          console.log(`[MP] ${name} asked to drop into seat ${decision.seat} of "${code}"`);
          return;
        }

        case 'queue': {
          room.queued.push({ socketId: socket.id, ...claimant, seat: decision.seat });
          socket.emit('join_pending', {
            room: code,
            seat: decision.seat,
            reason: decision.reason,
          });
          console.log(`[MP] ${name} queued for seat ${decision.seat} of "${code}"`);
          return;
        }

        default:
          socket.emit('room_error', { message: decision.reason });
      }
    });

    /** Host's answer to a drop-in request. */
    socket.on('dropin_response', ({ requestId, accepted } = {}) => {
      const room = currentRoom();
      if (!room || !isHost(room)) return;

      const request = room.dropinRequests.get(requestId);
      if (!request) return;
      room.dropinRequests.delete(requestId);

      const waiting = io.sockets.sockets.get(request.socketId);
      if (!waiting) return; // they gave up

      if (!accepted) {
        waiting.emit('room_error', { message: 'The host declined your request to join' });
        return;
      }

      // The table moved on while the host decided — re-check the seat.
      const botSeats = room.game ? room.game.getBotSeats() : [];
      const seat = botSeats.includes(request.seat) ? request.seat : botSeats[0];
      if (seat === undefined) {
        waiting.emit('room_error', { message: 'That seat was taken while you waited' });
        return;
      }

      admitPlayer(room, waiting, { ...request, seat });
      console.log(`[MP] Host let ${request.name} into seat ${seat} of "${room.code}"`);
    });

    socket.on('leave_room', () => {
      handleDeparture('left');
    });

    socket.on('set_strategy', ({ aiStrategy } = {}) => {
      const room = currentRoom();
      if (!room || !isHost(room) || room.started) return;
      if (!strategies.includes(aiStrategy)) return;
      room.aiStrategy = aiStrategy;
      room.lastActivity = Date.now();
      emitRoomState(room);
    });

    socket.on('set_join_policy', ({ joinPolicy } = {}) => {
      const room = currentRoom();
      if (!room || !isHost(room)) return;
      if (!isValidJoinPolicy(joinPolicy)) return;
      room.joinPolicy = joinPolicy;
      room.lastActivity = Date.now();
      emitRoomState(room);
    });

    socket.on('move_seat', ({ targetSeat } = {}) => {
      const room = currentRoom();
      if (!room || room.started) return;
      if (!Number.isInteger(targetSeat) || targetSeat < 0 || targetSeat >= MAX_SEATS) return;

      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;
      if (room.players.some(p => p.seat === targetSeat)) {
        socket.emit('room_error', { message: 'That seat is taken' });
        return;
      }

      player.seat = targetSeat;
      room.lastActivity = Date.now();
      socket.emit('seat_changed', { mySeat: targetSeat, ...roomSummary(room) });
      socket.to(room.code).emit('room_updated', roomSummary(room));
    });

    /** Ask the player in `targetSeat` to trade places. */
    socket.on('request_swap', ({ targetSeat } = {}) => {
      const room = currentRoom();
      if (!room || room.started) return;
      if (!Number.isInteger(targetSeat) || targetSeat < 0 || targetSeat >= MAX_SEATS) return;

      const requester = room.players.find(p => p.socketId === socket.id);
      if (!requester || requester.seat === targetSeat) return;

      const target = room.players.find(p => p.seat === targetSeat);
      if (!target) {
        // Nobody there — just move, no need to ask.
        requester.seat = targetSeat;
        room.lastActivity = Date.now();
        socket.emit('seat_changed', { mySeat: targetSeat, ...roomSummary(room) });
        socket.to(room.code).emit('room_updated', roomSummary(room));
        return;
      }

      io.to(target.socketId).emit('swap_request', {
        fromName: requester.name,
        fromSeat: requester.seat,
        targetSeat,
      });
    });

    socket.on('swap_response', ({ accepted, fromSeat } = {}) => {
      const room = currentRoom();
      if (!room || room.started) return;

      const responder = room.players.find(p => p.socketId === socket.id);
      const requester = room.players.find(p => p.seat === fromSeat);
      if (!responder || !requester || responder === requester) return;

      if (!accepted) {
        io.to(requester.socketId).emit('swap_declined', { byName: responder.name });
        return;
      }

      const held = responder.seat;
      responder.seat = requester.seat;
      requester.seat = held;
      room.lastActivity = Date.now();

      // Both movers need their own new seat; everyone else just needs the table.
      io.to(requester.socketId).emit('seat_changed', { mySeat: requester.seat, ...roomSummary(room) });
      io.to(responder.socketId).emit('seat_changed', { mySeat: responder.seat, ...roomSummary(room) });
      for (const p of room.players) {
        if (p !== requester && p !== responder) {
          io.to(p.socketId).emit('room_updated', roomSummary(room));
        }
      }
    });

    // ── Starting the game ────────────────────────────────────────────

    socket.on('start_game', () => {
      const room = currentRoom();
      if (!room) return;
      if (!isHost(room)) {
        socket.emit('room_error', { message: 'Only the host can start the game' });
        return;
      }
      if (room.started) return;
      if (!engineReady) {
        socket.emit('room_error', {
          message: 'The game engine is not built on this server',
        });
        return;
      }

      const botSeats = [];
      const taken = new Set(room.players.map(p => p.seat));
      for (let i = 0; i < MAX_SEATS; i++) if (!taken.has(i)) botSeats.push(i);

      try {
        createRoomGame(room);
      } catch (error) {
        console.error(`[MP] Failed to start "${room.code}": ${error.message}`);
        socket.emit('room_error', { message: 'Could not start the game' });
        return;
      }

      room.lastActivity = Date.now();
      io.to(room.code).emit('game_started', {
        ...roomSummary(room),
        botSeats,
        playerNames: room.game.getPlayerNames(),
      });

      // Only now deal — the first per-seat seeds must arrive after clients
      // know the game has begun.
      room.game.start();

      console.log(
        `[MP] "${room.code}" started: ${room.players.length} human(s), ` +
          `${botSeats.length} bot(s) on ${room.aiStrategy}`
      );
    });

    /** The host's one-shot "someone is hosting" Signal post. */
    socket.on('announce_hosting', async () => {
      const room = currentRoom();
      if (!room || !isHost(room)) return;

      if (!announcer) {
        socket.emit('hosting_result', { sent: false, reason: 'No Signal bot configured' });
        return;
      }
      if (room.hostingAnnounced) {
        socket.emit('hosting_result', { sent: false, reason: 'Already announced' });
        return;
      }

      const host = room.players.find(p => p.socketId === socket.id);
      const result = await announcer.announceHosting(room.code, {
        hostName: host ? host.name : undefined,
        url: typeof hostUrl === 'function' ? hostUrl() : hostUrl || undefined,
      });

      if (result.sent) {
        room.hostingAnnounced = true;
        emitRoomState(room);
      }
      socket.emit('hosting_result', result);
    });

    // ── In-game ──────────────────────────────────────────────────────

    socket.on('player_action', ({ action } = {}) => {
      const room = currentRoom();
      if (!room || !room.game) return;

      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;

      room.lastActivity = Date.now();
      const accepted = room.game.handleAction(player.seat, action);
      if (!accepted) {
        // Re-sync the client that tried something illegal or stale.
        socket.emit('action_rejected', { action });
      }
    });

    // ── Departure ────────────────────────────────────────────────────

    function handleDeparture(why) {
      const room = currentRoom();
      socket.data.room = null;
      if (!room) return;

      socket.leave(room.code);

      // Drop any pending interest this socket had in the room.
      room.queued = room.queued.filter(q => q.socketId !== socket.id);
      for (const [id, request] of room.dropinRequests) {
        if (request.socketId === socket.id) room.dropinRequests.delete(id);
      }

      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;
      room.players = room.players.filter(p => p.socketId !== socket.id);
      room.lastActivity = Date.now();

      // Mid-game, the empty seat is taken over by a bot — and remembered, so
      // the player who left can claim it back under 'dropin'/'reconnect'.
      if (room.game) {
        room.game.removePlayer(player.seat);
        if (room.joinPolicy !== 'disabled') {
          room.vacancies.set(player.seat, {
            name: player.name,
            deviceId: player.deviceId,
            ip: player.ip,
            ts: Date.now(),
          });
        }
      }

      if (room.players.length === 0) {
        // An in-progress table that allows rejoining is held open briefly —
        // otherwise a single dropped connection in a solo game destroys the
        // very table the player is trying to get back into.
        if (room.game && room.joinPolicy !== 'disabled') {
          cancelEmptyRoomTimer(room);
          room.emptyTimer = setTimeout(() => {
            if (room.players.length === 0) destroyRoom(room, 'empty, nobody returned');
          }, EMPTY_ROOM_GRACE_MS);
          if (room.emptyTimer.unref) room.emptyTimer.unref();
          console.log(`[MP] "${room.code}" is empty; holding it open to reconnect`);
          return;
        }
        destroyRoom(room, `${why}, empty`);
        return;
      }

      // Host reassignment — the table outlives whoever opened it.
      if (room.hostSocketId === socket.id) {
        room.hostSocketId = room.players[0].socketId;
        io.to(room.hostSocketId).emit('host_promoted');
        console.log(`[MP] Host of "${room.code}" left; promoted ${room.players[0].name}`);
      }

      io.to(room.code).emit('player_left', {
        ...roomSummary(room),
        leftName: player.name,
        leftSeat: player.seat,
        replacedByBot: !!room.game,
      });

      console.log(`[MP] ${player.name} ${why} "${room.code}"`);
    }

    socket.on('disconnect', () => {
      console.log(`[MP] Client disconnected: ${socket.id}`);
      handleDeparture('disconnected from');
    });
  });

  // Rooms are in-memory; sweep ones nobody has touched in a while.
  const reaper = setInterval(() => {
    const cutoff = Date.now() - IDLE_ROOM_MS;
    for (const room of [...rooms.values()]) {
      if (room.lastActivity < cutoff) destroyRoom(room, 'idle');
    }
  }, REAP_INTERVAL_MS);
  if (reaper.unref) reaper.unref();

  return io;
}

module.exports = { initMultiplayer, rooms };
