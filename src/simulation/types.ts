import { StrategyAST } from '../strategy/types.ts';

export interface StrategyConfig {
  name: string;
  strategyText: string;
}

export interface ComparisonConfig {
  strategies: StrategyConfig[];
  assignmentMode: 'by-team' | 'round-robin';
  numGames: number;
  predefinedDeckUrls?: string[];  // When set, use these instead of random decks
}

export interface HandResult {
  bidWinner: number;       // player ID (0=S, 1=E, 2=N, 3=W), -1 if redeal
  bidAmount: number;
  trumpSuit: string;       // 'spades'|'hearts'|'diamonds'|'clubs'|''
  direction: string;       // 'uptown'|'downtown'|'downtown-noaces'|''
  discards: string[];      // card IDs discarded by declarer
  booksWon: [number, number]; // tricks won by team 0 / team 1
  teamScoresAfter: [number, number]; // cumulative scores after this hand
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
  hands: HandResult[];
  team0StrategyIndex: number;
  team1StrategyIndex: number;
}

export interface InterestingGame {
  deckUrl: string;
  rotation: number;
  configAResult: GameResult;
  configBResult: GameResult;
  allResults?: GameResult[];
  interestingnessScore?: number;
}

export interface ComparisonSummary {
  totalGames: number;
  winsPerConfig: number[];
  winRate: number[];
  strategyMattersCount: number;
  cardAdvantageDominatedCount: number;
  strategyWins?: number[];
  strategyGames?: number[];
  headToHead?: number[][];
}

export interface StrategyComparisonResult {
  config: ComparisonConfig;
  results: GameResult[];
  summary: ComparisonSummary;
  interestingGames: InterestingGame[];
}
