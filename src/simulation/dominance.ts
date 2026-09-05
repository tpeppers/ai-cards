/**
 * Dominance Lab: is a strategy a best response on a given board?
 *
 * The question this answers is narrower and sharper than the head-to-head
 * win rates the Compare page reports. There the board is random and the
 * verdict is "which strategy wins more games overall". Here the board is
 * pinned — a specific hand, or a specific full 52-card layout — and the
 * verdict is "on THIS board, can any other strategy do better from my
 * seat?".
 *
 * The test is unilateral deviation, the game-theoretic definition:
 *
 *   BASELINE   champion seated in all four seats  -> payoff_c
 *   DEVIATED   one seat (or one team) swapped to
 *              a challenger, everyone else still
 *              playing champion                   -> payoff_x
 *
 *   delta = payoff_x - payoff_c
 *
 * delta > 0 is a refutation: the deviator profited by abandoning the
 * champion, so the champion is not a best response on this board. delta
 * <= 0 for every challenger tried is evidence (never proof — the search
 * is over the strategies you supplied, not over all strategies) that the
 * champion is dominant here.
 *
 * Holding the other three seats fixed at champion is what makes a
 * refutation meaningful. A challenger that "wins" a head-to-head match
 * may only be exploiting a specific opponent; a challenger that profits
 * by deviating against the champion itself is strictly better play.
 *
 * ── Board specs ────────────────────────────────────────────────────
 *
 * A board spec is a 52-character deck string in the urlGameState schema
 * (see src/urlGameState.js) where '_' means "unknown". Cards are dealt
 * round-robin, so seat P holds indices P, P+4, ... P+44, and indices
 * 48-51 are the kitty. Two useful shapes:
 *
 *   fully specified   every card known; the hand is deterministic, so
 *                     one simulation per dealer is the complete answer
 *   partial           e.g. "A___B___C___..." pins South's hand and
 *                     leaves the other three seats and the kitty open;
 *                     unknowns are filled by seeded Monte Carlo and the
 *                     verdict comes with a confidence interval
 *
 * Every fill is resolved here, before the game sees it, so the baseline
 * and every challenger play the exact same cards. That pairing is what
 * makes small deltas readable — without it the fill noise would swamp
 * the strategy difference.
 */

import { BidWhistGame } from '../games/BidWhistGame.ts';
import { StrategyAST } from '../strategy/types.ts';
import { parseStrategy } from '../strategy/parser.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import { StrategyConfig } from './types.ts';
import { letterToCard } from '../urlGameState.js';

// ── Constants ────────────────────────────────────────────────────────

/** All 52 card letters in the urlGameState schema. */
const ALL_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const DECK_LENGTH = 52;
export const WILDCARD = '_';

/**
 * Payoff credited for a whisting (all 13 books). scoreHand() awards no
 * points for one because it ends the game outright, so for a single-hand
 * payoff we substitute the value of winning: the 21-point target.
 */
export const WHISTING_PAYOFF = 21;

export const SEAT_LABELS = ['South', 'East', 'North', 'West'];

// ── Seeded RNG (mulberry32, same generator as strategyOptimizer) ─────

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Board specs ──────────────────────────────────────────────────────

export interface BoardSpecInfo {
  valid: boolean;
  error: string;
  /** Number of '_' positions still to be filled. */
  wildcards: number;
  /** True when nothing is unknown, so every simulation is deterministic. */
  exact: boolean;
  /** Wildcard count per seat (0-3) and the kitty (index 4). */
  unknownBySeat: [number, number, number, number, number];
}

/**
 * Validate a board spec: 52 chars, every non-wildcard a legal card
 * letter, no duplicates.
 */
export function analyzeBoardSpec(spec: string): BoardSpecInfo {
  const empty: BoardSpecInfo = {
    valid: false,
    error: '',
    wildcards: 0,
    exact: false,
    unknownBySeat: [0, 0, 0, 0, 0],
  };

  if (spec.length !== DECK_LENGTH) {
    return { ...empty, error: `Board spec must be exactly ${DECK_LENGTH} characters (got ${spec.length}).` };
  }

  const seen = new Set<string>();
  const unknownBySeat: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let wildcards = 0;

  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    const bucket = i < 48 ? i % 4 : 4;
    if (ch === WILDCARD) {
      wildcards++;
      unknownBySeat[bucket]++;
      continue;
    }
    if (ALL_LETTERS.indexOf(ch) < 0) {
      return { ...empty, error: `Invalid card letter '${ch}' at position ${i}.` };
    }
    if (seen.has(ch)) {
      const card = letterToCard(ch);
      return { ...empty, error: `Duplicate card ${card.suit} ${card.rank} ('${ch}') at position ${i}.` };
    }
    seen.add(ch);
  }

  return { valid: true, error: '', wildcards, exact: wildcards === 0, unknownBySeat };
}

/**
 * Fill every wildcard in a spec with a distinct unused card, drawn with
 * the supplied RNG. Returns a fully specified 52-character deck URL.
 */
export function resolveBoardSpec(spec: string, rng: () => number): string {
  const used = new Set<string>();
  for (const ch of spec) {
    if (ch !== WILDCARD) used.add(ch);
  }

  const pool = ALL_LETTERS.split('').filter(ch => !used.has(ch));
  // Fisher-Yates with the seeded RNG so a given seed reproduces exactly.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  let next = 0;
  const out = spec.split('');
  for (let i = 0; i < out.length; i++) {
    if (out[i] === WILDCARD) out[i] = pool[next++];
  }
  return out.join('');
}

/**
 * Build a board spec from one seat's hand. Given up to 12 card letters
 * and a seat, lays them on that seat's stride-4 positions and leaves
 * everything else unknown — the "A___B___C___..." shape.
 */
export function buildSpecFromSeatHand(letters: string, seat: number): string {
  const cards = letters.split('').filter(ch => ch !== WILDCARD && ch.trim() !== '');
  if (cards.length > 12) {
    throw new Error(`A seat holds 12 cards; got ${cards.length}.`);
  }
  const out = new Array(DECK_LENGTH).fill(WILDCARD);
  for (let i = 0; i < cards.length; i++) {
    out[seat + i * 4] = cards[i];
  }
  return out.join('');
}

/** Extract the 12 letters dealt to a seat from a 52-char spec. */
export function seatLetters(spec: string, seat: number): string {
  let out = '';
  for (let i = seat; i < 48; i += 4) out += spec[i];
  return out;
}

/** Extract the 4 kitty letters from a 52-char spec. */
export function kittyLetters(spec: string): string {
  return spec.slice(48, 52);
}

// ── Single-hand simulation ───────────────────────────────────────────

export interface HandOutcome {
  /** Seat that won the bid, or -1 when everyone passed. */
  declarer: number;
  bidAmount: number;
  trumpSuit: string;
  direction: string;
  /** Books won in play (the declarer's kitty book is not included). */
  booksWon: [number, number];
  /** Points each team scored on this hand (scoreHand semantics). */
  teamPoints: [number, number];
  /** Team that whisted, or -1. */
  whistTeam: number;
  /** True when all four passed and the hand would have been redealt. */
  passedOut: boolean;
  bids: { playerId: number; amount: number }[];
}

const PASSED_OUT: HandOutcome = {
  declarer: -1,
  bidAmount: 0,
  trumpSuit: '',
  direction: '',
  booksWon: [0, 0],
  teamPoints: [0, 0],
  whistTeam: -1,
  passedOut: true,
  bids: [],
};

/**
 * Play exactly one hand on a fully specified deck and return the score.
 *
 * A fresh BidWhistGame is used per call, so getTeamScores() afterwards is
 * this hand's points rather than a running total. The deck must contain
 * no wildcards — resolveBoardSpec first — otherwise BidWhistGame fills
 * them with Math.random and the run stops being reproducible or paired.
 */
export function playHand(
  deckUrl: string,
  strategies: (StrategyAST | null)[],
  dealer: number,
): HandOutcome {
  const game = new BidWhistGame();
  game.setDealer(dealer);
  game.dealCards(deckUrl);

  // Bidding
  const bids: { playerId: number; amount: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const gs = game.getGameState();
    if (gs.gameStage !== 'bidding') break;
    const cp = gs.currentPlayer;
    if (cp === null) break;
    const before = game.getBiddingState().bids.length;
    game.setStrategy(strategies[cp]);
    game.processAIBid(cp);
    const after = game.getBiddingState().bids;
    if (after.length > before) {
      const last = after[after.length - 1];
      bids.push({ playerId: last.playerId, amount: last.amount });
    }
  }

  // Everyone passed: bidding restarts, which in a real game means a redeal.
  if (game.getGameState().gameStage === 'bidding') {
    return { ...PASSED_OUT, bids };
  }

  const declarer = game.getDeclarer();
  if (declarer === null) return { ...PASSED_OUT, bids };
  const bidAmount = game.getCurrentHighBid();

  // Trump selection
  if (game.getGameState().gameStage === 'trumpSelection') {
    game.setStrategy(strategies[declarer]);
    game.processAITrumpSelection(declarer);
  }
  const trumpSuit = game.getTrumpSuit() ?? '';
  const direction = game.getBidDirection();

  // Kitty discard (setTrumpSuit auto-discards for non-South declarers)
  if (game.getGameState().gameStage === 'discarding') {
    game.setStrategy(strategies[declarer]);
    game.simulateAutoDiscard(declarer);
  }

  // Play out the 12 tricks. scoreHand() fires on the last one.
  for (let trick = 0; trick < 12; trick++) {
    for (let c = 0; c < 4; c++) {
      const gs = game.getGameState();
      if (gs.gameStage !== 'play') break;
      const cp = gs.currentPlayer;
      if (cp === null) break;
      game.setStrategy(strategies[cp]);
      const move = game.getBestMove(cp);
      if (!move) break;
      game.playCard(cp, move);
    }
  }

  const booksWon = game.getBooksWon();
  const teamPoints = game.getTeamScores();

  return {
    declarer,
    bidAmount,
    trumpSuit,
    direction,
    booksWon: [booksWon[0], booksWon[1]],
    teamPoints: [teamPoints[0], teamPoints[1]],
    whistTeam: game.getWhistingWinner(),
    passedOut: false,
    bids,
  };
}

/**
 * Net hand points from one team's point of view. A whisting substitutes
 * the game-winning payoff, since scoreHand() books no points for it.
 */
export function payoffForTeam(outcome: HandOutcome, team: number): number {
  if (outcome.whistTeam >= 0) {
    return outcome.whistTeam === team ? WHISTING_PAYOFF : -WHISTING_PAYOFF;
  }
  return outcome.teamPoints[team] - outcome.teamPoints[1 - team];
}

/** Books margin from one team's point of view, kitty book included. */
export function booksMarginForTeam(outcome: HandOutcome, team: number): number {
  if (outcome.passedOut) return 0;
  const declarerTeam = outcome.declarer % 2;
  const b0 = outcome.booksWon[0] + (declarerTeam === 0 ? 1 : 0);
  const b1 = outcome.booksWon[1] + (declarerTeam === 1 ? 1 : 0);
  return team === 0 ? b0 - b1 : b1 - b0;
}

// ── Console quieting ─────────────────────────────────────────────────

/**
 * Prefixes the engine emits once per deal, per trick, or per rule
 * evaluation. Fine when you are watching one hand; ruinous at batch
 * scale — a browser console call costs far more than the hand itself, and
 * a 13k-hand run emits well over a hundred thousand of them.
 */
const SIMULATION_NOISE = ['[Strategy]', 'Bid Whist dealing deck', 'Trick ended, winner'];

/**
 * Run `fn` with the engine's per-hand chatter suppressed, restoring the
 * console and the strategy debug flag afterwards even if it throws.
 *
 * Only the known noise prefixes are dropped — anything else a component
 * logs while the run is yielding still reaches the console.
 */
let quietDepth = 0;

export async function withQuietSimulation<T>(fn: () => Promise<T>): Promise<T> {
  const priorLog = console.log;
  console.log = (...args: unknown[]) => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (SIMULATION_NOISE.some(n => first.startsWith(n))) return;
    priorLog(...args);
  };
  quietDepth++;
  setStrategyDebug(false);
  try {
    return await fn();
  } finally {
    console.log = priorLog;
    // Only the outermost call re-enables debug, so a nested run (a search
    // confirming a finalist, say) doesn't turn the chatter back on for the
    // rest of the enclosing one.
    quietDepth--;
    if (quietDepth === 0) setStrategyDebug(true);
  }
}

// ── Strategy loading ─────────────────────────────────────────────────

/**
 * Parse a strategy and reject one that would silently do nothing.
 *
 * parseStrategy is lenient: hand it prose and it returns an AST with no
 * sections rather than throwing. BidWhistGame then finds no rule to fire
 * and falls back to its built-in AI, so the run would quietly report the
 * default AI's results under the challenger's name. Catching it here is
 * the difference between "your strategy lost" and "your strategy was
 * never used".
 */
export function loadStrategy(text: string): { ast: StrategyAST | null; error: string } {
  let ast: StrategyAST;
  try {
    ast = parseStrategy(text);
  } catch (e) {
    return { ast: null, error: e instanceof Error ? e.message : String(e) };
  }
  if (!ast.play && !ast.bid && !ast.trump && !ast.discard) {
    return {
      ast: null,
      error: 'No play, bid, trump or discard section parsed — the game would fall back to its built-in AI.',
    };
  }
  return { ast, error: '' };
}

// ── Dominance run ────────────────────────────────────────────────────

export type DeviationScope = 'seat' | 'team';

export interface DominanceConfig {
  boardSpec: string;
  champion: StrategyConfig;
  challengers: StrategyConfig[];
  /** Swap a single seat, or both seats of the deviating team. */
  deviation: DeviationScope;
  /** The deviating seat. Its team (seat % 2) collects the payoff. */
  seat: number;
  /** Dealer positions to test. Rotating the dealer varies who bids first. */
  dealers: number[];
  /** Monte Carlo fills of the unknown cards. Forced to 1 on an exact board. */
  fills: number;
  seed: number;
}

export interface TrialOutcome {
  fill: number;
  dealer: number;
  deckUrl: string;
  baseline: HandOutcome;
  deviated: HandOutcome;
  basePayoff: number;
  devPayoff: number;
  delta: number;
  baseBooks: number;
  devBooks: number;
}

export interface ChallengerReport {
  name: string;
  parseError: string;
  trials: TrialOutcome[];
  meanDelta: number;
  /** 95% half-width on meanDelta. 0 when the board is exact. */
  ci95: number;
  /** meanDelta - ci95; > 0 means a significant refutation. */
  lowerBound: number;
  wins: number;
  ties: number;
  losses: number;
  /** Largest positive delta, for jumping straight to the refuting deal. */
  bestTrial: TrialOutcome | null;
  /** Deviating profits on at least one trial. */
  beatsOnSome: boolean;
  /** Deviating profits overall, significantly. */
  refutes: boolean;
}

export type DominanceVerdict = 'dominant' | 'contested' | 'refuted' | 'error';

export interface DominanceReport {
  config: DominanceConfig;
  /** True when the board spec had no wildcards: results are exact. */
  exact: boolean;
  /** Seats that were swapped to the challenger. */
  deviatingSeats: number[];
  deviatingTeam: number;
  championParseError: string;
  /** Champion-vs-champion parity row; every delta must be exactly 0. */
  parity: ChallengerReport | null;
  challengers: ChallengerReport[];
  verdict: DominanceVerdict;
  trialsPerChallenger: number;
}

/** Which seats the challenger occupies under the chosen deviation scope. */
export function deviatingSeatsFor(seat: number, scope: DeviationScope): number[] {
  return scope === 'team' ? [seat, (seat + 2) % 4] : [seat];
}

function summarize(
  name: string,
  trials: TrialOutcome[],
  exact: boolean,
  parseError = '',
): ChallengerReport {
  const n = trials.length;
  const deltas = trials.map(t => t.delta);
  const meanDelta = n > 0 ? deltas.reduce((a, b) => a + b, 0) / n : 0;

  // On an exact board the dealer sweep is the complete population, not a
  // sample, so a confidence interval would be meaningless — the deltas
  // are the answer.
  let ci95 = 0;
  if (!exact && n > 1) {
    const variance = deltas.reduce((a, d) => a + (d - meanDelta) ** 2, 0) / (n - 1);
    ci95 = 1.96 * Math.sqrt(variance / n);
  }

  let wins = 0, ties = 0, losses = 0;
  let bestTrial: TrialOutcome | null = null;
  for (const t of trials) {
    if (t.delta > 0) {
      wins++;
      if (!bestTrial || t.delta > bestTrial.delta) bestTrial = t;
    } else if (t.delta < 0) losses++;
    else ties++;
  }

  const lowerBound = meanDelta - ci95;
  return {
    name,
    parseError,
    trials,
    meanDelta,
    ci95,
    lowerBound,
    wins,
    ties,
    losses,
    bestTrial,
    beatsOnSome: wins > 0,
    refutes: exact ? meanDelta > 0 : lowerBound > 0,
  };
}

/**
 * Run the dominance check. Baselines are computed once per (fill, dealer)
 * and shared across every challenger, so N challengers cost N+1 hands per
 * trial rather than 2N.
 */
export async function runDominanceCheck(
  config: DominanceConfig,
  onProgress?: (completed: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<DominanceReport> {
  return withQuietSimulation(() => runDominanceCheckLoud(config, onProgress, shouldAbort));
}

/** runDominanceCheck without the console quieting, for callers that manage it. */
async function runDominanceCheckLoud(
  config: DominanceConfig,
  onProgress?: (completed: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<DominanceReport> {
  const info = analyzeBoardSpec(config.boardSpec);
  const exact = info.exact;
  const fills = exact ? 1 : Math.max(1, config.fills);
  const dealers = config.dealers.length > 0 ? config.dealers : [0];
  const deviatingSeats = deviatingSeatsFor(config.seat, config.deviation);
  const deviatingTeam = config.seat % 2;

  const loadedChampion = loadStrategy(config.champion.strategyText);
  const championAst = loadedChampion.ast;
  const championParseError = loadedChampion.error;

  const base: DominanceReport = {
    config,
    exact,
    deviatingSeats,
    deviatingTeam,
    championParseError,
    parity: null,
    challengers: [],
    verdict: 'error',
    trialsPerChallenger: fills * dealers.length,
  };

  if (!info.valid) return { ...base, championParseError: info.error };
  if (championParseError) return base;

  // Parse every challenger up front; a broken one gets an empty report
  // rather than aborting the run.
  const parsed = config.challengers.map(c => {
    const loaded = loadStrategy(c.strategyText);
    return { name: c.name, ast: loaded.ast, error: loaded.error };
  });

  // The champion is always run against itself as a parity check. Every
  // delta must be exactly 0; anything else means a nondeterminism leaked
  // into the simulation and the whole report is untrustworthy.
  const runnable = [{ name: `${config.champion.name} (parity)`, ast: championAst, error: '' }, ...parsed.filter(p => p.ast)];

  const trialsByName = new Map<string, TrialOutcome[]>();
  for (const r of runnable) trialsByName.set(r.name, []);

  const rng = makeRng(config.seed);
  const total = fills * dealers.length;
  let completed = 0;

  for (let fill = 0; fill < fills; fill++) {
    // One resolution per fill, shared by every dealer and challenger.
    const deckUrl = exact ? config.boardSpec : resolveBoardSpec(config.boardSpec, rng);

    for (const dealer of dealers) {
      if (shouldAbort && shouldAbort()) break;

      const baselineSeats: (StrategyAST | null)[] = [championAst, championAst, championAst, championAst];
      const baseline = playHand(deckUrl, baselineSeats, dealer);
      const basePayoff = payoffForTeam(baseline, deviatingTeam);
      const baseBooks = booksMarginForTeam(baseline, deviatingTeam);

      for (const r of runnable) {
        const seats: (StrategyAST | null)[] = [championAst, championAst, championAst, championAst];
        for (const s of deviatingSeats) seats[s] = r.ast;
        const deviated = playHand(deckUrl, seats, dealer);
        const devPayoff = payoffForTeam(deviated, deviatingTeam);
        trialsByName.get(r.name)!.push({
          fill,
          dealer,
          deckUrl,
          baseline,
          deviated,
          basePayoff,
          devPayoff,
          delta: devPayoff - basePayoff,
          baseBooks,
          devBooks: booksMarginForTeam(deviated, deviatingTeam),
        });
      }

      completed++;
      if (onProgress) onProgress(completed, total);
      // Yield so the browser stays responsive during long fill sweeps.
      if (completed % 8 === 0) await new Promise(res => setTimeout(res, 0));
    }
  }

  const parity = summarize(runnable[0].name, trialsByName.get(runnable[0].name)!, exact);
  const challengers: ChallengerReport[] = parsed.map(p =>
    p.ast
      ? summarize(p.name, trialsByName.get(p.name) ?? [], exact)
      : summarize(p.name, [], exact, p.error),
  );
  challengers.sort((a, b) => b.meanDelta - a.meanDelta);

  const verdict: DominanceVerdict = challengers.some(c => c.refutes)
    ? 'refuted'
    : challengers.some(c => c.meanDelta > 0 || c.beatsOnSome)
      ? 'contested'
      : 'dominant';

  return { ...base, parity, challengers, verdict };
}
