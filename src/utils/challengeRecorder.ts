/**
 * Challenge Mode recorder — buffers assist events during a hand and, at
 * scoring time, builds a BWR1 HandRecord entirely from public game state
 * (mirroring deviationJournal's GameLike accessors), pairs it with the
 * shadow-sim counterfactual, and persists it to localStorage.
 *
 * Plain class, no React — BidWhistGame.tsx holds one in a ref.
 */

import { Card } from '../types/CardGame.ts';
import { AssistEvent, HandRecord, encodeHandRecord } from './gameRecord.ts';

export interface StoredChallengeRecord {
  ts: number;
  strategyName: string;
  encoded: string;
  flagged: boolean;
  assistCount: number;
  deal: string;
}

// Minimal game-like handle (subset of BidWhistGame's public surface).
interface ChallengeGameLike {
  getGameState(): {
    players: { id: number; hand: Card[]; tricks: Card[] }[];
    currentTrick: { playerId: number; card: Card }[];
    currentPlayer: number | null;
    gameStage: string;
  };
  getLastDealtDeckUrl(): string;
  getDealer(): number;
  getBiddingState(): {
    currentHighBid: number;
    bids: { playerId: number; amount: number; passed: boolean }[];
    dealer: number;
  };
  getTrumpSuit(): string | null;
  getBidDirection(): string;
  getDeclarer(): number | null;
  getPlayedCards(): Card[];
  getBooksWon(): [number, number];
}

const STORAGE_KEY = 'challengeRecords';

export class ChallengeRecorder {
  private strategyName: string;
  private assists: AssistEvent[] = [];

  constructor(strategyName: string) {
    this.strategyName = strategyName;
  }

  /**
   * Buffer an assist event for the current hand. Consecutive identical
   * previews (same playIndex) are collapsed so hover-jitter doesn't
   * inflate the record — this is the preview throttle callers rely on.
   */
  assist(ev: AssistEvent): void {
    if (ev.type === 'preview') {
      const last = this.assists[this.assists.length - 1];
      if (last && last.type === 'preview' && last.playIndex === ev.playIndex) return;
    }
    this.assists.push(ev);
  }

  /**
   * Plays recorded so far: cards in completed tricks plus the current
   * (partial) trick — the playIndex callers stamp onto assist events.
   */
  playsSoFar(game: ChallengeGameLike): number {
    return game.getPlayedCards().length + game.getGameState().currentTrick.length;
  }

  /**
   * Build + persist the BWR1 record for the just-completed hand.
   * All-pass / incomplete hands (no declarer or no trump) are skipped:
   * returns null without storing (the assist buffer is still reset —
   * those assists belonged to the skipped hand).
   */
  finalizeHand(
    game: ChallengeGameLike,
    shadow: { booksWon: [number, number] } | null
  ): StoredChallengeRecord | null {
    const declarer = game.getDeclarer();
    const trumpSuit = game.getTrumpSuit();
    if (declarer === null || trumpSuit === null) {
      this.assists = [];
      return null;
    }

    const deal = game.getLastDealtDeckUrl();
    const dealer = game.getDealer();

    // Bids in recorded order; pass = 0. Take-it detection: the engine
    // records a dealer "take" as a normal bid at the taken amount, so a
    // final dealer bid that merely EQUALS the earlier max (a regular bid
    // must be strictly higher) is a take.
    const rawBids = game.getBiddingState().bids;
    const bids: (number | 'T')[] = rawBids.map(b => (b.passed ? 0 : b.amount));
    if (rawBids.length > 1) {
      const last = rawBids[rawBids.length - 1];
      const earlierMax = Math.max(...rawBids.slice(0, -1).map(b => (b.passed ? 0 : b.amount)));
      if (last.playerId === dealer && !last.passed && last.amount === earlierMax) {
        bids[bids.length - 1] = 'T';
      }
    }

    const discards = game.getGameState().players[declarer].tricks
      .slice(0, 4)
      .map(c => c.id);
    const plays = game.getPlayedCards().map(c => c.id);

    const rawBooks = game.getBooksWon();
    const humanBooks: [number, number] = [rawBooks[0], rawBooks[1]];
    const shadowBooks: [number, number] | null =
      shadow ? [shadow.booksWon[0], shadow.booksWon[1]] : null;
    // The human sits on team 0; strictly more books than the
    // all-strategy counterfactual = flag.
    const flagged = shadow != null && humanBooks[0] > shadow.booksWon[0];

    const record: HandRecord = {
      deal,
      dealer,
      bids,
      call: { suit: trumpSuit, direction: game.getBidDirection() },
      discards,
      plays,
      assists: this.assists.slice(),
      outcome: { humanBooks, shadowBooks, flagged },
    };

    const stored: StoredChallengeRecord = {
      ts: Date.now(),
      strategyName: this.strategyName,
      encoded: encodeHandRecord(record),
      flagged,
      assistCount: this.assists.length,
      deal,
    };
    ChallengeRecorder.append(stored);
    this.assists = [];
    return stored;
  }

  // ── Persistence ────────────────────────────────────────────────────

  private static append(rec: StoredChallengeRecord): void {
    const all = ChallengeRecorder.load();
    all.push(rec);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      // localStorage full — drop the oldest half and retry once.
      const half = all.slice(Math.floor(all.length / 2));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(half)); } catch {}
    }
  }

  static load(): StoredChallengeRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  static clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  static toCsv(records: StoredChallengeRecord[]): string {
    const esc = (v: string): string =>
      /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const header = 'ts,strategyName,flagged,assistCount,deal,encoded';
    const rows = records.map(r =>
      [
        new Date(r.ts).toISOString(),
        r.strategyName,
        String(r.flagged),
        String(r.assistCount),
        r.deal,
        r.encoded,
      ].map(esc).join(',')
    );
    return [header, ...rows].join('\n');
  }
}
