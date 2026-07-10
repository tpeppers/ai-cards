import { encodeHandRecord, decodeHandRecord, replayHandRecord, HandRecord, AssistEvent } from './gameRecord.ts';
import { BidWhistGame } from '../games/BidWhistGame.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { BIDWHIST_CLAUDE_OMNI } from '../strategies/index.ts';

// Same fixed deal as BidWhistGame.test.ts.
const TEST_URL = 'oVKtOPzUAJYMDWsTNFIGbqcSaifXEkHQnLuRplryChmwBdvxjZge';

/**
 * Drives a full hand through a real engine with the Claude Omni strategy
 * on every seat, capturing each decision as HandRecord fields.
 */
function driveHandRecord(): { record: HandRecord; books: [number, number] } {
  const game = new BidWhistGame();
  game.setStrategy(parseStrategy(BIDWHIST_CLAUDE_OMNI));
  game.setDealer(0);
  game.dealCards(TEST_URL);

  // Bidding: capture each bid ('T' for the dealer take-it, -1 internally).
  const bids: (number | 'T')[] = [];
  let state = game.getGameState();
  while (state.gameStage === 'bidding' && bids.length < 4) {
    const bidder = state.currentPlayer!;
    const amount = game.getAIBid(bidder);
    bids.push(amount === -1 ? 'T' : amount);
    expect(game.placeBid(bidder, amount)).toBe(true);
    state = game.getGameState();
  }
  expect(state.gameStage).toBe('trumpSelection');

  const declarer = game.getDeclarer()!;
  const { suit, direction } = game.getAITrumpSelection(declarer);
  // isHumanDeclarer=false → strategy auto-discards immediately.
  expect(game.setTrumpSuitForPlayer(suit, direction, false)).toBe(true);
  const discards = game.getPlayer(declarer)!.tricks.slice(0, 4).map(c => c.id);
  expect(discards.length).toBe(4);

  // Play out all 12 tricks, capturing table order.
  const plays: string[] = [];
  state = game.getGameState();
  while (state.gameStage === 'play') {
    const player = state.currentPlayer!;
    const card = game.getBestMove(player)!;
    expect(card).toBeTruthy();
    plays.push(card.id);
    expect(game.playCard(player, card).isValid).toBe(true);
    state = game.getGameState();
  }
  expect(state.gameStage).toBe('scoring');
  expect(plays.length).toBe(48);

  const rawBooks = game.getBooksWon();
  const books: [number, number] = [rawBooks[0], rawBooks[1]];

  const record: HandRecord = {
    deal: TEST_URL,
    dealer: 0,
    bids,
    call: { suit, direction },
    discards,
    plays,
    assists: [],
    outcome: { humanBooks: books, shadowBooks: null, flagged: false },
  };
  return { record, books };
}

describe('BWR1 hand records', () => {
  test('engine-driven record round-trips and replays to the same books', () => {
    const { record, books } = driveHandRecord();

    const encoded = encodeHandRecord(record);
    // Single-string form uses only the URL/HTTP-friendly alphabet.
    expect(encoded).toMatch(/^[A-Za-z0-9.~-]+$/);

    const decoded = decodeHandRecord(encoded);
    expect(decoded).toEqual(record);

    const replay = replayHandRecord(decoded);
    expect(replay.errors).toEqual([]);
    expect(replay.valid).toBe(true);
    expect(replay.books).toEqual(books);
  });

  test('record with every assist token type and flagged outcome round-trips', () => {
    const { record } = driveHandRecord();
    const assists: AssistEvent[] = [
      { type: 'showAllOn', playIndex: 0 },
      { type: 'showAllOff', playIndex: 5 },
      { type: 'autoplay', playIndex: 12 },
      { type: 'preview', playIndex: 33 },
      { type: 'bidAssist', bidIndex: 2 },
      { type: 'trumpAssist' },
      { type: 'discardAssist' },
    ];
    const full: HandRecord = {
      ...record,
      assists,
      outcome: { humanBooks: [8, 5], shadowBooks: [7, 6], flagged: true },
    };

    const encoded = encodeHandRecord(full);
    const decoded = decodeHandRecord(encoded);
    expect(decoded).toEqual(full);
    // Byte-exact in the string direction too.
    expect(encodeHandRecord(decoded)).toBe(encoded);
  });

  test('decode rejects malformed input with descriptive errors', () => {
    const { record } = driveHandRecord();
    const encoded = encodeHandRecord(record);
    const parts = encoded.split('.');

    const withField = (idx: number, value: string): string => {
      const p = parts.slice();
      p[idx] = value;
      return p.join('.');
    };

    // Wrong version tag.
    expect(() => decodeHandRecord(withField(0, 'BWR2'))).toThrow(/version/);
    // 51-char deal.
    expect(() => decodeHandRecord(withField(1, parts[1].slice(0, 51)))).toThrow(/52/);
    // Invalid bid char.
    expect(() => decodeHandRecord(withField(3, '04X0'))).toThrow(/bid char/);
    // Bad call suit.
    expect(() => decodeHandRecord(withField(4, 'xu'))).toThrow(/call suit/);
    // Junk assist token.
    expect(() => decodeHandRecord(withField(7, 'Q9'))).toThrow(/assist token/);
    // Out-of-range dealer.
    expect(() => decodeHandRecord(withField(2, '7'))).toThrow(/dealer/);
  });

  test('all-pass record round-trips and replays valid', () => {
    const record: HandRecord = {
      deal: TEST_URL,
      dealer: 0,
      bids: [0, 0, 0, 0],
      call: null,
      discards: [],
      plays: [],
      assists: [],
      outcome: { humanBooks: null, shadowBooks: null, flagged: false },
    };

    const encoded = encodeHandRecord(record);
    const decoded = decodeHandRecord(encoded);
    expect(decoded).toEqual(record);

    const replay = replayHandRecord(decoded);
    expect(replay.errors).toEqual([]);
    expect(replay.valid).toBe(true);
    expect(replay.books).toBeNull();
  });
});
