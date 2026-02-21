import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { HostGame } from '../multiplayer/hostGame.ts';
import { LobbyPlayer, LobbyState, MultiplayerGameState, PlayerAction } from '../multiplayer/types.ts';
import { STRATEGY_REGISTRY } from '../strategies/index.ts';
import BiddingOverlay from './BiddingOverlay.tsx';
import TrumpSelectionOverlay from './TrumpSelectionOverlay.tsx';
import DiscardOverlay from './DiscardOverlay.tsx';
import PlayerArea from './PlayerArea.tsx';
import { Card, Player } from '../types/CardGame.ts';

const SOCKET_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

const SUIT_SYMBOLS: { [key: string]: string } = {
  spades: '\u2660', hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663'
};
const SUIT_COLORS: { [key: string]: string } = {
  spades: 'black', hearts: 'red', diamonds: 'red', clubs: 'black'
};

type Phase = 'lobby' | 'waiting' | 'game';

const MultiplayerPage: React.FC = () => {
  // Connection state
  const socketRef = useRef<Socket | null>(null);
  const hostGameRef = useRef<HostGame | null>(null);

  // Lobby state
  const [phase, setPhase] = useState<Phase>('lobby');
  const [lobbyTab, setLobbyTab] = useState<'create' | 'join'>('create');
  const [passphrase, setPassphrase] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [aiStrategy, setAiStrategy] = useState('Family');
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seat swap state
  const [swapRequest, setSwapRequest] = useState<{ fromName: string; fromSeat: number } | null>(null);

  // Game state (for both host and guest)
  const [gameState, setGameState] = useState<MultiplayerGameState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Filter strategies to bidwhist only
  const bidWhistStrategies = STRATEGY_REGISTRY.filter(s => s.game === 'bidwhist');

  // Socket connection
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[MP] Connected to server');
    });

    socket.on('lobby_error', ({ message }: { message: string }) => {
      setError(message);
    });

    socket.on('lobby_joined', (data: LobbyState) => {
      setLobbyState(data);
      setPhase('waiting');
      setError(null);
    });

    socket.on('lobby_updated', ({ players }: { players: LobbyPlayer[] }) => {
      setLobbyState(prev => prev ? { ...prev, players } : null);
    });

    socket.on('game_started', ({ players, aiStrategy: strategy }: { players: LobbyPlayer[]; aiStrategy: string }) => {
      setLobbyState(prev => prev ? { ...prev, players, started: true } : null);
      setPhase('game');
    });

    socket.on('player_left', ({ players, leftPlayerName, leftSeat }: { players: LobbyPlayer[]; leftPlayerName: string; leftSeat: number }) => {
      setLobbyState(prev => prev ? { ...prev, players } : null);
      setStatusMessage(`${leftPlayerName} left (replaced by AI)`);
      setTimeout(() => setStatusMessage(''), 3000);
      // If host, replace the departed player with AI in the game
      if (hostGameRef.current && leftSeat >= 0) {
        hostGameRef.current.removePlayer(leftSeat);
      }
    });

    socket.on('host_disconnected', () => {
      setPhase('lobby');
      setLobbyState(null);
      setGameState(null);
      hostGameRef.current?.destroy();
      hostGameRef.current = null;
      setError('Host disconnected. Lobby has been closed.');
    });

    // Seat management events
    socket.on('seat_changed', ({ mySeat, players }: { mySeat: number; players: LobbyPlayer[] }) => {
      setLobbyState(prev => prev ? { ...prev, mySeat, players } : null);
    });

    socket.on('swap_request', ({ fromName, fromSeat }: { fromName: string; fromSeat: number }) => {
      setSwapRequest({ fromName, fromSeat });
    });

    socket.on('swap_declined', ({ byName }: { byName: string }) => {
      setStatusMessage(`${byName} declined your swap request`);
      setTimeout(() => setStatusMessage(''), 3000);
    });

    socket.on('disconnect', () => {
      console.log('[MP] Disconnected from server');
    });

    return () => {
      socket.disconnect();
      hostGameRef.current?.destroy();
    };
  }, []);

  // Host: listen for player actions
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handlePlayerAction = ({ seat, action }: { seat: number; action: PlayerAction }) => {
      const hostGame = hostGameRef.current;
      if (!hostGame) return;
      hostGame.handlePlayerAction(seat, action);
    };

    socket.on('player_action', handlePlayerAction);
    return () => { socket.off('player_action', handlePlayerAction); };
  }, []);

  const handleCreate = useCallback(() => {
    if (!passphrase.trim() || !playerName.trim()) {
      setError('Please enter a passphrase and your name');
      return;
    }
    socketRef.current?.emit('create_lobby', {
      passphrase: passphrase.trim(),
      playerName: playerName.trim(),
      aiStrategy
    });
  }, [passphrase, playerName, aiStrategy]);

  const handleJoin = useCallback(() => {
    if (!passphrase.trim() || !playerName.trim()) {
      setError('Please enter the passphrase and your name');
      return;
    }
    socketRef.current?.emit('join_lobby', {
      passphrase: passphrase.trim(),
      playerName: playerName.trim()
    });
  }, [passphrase, playerName]);

  const handleLeave = useCallback(() => {
    socketRef.current?.emit('leave_lobby');
    setPhase('lobby');
    setLobbyState(null);
    setGameState(null);
    hostGameRef.current?.destroy();
    hostGameRef.current = null;
  }, []);

  const handleSeatClick = useCallback((targetSeat: number) => {
    if (!lobbyState) return;
    if (targetSeat === lobbyState.mySeat) return; // clicking own seat

    const occupant = lobbyState.players.find(p => p.seat === targetSeat);
    if (occupant) {
      // Seat is occupied — request swap
      socketRef.current?.emit('request_swap', { targetSeat });
      setStatusMessage(`Swap request sent to ${occupant.name}...`);
      setTimeout(() => setStatusMessage(''), 3000);
    } else {
      // Seat is empty — move directly
      socketRef.current?.emit('move_seat', { targetSeat });
    }
  }, [lobbyState]);

  const handleSwapResponse = useCallback((accepted: boolean) => {
    if (!swapRequest) return;
    socketRef.current?.emit('swap_response', {
      accepted,
      fromSeat: swapRequest.fromSeat
    });
    setSwapRequest(null);
  }, [swapRequest]);

  const handleStartGame = useCallback(() => {
    if (!lobbyState) return;
    const socket = socketRef.current;
    if (!socket) return;

    // Create HostGame instance
    const hostGame = new HostGame(lobbyState.players, lobbyState.aiStrategy);
    hostGameRef.current = hostGame;

    // Set up state broadcasting: host gets state locally,
    // other human players receive per-seat states via socket broadcast
    hostGame.onBroadcast((states) => {
      const hostState = states.get(lobbyState.mySeat);
      if (hostState) {
        setGameState(hostState);
      }

      // Build per-seat states for remote players and broadcast
      const statesArray: { seat: number; state: MultiplayerGameState }[] = [];
      states.forEach((state, seat) => {
        if (seat !== lobbyState.mySeat) {
          statesArray.push({ seat, state });
        }
      });

      if (statesArray.length > 0) {
        socket.emit('game_state_all', {
          state: { type: 'per_seat', states: statesArray }
        });
      }
    });

    socket.emit('start_game');
    hostGame.startGame();
  }, [lobbyState]);

  // Guest: handle incoming per-seat state
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !lobbyState || lobbyState.isHost) return;

    const handleState = (data: any) => {
      if (data && data.type === 'per_seat' && data.states) {
        // Find my seat's state
        const myState = data.states.find((s: any) => s.seat === lobbyState.mySeat);
        if (myState) {
          setGameState(myState.state);
        }
      } else if (data && !data.type) {
        // Direct state (fallback)
        setGameState(data);
      }
    };

    socket.on('game_state', handleState);
    return () => { socket.off('game_state', handleState); };
  }, [lobbyState]);

  // Send player action (for both host and guest)
  const sendAction = useCallback((action: PlayerAction) => {
    if (!lobbyState) return;

    if (lobbyState.isHost) {
      // Host processes action locally
      hostGameRef.current?.handlePlayerAction(lobbyState.mySeat, action);
    } else {
      // Guest sends action to server
      socketRef.current?.emit('player_action', { action });
    }
  }, [lobbyState]);

  // Game action handlers
  const handleBid = useCallback((amount: number) => {
    sendAction({ type: 'bid', amount });
  }, [sendAction]);

  const handleTrumpSelection = useCallback((suit: string, direction: 'uptown' | 'downtown' | 'downtown-noaces') => {
    sendAction({ type: 'trump', suit, direction });
  }, [sendAction]);

  const handleDiscard = useCallback((cardIds: string[]) => {
    sendAction({ type: 'discard', cardIds });
  }, [sendAction]);

  const handlePlayCard = useCallback((card: Card) => {
    sendAction({ type: 'play', cardId: card.id });
  }, [sendAction]);

  // ---- RENDER ----

  // Lobby creation/joining screen
  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="bg-gray-800 rounded-lg p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold mb-6 text-center">Multiplayer Bid Whist</h1>

          {/* Tabs */}
          <div className="flex mb-6">
            <button
              className={`flex-1 py-2 text-center rounded-l ${lobbyTab === 'create' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
              onClick={() => { setLobbyTab('create'); setError(null); }}
            >
              Create
            </button>
            <button
              className={`flex-1 py-2 text-center rounded-r ${lobbyTab === 'join' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
              onClick={() => { setLobbyTab('join'); setError(null); }}
            >
              Join
            </button>
          </div>

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
              <label className="block text-sm text-gray-300 mb-1">Passphrase</label>
              <input
                type="text"
                value={passphrase}
                onChange={e => setPassphrase(e.target.value)}
                placeholder="Secret passphrase to share"
                className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 text-white focus:outline-none focus:border-blue-500"
                maxLength={50}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    lobbyTab === 'create' ? handleCreate() : handleJoin();
                  }
                }}
              />
            </div>

            {lobbyTab === 'create' && (
              <div>
                <label className="block text-sm text-gray-300 mb-1">AI Strategy</label>
                <select
                  value={aiStrategy}
                  onChange={e => setAiStrategy(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 text-white focus:outline-none focus:border-blue-500"
                >
                  {bidWhistStrategies.map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            <button
              className="w-full bg-blue-600 hover:bg-blue-700 py-3 rounded font-semibold text-lg"
              onClick={lobbyTab === 'create' ? handleCreate : handleJoin}
            >
              {lobbyTab === 'create' ? 'Create Lobby' : 'Join Lobby'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Waiting room
  if (phase === 'waiting' && lobbyState) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="bg-gray-800 rounded-lg p-8 w-full max-w-md">
          <h2 className="text-xl font-bold mb-2 text-center">Waiting Room</h2>
          <p className="text-gray-400 text-center text-sm mb-6">
            Passphrase: <span className="text-white font-mono">{lobbyState.passphrase}</span>
          </p>

          {/* Swap request banner */}
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

          {/* Status message */}
          {statusMessage && phase === 'waiting' && (
            <div className="bg-gray-700 text-gray-300 text-sm text-center px-3 py-2 rounded mb-4">
              {statusMessage}
            </div>
          )}

          <div className="space-y-3 mb-6">
            {[0, 1, 2, 3].map(seat => {
              const player = lobbyState.players.find(p => p.seat === seat);
              const seatLabel = ['South', 'East', 'North', 'West'][seat];
              const teamLabel = seat % 2 === 0 ? 'Team 1' : 'Team 2';
              const isMe = seat === lobbyState.mySeat;
              const isClickable = !isMe;
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
                  onClick={isClickable ? () => handleSeatClick(seat) : undefined}
                  title={isMe ? 'Your seat' : player ? `Click to request swap with ${player.name}` : 'Click to move here'}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-12">{seatLabel}</span>
                    {player ? (
                      <span className="font-semibold">
                        {player.name}
                        {player.isHost && <span className="ml-2 text-xs bg-yellow-600 px-1.5 py-0.5 rounded">Host</span>}
                        {isMe && <span className="ml-2 text-xs bg-blue-600 px-1.5 py-0.5 rounded">You</span>}
                      </span>
                    ) : (
                      <span className="text-gray-500 italic">AI ({lobbyState.aiStrategy})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isClickable && !player && (
                      <span className="text-xs text-blue-400">Move here</span>
                    )}
                    {isClickable && player && (
                      <span className="text-xs text-blue-400">Swap</span>
                    )}
                    <span className="text-xs text-gray-500">{teamLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-center text-sm text-gray-400 mb-4">
            {lobbyState.players.length}/4 players ({4 - lobbyState.players.length} AI)
          </div>

          <div className="flex gap-3">
            <button
              className="flex-1 bg-gray-600 hover:bg-gray-500 py-2 rounded"
              onClick={handleLeave}
            >
              Leave
            </button>
            {lobbyState.isHost && (
              <button
                className="flex-1 bg-green-600 hover:bg-green-700 py-2 rounded font-semibold"
                onClick={handleStartGame}
              >
                Start Game
              </button>
            )}
          </div>

          {!lobbyState.isHost && (
            <p className="text-center text-gray-500 text-sm mt-4">
              Waiting for host to start the game...
            </p>
          )}
        </div>
      </div>
    );
  }

  // Game phase
  if (phase === 'game' && gameState) {
    return <MultiplayerGameView
      gameState={gameState}
      lobbyState={lobbyState!}
      onBid={handleBid}
      onTrumpSelection={handleTrumpSelection}
      onDiscard={handleDiscard}
      onPlayCard={handlePlayCard}
      onLeave={handleLeave}
      statusMessage={statusMessage}
    />;
  }

  return null;
};

// ---- Game View Component ----

interface GameViewProps {
  gameState: MultiplayerGameState;
  lobbyState: LobbyState;
  onBid: (amount: number) => void;
  onTrumpSelection: (suit: string, direction: 'uptown' | 'downtown' | 'downtown-noaces') => void;
  onDiscard: (cardIds: string[]) => void;
  onPlayCard: (card: Card) => void;
  onLeave: () => void;
  statusMessage: string;
}

const MultiplayerGameView: React.FC<GameViewProps> = ({
  gameState: gs,
  lobbyState,
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
