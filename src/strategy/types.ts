import { Card } from '../types/CardGame.ts';

// ── AST Node Types ──────────────────────────────────────────────────

export interface StrategyAST {
  name: string;
  game: string;
  play?: PlaySection;
  bid?: RuleBlock;
  trump?: RuleBlock;
}

export interface PlaySection {
  leading?: RuleBlock;
  following?: RuleBlock;
  void?: RuleBlock;
}

export interface RuleBlock {
  rules: Rule[];
  defaultAction?: Action;
}

export interface Rule {
  condition: Expression;
  action: Action;
}

// ── Expressions ─────────────────────────────────────────────────────

export type Expression =
  | BinaryExpr
  | UnaryExpr
  | VariableExpr
  | LiteralExpr
  | FunctionCallExpr
  | PropertyAccessExpr;

export interface BinaryExpr {
  type: 'binary';
  op: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'and' | 'or' | '+' | '-';
  left: Expression;
  right: Expression;
}

export interface UnaryExpr {
  type: 'unary';
  op: 'not';
  operand: Expression;
}

export interface VariableExpr {
  type: 'variable';
  name: string;
}

export interface LiteralExpr {
  type: 'literal';
  value: number | string | boolean;
}

export interface FunctionCallExpr {
  type: 'call';
  name: string;
  args: Expression[];
}

export interface PropertyAccessExpr {
  type: 'property';
  object: Expression;
  property: string;
  args?: Expression[]; // for method calls like .suit(S)
}

// ── Actions ─────────────────────────────────────────────────────────

export type Action =
  | PlayAction
  | BidAction
  | PassAction
  | ChooseAction;

export interface PlayAction {
  type: 'play';
  cardExpr: Expression;
}

export interface BidAction {
  type: 'bid';
  amountExpr: Expression; // number expression or 'take'
}

export interface PassAction {
  type: 'pass';
}

export interface ChooseAction {
  type: 'choose';
  suitExpr: Expression;
  directionExpr: Expression;
}

// ── Runtime Context ─────────────────────────────────────────────────

export interface BidInfo {
  playerId: number;
  amount: number; // 0 = pass
  passed: boolean;
}

export interface CardSet {
  cards: Card[];
}

export interface StrategyContext {
  // My hand
  hand: Card[];

  // Current trick state
  currentTrick: { playerId: number; card: Card }[];
  leadSuit: string | null;
  trumpSuit: string | null;

  // Player info
  playerId: number;
  declarer: number | null;
  dealer: number;
  isDealer: boolean;
  onDeclarerTeam: boolean;
  hasTrump: boolean;

  // Trick context
  partnerWinning: boolean;
  partnerLed: boolean;
  isFirstTrick: boolean;
  heartsBroken: boolean;

  // Bid Whist specific
  bidDirection: string;
  currentHighBid: number;
  bids: BidInfo[];
  bidCount: number; // number of bids placed so far (0=first bidder)
  partnerBid: number; // partner's bid amount (0=pass)
  enemyBid: number;   // enemy signal bid amount (0=none, 1=downtown, 2=uptown)

  // Void discard signaling
  haveSignaled: boolean;       // has this player already made a void discard?
  partnerSignal: string;       // partner's first void discard suit ("" = none)
  enemySignal1: string;        // first enemy's signal ("" = none)
  enemySignal2: string;        // second enemy's signal ("" = none)

  // Void tracking
  enemyHasTrump: boolean;      // true until both enemies shown void in trump
  partnerVoidSuits: string[];   // suits partner is observed void in

  // Card evaluation helpers (injected by game)
  getCardValue: (card: Card) => number;
  compareCards: (a: Card, b: Card) => number;
  evaluateCurrentWinner: () => number; // index into currentTrick

  // All cards that have been played (for cards_above tracking)
  playedCards: Card[];
}
