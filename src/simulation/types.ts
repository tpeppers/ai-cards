import { StrategyAST } from '../strategy/types.ts';

export interface StrategyConfig {
  name: string;
  strategyText: string;
}

export interface ComparisonConfig {
  strategies: StrategyConfig[];
  assignmentMode: 'by-team' | 'by-player';
  numGames: number;
}

export interface GameResult {
  deckUrl: string;
  rotation: number;
  rotatedUrl: string;
  winningTeam: number;
  teamScores: [number, number];
  handsPlayed: number;
  handDeckUrls: string[];
  configIndex: number;
}

export interface InterestingGame {
  deckUrl: string;
  rotation: number;
  configAResult: GameResult;
  configBResult: GameResult;
}

export interface ComparisonSummary {
  totalGames: number;
  winsPerConfig: number[];
  winRate: number[];
  strategyMattersCount: number;
  cardAdvantageDominatedCount: number;
}

export interface StrategyComparisonResult {
  config: ComparisonConfig;
  results: GameResult[];
  summary: ComparisonSummary;
  interestingGames: InterestingGame[];
}
