import { BidWhistGame } from './BidWhistGame';

describe('BidWhistGame Deterministic Test', () => {
  const TEST_URL = 'oVKtOPzUAJYMDWsTNFIGbqcSaifXEkHQnLuRplryChmwBdvxjZge';

  test('deterministic hand with bid 6, downtown aces good, clubs trump wins all tricks', () => {
    const game = new BidWhistGame();

    // Deal with fixed URL seed
    game.dealCards(TEST_URL);

    // Verify we're in bidding phase
    let state = game.getGameState();
    expect(state.gameStage).toBe('bidding');

    // Player 0 needs to bid - first simulate other players passing/bidding
    // The bidding order depends on dealer position, so let's process bids until it's player 0's turn
    const biddingState = game.getBiddingState();

    // Process AI bids until it's player 0's turn or they can bid
    while (state.currentPlayer !== 0 && state.gameStage === 'bidding') {
      game.processAIBid(state.currentPlayer!);
      state = game.getGameState();
    }

    // Player 0 bids 6
    expect(game.placeBid(0, 6)).toBe(true);
    state = game.getGameState();

    // Continue AI bidding if needed
    while (state.gameStage === 'bidding' && state.currentPlayer !== 0) {
      game.processAIBid(state.currentPlayer!);
      state = game.getGameState();
    }

    // Should be in trump selection phase with player 0 as declarer
    expect(state.gameStage).toBe('trumpSelection');
    expect(game.getDeclarer()).toBe(0);

    // Verify player 0 has 16 cards (12 + 4 from kitty)
    expect(state.players[0].hand.length).toBe(16);

    // Select Downtown (Aces Good) with Clubs trump
    expect(game.setTrumpSuit('clubs', 'downtown')).toBe(true);
    state = game.getGameState();

    // Should be in discard phase
    expect(state.gameStage).toBe('discarding');
    expect(state.players[0].hand.length).toBe(16);

    // Find the cards to discard: King of Diamonds (K♦), 10 of Hearts (10♥), 7 of Hearts (7♥), 5 of Hearts (5♥)
    const hand = state.players[0].hand;
    const kingOfDiamonds = hand.find(c => c.suit === 'diamonds' && c.rank === 13);
    const tenOfHearts = hand.find(c => c.suit === 'hearts' && c.rank === 10);
    const sevenOfHearts = hand.find(c => c.suit === 'hearts' && c.rank === 7);
    const fiveOfHearts = hand.find(c => c.suit === 'hearts' && c.rank === 5);

    expect(kingOfDiamonds).toBeDefined();
    expect(tenOfHearts).toBeDefined();
    expect(sevenOfHearts).toBeDefined();
    expect(fiveOfHearts).toBeDefined();

    // Discard these 4 cards
    const discardIds = [
      kingOfDiamonds!.id,
      tenOfHearts!.id,
      sevenOfHearts!.id,
      fiveOfHearts!.id
    ];
    expect(game.discardCards(discardIds)).toBe(true);
    state = game.getGameState();

    // Should now be in play phase with 12 cards
    expect(state.gameStage).toBe('play');
    expect(state.players[0].hand.length).toBe(12);
    expect(state.currentPlayer).toBe(0); // Declarer leads

    // Verify the hand contains the expected cards after discard
    const finalHand = state.players[0].hand;

    // Should have: A♣, 2♣, 3♣, 4♣, 5♣ (clubs), A♠, 2♠, 3♠ (spades), A♥, 2♥ (hearts), A♦, 2♦ (diamonds)
    const expectedCards = [
      { suit: 'clubs', rank: 1 },   // A♣
      { suit: 'clubs', rank: 2 },   // 2♣
      { suit: 'clubs', rank: 3 },   // 3♣
      { suit: 'clubs', rank: 4 },   // 4♣
      { suit: 'clubs', rank: 5 },   // 5♣
      { suit: 'spades', rank: 1 },  // A♠
      { suit: 'spades', rank: 2 },  // 2♠
      { suit: 'spades', rank: 3 },  // 3♠
      { suit: 'hearts', rank: 1 },  // A♥
      { suit: 'hearts', rank: 2 },  // 2♥
      { suit: 'diamonds', rank: 1 },// A♦
      { suit: 'diamonds', rank: 2 } // 2♦
    ];

    expectedCards.forEach(expected => {
      const found = finalHand.find(c => c.suit === expected.suit && c.rank === expected.rank);
      expect(found).toBeDefined();
    });

    // Now simulate the keyboard shortcut play pattern:
    // Press "6" (index 5) 6 times, then "1" (index 0) 6 times
    // This plays cards in a specific order based on the sorted hand

    let tricksPlayed = 0;

    // Helper to play a card at a given index and let AI players respond
    const playCardAtIndex = (index: number) => {
      state = game.getGameState();
      const playerHand = state.players[0].hand;

      if (index >= playerHand.length) {
        throw new Error(`Cannot play card at index ${index}, hand only has ${playerHand.length} cards`);
      }

      const cardToPlay = playerHand[index];
      const move = game.playCard(0, cardToPlay);
      expect(move.isValid).toBe(true);

      // Let AI players complete the trick
      state = game.getGameState();
      while (state.currentTrick.length < 4 && state.gameStage === 'play') {
        const aiPlayer = state.currentPlayer!;
        if (aiPlayer === 0) break; // Back to human

        const aiCard = game.getBestMove(aiPlayer);
        if (aiCard) {
          game.playCard(aiPlayer, aiCard);
        }
        state = game.getGameState();
      }

      // Trick should be complete or we're waiting for next trick
      state = game.getGameState();
      if (state.currentTrick.length === 0) {
        tricksPlayed++;
      }
    };

    // Play "6" (index 5) six times
    for (let i = 0; i < 6; i++) {
      state = game.getGameState();
      if (state.gameStage !== 'play') break;
      if (state.currentPlayer === 0) {
        playCardAtIndex(5);
      }
    }

    // Play "1" (index 0) six times
    for (let i = 0; i < 6; i++) {
      state = game.getGameState();
      if (state.gameStage !== 'play') break;
      if (state.currentPlayer === 0) {
        playCardAtIndex(0);
      }
    }

    // Game should be complete
    state = game.getGameState();
    expect(state.gameStage).toBe('scoring');

    // Taking all 12 tricks (13 books counting the kitty discard) is a
    // WHISTING: an instant game win for the declarer's team that scores
    // zero points. (This test predates the whisting rule and used to
    // assert points > 0 for the swept hand.)
    expect(game.getWhistingWinner()).toBe(0);
    expect(game.isGameOver()).toBe(true);
    const teamScores = game.getTeamScores();
    expect(teamScores).toEqual([0, 0]);

    console.log('Final team scores:', teamScores);
    console.log('Whisting winner team:', game.getWhistingWinner());
  });

  test('verifies initial hand distribution from URL', () => {
    const game = new BidWhistGame();
    game.dealCards(TEST_URL);

    const state = game.getGameState();

    // Player 0 should have 12 cards initially
    expect(state.players[0].hand.length).toBe(12);

    // Verify specific cards are dealt to player 0
    // Based on round-robin dealing, player 0 gets positions 0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44
    // From URL: o(0)=2♠, O(4)=2♦, A(8)=A♣, D(12)=4♣, N(16)=A♦, b(20)=2♥,
    //           a(24)=A♥, E(28)=5♣, n(32)=A♠, p(36)=3♠, C(40)=3♣, B(44)=2♣

    const hand = state.players[0].hand;

    // Check for specific cards
    expect(hand.some(c => c.suit === 'spades' && c.rank === 2)).toBe(true);   // 2♠
    expect(hand.some(c => c.suit === 'diamonds' && c.rank === 2)).toBe(true); // 2♦
    expect(hand.some(c => c.suit === 'clubs' && c.rank === 1)).toBe(true);    // A♣
    expect(hand.some(c => c.suit === 'clubs' && c.rank === 4)).toBe(true);    // 4♣
    expect(hand.some(c => c.suit === 'diamonds' && c.rank === 1)).toBe(true); // A♦
    expect(hand.some(c => c.suit === 'hearts' && c.rank === 2)).toBe(true);   // 2♥
    expect(hand.some(c => c.suit === 'hearts' && c.rank === 1)).toBe(true);   // A♥
    expect(hand.some(c => c.suit === 'clubs' && c.rank === 5)).toBe(true);    // 5♣
    expect(hand.some(c => c.suit === 'spades' && c.rank === 1)).toBe(true);   // A♠
    expect(hand.some(c => c.suit === 'spades' && c.rank === 3)).toBe(true);   // 3♠
    expect(hand.some(c => c.suit === 'clubs' && c.rank === 3)).toBe(true);    // 3♣
    expect(hand.some(c => c.suit === 'clubs' && c.rank === 2)).toBe(true);    // 2♣
  });

  test('kitty contains expected cards from URL', () => {
    const game = new BidWhistGame();
    game.dealCards(TEST_URL);

    // Process through bidding to get kitty
    let state = game.getGameState();

    // Make player 0 win the bid
    while (state.currentPlayer !== 0 && state.gameStage === 'bidding') {
      game.processAIBid(state.currentPlayer!);
      state = game.getGameState();
    }

    if (state.currentPlayer === 0 && state.gameStage === 'bidding') {
      game.placeBid(0, 6);
      state = game.getGameState();
    }

    while (state.gameStage === 'bidding' && state.currentPlayer !== 0) {
      game.processAIBid(state.currentPlayer!);
      state = game.getGameState();
    }

    // Should have 16 cards now (12 + 4 kitty)
    state = game.getGameState();
    if (state.gameStage === 'trumpSelection' && game.getDeclarer() === 0) {
      expect(state.players[0].hand.length).toBe(16);

      // Kitty should contain: j(48)=10♥, Z(49)=K♦, g(50)=7♥, e(51)=5♥
      const hand = state.players[0].hand;
      expect(hand.some(c => c.suit === 'hearts' && c.rank === 10)).toBe(true);  // 10♥
      expect(hand.some(c => c.suit === 'diamonds' && c.rank === 13)).toBe(true); // K♦
      expect(hand.some(c => c.suit === 'hearts' && c.rank === 7)).toBe(true);   // 7♥
      expect(hand.some(c => c.suit === 'hearts' && c.rank === 5)).toBe(true);   // 5♥
    }
  });

  test('same URL produces same hands on multiple deals', () => {
    const game1 = new BidWhistGame();
    const game2 = new BidWhistGame();

    game1.dealCards(TEST_URL);
    game2.dealCards(TEST_URL);

    const state1 = game1.getGameState();
    const state2 = game2.getGameState();

    // All players should have the same cards
    for (let i = 0; i < 4; i++) {
      const hand1 = state1.players[i].hand.map(c => c.id).sort();
      const hand2 = state2.players[i].hand.map(c => c.id).sort();
      expect(hand1).toEqual(hand2);
    }
  });
});

describe('BidWhistGame card values and direction reset', () => {
  const TEST_URL = 'oVKtOPzUAJYMDWsTNFIGbqcSaifXEkHQnLuRplryChmwBdvxjZge';

  function gameWithDirection(direction: 'uptown' | 'downtown' | 'downtown-noaces'): BidWhistGame {
    const game = new BidWhistGame();
    game.dealCards(TEST_URL);
    let state = game.getGameState();
    while (state.gameStage === 'bidding') {
      if (state.currentPlayer === 0) {
        game.placeBid(0, 6);
      } else {
        game.processAIBid(state.currentPlayer!);
      }
      state = game.getGameState();
    }
    // Whoever won the bid, force the direction we want to test
    expect(game.setTrumpSuitForPlayer('clubs', direction, false)).toBe(true);
    return game;
  }

  test('downtown-noaces: the King strictly beats the Ace', () => {
    const game = gameWithDirection('downtown-noaces');
    const ace = { suit: 'hearts', rank: 1, id: 'hearts_1' };
    const king = { suit: 'hearts', rank: 13, id: 'hearts_13' };
    // Regression: A and K both used to map to value 1 (a tie), letting an
    // already-played Ace hold the trick against the King.
    expect(game.getCardValue(king)).toBeGreaterThan(game.getCardValue(ace));
    expect(game.compareCards(king, ace)).toBeGreaterThan(0);
  });

  test('downtown-noaces: the deuce is the best card in the suit', () => {
    const game = gameWithDirection('downtown-noaces');
    const deuce = { suit: 'hearts', rank: 2, id: 'hearts_2' };
    const king = { suit: 'hearts', rank: 13, id: 'hearts_13' };
    expect(game.getCardValue(deuce)).toBeGreaterThan(game.getCardValue(king));
  });

  test('startNewHand resets bid direction to uptown', () => {
    const game = gameWithDirection('downtown-noaces');
    expect(game.getBidDirection()).toBe('downtown-noaces');
    // Regression: the next hand's bidding phase used to evaluate card
    // values under the PREVIOUS hand's direction.
    game.startNewHand();
    expect(game.getBidDirection()).toBe('uptown');
  });
});

describe('Directional hand organization', () => {
  const TEST_URL = 'oVKtOPzUAJYMDWsTNFIGbqcSaifXEkHQnLuRplryChmwBdvxjZge';

  afterEach(() => {
    localStorage.removeItem('directionalHandSort');
  });

  function dealtGame(): BidWhistGame {
    const game = new BidWhistGame();
    game.dealCards(TEST_URL);
    let state = game.getGameState();
    while (state.gameStage === 'bidding') {
      if (state.currentPlayer === 0) {
        game.placeBid(0, 6);
      } else {
        game.processAIBid(state.currentPlayer!);
      }
      state = game.getGameState();
    }
    return game;
  }

  /** Ranks of one suit, in the order they appear in the hand. */
  function suitRanks(game: BidWhistGame, suit: string): number[] {
    return game.getGameState().players[0].hand
      .filter(c => c.suit === suit)
      .map(c => c.rank);
  }

  /** Every suit reads strongest-first for the direction in play. */
  function expectStrongestFirst(game: BidWhistGame) {
    const hand = game.getGameState().players[0].hand;
    for (let i = 1; i < hand.length; i++) {
      if (hand[i].suit !== hand[i - 1].suit) continue;
      expect(game.getCardValue(hand[i - 1])).toBeGreaterThan(game.getCardValue(hand[i]));
    }
  }

  test('uptown hands read A K Q ... 2 within a suit', () => {
    const game = dealtGame();
    expect(game.setTrumpSuitForPlayer('clubs', 'uptown', false)).toBe(true);
    expectStrongestFirst(game);
  });

  test('downtown hands reorganize so the ace and deuce lead the suit', () => {
    const game = dealtGame();
    expect(game.setTrumpSuitForPlayer('clubs', 'downtown', false)).toBe(true);
    expectStrongestFirst(game);
    // The King is the worst card downtown, so it can never lead its suit.
    for (const suit of ['spades', 'hearts', 'clubs', 'diamonds']) {
      const ranks = suitRanks(game, suit);
      if (ranks.length > 1) expect(ranks[0]).not.toBe(13);
    }
  });

  test('downtown-noaces hands push the ace to the back of its suit', () => {
    const game = dealtGame();
    expect(game.setTrumpSuitForPlayer('clubs', 'downtown-noaces', false)).toBe(true);
    expectStrongestFirst(game);
    for (const suit of ['spades', 'hearts', 'clubs', 'diamonds']) {
      const ranks = suitRanks(game, suit);
      if (ranks.includes(1) && ranks.length > 1) expect(ranks[ranks.length - 1]).toBe(1);
    }
  });

  test('with the setting off, a downtown hand still reads uptown', () => {
    localStorage.setItem('directionalHandSort', 'off');
    const game = dealtGame();
    expect(game.setTrumpSuitForPlayer('clubs', 'downtown', false)).toBe(true);
    const hand = game.getGameState().players[0].hand;
    for (let i = 1; i < hand.length; i++) {
      if (hand[i].suit !== hand[i - 1].suit) continue;
      const uptownValue = (rank: number) => (rank === 1 ? 14 : rank);
      expect(uptownValue(hand[i - 1].rank)).toBeGreaterThan(uptownValue(hand[i].rank));
    }
  });

  test('resortHands re-applies the preference mid-hand', () => {
    localStorage.setItem('directionalHandSort', 'off');
    const game = dealtGame();
    expect(game.setTrumpSuitForPlayer('clubs', 'downtown', false)).toBe(true);
    localStorage.setItem('directionalHandSort', 'on');
    game.resortHands();
    expectStrongestFirst(game);
  });
});

describe('Game Mode faithful-replay anchoring', () => {
  test('with dealer at index 0, the tagged 1st bidder (index 3) bids first', () => {
    // Mirror server/deckReconstruct.js's convention: dealer→0 (hearts),
    // bid3→1 (diamonds), bid2→2 (clubs), bid1→3 (spades); kitty '_'.
    // If either the engine's bid order or the reconstruction mapping
    // changes, this test fails — they must move together.
    const hearts = 'abcdefghijkl';   // ranks 1-12
    const diamonds = 'NOPQRSTUVWXY';
    const clubs = 'ABCDEFGHIJKL';
    const spades = 'nopqrstuvwxy';
    let url = '';
    for (let i = 0; i < 12; i++) {
      url += hearts[i] + diamonds[i] + clubs[i] + spades[i];
    }
    url += '____'; // kitty: the four kings, filled randomly on load

    const game = new BidWhistGame();
    game.setDealer(0); // the loader does this for URL-seeded deals
    game.dealCards(url);

    const state = game.getGameState();
    // Hands land at the anchored indices…
    expect(state.players[0].hand.every(c => c.suit === 'hearts')).toBe(true);
    expect(state.players[1].hand.every(c => c.suit === 'diamonds')).toBe(true);
    expect(state.players[2].hand.every(c => c.suit === 'clubs')).toBe(true);
    expect(state.players[3].hand.every(c => c.suit === 'spades')).toBe(true);
    // …and the engine's first bidder is index 3 — the person tagged
    // "1st bidder" at the real table (spades holder).
    expect(state.gameStage).toBe('bidding');
    expect(state.currentPlayer).toBe(3);
    // Bid order proceeds 3 → 2 → 1 → 0 (dealer last).
    expect(game.placeBid(3, 1)).toBe(true);
    expect(game.getGameState().currentPlayer).toBe(2);
    expect(game.placeBid(2, 2)).toBe(true);
    expect(game.getGameState().currentPlayer).toBe(1);
    expect(game.placeBid(1, 0)).toBe(true);
    expect(game.getGameState().currentPlayer).toBe(0); // dealer bids last
  });
});
