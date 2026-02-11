import { CardGame, Card } from '../types/CardGame.ts';
import { cardToLetter, letterToCard } from '../urlGameState.js';
import { evaluatePlay, evaluateBid, evaluateTrump } from '../strategy/evaluator.ts';
import { buildBidWhistContext } from '../strategy/context.ts';

type BidDirection = 'uptown' | 'downtown' | 'downtown-noaces';

export interface BidInfo {
  playerId: number;
  amount: number; // 0 = pass, 1-6 = bid amount
  passed: boolean;
}

export interface BidWhistState {
  biddingPhase: boolean;
  currentHighBid: number;
  currentHighBidder: number | null;
  bids: BidInfo[];
  allPlayersBid: boolean;
  dealer: number;
}

export class BidWhistGame extends CardGame {
  private leadSuit: string | null = null;
  private trumpSuit: string | null = null;
  private bidDirection: BidDirection = 'uptown';
  private currentHighBid: number = 0;
  private currentHighBidder: number | null = null;
  private bids: BidInfo[] = [];
  private biddingComplete: boolean = false;
  private kitty: Card[] = [];
  private declarer: number | null = null;
  private teamScores: [number, number] = [0, 0];
  private booksWon: [number, number] = [0, 0];
  private dealer: number = 0; // Dealer position, rotates clockwise each hand
  private lastCompletedTrick: { playerId: number; card: Card }[] = []; // Last book played

  constructor() {
    super(['You', 'East', 'North', 'West']);
    // Randomly pick initial dealer
    this.dealer = Math.floor(Math.random() * 4);
    this.message = 'Welcome to Bid Whist!';
  }

  createDeck(): Card[] {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const deck: Card[] = [];

    // Standard 52-card deck (no jokers in this variation)
    suits.forEach(suit => {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({ suit, rank, id: `${suit}_${rank}` });
      }
    });

    return deck;
  }

  private isInDeck(eDeck: Card[], aCard: Card): boolean {
    return eDeck.some(card => card.id === aCard.id);
  }

  private getNewRandom(existingDeck: Card[]): Card {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let result = '';
    let isDone = false;
    while (!isDone) {
      result = characters.charAt(Math.floor(Math.random() * characters.length));
      isDone = !this.isInDeck(existingDeck, letterToCard(result));
    }
    return letterToCard(result);
  }

  // Perform "Close-up Magic" - create deck from URL string
  private rigDeck(urlToDeal: string): Card[] {
    const deck: Card[] = [];
    for (let i = 0; i < urlToDeal.length; i++) {
      deck.push(letterToCard(urlToDeal[i]));
    }

    // If there's randoms, fill them in with values
    if (urlToDeal.indexOf('_') > -1) {
      for (let i = 0; i < urlToDeal.length; i++) {
        if (urlToDeal[i] === '_') {
          deck[i] = this.getNewRandom(deck);
        }
      }
    }

    let deckString = '';
    for (let i = 0; i < urlToDeal.length; i++) {
      deckString = deckString + cardToLetter(deck[i]);
    }

    console.log(`Bid Whist dealing deck, URL string was: ${deckString}`);
    return deck;
  }

  dealCards(urlToDeal?: string): void {
    const deck = urlToDeal ? this.rigDeck(urlToDeal) : this.shuffleDeck(this.createDeck());

    // Deal 12 cards to each player (48 cards)
    for (let i = 0; i < 48; i++) {
      const playerIndex = i % 4;
      this.players[playerIndex].hand.push(deck[i]);
    }

    // Remaining 4 cards go to kitty
    this.kitty = deck.slice(48, 52);

    this.players.forEach(player => {
      this.sortHand(player.hand);
    });

    // Start bidding phase - bidding starts clockwise from dealer
    // Player layout: 0=You(South), 1=East, 2=North, 3=West
    // Clockwise: 0→3→2→1→0, so next player = (current + 3) % 4
    const firstBidder = (this.dealer + 3) % 4;
    this.currentPlayer = firstBidder;
    this.gameStage = 'bidding';
    this.biddingComplete = false;
    this.bids = [];
    this.currentHighBid = 0;
    this.currentHighBidder = null;

    const dealerName = this.players[this.dealer].name;
    if (firstBidder === 0) {
      this.message = `${dealerName} deals. Your turn to bid`;
    } else {
      this.message = `${dealerName} deals. ${this.players[firstBidder].name} bids first`;
    }
  }

  private sortHand(hand: Card[]): void {
    hand.sort((a, b) => {
      const suitOrder: { [key: string]: number } = { spades: 1, hearts: 2, clubs: 3, diamonds: 4 };
      if (suitOrder[a.suit] !== suitOrder[b.suit]) {
        return suitOrder[a.suit] - suitOrder[b.suit];
      }

      if (this.bidDirection === 'downtown') {
        const rankA = a.rank === 1 ? 14 : a.rank;
        const rankB = b.rank === 1 ? 14 : b.rank;
        return rankA - rankB;
      }
      return a.rank - b.rank;
    });
  }

  // Check if it's dealer's turn (4th bid)
  isDealersTurn(): boolean {
    return this.bids.length === 3 && this.currentPlayer === this.dealer;
  }

  // Check if dealer can "take it" (there's a current high bid to take)
  canDealerTakeIt(): boolean {
    return this.isDealersTurn() && this.currentHighBid > 0;
  }

  // Get valid bids for current player
  // Returns: 0 = pass, 1-6 = bid amount, -1 = "take it" (dealer only)
  getValidBids(): number[] {
    const validBids: number[] = [0]; // Pass is always valid

    // Dealer's 4th bid - can "take it" if there's a high bid
    if (this.isDealersTurn() && this.currentHighBid > 0) {
      validBids.push(-1); // -1 = "take it"
    }

    // Regular bids (must be higher than current)
    for (let i = this.currentHighBid + 1; i <= 6; i++) {
      validBids.push(i);
    }

    return validBids;
  }

  // Get current bidding state for UI
  getBiddingState(): BidWhistState {
    return {
      biddingPhase: this.gameStage === 'bidding',
      currentHighBid: this.currentHighBid,
      currentHighBidder: this.currentHighBidder,
      bids: [...this.bids],
      allPlayersBid: this.bids.length >= 4,
      dealer: this.dealer
    };
  }

  // Place a bid (0 = pass, -1 = "take it" (dealer only), 1-6 = bid amount)
  placeBid(playerId: number, amount: number): boolean {
    if (this.gameStage !== 'bidding') return false;
    if (this.currentPlayer !== playerId) return false;

    // Handle "take it" - dealer claims the current high bid
    if (amount === -1) {
      if (!this.isDealersTurn() || this.currentHighBid === 0) {
        return false; // Can only "take it" as dealer with an existing bid
      }
      // Dealer takes the current high bid
      const bid: BidInfo = {
        playerId,
        amount: this.currentHighBid, // Record the actual bid amount
        passed: false
      };
      this.bids.push(bid);
      this.currentHighBidder = playerId; // Dealer now owns the bid
      this.message = `${this.players[playerId].name} takes it at ${this.currentHighBid}!`;
      this.finalizeBidding();
      return true;
    }

    // Validate regular bid
    if (amount !== 0 && amount <= this.currentHighBid) {
      // Exception: dealer on 4th bid doesn't need to outbid (handled by "take it")
      return false; // Must bid higher than current
    }
    if (amount > 6) return false;

    const bid: BidInfo = {
      playerId,
      amount,
      passed: amount === 0
    };
    this.bids.push(bid);

    if (amount > 0) {
      this.currentHighBid = amount;
      this.currentHighBidder = playerId;
    }

    const playerName = this.players[playerId].name;
    if (amount === 0) {
      this.message = `${playerName} passed`;
    } else {
      this.message = `${playerName} bid ${amount}`;
    }

    // Check if bidding is complete (all 4 players have bid)
    if (this.bids.length >= 4) {
      this.finalizeBidding();
    } else {
      // Move to next player clockwise: (current + 3) % 4
      this.currentPlayer = (playerId + 3) % 4;

      // Update message for next player
      if (this.currentPlayer === 0) {
        this.message += ' - Your turn to bid';
      } else {
        this.message += ` - ${this.players[this.currentPlayer].name}'s turn`;
      }
    }

    return true;
  }

  // AI bidding logic - separate for future expansion
  getAIBid(playerId: number): number {
    // Try strategy evaluator first
    if (this.strategy) {
      const ctx = buildBidWhistContext(this, playerId);
      const bid = evaluateBid(this.strategy, ctx);
      if (bid !== null) {
        return bid;
      }
    }

    // Fallback to default logic
    // Dealer's 4th bid - special options
    if (this.isDealersTurn() && playerId === this.dealer) {
      // If there's a bid to take, AI dealer might take it or pass
      if (this.currentHighBid > 0) {
        // Simple AI: take it if bid is reasonable (1-3), otherwise pass
        if (this.currentHighBid <= 3) {
          return -1; // Take it
        } else {
          return 0; // Pass (let them have it)
        }
      }
      // No bid to take, dealer must bid or pass
      return 1; // Bid 1
    }

    // Regular bidding: Simple escalating bid strategy
    const escalationLevels: { [key: number]: number } = {
      1: 1, // East bids 1
      2: 2, // North bids 2
      3: 3, // West bids 3
    };

    const maxBid = escalationLevels[playerId] || 1;

    // If current high bid is >= their max, pass
    if (this.currentHighBid >= maxBid) {
      return 0; // Pass
    }

    // Bid one higher than current (up to their max)
    const bidAmount = Math.min(this.currentHighBid + 1, maxBid);
    return bidAmount;
  }

  // Process AI bid
  processAIBid(playerId: number): void {
    const bidAmount = this.getAIBid(playerId);
    this.placeBid(playerId, bidAmount);
  }

  private finalizeBidding(): void {
    this.biddingComplete = true;

    // Check if everyone passed
    if (this.currentHighBidder === null) {
      // Everyone passed - redeal
      this.message = 'Everyone passed! Redealing...';
      this.startNewHand();
      return;
    }

    this.declarer = this.currentHighBidder;

    // Give kitty to declarer
    this.players[this.declarer].hand.push(...this.kitty);
    this.sortHand(this.players[this.declarer].hand);
    this.kitty = [];

    // Move to trump selection phase
    this.currentPlayer = this.declarer;
    this.gameStage = 'trumpSelection';
    this.message = `${this.players[this.declarer].name} won the bid with ${this.currentHighBid}. Choose trump suit!`;
  }

  // Set trump suit (called by bid winner)
  setTrumpSuit(suit: string, direction: BidDirection = 'uptown'): boolean {
    if (this.gameStage !== 'trumpSelection') return false;
    if (this.declarer === null) return false;

    const validSuits = ['spades', 'hearts', 'diamonds', 'clubs'];
    if (!validSuits.includes(suit)) return false;

    this.trumpSuit = suit;
    this.bidDirection = direction;

    // Re-sort hands based on direction
    this.players.forEach(player => {
      this.sortHand(player.hand);
    });

    const suitDisplay = suit.charAt(0).toUpperCase() + suit.slice(1);
    const directionDisplayMap: { [key: string]: string } = {
      'uptown': 'Uptown',
      'downtown': 'Downtown',
      'downtown-noaces': 'Downtown (Aces No Good)'
    };
    const directionDisplay = directionDisplayMap[direction] || direction;

    // If human player (declarer === 0), go to discard phase
    // Otherwise, AI auto-discards and goes straight to play
    if (this.declarer === 0) {
      this.gameStage = 'discarding';
      this.message = `You chose ${directionDisplay} in ${suitDisplay}. Select 4 cards to discard.`;
    } else {
      // AI auto-discards
      this.autoDiscard(this.declarer);
      this.findStartingPlayer();
      this.gameStage = 'play';
      this.message = `${this.players[this.declarer].name} chose ${directionDisplay} in ${suitDisplay}. Play begins!`;
    }

    return true;
  }

  // Human player discards selected cards
  discardCards(cardIds: string[]): boolean {
    if (this.gameStage !== 'discarding') return false;
    if (this.declarer !== 0) return false; // Only human can manually discard
    if (cardIds.length !== 4) return false;

    const player = this.players[0];
    const discards = player.hand.filter(c => cardIds.includes(c.id));
    if (discards.length !== 4) return false;

    // Remove discards from hand
    player.hand = player.hand.filter(c => !cardIds.includes(c.id));
    // Discards count toward declarer's tricks
    player.tricks.push(...discards);
    this.sortHand(player.hand);

    // Start play phase
    this.findStartingPlayer();
    this.gameStage = 'play';
    this.message = 'Play begins! You lead the first card.';

    return true;
  }

  // Check if in discard phase
  isDiscardPhase(): boolean {
    return this.gameStage === 'discarding';
  }

  // AI trump selection logic - chooses based on hand composition
  getAITrumpSelection(playerId: number): { suit: string; direction: BidDirection } {
    // Try strategy evaluator first
    if (this.strategy) {
      const ctx = buildBidWhistContext(this, playerId);
      const result = evaluateTrump(this.strategy, ctx);
      if (result) {
        const validDirections: BidDirection[] = ['uptown', 'downtown', 'downtown-noaces'];
        const dir = validDirections.includes(result.direction as BidDirection)
          ? result.direction as BidDirection : 'uptown';
        return { suit: result.suit, direction: dir };
      }
    }

    // Fallback to default logic
    const hand = this.players[playerId].hand;

    // Count cards in each suit
    const suitCounts: { [suit: string]: number } = {
      spades: 0,
      hearts: 0,
      diamonds: 0,
      clubs: 0
    };

    hand.forEach(card => {
      if (suitCounts[card.suit] !== undefined) {
        suitCounts[card.suit]++;
      }
    });

    // Choose suit with most cards
    let bestSuit = 'spades';
    let maxCount = 0;
    for (const [suit, count] of Object.entries(suitCounts)) {
      if (count > maxCount) {
        maxCount = count;
        bestSuit = suit;
      }
    }

    // Count low cards (2-7) vs high cards (8-K, A) to determine direction
    let lowCount = 0;  // ranks 2-7
    let highCount = 0; // ranks 8-13 and Ace (1)
    let aceCount = 0;

    hand.forEach(card => {
      if (card.rank === 1) {
        aceCount++;
        highCount++; // Ace counts as high for direction decision
      } else if (card.rank >= 2 && card.rank <= 7) {
        lowCount++;
      } else {
        highCount++; // 8-13
      }
    });

    // Choose direction based on card distribution
    let direction: BidDirection;
    if (lowCount > highCount) {
      // Going downtown (low)
      // If we have 2+ aces, call aces good (they stay high)
      // Otherwise call aces no good (they become worst)
      if (aceCount >= 2) {
        direction = 'downtown';
      } else {
        direction = 'downtown-noaces';
      }
    } else {
      direction = 'uptown';
    }

    return { suit: bestSuit, direction };
  }

  // Process AI trump selection
  processAITrumpSelection(playerId: number): void {
    const { suit, direction } = this.getAITrumpSelection(playerId);
    this.setTrumpSuit(suit, direction);
  }

  // Check if in trump selection phase
  isTrumpSelectionPhase(): boolean {
    return this.gameStage === 'trumpSelection';
  }

  // Get the declarer (bid winner)
  getDeclarer(): number | null {
    return this.declarer;
  }

  private autoDiscard(playerId: number): void {
    const player = this.players[playerId];

    // Separate trump and non-trump cards
    const trumpCards = player.hand.filter(c => c.suit === this.trumpSuit);
    const nonTrumpCards = player.hand.filter(c => c.suit !== this.trumpSuit);

    // Sort non-trump cards by their value in the chosen direction (worst first)
    // We want to discard the cards that are least likely to win
    nonTrumpCards.sort((a, b) => {
      // Compare by card value - lower value = worse = discard first
      return this.getCardValue(a) - this.getCardValue(b);
    });

    // Take the 4 worst non-trump cards as discards
    const discards: Card[] = [];

    // First, take from non-trump (worst cards first)
    for (const card of nonTrumpCards) {
      if (discards.length >= 4) break;
      discards.push(card);
    }

    // Only if we don't have enough non-trump, reluctantly discard trump (worst trump first)
    if (discards.length < 4) {
      // Sort trump by value (worst first)
      trumpCards.sort((a, b) => this.getCardValue(a) - this.getCardValue(b));
      for (const card of trumpCards) {
        if (discards.length >= 4) break;
        discards.push(card);
      }
    }

    // Remove discards from hand (back to 12 cards)
    player.hand = player.hand.filter(c => !discards.some(d => d.id === c.id));
    // Discards count toward declarer's tricks
    player.tricks.push(...discards);
    this.sortHand(player.hand);
  }

  findStartingPlayer(): void {
    // In this variation, bid winner leads the first card
    if (this.declarer !== null) {
      this.currentPlayer = this.declarer;
    } else {
      this.currentPlayer = 0;
    }
  }

  isValidMove(playerId: number, card: Card): boolean {
    const playerHand = this.players[playerId].hand;

    if (this.currentTrick.length === 0) {
      return true;
    }

    if (this.leadSuit) {
      const hasSuit = playerHand.some(c => c.suit === this.leadSuit);
      if (hasSuit) {
        return card.suit === this.leadSuit;
      }
    }

    return true;
  }

  protected getValidationError(playerId: number, card: Card): string {
    const playerHand = this.players[playerId].hand;

    if (this.leadSuit) {
      const hasSuit = playerHand.some(c => c.suit === this.leadSuit);
      if (hasSuit && card.suit !== this.leadSuit) {
        return `Must follow suit (${this.leadSuit})`;
      }
    }

    return "Invalid move";
  }

  protected processCardPlay(playerId: number, card: Card): void {
    if (this.currentTrick.length === 1) {
      this.leadSuit = card.suit;
    }

    super.processCardPlay(playerId, card);
  }

  // Override to go clockwise: 0→3→2→1→0
  protected setNextPlayer(): void {
    if (this.currentPlayer !== null) {
      this.currentPlayer = (this.currentPlayer + 3) % 4;
    }
  }

  protected finalizeTrick(winnerPlayerId: number): void {
    const winnerTeam = winnerPlayerId % 2;
    this.booksWon[winnerTeam]++;

    // Save the last completed trick (book) before it's cleared
    this.lastCompletedTrick = this.currentTrick.map(play => ({
      playerId: play.playerId,
      card: play.card
    }));

    super.finalizeTrick(winnerPlayerId);
    this.leadSuit = null;
  }

  getBestMove(playerId: number): Card | null {
    // Try strategy evaluator first
    if (this.strategy) {
      const ctx = buildBidWhistContext(this, playerId);
      const card = evaluatePlay(this.strategy, ctx);
      if (card && this.isValidMove(playerId, card)) {
        return card;
      }
    }

    // Fallback to default logic
    return this.defaultGetBestMove(playerId);
  }

  private defaultGetBestMove(playerId: number): Card | null {
    const playerHand = this.players[playerId].hand;

    if (playerHand.length === 0) return null;

    if (this.currentTrick.length === 0) {
      const declarerTeam = this.declarer !== null ? this.declarer % 2 : 0;
      if (playerId % 2 === declarerTeam) {
        const trump = playerHand.filter(c => c.suit === this.trumpSuit);
        if (trump.length > 0) {
          return this.getHighestCard(trump);
        }
      }
      return this.getLowestCard(playerHand);
    }

    const suitCards = playerHand.filter(c => c.suit === this.leadSuit);
    if (suitCards.length > 0) {
      const currentWinner = this.evaluateCurrentWinner();
      const winningCards = suitCards.filter(c => this.compareCards(c, this.currentTrick[currentWinner].card) > 0);
      if (winningCards.length > 0) {
        return this.getLowestCard(winningCards);
      }
      return this.getLowestCard(suitCards);
    }

    const currentWinner = this.evaluateCurrentWinner();
    const isPartnerWinning = currentWinner !== -1 &&
      (this.currentTrick[currentWinner].playerId % 2) === (playerId % 2);

    if (!isPartnerWinning) {
      const trumpCards = playerHand.filter(c => c.suit === this.trumpSuit);
      if (trumpCards.length > 0) {
        return this.getLowestCard(trumpCards);
      }
    }

    return this.getLowestCard(playerHand);
  }

  private getHighestCard(cards: Card[]): Card {
    return cards.reduce((highest, card) =>
      this.getCardValue(card) > this.getCardValue(highest) ? card : highest
    );
  }

  private getLowestCard(cards: Card[]): Card {
    return cards.reduce((lowest, card) =>
      this.getCardValue(card) < this.getCardValue(lowest) ? card : lowest
    );
  }

  getCardValue(card: Card): number {
    // Uptown: A K Q J 10 9 8 7 6 5 4 3 2 (A highest)
    // Downtown: A 2 3 4 5 6 7 8 9 10 J Q K (A still high, 2 is best)
    // Downtown No Aces: 2 3 4 5 6 7 8 9 10 J Q K A (2 is best, A is worst)
    if (this.bidDirection === 'uptown') {
      return card.rank === 1 ? 14 : card.rank;
    } else if (this.bidDirection === 'downtown') {
      return card.rank === 1 ? 14 : (14 - card.rank);
    } else {
      // downtown-noaces: Ace is worst (value 1), 2 is best (value 13)
      return card.rank === 1 ? 1 : (14 - card.rank);
    }
  }

  compareCards(a: Card, b: Card): number {
    // Trump beats non-trump
    if (a.suit === this.trumpSuit && b.suit !== this.trumpSuit) return 1;
    if (b.suit === this.trumpSuit && a.suit !== this.trumpSuit) return -1;

    if (a.suit === b.suit) {
      return this.getCardValue(a) - this.getCardValue(b);
    }

    return 0;
  }

  evaluateCurrentWinner(): number {
    if (this.currentTrick.length === 0) return -1;

    let winnerIndex = 0;
    for (let i = 1; i < this.currentTrick.length; i++) {
      if (this.compareCards(this.currentTrick[i].card, this.currentTrick[winnerIndex].card) > 0) {
        winnerIndex = i;
      }
    }
    return winnerIndex;
  }

  evaluateTrick(): number {
    if (this.currentTrick.length === 0) return -1;

    const winnerIndex = this.evaluateCurrentWinner();
    return this.currentTrick[winnerIndex].playerId;
  }

  scoreHand(): void {
    const declarerTeam = this.declarer !== null ? this.declarer % 2 : 0;

    const team0Books = this.booksWon[0] + (declarerTeam === 0 ? 1 : 0);
    const team1Books = this.booksWon[1] + (declarerTeam === 1 ? 1 : 0);

    if (this.currentHighBid > 0) {
      const contractBooks = this.currentHighBid + 6;
      const declarerBooks = declarerTeam === 0 ? team0Books : team1Books;

      if (declarerBooks >= contractBooks) {
        const points = declarerBooks - 6;
        if (declarerTeam === 0) {
          this.teamScores[0] += points;
        } else {
          this.teamScores[1] += points;
        }
        this.message = `Contract made! ${declarerBooks - 6} books over.`;
      } else {
        // Opponents get the bid points when declarer fails
        const points = this.currentHighBid;
        const opponentTeam = declarerTeam === 0 ? 1 : 0;
        this.teamScores[opponentTeam] += points;
        const opponentNames = opponentTeam === 0 ? 'You & North' : 'East & West';
        this.message = `Contract failed! ${opponentNames} earn ${points} points.`;
      }
    }

    this.players[0].totalScore = this.teamScores[0];
    this.players[2].totalScore = this.teamScores[0];
    this.players[1].totalScore = this.teamScores[1];
    this.players[3].totalScore = this.teamScores[1];

    this.players[0].score = team0Books;
    this.players[2].score = team0Books;
    this.players[1].score = team1Books;
    this.players[3].score = team1Books;
  }

  isGameOver(): boolean {
    // First team to 7 points wins
    return this.teamScores[0] >= 7 || this.teamScores[1] >= 7;
  }

  getGameSpecificMessage(): string {
    if (this.gameOver && this.winner) {
      const winningTeam = this.winner.id % 2;
      return `Game over! Team ${winningTeam === 0 ? 'You & North' : 'East & West'} wins!`;
    }
    if (this.gameStage === 'scoring') {
      return `Hand complete! Team scores: You/North: ${this.teamScores[0]}, East/West: ${this.teamScores[1]}`;
    }
    return this.message;
  }

  protected findWinner(): void {
    // Team with 7+ points wins
    if (this.teamScores[0] >= 7) {
      this.winner = this.players[0]; // You & North win
    } else {
      this.winner = this.players[1]; // East & West win
    }
  }

  resetGame(): void {
    super.resetGame();
    this.leadSuit = null;
    this.trumpSuit = null;
    this.bidDirection = 'uptown';
    this.currentHighBid = 0;
    this.currentHighBidder = null;
    this.bids = [];
    this.biddingComplete = false;
    this.kitty = [];
    this.declarer = null;
    this.teamScores = [0, 0];
    this.booksWon = [0, 0];
    this.lastCompletedTrick = [];
    // Randomly pick new dealer for new game
    this.dealer = Math.floor(Math.random() * 4);
    this.message = 'Welcome to Bid Whist!';
  }

  startNewHand(url?: string): void {
    // Reset bid whist state BEFORE calling super (which deals cards)
    this.leadSuit = null;
    this.trumpSuit = null;
    this.currentHighBid = 0;
    this.currentHighBidder = null;
    this.bids = [];
    this.biddingComplete = false;
    this.booksWon = [0, 0];
    this.declarer = null;
    this.lastCompletedTrick = [];
    // Rotate dealer clockwise for new hand: 0→3→2→1→0
    this.dealer = (this.dealer + 3) % 4;
    // Now deal cards (uses the new dealer position)
    super.startNewHand(url);
  }

  // Simulation helpers
  simulateAutoDiscard(playerId: number): void {
    this.autoDiscard(playerId);
    this.findStartingPlayer();
    this.gameStage = 'play';
  }

  setDealer(dealer: number): void {
    this.dealer = dealer;
  }

  getBooksWon(): [number, number] {
    return this.booksWon;
  }

  getCurrentHighBid(): number {
    return this.currentHighBid;
  }

  // Getters
  getTrumpSuit(): string | null {
    return this.trumpSuit;
  }

  getBidDirection(): BidDirection {
    return this.bidDirection;
  }

  getTeamScores(): [number, number] {
    return this.teamScores;
  }

  isBiddingPhase(): boolean {
    return this.gameStage === 'bidding';
  }

  getDealer(): number {
    return this.dealer;
  }

  getLastCompletedTrick(): { playerId: number; card: Card }[] {
    return this.lastCompletedTrick;
  }
}
