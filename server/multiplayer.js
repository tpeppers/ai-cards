const { Server } = require('socket.io');

// In-memory lobby storage: passphrase -> lobby data
const lobbies = new Map();

function initMultiplayer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`[MP] Client connected: ${socket.id}`);
    let currentLobby = null; // passphrase this socket is in

    socket.on('create_lobby', ({ passphrase, playerName, aiStrategy }) => {
      if (lobbies.has(passphrase)) {
        socket.emit('lobby_error', { message: 'A lobby with that passphrase already exists' });
        return;
      }

      const lobby = {
        host: socket.id,
        players: [{ socketId: socket.id, name: playerName, seat: 0 }],
        aiStrategy: aiStrategy || 'Family',
        started: false
      };

      lobbies.set(passphrase, lobby);
      currentLobby = passphrase;
      socket.join(passphrase);

      socket.emit('lobby_joined', {
        passphrase,
        players: lobby.players.map(p => ({ name: p.name, seat: p.seat, isHost: p.socketId === lobby.host })),
        aiStrategy: lobby.aiStrategy,
        isHost: true,
        mySeat: 0
      });

      console.log(`[MP] Lobby created: "${passphrase}" by ${playerName}`);
    });

    socket.on('join_lobby', ({ passphrase, playerName }) => {
      const lobby = lobbies.get(passphrase);

      if (!lobby) {
        socket.emit('lobby_error', { message: 'No lobby found with that passphrase' });
        return;
      }

      if (lobby.started) {
        socket.emit('lobby_error', { message: 'Game has already started' });
        return;
      }

      if (lobby.players.length >= 4) {
        socket.emit('lobby_error', { message: 'Lobby is full (4 players max)' });
        return;
      }

      // Check for duplicate names
      if (lobby.players.some(p => p.name === playerName)) {
        socket.emit('lobby_error', { message: 'That name is already taken in this lobby' });
        return;
      }

      // Assign next open seat
      const takenSeats = new Set(lobby.players.map(p => p.seat));
      let seat = -1;
      for (let i = 0; i < 4; i++) {
        if (!takenSeats.has(i)) { seat = i; break; }
      }

      lobby.players.push({ socketId: socket.id, name: playerName, seat });
      currentLobby = passphrase;
      socket.join(passphrase);

      const playersInfo = lobby.players.map(p => ({
        name: p.name, seat: p.seat, isHost: p.socketId === lobby.host
      }));

      // Notify the joining player
      socket.emit('lobby_joined', {
        passphrase,
        players: playersInfo,
        aiStrategy: lobby.aiStrategy,
        isHost: false,
        mySeat: seat
      });

      // Notify all others in the lobby
      socket.to(passphrase).emit('lobby_updated', { players: playersInfo });

      console.log(`[MP] ${playerName} joined "${passphrase}" at seat ${seat}`);
    });

    socket.on('leave_lobby', () => {
      handleLeave(socket, currentLobby);
      currentLobby = null;
    });

    // Move to an empty seat
    socket.on('move_seat', ({ targetSeat }) => {
      if (!currentLobby) return;
      const lobby = lobbies.get(currentLobby);
      if (!lobby || lobby.started) return;
      if (targetSeat < 0 || targetSeat > 3) return;

      const player = lobby.players.find(p => p.socketId === socket.id);
      if (!player) return;

      // Check seat is empty
      if (lobby.players.some(p => p.seat === targetSeat)) {
        socket.emit('lobby_error', { message: 'That seat is occupied' });
        return;
      }

      const oldSeat = player.seat;
      player.seat = targetSeat;

      const playersInfo = lobby.players.map(p => ({
        name: p.name, seat: p.seat, isHost: p.socketId === lobby.host
      }));

      // Notify everyone (including the mover, with updated mySeat)
      socket.emit('seat_changed', { mySeat: targetSeat, players: playersInfo });
      socket.to(currentLobby).emit('lobby_updated', { players: playersInfo });

      console.log(`[MP] ${player.name} moved from seat ${oldSeat} to ${targetSeat}`);
    });

    // Request to swap seats with another player
    socket.on('request_swap', ({ targetSeat }) => {
      if (!currentLobby) return;
      const lobby = lobbies.get(currentLobby);
      if (!lobby || lobby.started) return;
      if (targetSeat < 0 || targetSeat > 3) return;

      const requester = lobby.players.find(p => p.socketId === socket.id);
      if (!requester) return;

      const target = lobby.players.find(p => p.seat === targetSeat);
      if (!target) {
        // Seat is empty — just move
        requester.seat = targetSeat;
        const playersInfo = lobby.players.map(p => ({
          name: p.name, seat: p.seat, isHost: p.socketId === lobby.host
        }));
        socket.emit('seat_changed', { mySeat: targetSeat, players: playersInfo });
        socket.to(currentLobby).emit('lobby_updated', { players: playersInfo });
        return;
      }

      if (target.socketId === socket.id) return; // can't swap with self

      // Send swap request to the target player
      io.to(target.socketId).emit('swap_request', {
        fromName: requester.name,
        fromSeat: requester.seat,
        targetSeat: targetSeat
      });

      console.log(`[MP] ${requester.name} requested swap with ${target.name} (seat ${targetSeat})`);
    });

    // Response to a swap request
    socket.on('swap_response', ({ accepted, fromSeat }) => {
      if (!currentLobby) return;
      const lobby = lobbies.get(currentLobby);
      if (!lobby || lobby.started) return;

      const responder = lobby.players.find(p => p.socketId === socket.id);
      const requester = lobby.players.find(p => p.seat === fromSeat);
      if (!responder || !requester) return;

      if (accepted) {
        // Swap seats
        const tempSeat = responder.seat;
        responder.seat = requester.seat;
        requester.seat = tempSeat;

        const playersInfo = lobby.players.map(p => ({
          name: p.name, seat: p.seat, isHost: p.socketId === lobby.host
        }));

        // Notify both players with their new seats
        io.to(requester.socketId).emit('seat_changed', { mySeat: requester.seat, players: playersInfo });
        io.to(responder.socketId).emit('seat_changed', { mySeat: responder.seat, players: playersInfo });

        // Notify everyone else
        lobby.players.forEach(p => {
          if (p.socketId !== requester.socketId && p.socketId !== responder.socketId) {
            io.to(p.socketId).emit('lobby_updated', { players: playersInfo });
          }
        });

        console.log(`[MP] Swap accepted: ${requester.name} <-> ${responder.name}`);
      } else {
        // Notify requester that swap was declined
        io.to(requester.socketId).emit('swap_declined', { byName: responder.name });
        console.log(`[MP] Swap declined by ${responder.name}`);
      }
    });

    socket.on('start_game', () => {
      if (!currentLobby) return;
      const lobby = lobbies.get(currentLobby);
      if (!lobby) return;
      if (lobby.host !== socket.id) return; // only host can start

      lobby.started = true;

      const playersInfo = lobby.players.map(p => ({
        name: p.name, seat: p.seat, isHost: p.socketId === lobby.host
      }));

      io.to(currentLobby).emit('game_started', {
        players: playersInfo,
        aiStrategy: lobby.aiStrategy
      });

      console.log(`[MP] Game started in "${currentLobby}" with ${lobby.players.length} players`);
    });

    // Host sends state to a specific player
    socket.on('game_state', ({ targetSocketId, state }) => {
      io.to(targetSocketId).emit('game_state', state);
    });

    // Host broadcasts state to all players in the room
    socket.on('game_state_all', ({ state }) => {
      if (!currentLobby) return;
      socket.to(currentLobby).emit('game_state', state);
    });

    // Player sends action to host
    socket.on('player_action', ({ action }) => {
      if (!currentLobby) return;
      const lobby = lobbies.get(currentLobby);
      if (!lobby) return;

      // Find this player's seat
      const player = lobby.players.find(p => p.socketId === socket.id);
      if (!player) return;

      // Forward action to host
      io.to(lobby.host).emit('player_action', {
        seat: player.seat,
        action
      });
    });

    socket.on('disconnect', () => {
      console.log(`[MP] Client disconnected: ${socket.id}`);

      if (currentLobby) {
        const lobby = lobbies.get(currentLobby);
        if (lobby) {
          const isHost = lobby.host === socket.id;

          if (isHost) {
            // Host left: destroy lobby, notify everyone
            io.to(currentLobby).emit('host_disconnected');
            lobbies.delete(currentLobby);
            console.log(`[MP] Host left, lobby "${currentLobby}" destroyed`);
          } else {
            // Guest left: remove from lobby, notify others
            const player = lobby.players.find(p => p.socketId === socket.id);
            lobby.players = lobby.players.filter(p => p.socketId !== socket.id);

            const playersInfo = lobby.players.map(p => ({
              name: p.name, seat: p.seat, isHost: p.socketId === lobby.host
            }));

            io.to(currentLobby).emit('player_left', {
              players: playersInfo,
              leftPlayerName: player?.name || 'Unknown',
              leftSeat: player?.seat ?? -1
            });

            console.log(`[MP] ${player?.name || 'Unknown'} left "${currentLobby}"`);
          }
        }
      }
    });
  });

  return io;
}

function handleLeave(socket, passphrase) {
  if (!passphrase) return;

  const lobby = lobbies.get(passphrase);
  if (!lobby) return;

  socket.leave(passphrase);

  if (lobby.host === socket.id) {
    // Host leaving destroys the lobby
    const io = socket.server;
    io.to(passphrase).emit('host_disconnected');
    lobbies.delete(passphrase);
  } else {
    // Remove guest
    const player = lobby.players.find(p => p.socketId === socket.id);
    lobby.players = lobby.players.filter(p => p.socketId !== socket.id);

    const playersInfo = lobby.players.map(p => ({
      name: p.name, seat: p.seat, isHost: p.socketId === lobby.host
    }));

    socket.to(passphrase).emit('player_left', {
      players: playersInfo,
      leftPlayerName: player?.name || 'Unknown',
      leftSeat: player?.seat ?? -1
    });
  }
}

module.exports = { initMultiplayer };
