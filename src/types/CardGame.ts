// Generic card game interfaces and types

export interface Card {
  suit: string;
  rank: number;
  id: string;
}

export interface Player {
  id: number;
  name: string;
  hand: Card[];
  tricks: Card[];
  score: number;
  totalScore: number;
}

export interface PlayedCard {
  playerId: number;
  card: Card;
}

export interface GameMove {
  playerId: number;
  card: Card;
  isValid: boolean;
  errorMessage?: string;
}

export interface GameState {
  players: Player[];
  currentTrick: PlayedCard[];
  currentPlayer: number | null;
  gameStage: 'deal' | 'play' | 'scoring';
  gameOver: boolean;
  winner: Player | null;
  message: string;
}

// Abstract base class for card games
export abstract class CardGame {
  protected players: Player[];
  protected currentTrick: PlayedCard[];
  protected currentPlayer: number | null;
  protected gameStage: 'deal' | 'play' | 'scoring';
  protected gameOver: boolean;
  protected winner: Player | null;
  protected message: string;

  constructor(playerNames: string[]) {
    this.players = playerNames.map((name, index) => ({
      id: index,
      name,
      hand: [],
      tricks: [],
      score: 0,
      totalScore: 0
    }));
    this.currentTrick = [];
    this.currentPlayer = null;
    this.gameStage = 'deal';
    this.gameOver = false;
    this.winner = null;
    this.message = 'Welcome to the game!';
  }

  // Abstract methods that each game must implement
  abstract createDeck(): Card[];
  abstract dealCards(): void;
  abstract findStartingPlayer(): void;
  abstract isValidMove(playerId: number, card: Card): boolean;
  abstract getBestMove(playerId: number): Card | null;
  abstract evaluateTrick(): number; // Returns winner player ID
  abstract scoreHand(): void;
  abstract isGameOver(): boolean;
  abstract getGameSpecificMessage(): string;

  // Generic methods that most games can use
  shuffleDeck(deck: Card[]): Card[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  playCard(playerId: number, card: Card): GameMove {
    if (!this.isValidMove(playerId, card)) {
      return {
        playerId,
        card,
        isValid: false,
        errorMessage: this.getValidationError(playerId, card)
      };
    }

    // Add card to current trick
    this.currentTrick.push({ playerId, card });

    // Remove card from player's hand
    this.players[playerId].hand = this.players[playerId].hand.filter(c => c.id !== card.id);

    // Process the play
    this.processCardPlay(playerId, card);

    return {
      playerId,
      card,
      isValid: true
    };
  }

  protected processCardPlay(playerId: number, card: Card): void {
    // If all players have played, evaluate the trick
    if (this.currentTrick.length === this.players.length) {
      const winnerPlayerId = this.evaluateTrick();
      console.log(`Trick ended, winner: ${winnerPlayerId}`)
      this.finalizeTrick(winnerPlayerId);
    } else {
      // Move to next player
      this.setNextPlayer();
    }
  }

  protected finalizeTrick(winnerPlayerId: number): void {
    // Add cards to winner's tricks
    this.players[winnerPlayerId].tricks.push(...this.currentTrick.map(play => play.card));
    
    // Clear the current trick
    this.currentTrick = [];
    this.currentPlayer = winnerPlayerId;

    // Check if hand is complete
    if (this.isHandComplete()) {
      this.scoreHand();
      if (this.isGameOver()) {
        this.gameStage = 'scoring';
        this.gameOver = true;
        this.findWinner();
      } else {
        this.gameStage = 'scoring';
      }
    }
  }

  protected setNextPlayer(): void {
    if (this.currentPlayer !== null) {
      this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
    }
  }

  protected isHandComplete(): boolean {
    return this.players.every(player => player.hand.length === 0);
  }

  protected findWinner(): void {
    // Default implementation - lowest score wins
    this.winner = this.players.reduce((lowest, player) => 
      player.totalScore < lowest.totalScore ? player : lowest, this.players[0]);
  }

  protected getValidationError(playerId: number, card: Card): string {
    return "Invalid move, tried to play "+ card.rank + " of " + card.suit;
  }

  // Getters for game state
  getGameState(): GameState {
    return {
      players: [...this.players],
      currentTrick: [...this.currentTrick],
      currentPlayer: this.currentPlayer,
      gameStage: this.gameStage,
      gameOver: this.gameOver,
      winner: this.winner,
      message: this.message
    };
  }

  getPlayer(playerId: number): Player | null {
    return this.players.find(p => p.id === playerId) || null;
  }

  getCurrentPlayer(): Player | null {
    return this.currentPlayer !== null ? this.players[this.currentPlayer] : null;
  }

  resetGame(): void {
    this.players.forEach(player => {
      player.hand = [];
      player.tricks = [];
      player.score = 0;
      player.totalScore = 0;
    });
    this.currentTrick = [];
    this.currentPlayer = null;
    this.gameStage = 'deal';
    this.gameOver = false;
    this.winner = null;
    this.message = 'Welcome to the game!';
  }

  startNewHand(): void {
    this.players.forEach(player => {
      player.hand = [];
      player.tricks = [];
      player.score = 0;
    });
    this.currentTrick = [];
    this.currentPlayer = null;
    this.gameStage = 'deal';
    this.dealCards();
  }
}