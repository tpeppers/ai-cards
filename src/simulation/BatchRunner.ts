import { BidWhistSimulator } from './BidWhistSimulator.ts';
import {
  ComparisonConfig,
  GameResult,
  HandResult,
  InterestingGame,
  InterestingHand,
  WhistingRef,
  InterestingWhisting,
  ComparisonSummary,
  StrategyComparisonResult,
} from './types.ts';
import { StrategyAST } from '../strategy/types.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { generateRandomDeckUrl } from '../urlGameState.js';

const URLS_PER_GAME = 30; // max deck URLs allocated per game attempt

/** Check if a hand is a whisting (13 books for declarer's team) */
function isWhisting(hand: HandResult): { is: boolean; declarerTeam: number; declarerBooks: number } {
  if (hand.bidWinner < 0 || !hand.bidAmount) return { is: false, declarerTeam: -1, declarerBooks: 0 };
  const declarerTeam = hand.bidWinner % 2;
  const declarerBooks = hand.booksWon[declarerTeam] + 1; // kitty counts
  return { is: declarerBooks === 13, declarerTeam, declarerBooks };
}

export class BatchRunner {
  private aborted = false;

  abort(): void {
    this.aborted = true;
  }

  /** Get a deck URL from the pool, generating/cycling as needed */
  private getHandUrl(
    index: number,
    predefinedDeckUrls: string[] | undefined,
    handPool: string[],
  ): string {
    if (predefinedDeckUrls && predefinedDeckUrls.length > 0) {
      return predefinedDeckUrls[index % predefinedDeckUrls.length];
    }
    // Lazily grow the random pool
    while (handPool.length <= index) {
      handPool.push(generateRandomDeckUrl());
    }
    return handPool[index];
  }

  async runComparison(
    config: ComparisonConfig,
    onProgress?: (completed: number, total: number) => void
  ): Promise<StrategyComparisonResult> {
    this.aborted = false;

    const simulator = new BidWhistSimulator();

    // Parse strategies
    const parsedStrategies: (StrategyAST | null)[] = config.strategies.map(s => {
      try {
        return parseStrategy(s.strategyText);
      } catch {
        return null;
      }
    });

    if (config.assignmentMode === 'round-robin') {
      return this.runRoundRobin(config, parsedStrategies, simulator, onProgress);
    }

    return this.runByTeam(config, parsedStrategies, simulator, onProgress);
  }

  private async runByTeam(
    config: ComparisonConfig,
    parsedStrategies: (StrategyAST | null)[],
    simulator: BidWhistSimulator,
    onProgress?: (completed: number, total: number) => void
  ): Promise<StrategyComparisonResult> {
    const allResults: GameResult[] = [];
    const interestingGames: InterestingGame[] = [];
    const interestingHands: InterestingHand[] = [];
    const whistings: WhistingRef[] = [];
    const interestingWhistings: InterestingWhisting[] = [];
    const targetHands = config.numHands;

    const team0A = parsedStrategies[0] ?? null;
    const team1A = parsedStrategies[1] ?? null;
    const configAStrategies = [team0A, team1A, team0A, team1A];
    const configBStrategies = [team1A, team0A, team1A, team0A];

    // Hand pool: lazily generated or cycled from predefined
    const handPool: string[] = [];
    let poolOffset = 0;
    let totalHandsPlayed = 0;
    let gameIndex = 0;
    let yieldCounter = 0;

    while (totalHandsPlayed < targetHands && !this.aborted) {
      // Get URLs for this game
      const gameUrls: string[] = [];
      for (let h = 0; h < URLS_PER_GAME; h++) {
        gameUrls.push(this.getHandUrl(poolOffset + h, config.predefinedDeckUrls, handPool));
      }

      let maxHandsInGame = 0;

      for (let rotation = 0; rotation < 4 && !this.aborted; rotation++) {
        // Rotate ALL URLs consistently
        const rotatedUrls = gameUrls.map(url => BidWhistSimulator.rotateDeck(url, rotation));
        const baseDeckUrl = gameUrls[0];
        const rotatedUrl = rotatedUrls[0];

        const resultA = simulator.simulateGame(rotatedUrl, configAStrategies, rotatedUrls, 0, rotation);
        resultA.rotation = rotation;
        resultA.deckUrl = baseDeckUrl;
        resultA.rotatedUrl = rotatedUrl;
        resultA.team0StrategyIndex = 0;
        resultA.team1StrategyIndex = 1;
        allResults.push(resultA);

        const resultB = simulator.simulateGame(rotatedUrl, configBStrategies, rotatedUrls, 1, rotation);
        resultB.rotation = rotation;
        resultB.deckUrl = baseDeckUrl;
        resultB.rotatedUrl = rotatedUrl;
        resultB.team0StrategyIndex = 1;
        resultB.team1StrategyIndex = 0;

        // Track max hands across all sims for pool advancement
        maxHandsInGame = Math.max(maxHandsInGame, resultA.handsPlayed, resultB.handsPlayed);

        // Detect interesting game (winner changed)
        if (resultA.winningTeam !== resultB.winningTeam) {
          interestingGames.push({
            deckUrl: baseDeckUrl,
            rotation,
            configAResult: resultA,
            configBResult: resultB,
          });
        }

        // Detect interesting hands and whistings (hand-by-hand comparison)
        const minHands = Math.min(resultA.hands.length, resultB.hands.length);
        for (let hi = 0; hi < minHands; hi++) {
          const hA = resultA.hands[hi];
          const hB = resultB.hands[hi];
          const handUrl = resultA.handDeckUrls[hi] || baseDeckUrl;

          // Interesting hand: book outcomes diverge
          if (hA.booksWon[0] !== hB.booksWon[1] || hA.booksWon[1] !== hB.booksWon[0]) {
            interestingHands.push({
              deckUrl: handUrl,
              rotation,
              gameIndex,
              handIndex: hi,
              configAHand: hA,
              configBHand: hB,
            });
          }

          // Whisting detection
          const wA = isWhisting(hA);
          const wB = isWhisting(hB);
          const nameA = config.strategies[0]?.name ?? 'A';
          const nameB = config.strategies[1]?.name ?? 'B';
          if (wA.is) {
            whistings.push({
              deckUrl: handUrl, rotation, gameIndex, handIndex: hi,
              hand: hA, declarerTeam: wA.declarerTeam, declarerBooks: 13,
              team0StrategyIndex: 0, team1StrategyIndex: 1, configLabel: nameA,
            });
          }
          if (wB.is) {
            whistings.push({
              deckUrl: handUrl, rotation, gameIndex, handIndex: hi,
              hand: hB, declarerTeam: wB.declarerTeam, declarerBooks: 13,
              team0StrategyIndex: 1, team1StrategyIndex: 0, configLabel: nameB,
            });
          }
          // Interesting whisting: one config whistings, the other doesn't on same hand
          if (wA.is && !wB.is) {
            const wBCheck = isWhisting(hB);
            interestingWhistings.push({
              deckUrl: handUrl, rotation, gameIndex, handIndex: hi,
              whistingHand: hA, nonWhistingHand: hB,
              whistingConfig: nameA, nonWhistingConfig: nameB,
              whistingBooks: 13, nonWhistingBooks: wBCheck.declarerBooks,
              team0StrategyIndex: 0, team1StrategyIndex: 1,
            });
          } else if (wB.is && !wA.is) {
            const wACheck = isWhisting(hA);
            interestingWhistings.push({
              deckUrl: handUrl, rotation, gameIndex, handIndex: hi,
              whistingHand: hB, nonWhistingHand: hA,
              whistingConfig: nameB, nonWhistingConfig: nameA,
              whistingBooks: 13, nonWhistingBooks: wACheck.declarerBooks,
              team0StrategyIndex: 1, team1StrategyIndex: 0,
            });
          }
        }
      }

      // Advance pool offset by how many hands the longest game used
      const advance = Math.max(maxHandsInGame, 1);
      poolOffset += advance;
      totalHandsPlayed += advance;
      gameIndex++;

      if (onProgress) {
        onProgress(Math.min(totalHandsPlayed, targetHands), targetHands);
      }

      // Yield to event loop periodically
      yieldCounter++;
      if (yieldCounter % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const winsPerConfig = [0, 0];
    let totalHandsInResults = 0;
    for (const result of allResults) {
      winsPerConfig[result.winningTeam]++;
      totalHandsInResults += result.handsPlayed;
    }

    const totalGames = allResults.length;
    const summary: ComparisonSummary = {
      totalGames,
      totalHands: totalHandsInResults,
      winsPerConfig,
      winRate: winsPerConfig.map(w => totalGames > 0 ? w / totalGames : 0),
      interestingGameCount: interestingGames.length,
      interestingHandCount: interestingHands.length,
      strategyMattersCount: interestingGames.length,
      cardAdvantageDominatedCount: (gameIndex * 4) - interestingGames.length,
    };

    return { config, results: allResults, summary, interestingGames, interestingHands, whistings, interestingWhistings };
  }

  private async runRoundRobin(
    config: ComparisonConfig,
    parsedStrategies: (StrategyAST | null)[],
    simulator: BidWhistSimulator,
    onProgress?: (completed: number, total: number) => void
  ): Promise<StrategyComparisonResult> {
    const N = parsedStrategies.length;

    // Generate all ordered pairs of distinct strategy indices
    const pairs: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i !== j) pairs.push([i, j]);
      }
    }

    const targetHands = config.numHands;
    const allResults: GameResult[] = [];
    const interestingGames: InterestingGame[] = [];
    const interestingHands: InterestingHand[] = [];
    const whistings: WhistingRef[] = [];
    const interestingWhistings: InterestingWhisting[] = [];

    // Track per-strategy wins and games, plus head-to-head
    const strategyWins = new Array(N).fill(0);
    const strategyGames = new Array(N).fill(0);
    const headToHead: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));

    const handPool: string[] = [];
    let poolOffset = 0;
    let totalHandsPlayed = 0;
    let gameIndex = 0;
    let yieldCounter = 0;

    while (totalHandsPlayed < targetHands && !this.aborted) {
      // Get URLs for this game
      const gameUrls: string[] = [];
      for (let h = 0; h < URLS_PER_GAME; h++) {
        gameUrls.push(this.getHandUrl(poolOffset + h, config.predefinedDeckUrls, handPool));
      }

      let maxHandsInGame = 0;

      for (let rotation = 0; rotation < 4 && !this.aborted; rotation++) {
        // Rotate ALL URLs consistently
        const rotatedUrls = gameUrls.map(url => BidWhistSimulator.rotateDeck(url, rotation));
        const baseDeckUrl = gameUrls[0];
        const rotatedUrl = rotatedUrls[0];

        const deckResults: GameResult[] = [];

        for (const [si, sj] of pairs) {
          if (this.aborted) break;
          const stI = parsedStrategies[si] ?? null;
          const stJ = parsedStrategies[sj] ?? null;
          const playerStrats = [stI, stJ, stI, stJ];

          const result = simulator.simulateGame(rotatedUrl, playerStrats, rotatedUrls, 0, rotation);
          result.rotation = rotation;
          result.deckUrl = baseDeckUrl;
          result.rotatedUrl = rotatedUrl;
          result.team0StrategyIndex = si;
          result.team1StrategyIndex = sj;

          deckResults.push(result);
          allResults.push(result);

          maxHandsInGame = Math.max(maxHandsInGame, result.handsPlayed);

          // Update stats
          const winnerIdx = result.winningTeam === 0 ? si : sj;
          const loserIdx = result.winningTeam === 0 ? sj : si;
          strategyWins[winnerIdx]++;
          strategyGames[si]++;
          strategyGames[sj]++;
          headToHead[winnerIdx][loserIdx]++;

          // Whisting detection per hand
          for (let hi = 0; hi < result.hands.length; hi++) {
            const w = isWhisting(result.hands[hi]);
            if (w.is) {
              const stratName = config.strategies[si]?.name ?? `S${si}`;
              whistings.push({
                deckUrl: result.handDeckUrls[hi] || baseDeckUrl, rotation, gameIndex, handIndex: hi,
                hand: result.hands[hi], declarerTeam: w.declarerTeam, declarerBooks: 13,
                team0StrategyIndex: si, team1StrategyIndex: sj, configLabel: stratName,
              });
            }
          }
        }

        // Compute interestingness for this deck+rotation
        const stratWon = new Set<number>();
        const stratLost = new Set<number>();
        for (const r of deckResults) {
          const winner = r.winningTeam === 0 ? r.team0StrategyIndex : r.team1StrategyIndex;
          const loser = r.winningTeam === 0 ? r.team1StrategyIndex : r.team0StrategyIndex;
          stratWon.add(winner);
          stratLost.add(loser);
        }
        let interestingnessScore = 0;
        for (let s = 0; s < N; s++) {
          if (stratWon.has(s) && stratLost.has(s)) interestingnessScore++;
        }

        if (interestingnessScore > 0) {
          interestingGames.push({
            deckUrl: baseDeckUrl,
            rotation,
            configAResult: deckResults[0],
            configBResult: deckResults.length > 1 ? deckResults[1] : deckResults[0],
            allResults: deckResults,
            interestingnessScore,
          });
        }
      }

      const advance = Math.max(maxHandsInGame, 1);
      poolOffset += advance;
      totalHandsPlayed += advance;
      gameIndex++;

      if (onProgress) {
        onProgress(Math.min(totalHandsPlayed, targetHands), targetHands);
      }

      yieldCounter++;
      if (yieldCounter % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Sort interesting games by score descending
    interestingGames.sort((a, b) => (b.interestingnessScore ?? 0) - (a.interestingnessScore ?? 0));

    let totalHandsInResults = 0;
    for (const r of allResults) {
      totalHandsInResults += r.handsPlayed;
    }

    const totalGames = allResults.length;
    const summary: ComparisonSummary = {
      totalGames,
      totalHands: totalHandsInResults,
      winsPerConfig: strategyWins,
      winRate: strategyWins.map((w, i) => strategyGames[i] > 0 ? w / strategyGames[i] : 0),
      interestingGameCount: interestingGames.length,
      interestingHandCount: interestingHands.length,
      strategyMattersCount: interestingGames.length,
      cardAdvantageDominatedCount: (gameIndex * 4) - interestingGames.length,
      strategyWins,
      strategyGames,
      headToHead,
    };

    return { config, results: allResults, summary, interestingGames, interestingHands, whistings, interestingWhistings };
  }
}
