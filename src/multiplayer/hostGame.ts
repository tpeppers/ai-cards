import { BidWhistGame } from '../games/BidWhistGame.ts';
import { STRATEGY_REGISTRY } from '../strategies/index.ts';
import { Card } from '../types/CardGame.ts';
import { LobbyPlayer, MultiplayerGameState, PlayerAction } from './types.ts';

type BidDirection = 'uptown' | 'downtown' | 'downtown-noaces';

export class HostGame {
  private game: BidWhistGame;
  private players: LobbyPlayer[];       // human players in lobby
  private humanSeats: Set<number>;
  private aiStrategy: string;
  private broadcastCallback: ((states: Map<number, MultiplayerGameState>) => void) | null = null;
  private aiTimers: ReturnType<typeof setTimeout>[] = [];
  private destroyed = false;
  private playerNames: string[] = ['South', 'East', 'North', 'West'];

  constructor(players: LobbyPlayer[], aiStrategy: string) {
    this.players = players;
    this.humanSeats = new Set(players.map(p => p.seat));
    this.aiStrategy = aiStrategy;
    this.game = new BidWhistGame();

    // Set player names
    const seatNames = ['South', 'East', 'North', 'West'];
    this.playerNames = seatNames.map((defaultName, seat) => {
      const human = players.find(p => p.seat === seat);
      return human ? human.name : `AI ${defaultName}`;
    });

    // Load AI strategy
    const strategyEntry = STRATEGY_REGISTRY.find(
      s => s.game === 'bidwhist' && s.name === aiStrategy
    );
    if (strategyEntry) {
      this.game.loadStrategy(strategyEntry.text);
    }
  }

  onBroadcast(callback: (states: Map<number, MultiplayerGameState>) => void): void {
    this.broadcastCallback = callback;
  }

  startGame(): void {
    this.game.dealCards();
    this.broadcastAllStates();
    this.scheduleAITurn();
  }

  // Remove a human player and replace with AI
  removePlayer(seat: number): void {
    this.humanSeats.delete(seat);
    this.playerNames[seat] = `AI ${['South', 'East', 'North', 'West'][seat]}`;
    this.broadcastAllStates();
    // If it was this player's turn, trigger AI
    this.scheduleAITurn();
  }

  handlePlayerAction(seat: number, action: PlayerAction): boolean {
    if (!this.humanSeats.has(seat)) return false;

    const gameState = this.game.getGameState();
    let success = false;

    switch (action.type) {
      case 'bid':
        if (gameState.gameStage !== 'bidding' || gameState.currentPlayer !== seat) break;
        success = this.game.placeBid(seat, action.amount);
        break;

      case 'trump':
        if (gameState.gameStage !== 'trumpSelection') break;
        if (this.game.getDeclarer() !== seat) break;
        success = this.game.setTrumpSuitForPlayer(
          action.suit,
          action.direction as BidDirection,
          true // human declarer - go to discard phase
        );
        break;

      case 'discard':
        if (gameState.gameStage !== 'discarding') break;
        if (this.game.getDeclarer() !== seat) break;
        success = this.game.discardCardsForPlayer(seat, action.cardIds);
        break;

      case 'play': {
        if (gameState.gameStage !== 'play' || gameState.currentPlayer !== seat) break;
        const card = gameState.players[seat]?.hand.find(c => c.id === action.cardId);
        if (card) {
          const move = this.game.playCard(seat, card);
          success = move.isValid;
        }
        break;
      }
    }

    if (success) {
      this.broadcastAllStates();
      this.checkAutoTransitions();
      this.scheduleAITurn();
    }

    return success;
  }

  getStateForPlayer(seat: number): MultiplayerGameState {
    const gs = this.game.getGameState();
    const bs = this.game.getBiddingState();
    const declarer = this.game.getDeclarer();
    const dealer = this.game.getDealer();
    const trumpSuit = this.game.getTrumpSuit();
    const bidDirection = this.game.getBidDirection();
    const teamScores = this.game.getTeamScores();
    const booksWon = this.game.getBooksWon();
    const whistingWinner = this.game.getWhistingWinner();
    const lastTrick = this.game.getLastCompletedTrick();

    // Rotation amount: how much to rotate so seat appears as index 0
    const rot = seat;

    const rotateSeat = (s: number): number => (s - rot + 4) % 4;

    // Rotated players array: index 0 = me, 1 = left, 2 = across, 3 = right
    const rotatedPlayers = [0, 1, 2, 3].map(i => {
      const actualSeat = (i + rot) % 4;
      const player = gs.players[actualSeat];
      return {
        name: this.playerNames[actualSeat],
        cardCount: player.hand.length,
        isAI: !this.humanSeats.has(actualSeat),
        totalScore: player.totalScore,
        trickCount: Math.floor(player.tricks.length / 4) // tricks are stored as individual cards, 4 per trick
      };
    });

    // Rotate current trick
    const rotatedTrick = gs.currentTrick.map(play => ({
      playerId: rotateSeat(play.playerId),
      card: play.card
    }));

    // Rotate last trick
    const rotatedLastTrick = lastTrick.map(play => ({
      playerId: rotateSeat(play.playerId),
      card: play.card
    }));

    // Rotate bidding state
    const rotatedBids = bs.bids.map(bid => ({
      ...bid,
      playerId: rotateSeat(bid.playerId)
    }));

    const rotatedBiddingState = {
      ...bs,
      bids: rotatedBids,
      currentHighBidder: bs.currentHighBidder !== null ? rotateSeat(bs.currentHighBidder) : null,
      dealer: rotateSeat(bs.dealer)
    };

    // Rotate team scores: index 0 = my team, index 1 = opposing team
    const myTeam = seat % 2;
    const rotatedTeamScores: [number, number] = [teamScores[myTeam], teamScores[1 - myTeam]];
    const rotatedBooksWon: [number, number] = [booksWon[myTeam], booksWon[1 - myTeam]];

    // Determine turn phase
    const currentPlayer = gs.currentPlayer !== null ? rotateSeat(gs.currentPlayer) : -1;
    const isMyTurn = gs.currentPlayer === seat;
    let turnPhase: MultiplayerGameState['turnPhase'] = 'wait';

    if (gs.gameStage === 'scoring') {
      turnPhase = 'scoring';
    } else if (gs.gameStage === 'bidding' && isMyTurn) {
      turnPhase = 'bid';
    } else if (gs.gameStage === 'trumpSelection' && declarer === seat) {
      turnPhase = 'trump';
    } else if (gs.gameStage === 'discarding' && declarer === seat) {
      turnPhase = 'discard';
    } else if (gs.gameStage === 'play' && isMyTurn) {
      turnPhase = 'play';
    }

    // Only include hand cards for this player
    const myHand = gs.players[seat]?.hand || [];

    // Valid moves/bids only when it's this player's turn
    let validMoves: Card[] | undefined;
    let validBids: number[] | undefined;

    if (turnPhase === 'play') {
      validMoves = myHand.filter(card => this.game.isValidMove(seat, card));
    } else if (turnPhase === 'bid') {
      validBids = this.game.getValidBids();
    }

    // Winner info
    let winner: string | null = null;
    if (gs.gameOver && gs.winner) {
      const winningTeam = gs.winner.id % 2;
      const teamNames = myTeam === winningTeam ? 'Your team' : 'Opposing team';
      winner = teamNames;
    }

    // Rotated declarer and dealer
    const rotatedDeclarer = declarer !== null ? rotateSeat(declarer) : -1;
    const rotatedDealer = rotateSeat(dealer);

    return {
      gameStage: gs.gameStage,
      myHand,
      currentTrick: rotatedTrick,
      currentPlayer,
      mySeat: seat,
      players: rotatedPlayers,
      biddingState: rotatedBiddingState,
      trumpSuit,
      bidDirection,
      teamScores: rotatedTeamScores,
      booksWon: rotatedBooksWon,
      gameOver: gs.gameOver,
      winner,
      whistingWinner,
      message: gs.message,
      validMoves,
      validBids,
      lastTrick: rotatedLastTrick,
      isMyTurn,
      turnPhase,
      declarer: rotatedDeclarer,
      dealer: rotatedDealer
    };
  }

  private broadcastAllStates(): void {
    if (this.destroyed) return;

    if (this.broadcastCallback) {
      const states = new Map<number, MultiplayerGameState>();
      // Send to all human players
      for (const seat of this.humanSeats) {
        states.set(seat, this.getStateForPlayer(seat));
      }
      this.broadcastCallback(states);
    }
  }

  private scheduleAITurn(): void {
    if (this.destroyed) return;

    const gs = this.game.getGameState();
    if (gs.gameOver) return;
    if (gs.gameStage === 'scoring') return;
    if (gs.gameStage === 'deal') return;

    const currentPlayer = gs.currentPlayer;
    if (currentPlayer === null) return;

    // Check if current player is AI
    if (this.humanSeats.has(currentPlayer)) return;

    // Also handle AI declarer for trump selection
    const declarer = this.game.getDeclarer();
    if (gs.gameStage === 'trumpSelection' && declarer !== null && !this.humanSeats.has(declarer)) {
      const delay = 1000 + Math.random() * 500;
      const timer = setTimeout(() => {
        if (this.destroyed) return;
        this.game.processAITrumpSelection(declarer);
        this.broadcastAllStates();
        this.checkAutoTransitions();
        this.scheduleAITurn();
      }, delay);
      this.aiTimers.push(timer);
      return;
    }

    if (gs.gameStage === 'bidding') {
      const delay = 1000 + Math.random() * 500;
      const timer = setTimeout(() => {
        if (this.destroyed) return;
        this.game.processAIBid(currentPlayer);
        this.broadcastAllStates();
        this.checkAutoTransitions();
        this.scheduleAITurn();
      }, delay);
      this.aiTimers.push(timer);
    } else if (gs.gameStage === 'play') {
      const delay = 1000 + Math.random() * 500;
      const timer = setTimeout(() => {
        if (this.destroyed) return;
        const bestMove = this.game.getBestMove(currentPlayer);
        if (bestMove) {
          this.game.playCard(currentPlayer, bestMove);
          this.broadcastAllStates();
          this.checkAutoTransitions();
          this.scheduleAITurn();
        }
      }, delay);
      this.aiTimers.push(timer);
    }
  }

  private checkAutoTransitions(): void {
    if (this.destroyed) return;
    const gs = this.game.getGameState();

    // After scoring, auto-start new hand
    if (gs.gameStage === 'scoring' && !gs.gameOver) {
      const timer = setTimeout(() => {
        if (this.destroyed) return;
        this.game.startNewHand();
        this.broadcastAllStates();
        this.scheduleAITurn();
      }, 4000);
      this.aiTimers.push(timer);
    }

    // Game over: auto-restart after delay
    if (gs.gameOver) {
      const timer = setTimeout(() => {
        if (this.destroyed) return;
        this.game.resetGame();
        this.game.dealCards();
        this.broadcastAllStates();
        this.scheduleAITurn();
      }, 6000);
      this.aiTimers.push(timer);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.aiTimers.forEach(timer => clearTimeout(timer));
    this.aiTimers = [];
  }
}
