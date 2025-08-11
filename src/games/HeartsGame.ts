import { CardGame, Card, Player } from '../types/CardGame.ts';

export class HeartsGame extends CardGame {
  private leadSuit: string | null = null;
  private heartsBroken: boolean = false;

  constructor() {
    super(['You', 'West', 'North', 'East']);
    this.message = 'Welcome to Hearts!';
  }

  createDeck(): Card[] {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const deck: Card[] = [];
    
    suits.forEach(suit => {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({ suit, rank, id: `${suit}_${rank}` });
      }
    });
    
    return deck;
  }

  dealCards(): void {
    const deck = this.shuffleDeck(this.createDeck());
    
    for (let i = 0; i < deck.length; i++) {
      const playerIndex = i % 4;
      this.players[playerIndex].hand.push(deck[i]);
    }
    
    // Sort hands
    this.players.forEach(player => {
      player.hand.sort((a, b) => {
        const suitOrder: { [key: string]: number } = { clubs: 1, diamonds: 2, spades: 3, hearts: 4 };
        if (suitOrder[a.suit] !== suitOrder[b.suit]) {
          return suitOrder[a.suit] - suitOrder[b.suit];
        }
        return a.rank - b.rank;
      });
    });

    this.findStartingPlayer();
    this.gameStage = 'play';
  }

  findStartingPlayer(): void {
    // Find player with 2 of clubs
    const twoOfClubsPlayer = this.players.findIndex(player => 
      player.hand.some(card => card.suit === 'clubs' && card.rank === 2)
    );
    
    this.currentPlayer = twoOfClubsPlayer;
    this.message = `${this.players[twoOfClubsPlayer].name} starts with the 2 of clubs`;
  }

  isValidMove(playerId: number, card: Card): boolean {
    const playerHand = this.players[playerId].hand;
    
    // First trick special rules
    if (this.currentTrick.length === 0 && this.leadSuit === null) {
      // First card of the first trick must be 2 of clubs
      const twoOfClubs = playerHand.find(c => c.suit === 'clubs' && c.rank === 2);
      if (twoOfClubs) {
        return card.suit === 'clubs' && card.rank === 2;
      }
    }
    
    // If player is leading the trick
    if (this.currentTrick.length === 0) {
      // Cannot lead with hearts until hearts are broken
      if (card && card.suit === 'hearts' && !this.heartsBroken) {
        // Unless player only has hearts
        const onlyHasHearts = playerHand.every(c => c.suit === 'hearts');
        if (!onlyHasHearts) {
          return false;
        }
      }
      return true;
    }
    
    // Must follow suit if possible
    if (this.leadSuit) {
      const hasSuit = playerHand.some(c => c.suit === this.leadSuit);
      if (hasSuit) {
        return card.suit === this.leadSuit;
      }
    }
    
    // First trick special rule: can't play hearts or queen of spades
    if (this.currentTrick.some(c => c.card.suit === 'clubs' && c.card.rank === 2)) {
      if (card.suit === 'hearts' || (card.suit === 'spades' && card.rank === 12)) {
        // Unless player only has hearts and queen of spades
        const onlyHasHeartAndQueen = playerHand.every(c => 
          c.suit === 'hearts' || (c.suit === 'spades' && c.rank === 12)
        );
        if (!onlyHasHeartAndQueen) {
          return false;
        }
      }
    }
    
    return true;
  }

  protected getValidationError(playerId: number, card: Card): string {
    const playerHand = this.players[playerId].hand;
    
    // First trick special rules
    if (this.currentTrick.length === 0 && this.leadSuit === null) {
      const twoOfClubs = playerHand.find(c => c.suit === 'clubs' && c.rank === 2);
      if (twoOfClubs && !(card.suit === 'clubs' && card.rank === 2)) {
        return "Must play 2 of clubs to start the game";
      }
    }
    
    // If player is leading the trick
    if (this.currentTrick.length === 0) {
      if (card && card.suit === 'hearts' && !this.heartsBroken) {
        const onlyHasHearts = playerHand.every(c => c.suit === 'hearts');
        if (!onlyHasHearts) {
          return "Can't lead with hearts until hearts are broken!";
        }
      }
    }
    
    // Must follow suit if possible
    if (this.leadSuit) {
      const hasSuit = playerHand.some(c => c.suit === this.leadSuit);
      if (hasSuit && card.suit !== this.leadSuit) {
        return "Must follow suit if possible";
      }
    }
    
    // First trick special rule: can't play hearts or queen of spades
    if (this.currentTrick.some(c => c.card.suit === 'clubs' && c.card.rank === 2)) {
      if (card.suit === 'hearts' || (card.suit === 'spades' && card.rank === 12)) {
        const onlyHasHeartAndQueen = playerHand.every(c => 
          c.suit === 'hearts' || (c.suit === 'spades' && c.rank === 12)
        );
        if (!onlyHasHeartAndQueen) {
          return "Can't play hearts or queen of spades on the first trick!";
        }
      }
    }
    
    return "Invalid move";
  }

  protected processCardPlay(playerId: number, card: Card): void {
    // Set lead suit if this is the first card of the trick
    if (this.currentTrick.length === 1) { // Just added the card, so length is 1
      this.leadSuit = card.suit;
    }
    
    // Check if hearts are broken
    if (card.suit === 'hearts' && !this.heartsBroken) {
      this.heartsBroken = true;
    }

    // Call parent implementation
    super.processCardPlay(playerId, card);
  }

  protected finalizeTrick(winnerPlayerId: number): void {
    // Call parent implementation
    super.finalizeTrick(winnerPlayerId);
    
    // Clear lead suit for Hearts
    this.leadSuit = null;
  }

  getBestMove(playerId: number): Card | null {
    const playerHand = this.players[playerId].hand;
    
    if (playerHand.length === 0) return null;

    // If leading a trick
    if (this.currentTrick.length === 0) {
      // Must play 2 of clubs if it's the first trick
      const twoOfClubs = playerHand.find(c => c.suit === 'clubs' && c.rank === 2);
      if (twoOfClubs) return twoOfClubs;
      
      // If hearts aren't broken, play a non-heart
      if (!this.heartsBroken) {
        const nonHeart = playerHand.find(c => c.suit !== 'hearts');
        if (nonHeart) return nonHeart;
      }
      
      // Otherwise, play lowest card
      return [...playerHand].sort((a, b) => a.rank - b.rank)[0];
    }
    
    // Follow suit if possible
    const suitCards = playerHand.filter(c => c.suit === this.leadSuit);
    if (suitCards.length > 0) {
      // Play highest card if it won't take the trick
      const currentHighest = this.currentTrick.reduce((highest, play) => {
        return play.card.suit === this.leadSuit && play.card.rank > highest.rank
          ? play.card
          : highest;
      }, { rank: 0 } as Card);
      
      const safeHighCards = suitCards.filter(c => c.rank < currentHighest.rank);
      if (safeHighCards.length > 0) {
        return safeHighCards.sort((a, b) => b.rank - a.rank)[0];
      }
      
      // Otherwise play lowest card of the suit
      return suitCards.sort((a, b) => a.rank - b.rank)[0];
    }
    
    // If can't follow suit, try to dump the queen of spades
    const queenOfSpades = playerHand.find(c => c.suit === 'spades' && c.rank === 12);
    if (queenOfSpades) return queenOfSpades;
    
    // Try to dump high hearts
    const hearts = playerHand.filter(c => c.suit === 'hearts').sort((a, b) => b.rank - a.rank);
    if (hearts.length > 0) return hearts[0];
    
    // Play highest card
    return [...playerHand].sort((a, b) => b.rank - a.rank)[0];
  }

  evaluateTrick(): number {
    if (this.currentTrick.length === 0) return -1;
    
    const leadingSuit = this.currentTrick[0].card.suit;
  
    // Find the highest card of the leading suit
    let highestRank = -1;
    let winnerPlayerId = -1;
  
    this.currentTrick.forEach((play) => {
      if (play.card.suit === leadingSuit && play.card.rank > highestRank) {
        highestRank = play.card.rank;
        winnerPlayerId = play.playerId;
      }
    });
  
    return winnerPlayerId;
  }

  scoreHand(): void {
    let shootingMoonPlayer: number | null = null;
    
    // Score each player's tricks
    this.players.forEach(player => {
      let hearts = 0;
      let queenOfSpades = false;
      
      player.tricks.forEach(card => {
        if (card.suit === 'hearts') {
          hearts++;
        }
        if (card.suit === 'spades' && card.rank === 12) {
          queenOfSpades = true;
        }
      });
      
      player.score = hearts + (queenOfSpades ? 13 : 0);
      
      // Check if a player shot the moon
      if (hearts === 13 && queenOfSpades) {
        shootingMoonPlayer = player.id;
      }
    });
    
    // Apply shooting the moon
    if (shootingMoonPlayer !== null) {
      this.players.forEach(player => {
        if (player.id === shootingMoonPlayer) {
          player.score = 0;
        } else {
          player.score = 26;
        }
      });
      this.message = `${this.players[shootingMoonPlayer].name} shot the moon!`;
    }
    
    // Update total scores
    this.players.forEach(player => {
      player.totalScore += player.score;
    });
  }

  isGameOver(): boolean {
    return this.players.some(player => player.totalScore >= 100);
  }

  getGameSpecificMessage(): string {
    if (this.gameOver && this.winner) {
      return `Game over! ${this.winner.name} wins with ${this.winner.totalScore} points!`;
    }
    if (this.gameStage === 'scoring') {
      return "Hand complete! Press Deal to start the next hand.";
    }
    return this.message;
  }

  // Hearts-specific getters
  getHeartsBroken(): boolean {
    return this.heartsBroken;
  }

  getLeadSuit(): string | null {
    return this.leadSuit;
  }

  // Reset Hearts-specific state
  resetGame(): void {
    super.resetGame();
    this.leadSuit = null;
    this.heartsBroken = false;
    this.message = 'Welcome to Hearts!';
  }

  startNewHand(): void {
    super.startNewHand();
    this.leadSuit = null;
    this.heartsBroken = false;
  }
}