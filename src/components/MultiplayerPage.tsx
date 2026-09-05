import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { MultiplayerGameState, PlayerAction } from '../multiplayer/types.ts';
import BiddingOverlay from './BiddingOverlay.tsx';
import TrumpSelectionOverlay from './TrumpSelectionOverlay.tsx';
import DiscardOverlay from './DiscardOverlay.tsx';
import PlayerArea from './PlayerArea.tsx';
import { Card, Player } from '../types/CardGame.ts';

const SOCKET_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

const SUIT_SYMBOLS: { [key: string]: string } = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣'
};
const SUIT_COLORS: { [key: string]: string } = {
  spades: 'black', hearts: 'red', diamonds: 'red', clubs: 'black'
};

const SEAT_NAMES = ['South', 'East', 'North', 'West'];
const MAX_ROOM_CODE = 20;
const DEVICE_ID_KEY = 'multiplayerDeviceId';

type Phase = 'lobby' | 'waiting' | 'pending' | 'game';

type JoinPolicy = 'dropin' | 'reconnect' | 'disabled';

const JOIN_POLICY_LABELS: Record<JoinPolicy, { label: string; blurb: string }> = {
  dropin: {
    label: 'Drop-in',
    blurb: 'Anyone can ask to join mid-hand. You approve each request.',
  },
  reconnect: {
    label: 'Reconnect',
    blurb: 'Players who drop can come straight back. Newcomers wait for the next hand.',
  },
  disabled: {
    label: 'Closed',
    blurb: 'Once the game starts, nobody else gets in — dropped players included.',
  },
};

/**
 * A stable per-browser id, so a player who drops can be recognised as the
 * same person and given their seat back.
 *
 * This is deliberately not IP-based: four players at one card table share a
 * network, so an address would identify the table, not the person.
 */
function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Private mode: fall back to a per-session id. Reconnecting then relies
    // on the weaker same-network-and-name check.
    return '';
  }
}

interface RoomPlayer {
  name: string;
  seat: number;
  isHost: boolean;
}

/** What the server tells us about the table we're sitting at. */
export interface RoomState {
  room: string;
  players: RoomPlayer[];
  aiStrategy: string;
  joinPolicy: JoinPolicy;
  started: boolean;
  hostingAnnounced: boolean;
  openSeats: number[];
  isHost: boolean;
  mySeat: number;
}

/** Someone asking to drop into a game already in progress. */
interface DropinRequest {
  requestId: string;
  name: string;
  seat: number;
}

/** The two seeds a player is handed once a hand finishes. */
interface HandSeeds {
  pregame: string | null;   // blind view dealt at the start of the hand
  deal: string | null;      // the full 52-card deal
  record: string | null;    // full replayable playout, null for an all-pass hand
}

const MultiplayerPage: React.FC = () => {
  const socketRef = useRef<Socket | null>(null);

  // Lobby / connection
  const [phase, setPhase] = useState<Phase>('lobby');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Server capabilities, announced on connect.
  const [strategies, setStrategies] = useState<string[]>([]);
  const [joinPolicies, setJoinPolicies] = useState<JoinPolicy[]>([]);
  const [engineReady, setEngineReady] = useState(true);
  const [announcerName, setAnnouncerName] = useState<string | null>(null);

  // Waiting to be let into a game already under way.
  const [pending, setPending] = useState<{ reason: string; seat: number } | null>(null);
  // Drop-in requests awaiting this host's decision.
  const [dropinRequests, setDropinRequests] = useState<DropinRequest[]>([]);

  const [swapRequest, setSwapRequest] = useState<{ fromName: string; fromSeat: number } | null>(null);

  // Game
  const [gameState, setGameState] = useState<MultiplayerGameState | null>(null);
  const [pregameSeed, setPregameSeed] = useState<string | null>(null);
  const [seeds, setSeeds] = useState<HandSeeds | null>(null);

  const flashStatus = useCallback((message: string, ms = 3000) => {
    setStatusMessage(message);
    setTimeout(() => setStatusMessage(''), ms);
  }, []);

  // ── Socket wiring ──────────────────────────────────────────────────
  //
  // The server is authoritative: it deals, validates and runs the bots, and
  // this component only renders what arrives and forwards the player's intent.

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('mp_ready', (data: {
      strategies: string[];
      defaultStrategy: string;
      joinPolicies: JoinPolicy[];
      defaultJoinPolicy: JoinPolicy;
      engineReady: boolean;
      announcer: string | null;
    }) => {
      setStrategies(data.strategies || []);
      setJoinPolicies(data.joinPolicies || []);
      setEngineReady(data.engineReady);
      setAnnouncerName(data.announcer);
    });

    socket.on('room_error', ({ message }: { message: string }) => {
      setError(message);
      setPending(null);
      setPhase(prev => (prev === 'pending' ? 'lobby' : prev));
    });

    socket.on('room_joined', (data: RoomState) => {
      setRoom(data);
      setPending(null);
      setPhase('waiting');
      setError(null);
    });

    // Seated straight into a game already under way — a reconnect, or a
    // drop-in the host waved through.
    socket.on('game_joined', (data: RoomState) => {
      setRoom(data);
      setPending(null);
      setError(null);
      setPhase('game');
    });

    socket.on('join_pending', ({ reason, seat }: { reason: string; seat: number }) => {
      setPending({ reason, seat });
      setError(null);
      setPhase('pending');
    });

    socket.on('dropin_request', (request: DropinRequest) => {
      setDropinRequests(prev => [...prev.filter(r => r.requestId !== request.requestId), request]);
    });

    socket.on('player_returned', ({ name, seat, ...summary }: {
      name: string;
      seat: number;
    } & Omit<RoomState, 'isHost' | 'mySeat'>) => {
      setRoom(prev => (prev ? { ...prev, ...summary, isHost: prev.isHost, mySeat: prev.mySeat } : prev));
      flashStatus(`${name} took seat ${SEAT_NAMES[seat]}`);
    });

    // Table changed around us — keep our own seat and host flag.
    socket.on('room_updated', (data: Omit<RoomState, 'isHost' | 'mySeat'>) => {
      setRoom(prev => (prev ? { ...prev, ...data, isHost: prev.isHost, mySeat: prev.mySeat } : prev));
    });

    socket.on('seat_changed', ({ mySeat, ...summary }: { mySeat: number } & Omit<RoomState, 'isHost' | 'mySeat'>) => {
      setRoom(prev => (prev ? { ...prev, ...summary, mySeat, isHost: prev.isHost } : prev));
    });

    socket.on('swap_request', ({ fromName, fromSeat }: { fromName: string; fromSeat: number }) => {
      setSwapRequest({ fromName, fromSeat });
    });

    socket.on('swap_declined', ({ byName }: { byName: string }) => {
      flashStatus(`${byName} declined your swap request`);
    });

    socket.on('game_started', (data: Omit<RoomState, 'isHost' | 'mySeat'>) => {
      setRoom(prev => (prev ? { ...prev, ...data, isHost: prev.isHost, mySeat: prev.mySeat } : prev));
      setSeeds(null);
      setPhase('game');
    });

    socket.on('player_left', ({ leftName, replacedByBot, ...summary }: {
      leftName: string;
      leftSeat: number;
      replacedByBot: boolean;
    } & Omit<RoomState, 'isHost' | 'mySeat'>) => {
      setRoom(prev => (prev ? { ...prev, ...summary, isHost: prev.isHost, mySeat: prev.mySeat } : prev));
      flashStatus(`${leftName} left${replacedByBot ? ' — a bot took the seat' : ''}`);
    });

    socket.on('host_promoted', () => {
      setRoom(prev => (prev ? { ...prev, isHost: true } : prev));
      flashStatus('The host left — you are the host now');
    });

    socket.on('game_state', (state: MultiplayerGameState) => setGameState(state));

    // Blind seed for the hand just dealt: our own 12 cards, everything else '_'.
    socket.on('pregame_seed', ({ seed }: { seed: string }) => {
      setPregameSeed(seed);
      setSeeds(null);
    });

    socket.on('postgame_seed', ({ pregame, deal, record }: HandSeeds) => {
      setSeeds({ pregame, deal, record });
    });

    socket.on('match_over', ({ teamScores, hands }: { teamScores: [number, number]; hands: number }) => {
      flashStatus(`Match over: ${teamScores[0]} — ${teamScores[1]} over ${hands} hand${hands === 1 ? '' : 's'}`, 8000);
    });

    socket.on('hosting_result', ({ sent, reason }: { sent: boolean; reason?: string }) => {
      flashStatus(sent ? 'Posted to Signal' : `Not posted: ${reason}`, 5000);
    });

    socket.on('action_rejected', () => {
      flashStatus('That move was not allowed');
    });

    socket.on('disconnect', () => setError('Lost connection to the server'));

    return () => {
      socket.disconnect();
    };
  }, [flashStatus]);

  // ── Lobby actions ──────────────────────────────────────────────────

  const handleJoin = useCallback((requestedSeat?: number) => {
    if (!roomCode.trim() || !playerName.trim()) {
      setError('Enter a room code and your name');
      return;
    }
    setError(null);
    socketRef.current?.emit('join_room', {
      roomCode: roomCode.trim(),
      playerName: playerName.trim(),
      deviceId: getDeviceId(),
      requestedSeat,
    });
  }, [roomCode, playerName]);

  const handleLeave = useCallback(() => {
    socketRef.current?.emit('leave_room');
    setPhase('lobby');
    setRoom(null);
    setGameState(null);
    setSeeds(null);
    setPregameSeed(null);
    setPending(null);
    setDropinRequests([]);
  }, []);

  const handleJoinPolicyChange = useCallback((joinPolicy: JoinPolicy) => {
    setRoom(prev => (prev ? { ...prev, joinPolicy } : prev));
    socketRef.current?.emit('set_join_policy', { joinPolicy });
  }, []);

  const handleDropinResponse = useCallback((requestId: string, accepted: boolean) => {
    socketRef.current?.emit('dropin_response', { requestId, accepted });
    setDropinRequests(prev => prev.filter(r => r.requestId !== requestId));
  }, []);

  const handleSeatClick = useCallback((targetSeat: number) => {
    if (!room || targetSeat === room.mySeat) return;
    const occupant = room.players.find(p => p.seat === targetSeat);
    if (occupant) {
      socketRef.current?.emit('request_swap', { targetSeat });
      flashStatus(`Swap request sent to ${occupant.name}...`);
    } else {
      socketRef.current?.emit('move_seat', { targetSeat });
    }
  }, [room, flashStatus]);

  const handleSwapResponse = useCallback((accepted: boolean) => {
    if (!swapRequest) return;
    socketRef.current?.emit('swap_response', { accepted, fromSeat: swapRequest.fromSeat });
    setSwapRequest(null);
  }, [swapRequest]);

  const handleStrategyChange = useCallback((aiStrategy: string) => {
    setRoom(prev => (prev ? { ...prev, aiStrategy } : prev));
    socketRef.current?.emit('set_strategy', { aiStrategy });
  }, []);

  const handleStartGame = useCallback(() => {
    socketRef.current?.emit('start_game');
  }, []);

  const handleAnnounceHosting = useCallback(() => {
    socketRef.current?.emit('announce_hosting');
  }, []);

  // ── Game actions ───────────────────────────────────────────────────

  const sendAction = useCallback((action: PlayerAction) => {
    socketRef.current?.emit('player_action', { action });
  }, []);

  const handleBid = useCallback((amount: number) => sendAction({ type: 'bid', amount }), [sendAction]);
  const handleTrumpSelection = useCallback(
    (suit: string, direction: 'uptown' | 'downtown' | 'downtown-noaces') =>
      sendAction({ type: 'trump', suit, direction }),
    [sendAction]
  );
  const handleDiscard = useCallback((cardIds: string[]) => sendAction({ type: 'discard', cardIds }), [sendAction]);
  const handlePlayCard = useCallback((card: Card) => sendAction({ type: 'play', cardId: card.id }), [sendAction]);

  // ---- RENDER ----

  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="bg-gray-800 rounded-lg p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold mb-2 text-center">Multiplayer Bid Whist</h1>
          <p className="text-gray-400 text-center text-sm mb-6">
            Everyone types the same room code to land at the same table.
            Bots fill any seats still empty when the host starts.
          </p>

          {!engineReady && (
            <div className="bg-yellow-900 border border-yellow-700 text-yellow-200 px-4 py-2 rounded mb-4 text-sm">
              This server has no game engine built, so games cannot start.
            </div>
          )}

          {error && (
            <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-2 rounded mb-4">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Your Name</label>
              <input
                type="text"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 text-white focus:outline-none focus:border-blue-500"
                maxLength={20}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1">Room Code</label>
              <input
                type="text"
                value={roomCode}
                onChange={e => setRoomCode(e.target.value)}
                placeholder="e.g. baggle bytes"
                className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 text-white focus:outline-none focus:border-blue-500"
                maxLength={MAX_ROOM_CODE}
                onKeyDown={e => { if (e.key === 'Enter') handleJoin(); }}
              />
              <p className="text-xs text-gray-500 mt-1">
                Letters, numbers and spaces, up to {MAX_ROOM_CODE} characters. Case doesn't matter.
              </p>
            </div>

            <button
              className="w-full bg-blue-600 hover:bg-blue-700 py-3 rounded font-semibold text-lg"
              onClick={() => handleJoin()}
            >
              Take a Seat
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'pending' && pending) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="bg-gray-800 rounded-lg p-8 w-full max-w-md text-center">
          <h2 className="text-xl font-bold mb-3">You're in the queue</h2>
          <p className="text-gray-300 mb-2">{pending.reason}.</p>
          <p className="text-gray-500 text-sm mb-6">
            Holding {SEAT_NAMES[pending.seat]} for you — a bot is playing it until you're in.
          </p>
          <div className="animate-pulse text-gray-600 mb-6">•  •  •</div>
          <button className="w-full bg-gray-600 hover:bg-gray-500 py-2 rounded" onClick={handleLeave}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'waiting' && room) {
    const humanCount = room.players.length;
    const botCount = 4 - humanCount;

    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="bg-gray-800 rounded-lg p-8 w-full max-w-md">
          <h2 className="text-xl font-bold mb-2 text-center">Waiting Room</h2>
          <p className="text-gray-400 text-center text-sm mb-6">
            Room code: <span className="text-white font-mono">{room.room}</span>
          </p>

          {swapRequest && (
            <div className="bg-blue-900 border border-blue-600 rounded p-3 mb-4">
              <p className="text-sm mb-2">
                <span className="font-semibold">{swapRequest.fromName}</span> wants to swap seats with you
              </p>
              <div className="flex gap-2">
                <button
                  className="flex-1 bg-green-600 hover:bg-green-700 py-1 rounded text-sm"
                  onClick={() => handleSwapResponse(true)}
                >
                  Accept
                </button>
                <button
                  className="flex-1 bg-red-600 hover:bg-red-700 py-1 rounded text-sm"
                  onClick={() => handleSwapResponse(false)}
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          {statusMessage && (
            <div className="bg-gray-700 text-gray-300 text-sm text-center px-3 py-2 rounded mb-4">
              {statusMessage}
            </div>
          )}

          {error && (
            <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-2 rounded mb-4 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-3 mb-6">
            {[0, 1, 2, 3].map(seat => {
              const player = room.players.find(p => p.seat === seat);
              const teamLabel = seat % 2 === 0 ? 'Team 1' : 'Team 2';
              const isMe = seat === room.mySeat;
              return (
                <div
                  key={seat}
                  className={`flex items-center justify-between p-3 rounded transition-colors ${
                    isMe
                      ? 'bg-gray-700 ring-1 ring-blue-500'
                      : player
                        ? 'bg-gray-700 hover:bg-gray-600 cursor-pointer'
                        : 'bg-gray-750 border border-dashed border-gray-600 hover:border-blue-500 hover:bg-gray-700 cursor-pointer'
                  }`}
                  onClick={isMe ? undefined : () => handleSeatClick(seat)}
                  title={isMe ? 'Your seat' : player ? `Click to request swap with ${player.name}` : 'Click to move here'}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-12">{SEAT_NAMES[seat]}</span>
                    {player ? (
                      <span className="font-semibold">
                        {player.name}
                        {player.isHost && <span className="ml-2 text-xs bg-yellow-600 px-1.5 py-0.5 rounded">Host</span>}
                        {isMe && <span className="ml-2 text-xs bg-blue-600 px-1.5 py-0.5 rounded">You</span>}
                      </span>
                    ) : (
                      <span className="text-gray-500 italic">Bot ({room.aiStrategy})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isMe && <span className="text-xs text-blue-400">{player ? 'Swap' : 'Move here'}</span>}
                    <span className="text-xs text-gray-500">{teamLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-center text-sm text-gray-400 mb-4">
            {humanCount}/4 players{botCount > 0 ? ` — ${botCount} bot${botCount === 1 ? '' : 's'} will fill in` : ''}
          </div>

          {room.isHost && strategies.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm text-gray-300 mb-1">Bot Strategy</label>
              <select
                value={room.aiStrategy}
                onChange={e => handleStrategyChange(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 text-white focus:outline-none focus:border-blue-500"
              >
                {strategies.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Locked in when the game starts, so every bot plays deterministically.
              </p>
            </div>
          )}

          {room.isHost && joinPolicies.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm text-gray-300 mb-1">If someone shows up mid-game</label>
              <select
                value={room.joinPolicy}
                onChange={e => handleJoinPolicyChange(e.target.value as JoinPolicy)}
                className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 text-white focus:outline-none focus:border-blue-500"
              >
                {joinPolicies.map(policy => (
                  <option key={policy} value={policy}>{JOIN_POLICY_LABELS[policy].label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {JOIN_POLICY_LABELS[room.joinPolicy]?.blurb}
              </p>
            </div>
          )}

          {room.isHost && announcerName && announcerName !== 'noop' && (
            <button
              className="w-full mb-3 py-2 rounded text-sm bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 disabled:text-gray-500"
              onClick={handleAnnounceHosting}
              disabled={room.hostingAnnounced}
            >
              {room.hostingAnnounced ? 'Announced on Signal' : 'Announce on Signal (once)'}
            </button>
          )}

          <div className="flex gap-3">
            <button className="flex-1 bg-gray-600 hover:bg-gray-500 py-2 rounded" onClick={handleLeave}>
              Leave
            </button>
            {room.isHost && (
              <button
                className="flex-1 bg-green-600 hover:bg-green-700 py-2 rounded font-semibold disabled:bg-gray-700"
                onClick={handleStartGame}
                disabled={!engineReady}
              >
                Go
              </button>
            )}
          </div>

          {!room.isHost && (
            <p className="text-center text-gray-500 text-sm mt-4">
              Waiting for the host to start...
            </p>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'game' && gameState) {
    return (
      <>
        <MultiplayerGameView
          gameState={gameState}
          room={room!}
          onBid={handleBid}
          onTrumpSelection={handleTrumpSelection}
          onDiscard={handleDiscard}
          onPlayCard={handlePlayCard}
          onLeave={handleLeave}
          statusMessage={statusMessage}
        />
        {dropinRequests.length > 0 && (
          <DropinRequests requests={dropinRequests} onRespond={handleDropinResponse} />
        )}
        {seeds && <SeedPanel seeds={seeds} onDismiss={() => setSeeds(null)} />}
      </>
    );
  }

  if (phase === 'game') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg mb-2">Dealing...</p>
          {pregameSeed && <p className="font-mono text-xs text-gray-500 break-all">{pregameSeed}</p>}
        </div>
      </div>
    );
  }

  return null;
};

// ---- Drop-in Requests ----

/**
 * Host-only prompt for 'dropin' mode. Stacked in a corner so it never covers
 * the table — the host is mid-hand and still has to be able to play.
 */
const DropinRequests: React.FC<{
  requests: DropinRequest[];
  onRespond: (requestId: string, accepted: boolean) => void;
}> = ({ requests, onRespond }) => (
  <div className="fixed bottom-4 right-4 z-40 space-y-2 max-w-xs">
    {requests.map(request => (
      <div key={request.requestId} className="bg-gray-800 border border-blue-600 rounded-lg p-3 shadow-lg">
        <p className="text-sm text-white mb-1">
          <span className="font-semibold">{request.name}</span> wants to join
        </p>
        <p className="text-xs text-gray-400 mb-2">
          They'd take {SEAT_NAMES[request.seat]}, picking up where the bot left off.
        </p>
        <div className="flex gap-2">
          <button
            className="flex-1 bg-green-600 hover:bg-green-700 py-1 rounded text-sm"
            onClick={() => onRespond(request.requestId, true)}
          >
            Let them in
          </button>
          <button
            className="flex-1 bg-gray-600 hover:bg-gray-500 py-1 rounded text-sm"
            onClick={() => onRespond(request.requestId, false)}
          >
            Decline
          </button>
        </div>
      </div>
    ))}
  </div>
);

// ---- Seed Panel ----

/**
 * Shown when a hand finishes: the blind seed the player started with, and the
 * full playout. Both paste straight into the replay page.
 */
const SeedPanel: React.FC<{ seeds: HandSeeds; onDismiss: () => void }> = ({ seeds, onDismiss }) => {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
      },
      () => setCopied('failed')
    );
  };

  const rows: { label: string; hint: string; value: string | null }[] = [
    {
      label: 'Your opening hand',
      hint: 'What you saw before bidding — your 12 cards, everyone else random.',
      value: seeds.pregame,
    },
    {
      label: 'Full deal',
      hint: 'All 52 cards as they were actually dealt.',
      value: seeds.deal,
    },
    {
      label: 'Full playout',
      hint: 'Every bid, discard and card played. Paste into Replay.',
      value: seeds.record,
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-full overflow-y-auto">
        <h3 className="text-lg font-bold mb-4">Hand complete</h3>

        <div className="space-y-4">
          {rows.map(row => (
            <div key={row.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-200">{row.label}</span>
                {row.value && (
                  <button
                    className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"
                    onClick={() => copy(row.label, row.value!)}
                  >
                    {copied === row.label ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 mb-1">{row.hint}</p>
              <div className="font-mono text-xs bg-gray-900 rounded p-2 break-all text-gray-300">
                {row.value || <span className="text-gray-600 italic">Not available for this hand (everyone passed)</span>}
              </div>
            </div>
          ))}
        </div>

        <button
          className="w-full mt-6 bg-blue-600 hover:bg-blue-700 py-2 rounded font-semibold"
          onClick={onDismiss}
        >
          Continue
        </button>
      </div>
    </div>
  );
};

// ---- Game View Component ----

interface GameViewProps {
  gameState: MultiplayerGameState;
  room: RoomState;
  onBid: (amount: number) => void;
  onTrumpSelection: (suit: string, direction: 'uptown' | 'downtown' | 'downtown-noaces') => void;
  onDiscard: (cardIds: string[]) => void;
  onPlayCard: (card: Card) => void;
  onLeave: () => void;
  statusMessage: string;
}

const MultiplayerGameView: React.FC<GameViewProps> = ({
  gameState: gs,
  room,
  onBid,
  onTrumpSelection,
  onDiscard,
  onPlayCard,
  onLeave,
  statusMessage
}) => {
  // Build Player objects for PlayerArea components
  // Rotated: index 0 = me (bottom), 1 = east, 2 = north (across), 3 = west
  const buildPlayer = (rotatedIndex: number): Player => {
    const p = gs.players[rotatedIndex];
    const isMe = rotatedIndex === 0;

    // For "me", use actual hand cards; for others, create face-down cards
    let hand: Card[] = [];
    if (isMe) {
      hand = gs.myHand;
    } else {
      // Create placeholder cards for card count display
      hand = Array.from({ length: p.cardCount }, (_, i) => ({
        suit: 'spades',
        rank: 1,
        id: `hidden_${rotatedIndex}_${i}`
      }));
    }

    return {
      id: rotatedIndex,
      name: p.name,
      hand,
      tricks: Array.from({ length: p.trickCount * 4 }, (_, i) => ({
        suit: 'spades', rank: 1, id: `trick_${rotatedIndex}_${i}`
      })),
      score: 0,
      totalScore: p.totalScore
    };
  };

  const players = [0, 1, 2, 3].map(buildPlayer);

  // Player names (rotated)
  const playerNames = gs.players.map(p => p.name);

  // Current trick positioning
  const trickPositions: { [key: number]: { x: string; y: string } } = {
    0: { x: '50%', y: '60%' },   // me (bottom)
    1: { x: '60%', y: '50%' },   // east (right) — clockwise layout: 0→3→2→1
    2: { x: '50%', y: '40%' },   // north (top)
    3: { x: '40%', y: '50%' }    // west (left)
  };

  // Determine what the current active player's name is
  const currentPlayerName = gs.currentPlayer >= 0 && gs.currentPlayer < gs.players.length
    ? gs.players[gs.currentPlayer].name : '';

  // Turn indicator
  let turnIndicator = '';
  if (gs.gameStage === 'scoring') {
    turnIndicator = gs.gameOver ? 'Game Over' : 'Scoring...';
  } else if (gs.isMyTurn) {
    turnIndicator = 'Your turn';
  } else {
    turnIndicator = `Waiting for ${currentPlayerName}...`;
  }

  // Trump display
  const trumpDisplay = gs.trumpSuit ? (
    <span style={{ color: SUIT_COLORS[gs.trumpSuit] || 'white' }}>
      {SUIT_SYMBOLS[gs.trumpSuit]} {gs.bidDirection === 'uptown' ? 'Up' : gs.bidDirection === 'downtown' ? 'Down' : 'Down (NA)'}
    </span>
  ) : null;

  return (
    <div className="relative w-full h-screen bg-green-900 overflow-hidden">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 bg-gray-800 bg-opacity-90 px-4 py-2 flex items-center justify-between z-50">
        <div className="flex items-center gap-4">
          <button
            className="text-gray-400 hover:text-white text-sm"
            onClick={onLeave}
          >
            Leave
          </button>
          <span className="text-white font-semibold">Bid Whist</span>
          {trumpDisplay && (
            <span className="text-sm">{trumpDisplay}</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-blue-300">
            My Team: {gs.teamScores[0]} pts ({gs.booksWon[0]} books)
          </span>
          <span className="text-gray-400">|</span>
          <span className="text-red-300">
            Opp: {gs.teamScores[1]} pts ({gs.booksWon[1]} books)
          </span>
        </div>
      </div>

      {/* Status message */}
      {statusMessage && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 bg-yellow-800 text-yellow-200 px-4 py-1 rounded text-sm z-50">
          {statusMessage}
        </div>
      )}

      {/* Turn indicator */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40">
        <div className={`px-4 py-1 rounded text-sm ${
          gs.isMyTurn ? 'bg-green-700 text-green-100' : 'bg-gray-700 text-gray-300'
        }`}>
          {turnIndicator}
        </div>
      </div>

      {/* Player areas */}
      {players.map((player, index) => (
        <PlayerArea
          key={index}
          player={player}
          isCurrentPlayer={gs.currentPlayer === index}
          isHuman={index === 0}
          playCard={index === 0 && gs.turnPhase === 'play' ? onPlayCard : () => {}}
          showAllCards={false}
          displayName={gs.players[index]?.name}
          subtitle={gs.players[index]?.isAI ? 'AI' : undefined}
        />
      ))}

      {/* Current trick */}
      {gs.currentTrick.length > 0 && (
        <div className="absolute inset-0 pointer-events-none z-30">
          {gs.currentTrick.map((play, idx) => {
            const pos = trickPositions[play.playerId] || { x: '50%', y: '50%' };
            return (
              <div
                key={idx}
                className="absolute"
                style={{
                  left: pos.x,
                  top: pos.y,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                <div
                  className="w-16 h-22 bg-white rounded-lg shadow-lg flex flex-col items-center justify-center border border-gray-300"
                  style={{
                    width: '64px',
                    height: '88px',
                    color: SUIT_COLORS[play.card.suit] || 'black'
                  }}
                >
                  <span className="text-lg font-bold">
                    {play.card.rank === 1 ? 'A' : play.card.rank === 11 ? 'J' : play.card.rank === 12 ? 'Q' : play.card.rank === 13 ? 'K' : play.card.rank}
                  </span>
                  <span className="text-2xl leading-none">{SUIT_SYMBOLS[play.card.suit]}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bidding overlay */}
      {gs.gameStage === 'bidding' && (
        <BiddingOverlay
          isYourTurn={gs.turnPhase === 'bid'}
          currentHighBid={gs.biddingState.currentHighBid}
          validBids={gs.validBids || []}
          bids={gs.biddingState.bids}
          playerNames={playerNames}
          dealer={gs.biddingState.dealer}
          currentBidder={gs.currentPlayer}
          onBid={onBid}
        />
      )}

      {/* Trump selection overlay */}
      {gs.gameStage === 'trumpSelection' && gs.turnPhase === 'trump' && (
        <TrumpSelectionOverlay
          isYourTurn={true}
          winningBid={gs.biddingState.currentHighBid}
          playerHand={gs.myHand}
          onSelectTrump={onTrumpSelection}
        />
      )}

      {/* Waiting for trump selection (not your turn) */}
      {gs.gameStage === 'trumpSelection' && gs.turnPhase !== 'trump' && (
        <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-black bg-opacity-70 text-white px-6 py-4 rounded-lg">
            Waiting for {gs.players[gs.declarer]?.name || 'declarer'} to select trump...
          </div>
        </div>
      )}

      {/* Discard overlay */}
      {gs.gameStage === 'discarding' && gs.turnPhase === 'discard' && (
        <DiscardOverlay
          playerHand={gs.myHand}
          trumpSuit={gs.trumpSuit}
          onDiscard={onDiscard}
        />
      )}

      {/* Waiting for discard */}
      {gs.gameStage === 'discarding' && gs.turnPhase !== 'discard' && (
        <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-black bg-opacity-70 text-white px-6 py-4 rounded-lg">
            Waiting for {gs.players[gs.declarer]?.name || 'declarer'} to discard...
          </div>
        </div>
      )}

      {/* Scoring overlay */}
      {gs.gameStage === 'scoring' && (
        <div className="absolute inset-0 flex items-center justify-center z-50">
          <div className="bg-gray-800 bg-opacity-95 text-white px-8 py-6 rounded-lg max-w-sm text-center">
            {gs.gameOver ? (
              <>
                <h2 className="text-2xl font-bold mb-4">
                  {gs.whistingWinner >= 0 ? 'WHISTED!' : 'Game Over!'}
                </h2>
                <p className="text-lg mb-2">{gs.winner} wins!</p>
                <p className="text-gray-400 mb-4">
                  Final Score: {gs.teamScores[0]} - {gs.teamScores[1]}
                </p>
                <p className="text-sm text-gray-500">New game starting...</p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold mb-3">Hand Complete</h2>
                <p className="mb-2">{gs.message}</p>
                <div className="flex justify-center gap-8 mb-4">
                  <div>
                    <div className="text-blue-300 font-semibold">My Team</div>
                    <div className="text-2xl">{gs.teamScores[0]}</div>
                    <div className="text-xs text-gray-400">{gs.booksWon[0]} books</div>
                  </div>
                  <div>
                    <div className="text-red-300 font-semibold">Opponents</div>
                    <div className="text-2xl">{gs.teamScores[1]}</div>
                    <div className="text-xs text-gray-400">{gs.booksWon[1]} books</div>
                  </div>
                </div>
                <p className="text-sm text-gray-500">Next hand starting...</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Last trick display */}
      {gs.lastTrick.length > 0 && gs.gameStage === 'play' && (
        <div className="absolute bottom-2 right-2 bg-white bg-opacity-90 p-2 rounded shadow z-40">
          <div className="text-xs font-semibold text-gray-600 mb-1">Last Book</div>
          <div className="flex gap-1">
            {gs.lastTrick.map((play, idx) => (
              <div
                key={idx}
                className="w-8 h-11 bg-white border border-gray-300 rounded flex flex-col items-center justify-center text-xs"
                style={{ color: SUIT_COLORS[play.card.suit] || 'black' }}
              >
                <span className="font-bold leading-none">
                  {play.card.rank === 1 ? 'A' : play.card.rank === 11 ? 'J' : play.card.rank === 12 ? 'Q' : play.card.rank === 13 ? 'K' : play.card.rank}
                </span>
                <span className="text-sm leading-none">{SUIT_SYMBOLS[play.card.suit]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Books indicator */}
      {gs.gameStage === 'play' && (
        <div className="absolute top-16 right-4 bg-white bg-opacity-90 p-2 rounded border border-gray-400 shadow-md z-40">
          <div className="text-sm font-bold border-b border-gray-400 mb-1 pb-1">Books</div>
          <div className="text-xs flex justify-between">
            <span>My Team:</span>
            <span className="ml-4 font-bold">{gs.booksWon[0]}</span>
          </div>
          <div className="text-xs flex justify-between">
            <span>Opp:</span>
            <span className="ml-4 font-bold">{gs.booksWon[1]}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiplayerPage;
