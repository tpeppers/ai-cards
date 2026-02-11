import { BidWhistGame } from '../games/BidWhistGame.ts';
import { StrategyAST } from '../strategy/types.ts';
import { GameResult } from './types.ts';
import { generateRandomDeckUrl } from '../urlGameState.js';

const MAX_REDEALS = 10;
const MAX_HANDS = 30;

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
   * Simulate a full game (to 7 points) with the given strategies assigned to players.
   * @param deckUrl - 52-char URL for the first hand
   * @param playerStrategies - parsed strategy ASTs for each of 4 players (null = use default AI)
   * @param handDeckUrls - pre-generated deck URLs for subsequent hands
   * @returns GameResult
   */
  simulateGame(
    deckUrl: string,
    playerStrategies: (StrategyAST | null)[],
    handDeckUrls: string[],
    configIndex: number
  ): GameResult {
    const game = new BidWhistGame();
    game.setDealer(0);

    // Deal first hand with the given deck URL
    game.dealCards(deckUrl);

    const usedHandUrls: string[] = [deckUrl];
    let handsPlayed = 0;
    let redealCount = 0;

    // Run hands until game is over
    while (!game.isGameOver() && handsPlayed < MAX_HANDS) {
      // Run the current hand through all phases
      const redealt = this.runHand(game, playerStrategies);

      if (redealt) {
        redealCount++;
        if (redealCount > MAX_REDEALS) {
          // Force dealer to bid 1 by temporarily setting a strategy that always bids 1
          // Just break out and declare based on current scores
          break;
        }
        continue;
      }

      handsPlayed++;

      if (game.isGameOver()) break;

      // Start next hand with pre-generated URL
      const nextUrlIndex = handsPlayed; // 0-indexed: hand 1 uses index 1
      const nextUrl = nextUrlIndex < handDeckUrls.length
        ? handDeckUrls[nextUrlIndex]
        : generateRandomDeckUrl();
      if (nextUrlIndex < handDeckUrls.length) {
        usedHandUrls.push(handDeckUrls[nextUrlIndex]);
      } else {
        usedHandUrls.push(nextUrl);
      }
      game.startNewHand(nextUrl);
    }

    const teamScores = game.getTeamScores();
    const winningTeam = teamScores[0] >= 7 ? 0 : (teamScores[1] >= 7 ? 1 : (teamScores[0] >= teamScores[1] ? 0 : 1));

    return {
      deckUrl,
      rotation: 0, // caller sets this
      rotatedUrl: deckUrl, // caller sets this
      winningTeam,
      teamScores: [...teamScores],
      handsPlayed,
      handDeckUrls: usedHandUrls,
      configIndex,
    };
  }

  /**
   * Run a single hand: bidding → trump selection → discarding → play 12 tricks.
   * Returns true if the hand was redealt (everyone passed).
   */
  private runHand(game: BidWhistGame, strategies: (StrategyAST | null)[]): boolean {
    const state = game.getGameState();

    // Phase: Bidding
    if (state.gameStage === 'bidding') {
      this.runBidding(game, strategies);
    }

    // Check if redeal happened (everyone passed → bidding restarts)
    const afterBid = game.getGameState();
    if (afterBid.gameStage === 'bidding') {
      // Redeal happened
      return true;
    }

    // Phase: Trump selection
    if (afterBid.gameStage === 'trumpSelection') {
      this.runTrumpSelection(game, strategies);
    }

    // Phase: Discarding (if declarer is player 0, it won't auto-discard)
    const afterTrump = game.getGameState();
    if (afterTrump.gameStage === 'discarding') {
      const declarer = game.getDeclarer();
      if (declarer !== null) {
        game.simulateAutoDiscard(declarer);
      }
    }

    // Phase: Play 12 tricks
    this.runPlay(game, strategies);

    return false;
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
}
