import { BidWhistGame } from '../games/BidWhistGame.ts';
import { Card } from '../types/CardGame.ts';
import { StrategyAST } from '../strategy/types.ts';
import { GameResult, HandResult } from './types.ts';
import { generateRandomDeckUrl } from '../urlGameState.js';
import {
  computePreBidStrength,
  computePostTrumpStrength,
  extractPlayerHand,
} from './handStrength.ts';
import { enableTracing, disableTracing, RuleTraceEntry } from '../strategy/evaluator.ts';

const MAX_REDEALS = 10;
const MAX_HANDS = 100;

// ── Detailed hand types (for Weaknesses tab) ─────────────────────

export interface TrickDetail {
  number: number;
  leader: number;
  plays: { playerId: number; card: Card }[];
  winner: number;
  team0Books: number;
  team1Books: number;
}

export interface DetailedHandData {
  dealer: number;
  declarer: number;
  bidAmount: number;
  trumpSuit: string;
  direction: string;
  booksWon: [number, number];
  contract: number;
  deficit: number;

  bids: { playerId: number; amount: number }[];
  startingHands: Card[][];
  kitty: Card[];
  postKittyHand: Card[];
  discards: Card[];
  playHands: Card[][];
  tricks: TrickDetail[];

  preBidStrengths: [number, number, number, number];
  postTrumpStrengths: [number, number, number, number];

  gameIndex: number;
  handIndex: number;
  deckUrl: string;
  configIndex: number;
  strategyNames: [string, string];
  team0StrategyIndex: number;
  team1StrategyIndex: number;
}

export class BidWhistSimulator {
  /**
   * Rotate a 52-char deck URL so player 0 gets the cards that player `rotation` originally had.
   * Chars 0-47 are dealt round-robin (card i → player i%4), chars 48-51 = kitty.
   * Rotate by r: shift the first 48 chars left by r positions.
   */
  static rotateDeck(url: string, rotation: number): string {
    if (rotation === 0) return url;
    const r = ((rotation % 4) + 4) % 4; // normalize to 0-3
    if (r === 0) return url;
    const dealt = url.slice(0, 48);
    const kitty = url.slice(48);
    return dealt.slice(r) + dealt.slice(0, r) + kitty;
  }

  /**
   * Simulate a full game (to 21 points, mercy at 11-0) with the given strategies assigned to players.
   * @param deckUrl - 52-char URL for the first hand
   * @param playerStrategies - parsed strategy ASTs for each of 4 players (null = use default AI)
   * @param handDeckUrls - pre-generated deck URLs for subsequent hands
   * @returns GameResult
   */
  simulateGame(
    deckUrl: string,
    playerStrategies: (StrategyAST | null)[],
    handDeckUrls: string[],
    configIndex: number,
    dealer: number = 0
  ): GameResult {
    const game = new BidWhistGame();
    game.setDealer(dealer);

    // Deal first hand with the given deck URL
    game.dealCards(deckUrl);

    const usedHandUrls: string[] = [deckUrl];
    const hands: HandResult[] = [];
    let handsPlayed = 0;
    let redealCount = 0;

    // Run hands until game is over
    while (!game.isGameOver() && handsPlayed < MAX_HANDS) {
      // Run the current hand through all phases
      const handResult = this.runHand(game, playerStrategies);

      if (handResult === null) {
        // Redeal (everyone passed)
        redealCount++;
        if (redealCount > MAX_REDEALS) {
          break;
        }
        continue;
      }

      hands.push(handResult);
      handsPlayed++;

      if (game.isGameOver()) break;

      // Start next hand with pre-generated URL
      const nextUrlIndex = handsPlayed;
      const nextUrl = nextUrlIndex < handDeckUrls.length
        ? handDeckUrls[nextUrlIndex]
        : generateRandomDeckUrl();
      usedHandUrls.push(nextUrl);
      game.startNewHand(nextUrl);
    }

    const teamScores = game.getTeamScores();
    const whistWinner = game.getWhistingWinner();
    const winningTeam = (() => {
      if (whistWinner >= 0) return whistWinner; // Whisting: instant win
      if (teamScores[0] >= 11 && teamScores[1] === 0) return 0;
      if (teamScores[1] >= 11 && teamScores[0] === 0) return 1;
      if (teamScores[0] >= 21) return 0;
      if (teamScores[1] >= 21) return 1;
      return teamScores[0] >= teamScores[1] ? 0 : 1; // fallback if MAX_HANDS hit
    })();

    return {
      deckUrl,
      rotation: 0, // caller sets this
      rotatedUrl: deckUrl, // caller sets this
      winningTeam,
      teamScores: [...teamScores],
      handsPlayed,
      handDeckUrls: usedHandUrls,
      configIndex,
      hands,
    };
  }

  /**
   * Run a single hand: bidding → trump selection → discarding → play 12 tricks.
   * Returns HandResult with details, or null if redealt (everyone passed).
   */
  private runHand(game: BidWhistGame, strategies: (StrategyAST | null)[]): HandResult | null {
    const dealer = game.getDealer();
    const state = game.getGameState();

    // Phase: Bidding
    if (state.gameStage === 'bidding') {
      this.runBidding(game, strategies);
    }

    // Check if redeal happened (everyone passed → bidding restarts)
    const afterBid = game.getGameState();
    if (afterBid.gameStage === 'bidding') {
      return null; // Redeal
    }

    // Capture bid info
    const bidWinner = game.getDeclarer() ?? -1;
    const bidAmount = game.getCurrentHighBid();

    // Phase: Trump selection
    if (afterBid.gameStage === 'trumpSelection') {
      this.runTrumpSelection(game, strategies);
    }

    // Capture trump info
    const trumpSuit = game.getTrumpSuit() ?? '';
    const direction = game.getBidDirection();

    // Phase: Discarding (if declarer is player 0, it won't auto-discard)
    const afterTrump = game.getGameState();
    if (afterTrump.gameStage === 'discarding') {
      const declarer = game.getDeclarer();
      if (declarer !== null) {
        game.setStrategy(strategies[declarer]);
        game.simulateAutoDiscard(declarer);
      }
    }

    // Capture discards (declarer's tricks before play = the 4 discards)
    const discards: string[] = [];
    if (bidWinner >= 0) {
      const declarerTricks = game.getGameState().players[bidWinner].tricks;
      // After discard but before play, tricks = the 4 discarded cards
      for (const card of declarerTricks) {
        discards.push(card.id);
      }
    }

    // Phase: Play 12 tricks
    this.runPlay(game, strategies);

    const booksWon = game.getBooksWon();
    const teamScoresAfter = game.getTeamScores();

    return {
      bidWinner,
      bidAmount,
      trumpSuit,
      direction,
      discards,
      booksWon: [...booksWon],
      teamScoresAfter: [...teamScoresAfter],
      dealer,
    };
  }

  private runBidding(game: BidWhistGame, strategies: (StrategyAST | null)[]): void {
    // Bid for all 4 players
    for (let i = 0; i < 4; i++) {
      const gs = game.getGameState();
      if (gs.gameStage !== 'bidding') break;
      const currentPlayer = gs.currentPlayer;
      if (currentPlayer === null) break;

      // Set strategy for current player
      game.setStrategy(strategies[currentPlayer]);
      game.processAIBid(currentPlayer);
    }
  }

  private runTrumpSelection(game: BidWhistGame, strategies: (StrategyAST | null)[]): void {
    const declarer = game.getDeclarer();
    if (declarer === null) return;

    game.setStrategy(strategies[declarer]);
    game.processAITrumpSelection(declarer);
  }

  private runPlay(game: BidWhistGame, strategies: (StrategyAST | null)[]): void {
    // Play up to 12 tricks (each trick = 4 cards)
    for (let trick = 0; trick < 12; trick++) {
      for (let card = 0; card < 4; card++) {
        const gs = game.getGameState();
        if (gs.gameStage !== 'play') return;
        const currentPlayer = gs.currentPlayer;
        if (currentPlayer === null) return;

        game.setStrategy(strategies[currentPlayer]);
        const bestMove = game.getBestMove(currentPlayer);
        if (!bestMove) return;

        game.playCard(currentPlayer, bestMove);
      }
    }
  }

  /**
   * Simulate a game with rule tracing enabled, capturing every rule evaluation.
   */
  simulateGameWithTracing(
    deckUrl: string,
    playerStrategies: (StrategyAST | null)[],
    handDeckUrls: string[],
    configIndex: number,
    dealer: number = 0
  ): { result: GameResult; traces: RuleTraceEntry[] } {
    enableTracing();
    const result = this.simulateGame(deckUrl, playerStrategies, handDeckUrls, configIndex, dealer);
    const traces = disableTracing();
    return { result, traces };
  }

  /**
   * Re-simulate a single hand with full detail capture for the Weaknesses tab.
   */
  static simulateDetailedHand(
    deckUrl: string,
    playerStrategies: (StrategyAST | null)[],
    dealer: number,
  ): DetailedHandData | null {
    const game = new BidWhistGame();
    game.setDealer(dealer);
    game.dealCards(deckUrl);

    // 1. Snapshot starting hands (12 cards each, after deal)
    const startingHands: Card[][] = game.getGameState().players.map(
      p => p.hand.map(c => ({ ...c }))
    );
    const kitty = game.getKitty();

    // 2. Bidding — record each bid
    const bids: { playerId: number; amount: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const gs = game.getGameState();
      if (gs.gameStage !== 'bidding') break;
      const cp = gs.currentPlayer;
      if (cp === null) break;
      game.setStrategy(playerStrategies[cp]);
      const bidState = game.getBiddingState();
      const bidsBefore = bidState.bids.length;
      game.processAIBid(cp);
      const bidsAfter = game.getBiddingState().bids;
      if (bidsAfter.length > bidsBefore) {
        const lastBid = bidsAfter[bidsAfter.length - 1];
        bids.push({ playerId: lastBid.playerId, amount: lastBid.amount });
      }
    }

    // Check redeal
    const afterBid = game.getGameState();
    if (afterBid.gameStage === 'bidding') return null;

    const declarer = game.getDeclarer();
    if (declarer === null) return null;
    const bidAmount = game.getCurrentHighBid();

    // 3. Trump selection
    game.setStrategy(playerStrategies[declarer]);
    game.processAITrumpSelection(declarer);
    const trumpSuit = game.getTrumpSuit() ?? '';
    const direction = game.getBidDirection();

    // 4. Snapshot post-kitty hand (declarer has 16 cards before discard)
    const afterTrump = game.getGameState();
    let postKittyHand: Card[] = [];
    const discards: Card[] = [];

    if (afterTrump.gameStage === 'discarding') {
      // Declarer is player 0 — kitty was added but not yet discarded
      postKittyHand = afterTrump.players[declarer].hand.map(c => ({ ...c }));
      game.setStrategy(playerStrategies[declarer]);
      game.simulateAutoDiscard(declarer);
    } else {
      // setTrumpSuit auto-discarded: postKittyHand = startingHands + kitty
      postKittyHand = [...startingHands[declarer], ...kitty];
    }

    // Capture discards from declarer's tricks (first 4 cards are the discards)
    const declarerTricks = game.getGameState().players[declarer].tricks;
    for (let i = 0; i < Math.min(4, declarerTricks.length); i++) {
      discards.push({ ...declarerTricks[i] });
    }

    // 5. Snapshot play hands (12 cards each at start of play)
    const playHands: Card[][] = game.getGameState().players.map(
      p => p.hand.map(c => ({ ...c }))
    );

    // 6. Play 12 tricks, capturing detail
    const tricks: TrickDetail[] = [];
    for (let t = 0; t < 12; t++) {
      const gs = game.getGameState();
      if (gs.gameStage !== 'play') break;

      const leader = gs.currentPlayer;
      if (leader === null) break;

      const plays: { playerId: number; card: Card }[] = [];
      for (let c = 0; c < 4; c++) {
        const gs2 = game.getGameState();
        if (gs2.gameStage !== 'play') break;
        const cp = gs2.currentPlayer;
        if (cp === null) break;
        game.setStrategy(playerStrategies[cp]);
        const move = game.getBestMove(cp);
        if (!move) break;
        plays.push({ playerId: cp, card: { ...move } });
        game.playCard(cp, move);
      }

      const booksWon = game.getBooksWon();
      // Determine winner: the trick winner is the current player after finalizeTrick
      // (since the game sets currentPlayer to the winner)
      const winner = game.getGameState().currentPlayer ?? leader;

      tricks.push({
        number: t + 1,
        leader,
        plays,
        winner,
        team0Books: booksWon[0],
        team1Books: booksWon[1],
      });
    }

    const booksWon = game.getBooksWon();
    const contract = bidAmount + 6;
    const declarerTeam = declarer % 2;
    const declarerBooks = booksWon[declarerTeam] + 1; // kitty counts as a book
    const deficit = contract - declarerBooks;

    // Compute hand strengths
    const preBidHands = [0, 1, 2, 3].map(p => extractPlayerHand(deckUrl, p));
    const preBidStrengths: [number, number, number, number] = [
      computePreBidStrength(preBidHands[0]),
      computePreBidStrength(preBidHands[1]),
      computePreBidStrength(preBidHands[2]),
      computePreBidStrength(preBidHands[3]),
    ];
    const postTrumpStrengths: [number, number, number, number] = trumpSuit
      ? [
          computePostTrumpStrength(preBidHands[0], trumpSuit, direction),
          computePostTrumpStrength(preBidHands[1], trumpSuit, direction),
          computePostTrumpStrength(preBidHands[2], trumpSuit, direction),
          computePostTrumpStrength(preBidHands[3], trumpSuit, direction),
        ]
      : [0, 0, 0, 0];

    return {
      dealer,
      declarer,
      bidAmount,
      trumpSuit,
      direction,
      booksWon: [...booksWon],
      contract,
      deficit,
      bids,
      startingHands,
      kitty,
      postKittyHand,
      discards,
      playHands,
      tricks,
      preBidStrengths,
      postTrumpStrengths,
      gameIndex: 0,
      handIndex: 0,
      deckUrl,
      configIndex: 0,
      strategyNames: ['', ''],
      team0StrategyIndex: 0,
      team1StrategyIndex: 0,
    };
  }
}
