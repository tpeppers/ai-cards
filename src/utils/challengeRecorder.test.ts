import { ChallengeRecorder } from './challengeRecorder.ts';
import { decodeHandRecord } from './gameRecord.ts';
import { BidWhistGame } from '../games/BidWhistGame.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { BIDWHIST_CLAUDE_OMNI } from '../strategies/index.ts';

// Same fixed deal as BidWhistGame.test.ts / gameRecord.test.ts.
const TEST_URL = 'oVKtOPzUAJYMDWsTNFIGbqcSaifXEkHQnLuRplryChmwBdvxjZge';

/**
 * Drives a full hand through a real engine with Claude Omni on every
 * seat (processAIBid + getAITrumpSelection + setTrumpSuitForPlayer(false)
 * + getBestMove loop) and leaves the game at scoring.
 */
function driveFullHand(): BidWhistGame {
  const game = new BidWhistGame();
  game.setStrategy(parseStrategy(BIDWHIST_CLAUDE_OMNI));
  game.setDealer(0);
  game.dealCards(TEST_URL);

  let state = game.getGameState();
  let guard = 0;
  while (state.gameStage === 'bidding' && guard++ < 8) {
    game.processAIBid(state.currentPlayer!);
    state = game.getGameState();
  }
  expect(state.gameStage).toBe('trumpSelection');

  const declarer = game.getDeclarer()!;
  const { suit, direction } = game.getAITrumpSelection(declarer);
  // isHumanDeclarer=false → the strategy auto-discards immediately.
  expect(game.setTrumpSuitForPlayer(suit, direction, false)).toBe(true);

  state = game.getGameState();
  while (state.gameStage === 'play') {
    const player = state.currentPlayer!;
    const card = game.getBestMove(player)!;
    expect(card).toBeTruthy();
    expect(game.playCard(player, card).isValid).toBe(true);
    state = game.getGameState();
  }
  expect(state.gameStage).toBe('scoring');
  return game;
}

beforeEach(() => {
  localStorage.clear();
});

describe('ChallengeRecorder', () => {
  test('finalizeHand stores a decodable BWR1 record with correct flag logic', () => {
    const game = driveFullHand();
    const recorder = new ChallengeRecorder('Claude Omni');

    // Buffer assists: two identical previews collapse to one.
    recorder.assist({ type: 'bidAssist', bidIndex: 0 });
    recorder.assist({ type: 'preview', playIndex: 0 });
    recorder.assist({ type: 'preview', playIndex: 0 }); // deduped
    recorder.assist({ type: 'autoplay', playIndex: 4 });

    // At scoring: 12 completed tricks, no partial trick.
    expect(recorder.playsSoFar(game as any)).toBe(48);

    const books = game.getBooksWon();
    const shadow: { booksWon: [number, number] } = { booksWon: [5, 8] };
    const stored = recorder.finalizeHand(game as any, shadow);

    expect(stored).not.toBeNull();
    expect(stored!.strategyName).toBe('Claude Omni');
    expect(stored!.deal).toBe(TEST_URL);
    expect(stored!.assistCount).toBe(3);
    expect(stored!.flagged).toBe(books[0] > 5);

    const decoded = decodeHandRecord(stored!.encoded);
    expect(decoded.deal).toBe(TEST_URL);
    expect(decoded.dealer).toBe(0);
    expect(decoded.plays.length).toBe(48);
    expect(decoded.discards.length).toBe(4);
    expect(decoded.bids.length).toBe(game.getBiddingState().bids.length);
    expect(decoded.call).toEqual({ suit: game.getTrumpSuit(), direction: game.getBidDirection() });
    expect(decoded.assists).toEqual([
      { type: 'bidAssist', bidIndex: 0 },
      { type: 'preview', playIndex: 0 },
      { type: 'autoplay', playIndex: 4 },
    ]);
    expect(decoded.outcome.humanBooks).toEqual([books[0], books[1]]);
    expect(decoded.outcome.shadowBooks).toEqual([5, 8]);
    expect(decoded.outcome.flagged).toBe(stored!.flagged);

    // Persisted via load().
    const loaded = ChallengeRecorder.load();
    expect(loaded.length).toBe(1);
    expect(loaded[0]).toEqual(stored);

    // Assist buffer resets after finalize; flag flips with the shadow.
    // Team 0 can't beat 12 (books sum to 12) → never flagged.
    const notFlagged = recorder.finalizeHand(game as any, { booksWon: [12, 0] });
    expect(notFlagged!.assistCount).toBe(0);
    expect(notFlagged!.flagged).toBe(false);
    // Shadow team 0 at 0 books → flagged iff the human line took any.
    const maybeFlagged = recorder.finalizeHand(game as any, { booksWon: [0, 12] });
    expect(maybeFlagged!.flagged).toBe(books[0] > 0);
    // No shadow → never flagged, shadowBooks null.
    const noShadow = recorder.finalizeHand(game as any, null);
    expect(noShadow!.flagged).toBe(false);
    expect(decodeHandRecord(noShadow!.encoded).outcome.shadowBooks).toBeNull();

    expect(ChallengeRecorder.load().length).toBe(4);
  });

  test('finalizeHand skips hands with no declarer/trump (returns null, stores nothing)', () => {
    const game = new BidWhistGame();
    game.setDealer(0);
    game.dealCards(TEST_URL); // still in bidding — no declarer, no trump
    const recorder = new ChallengeRecorder('Claude Omni');
    recorder.assist({ type: 'bidAssist', bidIndex: 0 });

    expect(recorder.finalizeHand(game as any, null)).toBeNull();
    expect(ChallengeRecorder.load()).toEqual([]);
  });

  test('clear empties the store and load tolerates junk', () => {
    const game = driveFullHand();
    const recorder = new ChallengeRecorder('Claude Omni');
    expect(recorder.finalizeHand(game as any, null)).not.toBeNull();
    expect(ChallengeRecorder.load().length).toBe(1);

    ChallengeRecorder.clear();
    expect(ChallengeRecorder.load()).toEqual([]);

    localStorage.setItem('challengeRecords', 'not json {');
    expect(ChallengeRecorder.load()).toEqual([]);
    localStorage.setItem('challengeRecords', '{"an":"object"}');
    expect(ChallengeRecorder.load()).toEqual([]);
  });

  test('toCsv produces a header plus one properly escaped row per record', () => {
    const game = driveFullHand();
    const recorder = new ChallengeRecorder('Name, with "quotes"');
    const stored = recorder.finalizeHand(game as any, { booksWon: [5, 8] })!;

    const csv = ChallengeRecorder.toCsv([stored]);
    const lines = csv.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('ts,strategyName,flagged,assistCount,deal,encoded');
    expect(lines[1].startsWith(new Date(stored.ts).toISOString())).toBe(true);
    expect(lines[1]).toContain('"Name, with ""quotes"""');
    expect(lines[1]).toContain(TEST_URL);
    expect(lines[1]).toContain(stored.encoded);
  });
});
