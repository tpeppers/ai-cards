import { StrategyAST } from '../strategy/types.ts';

export interface StrategyConfig {
  name: string;
  strategyText: string;
}

export interface ComparisonConfig {
  strategies: StrategyConfig[];
  assignmentMode: 'by-team' | 'round-robin';
  numHands: number;
  predefinedDeckUrls?: string[];  // When set, use these instead of random decks
  abTestMeta?: {
    section: 'play' | 'bid' | 'trump' | 'discard';
    originalSectionText: string;
    modifiedSectionText: string;
  };
}

export interface HandResult {
  bidWinner: number;       // player ID (0=S, 1=E, 2=N, 3=W), -1 if redeal
  bidAmount: number;
  trumpSuit: string;       // 'spades'|'hearts'|'diamonds'|'clubs'|''
  direction: string;       // 'uptown'|'downtown'|'downtown-noaces'|''
  discards: string[];      // card IDs discarded by declarer
  booksWon: [number, number]; // tricks won by team 0 / team 1
  teamScoresAfter: [number, number]; // cumulative scores after this hand
  dealer: number;          // dealer position for this hand (0-3)
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

export interface InterestingHand {
  deckUrl: string;           // deck URL for this specific hand
  rotation: number;
  gameIndex: number;         // which game this hand belongs to
  handIndex: number;         // hand index within the game
  configAHand: HandResult;
  configBHand: HandResult;
}

export interface WhistingRef {
  deckUrl: string;
  rotation: number;
  gameIndex: number;
  handIndex: number;
  hand: HandResult;
  declarerTeam: number;
  declarerBooks: number;     // always 13 for a whisting
  team0StrategyIndex: number;
  team1StrategyIndex: number;
  configLabel: string;       // 'A' | 'B' | strategy name
}

export interface InterestingWhisting {
  deckUrl: string;
  rotation: number;
  gameIndex: number;
  handIndex: number;
  whistingHand: HandResult;  // the hand where whisting occurred
  nonWhistingHand: HandResult; // the hand where it didn't
  whistingConfig: string;    // which config achieved it
  nonWhistingConfig: string;
  whistingBooks: number;     // 13
  nonWhistingBooks: number;  // how many the other config got
  team0StrategyIndex: number;
  team1StrategyIndex: number;
}

export interface ComparisonSummary {
  totalGames: number;        // total full games (configA only, across all rotations)
  totalHands: number;        // total hands across all games
  winsPerConfig: number[];   // game-level wins
  winRate: number[];         // game-level win rates
  interestingGameCount: number;  // games where strategy changed winner
  interestingHandCount: number;  // hands where outcomes diverged
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
  interestingHands: InterestingHand[];
  whistings: WhistingRef[];
  interestingWhistings: InterestingWhisting[];
}
