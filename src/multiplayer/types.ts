import { Card, PlayedCard } from '../types/CardGame.ts';
import { BidWhistState } from '../games/BidWhistGame.ts';

export interface LobbyPlayer {
  name: string;
  seat: number;
  isHost: boolean;
}

export interface LobbyState {
  passphrase: string;
  players: LobbyPlayer[];
  aiStrategy: string;
  isHost: boolean;
  mySeat: number;
}

export interface MultiplayerGameState {
  gameStage: 'deal' | 'bidding' | 'trumpSelection' | 'discarding' | 'play' | 'scoring';
  myHand: Card[];
  currentTrick: PlayedCard[];
  currentPlayer: number;       // rotated: 0=me
  mySeat: number;              // absolute seat
  players: { name: string; cardCount: number; isAI: boolean; totalScore: number; trickCount: number }[];
  biddingState: BidWhistState;  // rotated player IDs
  trumpSuit: string | null;
  bidDirection: string;
  teamScores: [number, number]; // [myTeam, otherTeam]
  booksWon: [number, number];   // [myTeam, otherTeam]
  gameOver: boolean;
  winner: string | null;
  whistingWinner: number;
  message: string;
  validMoves?: Card[];
  validBids?: number[];
  lastTrick: PlayedCard[];      // rotated
  isMyTurn: boolean;
  turnPhase: 'bid' | 'trump' | 'discard' | 'play' | 'wait' | 'scoring';
  declarer: number;             // rotated
  dealer: number;               // rotated
}

export type PlayerAction =
  | { type: 'bid'; amount: number }
  | { type: 'trump'; suit: string; direction: string }
  | { type: 'discard'; cardIds: string[] }
  | { type: 'play'; cardId: string };
