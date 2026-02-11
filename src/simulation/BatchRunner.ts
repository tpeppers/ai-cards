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
      // Use predefined deck URL if available, otherwise random
      const deckUrl = config.predefinedDeckUrls && i < config.predefinedDeckUrls.length
        ? config.predefinedDeckUrls[i]
        : generateRandomDeckUrl();
      deckUrls.push(deckUrl);
      const handUrls: string[] = [deckUrl];
      for (let h = 1; h < HANDS_PER_GAME; h++) {
        handUrls.push(generateRandomDeckUrl());
      }
      handUrlSequences.push(handUrls);
    }

    if (config.assignmentMode === 'round-robin') {
      return this.runRoundRobin(config, parsedStrategies, deckUrls, handUrlSequences, simulator, onProgress);
    }

    return this.runByTeam(config, parsedStrategies, deckUrls, handUrlSequences, simulator, onProgress);
  }

  private async runByTeam(
    config: ComparisonConfig,
    parsedStrategies: (StrategyAST | null)[],
    deckUrls: string[],
    handUrlSequences: string[][],
    simulator: BidWhistSimulator,
    onProgress?: (completed: number, total: number) => void
  ): Promise<StrategyComparisonResult> {
    const allResults: GameResult[] = [];
    const interestingGames: InterestingGame[] = [];
    const totalSims = config.numGames * 4;
    let completed = 0;

    const team0A = parsedStrategies[0] ?? null;
    const team1A = parsedStrategies[1] ?? null;
    const configAStrategies = [team0A, team1A, team0A, team1A];
    const configBStrategies = [team1A, team0A, team1A, team0A];

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

          const resultA = simulator.simulateGame(rotatedUrl, configAStrategies, rotatedHandUrls, 0);
          resultA.rotation = rotation;
          resultA.deckUrl = baseDeckUrl;
          resultA.rotatedUrl = rotatedUrl;
          resultA.team0StrategyIndex = 0;
          resultA.team1StrategyIndex = 1;
          allResults.push(resultA);

          const resultB = simulator.simulateGame(rotatedUrl, configBStrategies, rotatedHandUrls, 1);
          resultB.rotation = rotation;
          resultB.deckUrl = baseDeckUrl;
          resultB.rotatedUrl = rotatedUrl;
          resultB.team0StrategyIndex = 1;
          resultB.team1StrategyIndex = 0;

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

      if (batchEnd < config.numGames) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const winsPerConfig = [0, 0];
    for (const result of allResults) {
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

    return { config, results: allResults, summary, interestingGames };
  }

  private async runRoundRobin(
    config: ComparisonConfig,
    parsedStrategies: (StrategyAST | null)[],
    deckUrls: string[],
    handUrlSequences: string[][],
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

    const totalSims = config.numGames * 4 * pairs.length;
    let completed = 0;

    const allResults: GameResult[] = [];
    const interestingGames: InterestingGame[] = [];

    // Track per-strategy wins and games, plus head-to-head
    const strategyWins = new Array(N).fill(0);
    const strategyGames = new Array(N).fill(0);
    const headToHead: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));

    for (let batchStart = 0; batchStart < config.numGames && !this.aborted; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, config.numGames);

      for (let gi = batchStart; gi < batchEnd && !this.aborted; gi++) {
        const baseDeckUrl = deckUrls[gi];
        const handUrls = handUrlSequences[gi];

        for (let rotation = 0; rotation < 4 && !this.aborted; rotation++) {
          const rotatedUrl = BidWhistSimulator.rotateDeck(baseDeckUrl, rotation);
          const rotatedHandUrls = handUrls.map((url, idx) =>
            idx === 0 ? rotatedUrl : url
          );

          const deckResults: GameResult[] = [];

          for (const [si, sj] of pairs) {
            if (this.aborted) break;
            const stI = parsedStrategies[si] ?? null;
            const stJ = parsedStrategies[sj] ?? null;
            const playerStrats = [stI, stJ, stI, stJ];

            const result = simulator.simulateGame(rotatedUrl, playerStrats, rotatedHandUrls, 0);
            result.rotation = rotation;
            result.deckUrl = baseDeckUrl;
            result.rotatedUrl = rotatedUrl;
            result.team0StrategyIndex = si;
            result.team1StrategyIndex = sj;

            deckResults.push(result);
            allResults.push(result);

            // Update stats
            const winnerIdx = result.winningTeam === 0 ? si : sj;
            const loserIdx = result.winningTeam === 0 ? sj : si;
            strategyWins[winnerIdx]++;
            strategyGames[si]++;
            strategyGames[sj]++;
            headToHead[winnerIdx][loserIdx]++;

            completed++;
            if (onProgress) {
              onProgress(completed, totalSims);
            }
          }

          // Compute interestingness for this deck+rotation
          // For each strategy, check if it won at least once AND lost at least once
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
      }

      if (batchEnd < config.numGames) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Sort interesting games by score descending
    interestingGames.sort((a, b) => (b.interestingnessScore ?? 0) - (a.interestingnessScore ?? 0));

    const totalGames = allResults.length;
    const summary: ComparisonSummary = {
      totalGames,
      winsPerConfig: strategyWins,
      winRate: strategyWins.map((w, i) => strategyGames[i] > 0 ? w / strategyGames[i] : 0),
      strategyMattersCount: interestingGames.length,
      cardAdvantageDominatedCount: (config.numGames * 4) - interestingGames.length,
      strategyWins,
      strategyGames,
      headToHead,
    };

    return { config, results: allResults, summary, interestingGames };
  }
}
