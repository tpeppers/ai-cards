import { BidWhistSimulator } from './BidWhistSimulator.ts';
import { BatchRunner } from './BatchRunner.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { generateRandomDeckUrl } from '../urlGameState.js';
import { BIDWHIST_STANDARD, BIDWHIST_CLAUDE, BIDWHIST_CONSERVATIVE } from '../strategies/index.ts';

describe('BidWhistSimulator', () => {
  describe('rotateDeck', () => {
    it('rotation 0 returns identity', () => {
      const url = generateRandomDeckUrl();
      expect(BidWhistSimulator.rotateDeck(url, 0)).toBe(url);
    });

    it('rotation 1 shifts first 48 chars left by 1', () => {
      const url = generateRandomDeckUrl();
      const rotated = BidWhistSimulator.rotateDeck(url, 1);
      const dealt = url.slice(0, 48);
      const kitty = url.slice(48);
      expect(rotated).toBe(dealt.slice(1) + dealt.slice(0, 1) + kitty);
    });

    it('rotation 4 returns identity', () => {
      const url = generateRandomDeckUrl();
      expect(BidWhistSimulator.rotateDeck(url, 4)).toBe(url);
    });

    it('preserves kitty across rotations', () => {
      const url = generateRandomDeckUrl();
      const kitty = url.slice(48);
      for (let r = 0; r < 4; r++) {
        const rotated = BidWhistSimulator.rotateDeck(url, r);
        expect(rotated.slice(48)).toBe(kitty);
      }
    });

    it('rotation 1 means P0 gets P1 original cards', () => {
      const url = generateRandomDeckUrl();
      // In original: card at index 1 goes to player 1 (index 1%4=1)
      // After rotation by 1: the char at original index 1 is now at index 0,
      // so it goes to player 0 (index 0%4=0)
      const rotated = BidWhistSimulator.rotateDeck(url, 1);
      // Player 0's cards in original: indices 0,4,8,12,...
      // Player 1's cards in original: indices 1,5,9,13,...
      // After rotation by 1, player 0 gets indices 1,5,9,13,... from original
      for (let i = 0; i < 12; i++) {
        const originalP1Card = url[1 + i * 4]; // P1's ith card in original
        const rotatedP0Card = rotated[0 + i * 4]; // P0's ith card after rotation
        expect(rotatedP0Card).toBe(originalP1Card);
      }
    });
  });

  describe('simulateGame', () => {
    it('runs a single game to completion with valid scores', () => {
      const simulator = new BidWhistSimulator();
      const deckUrl = generateRandomDeckUrl();
      const handUrls = [deckUrl];
      for (let i = 1; i < 20; i++) {
        handUrls.push(generateRandomDeckUrl());
      }

      const strategy = parseStrategy(BIDWHIST_STANDARD);
      const strategies = [strategy, strategy, strategy, strategy];

      const result = simulator.simulateGame(deckUrl, strategies, handUrls, 0);

      expect(result.winningTeam).toBeGreaterThanOrEqual(0);
      expect(result.winningTeam).toBeLessThanOrEqual(1);
      expect(result.teamScores[0]).toBeGreaterThanOrEqual(0);
      expect(result.teamScores[1]).toBeGreaterThanOrEqual(0);
      expect(result.teamScores[0] >= 7 || result.teamScores[1] >= 7).toBe(true);
      expect(result.handsPlayed).toBeGreaterThan(0);
    });

    it('can run with different strategies', () => {
      const simulator = new BidWhistSimulator();
      const deckUrl = generateRandomDeckUrl();
      const handUrls = [deckUrl];
      for (let i = 1; i < 20; i++) {
        handUrls.push(generateRandomDeckUrl());
      }

      const claude = parseStrategy(BIDWHIST_CLAUDE);
      const conservative = parseStrategy(BIDWHIST_CONSERVATIVE);
      const strategies = [claude, conservative, claude, conservative];

      const result = simulator.simulateGame(deckUrl, strategies, handUrls, 0);

      expect(result.winningTeam).toBeGreaterThanOrEqual(0);
      expect(result.winningTeam).toBeLessThanOrEqual(1);
      expect(result.handsPlayed).toBeGreaterThan(0);
    });
  });

  describe('BatchRunner', () => {
    it('completes for 10 games and produces a valid report', async () => {
      const runner = new BatchRunner();
      const result = await runner.runComparison({
        strategies: [
          { name: 'Standard', strategyText: BIDWHIST_STANDARD },
          { name: 'Claude', strategyText: BIDWHIST_CLAUDE },
        ],
        assignmentMode: 'by-team',
        numGames: 10,
      });

      // 10 games * 4 rotations = 40 simulations
      expect(result.results.length).toBe(40);
      expect(result.summary.totalGames).toBe(40);
      expect(result.summary.winsPerConfig[0] + result.summary.winsPerConfig[1]).toBe(40);
      expect(result.summary.winRate[0]).toBeGreaterThanOrEqual(0);
      expect(result.summary.winRate[0]).toBeLessThanOrEqual(1);
      expect(result.summary.winRate[1]).toBeGreaterThanOrEqual(0);
      expect(result.summary.winRate[1]).toBeLessThanOrEqual(1);
      expect(result.interestingGames).toBeDefined();
      expect(Array.isArray(result.interestingGames)).toBe(true);
    }, 30000);

    it('abort stops processing', async () => {
      const runner = new BatchRunner();
      let lastCompleted = 0;

      const promise = runner.runComparison({
        strategies: [
          { name: 'Standard', strategyText: BIDWHIST_STANDARD },
          { name: 'Conservative', strategyText: BIDWHIST_CONSERVATIVE },
        ],
        assignmentMode: 'by-team',
        numGames: 1000,
      }, (completed) => {
        lastCompleted = completed;
        if (completed >= 10) {
          runner.abort();
        }
      });

      const result = await promise;
      // Should have stopped early
      expect(result.results.length).toBeLessThan(4000);
    }, 30000);
  });
});
