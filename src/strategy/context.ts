import { Card } from '../types/CardGame.ts';
import { StrategyContext, BidInfo } from './types.ts';

interface BidWhistGameLike {
  getGameState(): {
    players: { id: number; hand: Card[]; tricks: Card[] }[];
    currentTrick: { playerId: number; card: Card }[];
    currentPlayer: number | null;
    gameStage: string;
  };
  getTrumpSuit(): string | null;
  getBidDirection(): string;
  getDeclarer(): number | null;
  getDealer(): number;
  getBiddingState(): {
    currentHighBid: number;
    bids: BidInfo[];
    dealer: number;
  };
  getCardValue(card: Card): number;
  compareCards(a: Card, b: Card): number;
  evaluateCurrentWinner(): number;
  getPlayedCards(): Card[];
}

interface HeartsGameLike {
  getGameState(): {
    players: { id: number; hand: Card[]; tricks: Card[] }[];
    currentTrick: { playerId: number; card: Card }[];
    currentPlayer: number | null;
    gameStage: string;
  };
  getHeartsBroken(): boolean;
  getLeadSuit(): string | null;
  getPlayedCards(): Card[];
}

export function buildBidWhistContext(game: BidWhistGameLike, playerId: number): StrategyContext {
  const state = game.getGameState();
  const biddingState = game.getBiddingState();
  const player = state.players[playerId];
  const declarer = game.getDeclarer();
  const trumpSuit = game.getTrumpSuit();
  const dealer = game.getDealer();

  // Determine lead suit from current trick
  const leadSuit = state.currentTrick.length > 0 ? state.currentTrick[0].card.suit : null;

  // Determine partner (in 4-player game, partner is +2)
  const partnerId = (playerId + 2) % 4;

  // Check if partner is currently winning the trick
  let partnerWinning = false;
  let partnerLed = false;
  if (state.currentTrick.length > 0) {
    partnerLed = state.currentTrick[0].playerId === partnerId;
    const winnerIdx = game.evaluateCurrentWinner();
    if (winnerIdx >= 0) {
      partnerWinning = state.currentTrick[winnerIdx].playerId === partnerId;
    }
  }

  // Find partner's bid
  let partnerBid = 0;
  for (const bid of biddingState.bids) {
    if (bid.playerId === partnerId && !bid.passed) {
      partnerBid = bid.amount;
    }
  }

  // Is first trick: no tricks completed yet
  const isFirstTrick = state.players.every(p => p.tricks.length === 0) ||
    // Or if declarer has exactly 4 tricks (the discards)
    (declarer !== null && state.players[declarer].tricks.length === 4 &&
     state.players.filter(p => p.id !== declarer).every(p => p.tricks.length === 0));

  return {
    hand: [...player.hand],
    currentTrick: [...state.currentTrick],
    leadSuit,
    trumpSuit,
    playerId,
    declarer,
    dealer,
    isDealer: playerId === dealer,
    onDeclarerTeam: declarer !== null && (playerId % 2) === (declarer % 2),
    hasTrump: trumpSuit !== null && player.hand.some(c => c.suit === trumpSuit),
    partnerWinning,
    partnerLed,
    isFirstTrick,
    heartsBroken: false,
    bidDirection: game.getBidDirection(),
    currentHighBid: biddingState.currentHighBid,
    bids: biddingState.bids.map(b => ({ playerId: b.playerId, amount: b.amount, passed: b.passed })),
    bidCount: biddingState.bids.length,
    partnerBid,
    getCardValue: (card: Card) => game.getCardValue(card),
    compareCards: (a: Card, b: Card) => game.compareCards(a, b),
    evaluateCurrentWinner: () => game.evaluateCurrentWinner(),
    playedCards: game.getPlayedCards(),
  };
}

export function buildHeartsContext(game: HeartsGameLike, playerId: number): StrategyContext {
  const state = game.getGameState();
  const player = state.players[playerId];
  const leadSuit = game.getLeadSuit();
  const partnerId = (playerId + 2) % 4;

  // Hearts doesn't have trumps, declarer, or bidding
  // Partner winning: check who played highest of lead suit
  let partnerWinning = false;
  let partnerLed = false;
  if (state.currentTrick.length > 0) {
    partnerLed = state.currentTrick[0].playerId === partnerId;
    // In hearts, highest card of lead suit wins
    const trickLeadSuit = state.currentTrick[0].card.suit;
    let highRank = -1;
    let winnerId = -1;
    state.currentTrick.forEach(p => {
      if (p.card.suit === trickLeadSuit && p.card.rank > highRank) {
        highRank = p.card.rank;
        winnerId = p.playerId;
      }
    });
    partnerWinning = winnerId === partnerId;
  }

  const isFirstTrick = state.players.every(p => p.tricks.length === 0);

  // Hearts card value: ace is high (14), rest normal
  const getCardValue = (card: Card): number => {
    return card.rank === 1 ? 14 : card.rank;
  };

  const compareCards = (a: Card, b: Card): number => {
    if (a.suit === b.suit) {
      return getCardValue(a) - getCardValue(b);
    }
    return 0;
  };

  const evaluateCurrentWinner = (): number => {
    if (state.currentTrick.length === 0) return -1;
    const trickLeadSuit = state.currentTrick[0].card.suit;
    let winIdx = 0;
    let highVal = getCardValue(state.currentTrick[0].card);
    for (let i = 1; i < state.currentTrick.length; i++) {
      if (state.currentTrick[i].card.suit === trickLeadSuit) {
        const val = getCardValue(state.currentTrick[i].card);
        if (val > highVal) {
          highVal = val;
          winIdx = i;
        }
      }
    }
    return winIdx;
  };

  return {
    hand: [...player.hand],
    currentTrick: [...state.currentTrick],
    leadSuit,
    trumpSuit: null,
    playerId,
    declarer: null,
    dealer: 0,
    isDealer: false,
    onDeclarerTeam: false,
    hasTrump: false,
    partnerWinning,
    partnerLed,
    isFirstTrick,
    heartsBroken: game.getHeartsBroken(),
    bidDirection: 'uptown',
    currentHighBid: 0,
    bids: [],
    bidCount: 0,
    partnerBid: 0,
    getCardValue,
    compareCards,
    evaluateCurrentWinner,
    playedCards: game.getPlayedCards(),
  };
}
