import { BidWhistSimulator } from './BidWhistSimulator.ts';
import {
  ComparisonConfig,
  GameResult,
  InterestingGame,
  ComparisonSummary,
  StrategyComparisonResult,
} from './types.ts';
import { StrategyAST } from '../strategy/types.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { generateRandomDeckUrl } from '../urlGameState.js';

const BATCH_SIZE = 50;
const HANDS_PER_GAME = 20; // pre-generate this many deck URLs per game

export class BatchRunner {
  private aborted = false;

  abort(): void {
    this.aborted = true;
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

    // Pre-generate all deck URLs and hand sequences
    const deckUrls: string[] = [];
    const handUrlSequences: string[][] = [];
    for (let i = 0; i < config.numGames; i++) {
      deckUrls.push(generateRandomDeckUrl());
      const handUrls: string[] = [deckUrls[i]];
      for (let h = 1; h < HANDS_PER_GAME; h++) {
        handUrls.push(generateRandomDeckUrl());
      }
      handUrlSequences.push(handUrls);
    }

    const allResults: GameResult[] = [];
    const interestingGames: InterestingGame[] = [];
    const totalSims = config.numGames * 4; // 4 rotations per deck
    let completed = 0;

    // Build strategy assignments for config A (primary) and config B (swapped)
    const buildPlayerStrategies = (
      parsedStrats: (StrategyAST | null)[],
      mode: 'by-team' | 'by-player',
      swapped: boolean
    ): (StrategyAST | null)[] => {
      if (mode === 'by-team') {
        // strategies[0] = team 0 (players 0,2), strategies[1] = team 1 (players 1,3)
        const team0Strat = swapped ? (parsedStrats[1] ?? null) : (parsedStrats[0] ?? null);
        const team1Strat = swapped ? (parsedStrats[0] ?? null) : (parsedStrats[1] ?? null);
        return [team0Strat, team1Strat, team0Strat, team1Strat];
      } else {
        // by-player: strategies[0..3] directly. For swap, rotate by 1
        if (swapped) {
          return [
            parsedStrats[1] ?? null,
            parsedStrats[0] ?? null,
            parsedStrats[3] ?? null,
            parsedStrats[2] ?? null,
          ];
        }
        return parsedStrats.map(s => s ?? null);
      }
    };

    const configAStrategies = buildPlayerStrategies(parsedStrategies, config.assignmentMode, false);
    const configBStrategies = buildPlayerStrategies(parsedStrategies, config.assignmentMode, true);

    // Process in batches
    for (let batchStart = 0; batchStart < config.numGames && !this.aborted; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, config.numGames);

      for (let i = batchStart; i < batchEnd && !this.aborted; i++) {
        const baseDeckUrl = deckUrls[i];
        const handUrls = handUrlSequences[i];

        for (let rotation = 0; rotation < 4 && !this.aborted; rotation++) {
          const rotatedUrl = BidWhistSimulator.rotateDeck(baseDeckUrl, rotation);
          const rotatedHandUrls = handUrls.map((url, idx) =>
            idx === 0 ? rotatedUrl : url
          );

          // Run config A (primary)
          const resultA = simulator.simulateGame(rotatedUrl, configAStrategies, rotatedHandUrls, 0);
          resultA.rotation = rotation;
          resultA.deckUrl = baseDeckUrl;
          resultA.rotatedUrl = rotatedUrl;
          allResults.push(resultA);

          // Run config B (swapped) with same deck sequence
          const resultB = simulator.simulateGame(rotatedUrl, configBStrategies, rotatedHandUrls, 1);
          resultB.rotation = rotation;
          resultB.deckUrl = baseDeckUrl;
          resultB.rotatedUrl = rotatedUrl;

          // Detect interesting games: winner changed when strategies swapped
          if (resultA.winningTeam !== resultB.winningTeam) {
            interestingGames.push({
              deckUrl: baseDeckUrl,
              rotation,
              configAResult: resultA,
              configBResult: resultB,
            });
          }

          completed++;
          if (onProgress) {
            onProgress(completed, totalSims);
          }
        }
      }

      // Yield to UI between batches
      if (batchEnd < config.numGames) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Build summary
    const winsPerConfig = [0, 0];
    for (const result of allResults) {
      // Config A: team 0 has strategy[0], team 1 has strategy[1]
      // If team 0 wins, that's a win for strategy[0]
      winsPerConfig[result.winningTeam]++;
    }

    const totalGames = allResults.length;
    const summary: ComparisonSummary = {
      totalGames,
      winsPerConfig,
      winRate: winsPerConfig.map(w => totalGames > 0 ? w / totalGames : 0),
      strategyMattersCount: interestingGames.length,
      cardAdvantageDominatedCount: (config.numGames * 4) - interestingGames.length,
    };

    return {
      config,
      results: allResults,
      summary,
      interestingGames,
    };
  }
}
