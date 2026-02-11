import React, { useState, useMemo } from 'react';
import { StrategyComparisonResult, GameResult, HandResult } from '../simulation/types.ts';
import { BidWhistSimulator } from '../simulation/BidWhistSimulator.ts';
import { computeAllHandStrengths } from '../simulation/handStrength.ts';

interface ComparisonResultsProps {
  result: StrategyComparisonResult;
}

// ── Constants ────────────────────────────────────────────────────────

const PLAYER_LABELS = ['S', 'E', 'N', 'W'];

const SUIT_SYMBOLS: { [key: string]: string } = {
  spades: '\u2660',
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
};

const SUIT_COLORS: { [key: string]: string } = {
  spades: '#a0aec0',
  hearts: '#f56565',
  diamonds: '#f6ad55',
  clubs: '#68d391',
};

const DIRECTION_LABELS: { [key: string]: string } = {
  'uptown': 'Uptown \u2191',
  'downtown': 'Downtown \u2193 (Aces Good)',
  'downtown-noaces': 'Downtown \u2193 (No Aces)',
};

// ── Helpers ──────────────────────────────────────────────────────────

function formatCall(hand: HandResult): React.ReactNode {
  if (!hand.trumpSuit) return '\u2014';
  const symbol = SUIT_SYMBOLS[hand.trumpSuit] || '?';
  const color = SUIT_COLORS[hand.trumpSuit] || '#e5e7eb';
  const arrow = hand.direction === 'uptown' ? '\u2191' : '\u2193';
  let acesLabel = '';
  if (hand.direction === 'downtown') acesLabel = ' A+';
  else if (hand.direction === 'downtown-noaces') acesLabel = ' No A';

  return (
    <span>
      <span style={{ fontWeight: 'bold' }}>{hand.bidAmount}</span>
      {' '}
      {arrow}
      <span style={{ color, fontWeight: 'bold' }}>{symbol}</span>
      {acesLabel && <span style={{ fontSize: '11px', opacity: 0.8 }}>{acesLabel}</span>}
    </span>
  );
}

function formatBidder(hand: HandResult): string {
  if (hand.bidWinner < 0) return '\u2014';
  return PLAYER_LABELS[hand.bidWinner] || '?';
}

function madeContract(hand: HandResult): boolean | null {
  if (hand.bidWinner < 0 || !hand.bidAmount) return null;
  const declarerTeam = hand.bidWinner % 2;
  const declarerBooks = hand.booksWon[declarerTeam] + 1;
  return declarerBooks >= hand.bidAmount + 6;
}

function formatMadeIt(hand: HandResult | undefined): React.ReactNode {
  if (!hand) return '\u2014';
  const made = madeContract(hand);
  if (made === null) return '\u2014';
  return made
    ? <span style={{ color: '#68d391' }}>{'\u2713'}</span>
    : <span style={{ color: '#f56565' }}>{'\u2717'}</span>;
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '\u2014';
  return ((num / denom) * 100).toFixed(1) + '%';
}

function suitLabel(suit: string): React.ReactNode {
  const symbol = SUIT_SYMBOLS[suit];
  const color = SUIT_COLORS[suit];
  if (!symbol) return suit;
  return (
    <span>
      <span style={{ color, fontWeight: 'bold', fontSize: '15px' }}>{symbol}</span>
      {' '}
      {suit.charAt(0).toUpperCase() + suit.slice(1)}
    </span>
  );
}

// ── Hand Preview Helpers ─────────────────────────────────────────────

const RANK_LABELS: { [r: number]: string } = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};

function letterToSuitRank(ch: string): { suit: string; rank: number } | null {
  if (ch >= 'a' && ch <= 'm') return { suit: 'hearts', rank: ch.charCodeAt(0) - 96 };
  if (ch >= 'n' && ch <= 'z') return { suit: 'spades', rank: ch.charCodeAt(0) - 109 };
  if (ch >= 'A' && ch <= 'M') return { suit: 'clubs', rank: ch.charCodeAt(0) - 64 };
  if (ch >= 'N' && ch <= 'Z') return { suit: 'diamonds', rank: ch.charCodeAt(0) - 77 };
  return null;
}

/** Extract player p's 12-card hand from a (rotated) 52-char deck URL */
function extractPlayerHand(deckUrl: string, player: number): { suit: string; rank: number }[] {
  const cards: { suit: string; rank: number }[] = [];
  for (let i = player; i < 48; i += 4) {
    const c = letterToSuitRank(deckUrl[i]);
    if (c) cards.push(c);
  }
  return cards;
}

/** Render a hand as JSX with colored suit symbols, sorted C/D/H/S */
function renderColoredHand(cards: { suit: string; rank: number }[]): React.ReactNode {
  const suitOrder = ['clubs', 'diamonds', 'hearts', 'spades'];
  const sorted = [...cards].sort((a, b) => {
    const si = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    if (si !== 0) return si;
    return a.rank - b.rank;
  });
  return sorted.map((c, i) => (
    <React.Fragment key={i}>
      {RANK_LABELS[c.rank] ?? c.rank}
      <span style={{ color: SUIT_COLORS[c.suit], fontWeight: 'bold' }}>{SUIT_SYMBOLS[c.suit]}</span>
    </React.Fragment>
  ));
}

/** CSS-only tooltip wrapper that shows a player's colored hand on hover */
function HandTip({ children, label, deckUrl, player }: {
  children: React.ReactNode;
  label: string;
  deckUrl: string;
  player: number;
}): React.ReactElement {
  const cards = extractPlayerHand(deckUrl, player);
  return (
    <span className="hand-tip">
      {children}
      <span className="hand-tip-content">
        <strong>{label}:&nbsp;</strong>
        {renderColoredHand(cards)}
      </span>
    </span>
  );
}

/** Team advantage: |mean(S,N) - mean(E,W)| for a 4-player strength tuple */
function teamAdvantage(s: [number, number, number, number]): number {
  const snAvg = (s[0] + s[2]) / 2;
  const ewAvg = (s[1] + s[3]) / 2;
  return Math.abs(snAvg - ewAvg);
}

function strengthColor(value: number): string {
  if (value >= 7.0) return '#68d391';
  if (value >= 5.5) return '#9ae6b4';
  if (value >= 4.0) return '#faf089';
  if (value >= 2.5) return '#f6ad55';
  return '#f56565';
}

/** Subtle green background on the better of two percentages */
function betterBg(
  a: number, aDenom: number,
  b: number, bDenom: number
): React.CSSProperties {
  if (aDenom === 0 || bDenom === 0) return {};
  if (a / aDenom > b / bDenom + 0.005) return { backgroundColor: 'rgba(34, 197, 94, 0.15)' };
  return {};
}

// ── Stats Computation (by-team, 2 strategies) ────────────────────────

interface BidLevelData {
  total: number;
  decl: [number, number];
  made: [number, number];
  def: [number, number];
  set: [number, number];
}

interface CategoryData {
  total: number;
  madeTotal: number;
  decl: [number, number];
  made: [number, number];
}

interface OverallData {
  declared: number;
  made: number;
  defended: number;
  setOpp: number;
  bidSum: number;
}

interface StatsData {
  totalHands: number;
  bidLevels: { level: number; data: BidLevelData }[];
  directions: { key: string; data: CategoryData }[];
  trumpSuits: { key: string; data: CategoryData }[];
  overall: [OverallData, OverallData];
}

function computeStats(result: StrategyComparisonResult): StatsData {
  const bidMap: { [level: number]: BidLevelData } = {};
  const dirMap: { [dir: string]: CategoryData } = {};
  const suitMap: { [suit: string]: CategoryData } = {};
  const overall: [OverallData, OverallData] = [
    { declared: 0, made: 0, defended: 0, setOpp: 0, bidSum: 0 },
    { declared: 0, made: 0, defended: 0, setOpp: 0, bidSum: 0 },
  ];
  let totalHands = 0;

  for (const game of result.results) {
    for (const hand of game.hands) {
      if (hand.bidWinner < 0 || !hand.bidAmount) continue;

      totalHands++;
      const declarerTeam = hand.bidWinner % 2;
      const defenderTeam = 1 - declarerTeam;
      // Map team → strategy index based on config assignment
      const declIdx = game.configIndex === declarerTeam ? 0 : 1;
      const defIdx = game.configIndex === defenderTeam ? 0 : 1;

      const declarerBooks = hand.booksWon[declarerTeam] + 1;
      const made = declarerBooks >= hand.bidAmount + 6;

      // Bid level
      const lvl = hand.bidAmount;
      if (!bidMap[lvl]) {
        bidMap[lvl] = { total: 0, decl: [0, 0], made: [0, 0], def: [0, 0], set: [0, 0] };
      }
      const bl = bidMap[lvl];
      bl.total++;
      bl.decl[declIdx]++;
      if (made) bl.made[declIdx]++;
      bl.def[defIdx]++;
      if (!made) bl.set[defIdx]++;

      // Direction
      const dir = hand.direction || 'unknown';
      if (!dirMap[dir]) {
        dirMap[dir] = { total: 0, madeTotal: 0, decl: [0, 0], made: [0, 0] };
      }
      const dm = dirMap[dir];
      dm.total++;
      if (made) dm.madeTotal++;
      dm.decl[declIdx]++;
      if (made) dm.made[declIdx]++;

      // Trump suit
      const suit = hand.trumpSuit || 'unknown';
      if (!suitMap[suit]) {
        suitMap[suit] = { total: 0, madeTotal: 0, decl: [0, 0], made: [0, 0] };
      }
      const sm = suitMap[suit];
      sm.total++;
      if (made) sm.madeTotal++;
      sm.decl[declIdx]++;
      if (made) sm.made[declIdx]++;

      // Overall per strategy
      overall[declIdx].declared++;
      overall[declIdx].bidSum += lvl;
      if (made) overall[declIdx].made++;
      overall[defIdx].defended++;
      if (!made) overall[defIdx].setOpp++;
    }
  }

  const bidLevels = Object.keys(bidMap)
    .map(Number)
    .sort((a, b) => a - b)
    .map(level => ({ level, data: bidMap[level] }));

  const dirOrder = ['uptown', 'downtown', 'downtown-noaces'];
  const directions = dirOrder
    .filter(k => dirMap[k])
    .map(key => ({ key, data: dirMap[key] }));
  // Add any unlisted direction keys
  for (const key of Object.keys(dirMap)) {
    if (!dirOrder.includes(key)) directions.push({ key, data: dirMap[key] });
  }

  const suitOrder = ['spades', 'hearts', 'diamonds', 'clubs'];
  const trumpSuits = suitOrder
    .filter(k => suitMap[k])
    .map(key => ({ key, data: suitMap[key] }));
  for (const key of Object.keys(suitMap)) {
    if (!suitOrder.includes(key)) trumpSuits.push({ key, data: suitMap[key] });
  }

  return { totalHands, bidLevels, directions, trumpSuits, overall };
}

// ── Stats Computation (round-robin, N strategies) ────────────────────

interface RROverallData {
  declared: number;
  made: number;
  defended: number;
  setOpp: number;
  bidSum: number;
}

interface RRBidLevelData {
  total: number;
  decl: number[];
  made: number[];
  def: number[];
  set: number[];
}

interface RRCategoryData {
  total: number;
  madeTotal: number;
  decl: number[];
  made: number[];
}

interface RRStatsData {
  totalHands: number;
  bidLevels: { level: number; data: RRBidLevelData }[];
  directions: { key: string; data: RRCategoryData }[];
  trumpSuits: { key: string; data: RRCategoryData }[];
  overall: RROverallData[];
}

function computeRRStats(result: StrategyComparisonResult): RRStatsData {
  const N = result.config.strategies.length;
  const bidMap: { [level: number]: RRBidLevelData } = {};
  const dirMap: { [dir: string]: RRCategoryData } = {};
  const suitMap: { [suit: string]: RRCategoryData } = {};
  const overall: RROverallData[] = Array.from({ length: N }, () => ({
    declared: 0, made: 0, defended: 0, setOpp: 0, bidSum: 0,
  }));
  let totalHands = 0;

  const zeros = () => new Array(N).fill(0);

  for (const game of result.results) {
    for (const hand of game.hands) {
      if (hand.bidWinner < 0 || !hand.bidAmount) continue;

      totalHands++;
      const declarerTeam = hand.bidWinner % 2;
      const defenderTeam = 1 - declarerTeam;
      const declStratIdx = declarerTeam === 0 ? game.team0StrategyIndex : game.team1StrategyIndex;
      const defStratIdx = defenderTeam === 0 ? game.team0StrategyIndex : game.team1StrategyIndex;

      const declarerBooks = hand.booksWon[declarerTeam] + 1;
      const made = declarerBooks >= hand.bidAmount + 6;

      const lvl = hand.bidAmount;
      if (!bidMap[lvl]) {
        bidMap[lvl] = { total: 0, decl: zeros(), made: zeros(), def: zeros(), set: zeros() };
      }
      const bl = bidMap[lvl];
      bl.total++;
      bl.decl[declStratIdx]++;
      if (made) bl.made[declStratIdx]++;
      bl.def[defStratIdx]++;
      if (!made) bl.set[defStratIdx]++;

      const dir = hand.direction || 'unknown';
      if (!dirMap[dir]) {
        dirMap[dir] = { total: 0, madeTotal: 0, decl: zeros(), made: zeros() };
      }
      const dm = dirMap[dir];
      dm.total++;
      if (made) dm.madeTotal++;
      dm.decl[declStratIdx]++;
      if (made) dm.made[declStratIdx]++;

      const suit = hand.trumpSuit || 'unknown';
      if (!suitMap[suit]) {
        suitMap[suit] = { total: 0, madeTotal: 0, decl: zeros(), made: zeros() };
      }
      const sm = suitMap[suit];
      sm.total++;
      if (made) sm.madeTotal++;
      sm.decl[declStratIdx]++;
      if (made) sm.made[declStratIdx]++;

      overall[declStratIdx].declared++;
      overall[declStratIdx].bidSum += lvl;
      if (made) overall[declStratIdx].made++;
      overall[defStratIdx].defended++;
      if (!made) overall[defStratIdx].setOpp++;
    }
  }

  const bidLevels = Object.keys(bidMap)
    .map(Number)
    .sort((a, b) => a - b)
    .map(level => ({ level, data: bidMap[level] }));

  const dirOrder = ['uptown', 'downtown', 'downtown-noaces'];
  const directions = dirOrder
    .filter(k => dirMap[k])
    .map(key => ({ key, data: dirMap[key] }));
  for (const key of Object.keys(dirMap)) {
    if (!dirOrder.includes(key)) directions.push({ key, data: dirMap[key] });
  }

  const suitOrder = ['spades', 'hearts', 'diamonds', 'clubs'];
  const trumpSuits = suitOrder
    .filter(k => suitMap[k])
    .map(key => ({ key, data: suitMap[key] }));
  for (const key of Object.keys(suitMap)) {
    if (!suitOrder.includes(key)) trumpSuits.push({ key, data: suitMap[key] });
  }

  return { totalHands, bidLevels, directions, trumpSuits, overall };
}

// ── Bid Analysis Computation ─────────────────────────────────────────

interface BidAnalysisHand {
  deckUrl: string;
  rotation: number;
  totalResults: number;
  madeCount: number;
  setCount: number;
  classification: 'always-set' | 'always-made' | 'mixed';
  sampleHand: HandResult;
  maxDeclarerBooks: number;
  minDeclarerBooks: number;
  avgDeclarerBooks: number;
}

interface BidAnalysisShutout {
  deckUrl: string;
  rotation: number;
  hand: HandResult;
  declarerBooks: number;
  defenderBooks: number;
  team0StrategyIndex: number;
  team1StrategyIndex: number;
}

interface BidAnalysisData {
  alwaysSet: BidAnalysisHand[];
  alwaysMade: BidAnalysisHand[];
  shutouts: BidAnalysisShutout[];
  totalDeckRotations: number;
  analyzedDeckRotations: number;
}

function computeBidAnalysis(result: StrategyComparisonResult): BidAnalysisData {
  // Group results by deck/rotation
  const groups = new Map<string, GameResult[]>();
  for (const game of result.results) {
    const key = `${game.deckUrl}|${game.rotation}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(game);
  }

  const alwaysSet: BidAnalysisHand[] = [];
  const alwaysMade: BidAnalysisHand[] = [];
  const allShutouts: BidAnalysisShutout[] = [];

  let analyzedDeckRotations = 0;

  for (const [, games] of groups) {
    // Look at first hand of each game in this group
    const validGames: { game: GameResult; hand: HandResult; declarerBooks: number; made: boolean }[] = [];
    for (const game of games) {
      const hand = game.hands[0];
      if (!hand || hand.bidWinner < 0 || !hand.bidAmount) continue;
      const declarerTeam = hand.bidWinner % 2;
      const declarerBooks = hand.booksWon[declarerTeam] + 1;
      const made = declarerBooks >= hand.bidAmount + 6;
      validGames.push({ game, hand, declarerBooks, made });
    }

    if (validGames.length === 0) continue;
    analyzedDeckRotations++;

    const madeCount = validGames.filter(v => v.made).length;
    const setCount = validGames.length - madeCount;
    const books = validGames.map(v => v.declarerBooks);
    const maxBooks = Math.max(...books);
    const minBooks = Math.min(...books);
    const avgBooks = books.reduce((a, b) => a + b, 0) / books.length;

    const classification: BidAnalysisHand['classification'] =
      setCount === validGames.length ? 'always-set' :
      madeCount === validGames.length ? 'always-made' : 'mixed';

    const entry: BidAnalysisHand = {
      deckUrl: validGames[0].game.deckUrl,
      rotation: validGames[0].game.rotation,
      totalResults: validGames.length,
      madeCount,
      setCount,
      classification,
      sampleHand: validGames[0].hand,
      maxDeclarerBooks: maxBooks,
      minDeclarerBooks: minBooks,
      avgDeclarerBooks: avgBooks,
    };

    if (classification === 'always-set') alwaysSet.push(entry);
    else if (classification === 'always-made') alwaysMade.push(entry);

    // Collect shutout candidates from all valid games
    for (const v of validGames) {
      const defenderBooks = 13 - v.declarerBooks;
      const dominance = Math.max(v.declarerBooks, defenderBooks);
      if (dominance >= 10) {
        allShutouts.push({
          deckUrl: v.game.deckUrl,
          rotation: v.game.rotation,
          hand: v.hand,
          declarerBooks: v.declarerBooks,
          defenderBooks,
          team0StrategyIndex: v.game.team0StrategyIndex,
          team1StrategyIndex: v.game.team1StrategyIndex,
        });
      }
    }
  }

  // Sort traps/locks by totalResults descending (higher confidence first)
  alwaysSet.sort((a, b) => b.totalResults - a.totalResults);
  alwaysMade.sort((a, b) => b.totalResults - a.totalResults);

  // Sort shutouts by dominance (most extreme first), take top 50
  allShutouts.sort((a, b) => {
    const domA = Math.max(a.declarerBooks, a.defenderBooks);
    const domB = Math.max(b.declarerBooks, b.defenderBooks);
    if (domB !== domA) return domB - domA;
    return Math.min(a.declarerBooks, a.defenderBooks) - Math.min(b.declarerBooks, b.defenderBooks);
  });
  const shutouts = allShutouts.slice(0, 50);

  return {
    alwaysSet,
    alwaysMade,
    shutouts,
    totalDeckRotations: groups.size,
    analyzedDeckRotations,
  };
}

// ── Filtered Hand Computation ────────────────────────────────────────

interface FilteredHandEntry {
  game: GameResult;
  hand: HandResult;
  handIndex: number;
  declarerTeam: number;
  defenderTeam: number;
  declStratIdx: number;
  defStratIdx: number;
  made: boolean;
}

function computeFilteredHands(
  result: StrategyComparisonResult,
  filter: HandFilter,
): FilteredHandEntry[] {
  const isRR = result.config.assignmentMode === 'round-robin';
  const entries: FilteredHandEntry[] = [];

  for (const game of result.results) {
    for (let hi = 0; hi < game.hands.length; hi++) {
      const hand = game.hands[hi];
      if (hand.bidWinner < 0 || !hand.bidAmount) continue;

      const declarerTeam = hand.bidWinner % 2;
      const defenderTeam = 1 - declarerTeam;

      let declStratIdx: number;
      let defStratIdx: number;
      if (isRR) {
        declStratIdx = declarerTeam === 0 ? game.team0StrategyIndex : game.team1StrategyIndex;
        defStratIdx = defenderTeam === 0 ? game.team0StrategyIndex : game.team1StrategyIndex;
      } else {
        declStratIdx = game.configIndex === declarerTeam ? 0 : 1;
        defStratIdx = game.configIndex === defenderTeam ? 0 : 1;
      }

      const declarerBooks = hand.booksWon[declarerTeam] + 1;
      const made = declarerBooks >= hand.bidAmount + 6;

      // Check filter criteria
      if (filter.bidLevel !== undefined && hand.bidAmount !== filter.bidLevel) continue;
      if (filter.direction !== undefined && hand.direction !== filter.direction) continue;
      if (filter.trumpSuit !== undefined && hand.trumpSuit !== filter.trumpSuit) continue;

      // Role + strategy check
      if (filter.role === 'declaring') {
        if (filter.strategyIndex !== undefined && declStratIdx !== filter.strategyIndex) continue;
        if (filter.outcome === 'made' && !made) continue;
        if (filter.outcome === 'set' && made) continue;
      } else if (filter.role === 'defending') {
        if (filter.strategyIndex !== undefined && defStratIdx !== filter.strategyIndex) continue;
        if (filter.outcome === 'set' && made) continue;  // "set" means defender set the declarer (declarer didn't make)
        if (filter.outcome === 'made' && !made) continue; // shouldn't normally happen for defending, but handle it
      } else {
        // role === 'any'
        if (filter.outcome === 'made' && !made) continue;
        if (filter.outcome === 'set' && made) continue;
      }

      entries.push({ game, hand, handIndex: hi, declarerTeam, defenderTeam, declStratIdx, defStratIdx, made });
    }
  }

  return entries;
}

// ── Styles ───────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontSize: '13px',
};
const tdStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: '13px',
};

const sThStyle: React.CSSProperties = {
  padding: '5px 8px', textAlign: 'right', fontSize: '12px', fontWeight: 'bold',
  borderBottom: '2px solid #374151', whiteSpace: 'nowrap',
};
const sThLeftStyle: React.CSSProperties = { ...sThStyle, textAlign: 'left' };
const sTdStyle: React.CSSProperties = {
  padding: '4px 8px', textAlign: 'right', fontSize: '12px',
  borderBottom: '1px solid #374151',
};
const sTdLeftStyle: React.CSSProperties = { ...sTdStyle, textAlign: 'left' };

const boxStyle: React.CSSProperties = {
  backgroundColor: '#162b1e',
  padding: '16px',
  borderRadius: '8px',
  marginBottom: '16px',
};

// ── Hand Filter ──────────────────────────────────────────────────────

interface HandFilter {
  label: string;
  strategyIndex?: number;
  role: 'declaring' | 'defending' | 'any';
  outcome?: 'made' | 'set';
  bidLevel?: number;
  direction?: string;
  trumpSuit?: string;
}

// ── Tab types ────────────────────────────────────────────────────────

type TabId = 'results' | 'interesting' | 'stats' | 'bidAnalysis' | 'handStrength' | 'filtered';

// ── Component ────────────────────────────────────────────────────────

const ComparisonResults: React.FC<ComparisonResultsProps> = ({ result }) => {
  const [activeTab, setActiveTab] = useState<TabId>('results');
  const [expandedGames, setExpandedGames] = useState<Set<number>>(() => new Set());

  const { config, summary, interestingGames } = result;
  const isRR = config.assignmentMode === 'round-robin';
  const strategyNames = config.strategies.map(s => s.name);
  const nameA = strategyNames[0] || 'Strategy A';
  const nameB = strategyNames[1] || 'Strategy B';

  const stats = useMemo(() => computeStats(result), [result]);
  const rrStats = useMemo(() => isRR ? computeRRStats(result) : null, [result, isRR]);
  const handStrengths = useMemo(() => isRR ? [] : computeAllHandStrengths(interestingGames), [interestingGames, isRR]);
  const bidAnalysis = useMemo(() => computeBidAnalysis(result), [result]);

  type HsSortKey = 'id' | 'preBidAdv' | 'postAdv'
    | 'preBidS' | 'preBidE' | 'preBidN' | 'preBidW'
    | 'postS' | 'postE' | 'postN' | 'postW';
  const [handFilter, setHandFilter] = useState<HandFilter | null>(null);

  const showFiltered = (filter: HandFilter) => {
    setHandFilter(filter);
    setActiveTab('filtered');
  };

  const [hsSortKey, setHsSortKey] = useState<HsSortKey>('id');
  const [hsSortAsc, setHsSortAsc] = useState<boolean>(true);

  const toggleHsSort = (key: HsSortKey) => {
    if (hsSortKey === key) {
      setHsSortAsc(!hsSortAsc);
    } else {
      setHsSortKey(key);
      setHsSortAsc(true);
    }
  };

  const hsSortedIndices = useMemo(() => {
    const indices = handStrengths.map((_, i) => i);
    const dir = hsSortAsc ? 1 : -1;
    indices.sort((a, b) => {
      let va: number, vb: number;
      switch (hsSortKey) {
        case 'preBidAdv':
          va = teamAdvantage(handStrengths[a].preBid);
          vb = teamAdvantage(handStrengths[b].preBid);
          break;
        case 'postAdv':
          va = teamAdvantage(handStrengths[a].postTrumpA);
          vb = teamAdvantage(handStrengths[b].postTrumpA);
          break;
        case 'preBidS': va = handStrengths[a].preBid[0]; vb = handStrengths[b].preBid[0]; break;
        case 'preBidE': va = handStrengths[a].preBid[1]; vb = handStrengths[b].preBid[1]; break;
        case 'preBidN': va = handStrengths[a].preBid[2]; vb = handStrengths[b].preBid[2]; break;
        case 'preBidW': va = handStrengths[a].preBid[3]; vb = handStrengths[b].preBid[3]; break;
        case 'postS': va = handStrengths[a].postTrumpA[0]; vb = handStrengths[b].postTrumpA[0]; break;
        case 'postE': va = handStrengths[a].postTrumpA[1]; vb = handStrengths[b].postTrumpA[1]; break;
        case 'postN': va = handStrengths[a].postTrumpA[2]; vb = handStrengths[b].postTrumpA[2]; break;
        case 'postW': va = handStrengths[a].postTrumpA[3]; vb = handStrengths[b].postTrumpA[3]; break;
        default:
          va = a; vb = b;
      }
      return (va - vb) * dir;
    });
    return indices;
  }, [handStrengths, hsSortKey, hsSortAsc]);

  const toggleExpanded = (idx: number) => {
    setExpandedGames(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const openReplay = (
    rotatedUrl: string,
    t0StratIdx: number,
    t1StratIdx: number,
    dealer: number = 0,
  ) => {
    const t0 = config.strategies[t0StratIdx];
    const t1 = config.strategies[t1StratIdx];
    sessionStorage.setItem('replay-config', JSON.stringify({
      deckUrl: rotatedUrl,
      dealer,
      team0StrategyText: t0?.strategyText ?? '',
      team0StrategyName: t0?.name ?? `Strategy ${t0StratIdx}`,
      team1StrategyText: t1?.strategyText ?? '',
      team1StrategyName: t1?.name ?? `Strategy ${t1StratIdx}`,
    }));
    window.open(`/replay#${rotatedUrl}`, '_blank');
  };

  const tabs: { id: TabId; label: string }[] = [
    ...(isRR
      ? [
          { id: 'results' as TabId, label: 'Results' },
          { id: 'interesting' as TabId, label: `Interesting Games (${interestingGames.length})` },
          { id: 'stats' as TabId, label: 'Stats Overview' },
          { id: 'bidAnalysis' as TabId, label: 'Bid Analysis' },
        ]
      : [
          { id: 'results' as TabId, label: 'Results' },
          { id: 'interesting' as TabId, label: `Interesting Games (${interestingGames.length})` },
          { id: 'stats' as TabId, label: 'Stats Overview' },
          { id: 'bidAnalysis' as TabId, label: 'Bid Analysis' },
          { id: 'handStrength' as TabId, label: 'Hand Strength' },
        ]),
    ...(handFilter
      ? [{ id: 'filtered' as TabId, label: `Filtered: ${handFilter.label}` }]
      : []),
  ];

  return (
    <div style={{ marginTop: '24px' }}>
      <style>{`
        .hand-tip { position: relative; }
        .hand-tip .hand-tip-content {
          display: none;
          position: absolute;
          bottom: calc(100% + 4px);
          left: 50%;
          transform: translateX(-50%);
          background: #1a1a2e;
          border: 1px solid #4b5563;
          border-radius: 4px;
          padding: 3px 7px;
          white-space: nowrap;
          font-size: 13px;
          color: #e5e7eb;
          z-index: 20;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        }
        .hand-tip:hover .hand-tip-content { display: block; }
        .stat-link { cursor: pointer; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px; }
        .stat-link:hover { text-decoration-style: solid; background-color: rgba(96, 165, 250, 0.1); }
      `}</style>
      {/* Tab bar */}
      <div style={{ display: 'flex', marginBottom: '16px' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: activeTab === tab.id ? 'bold' : 'normal',
              color: activeTab === tab.id ? '#fff' : '#9ca3af',
              background: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #22c55e' : '2px solid #374151',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
        {/* Fill remaining space with bottom border */}
        <div style={{ flex: 1, borderBottom: '2px solid #374151' }} />
      </div>

      {/* ── Results tab ─────────────────────────────────────────── */}
      {activeTab === 'results' && !isRR && (
        <div>
          {/* Summary table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #374151' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left' }}>Strategy (Team 0)</th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}>Games Won</th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}>Win Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #4b5563' }}>
                <td style={{ padding: '8px 12px' }}>{nameA}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{summary.winsPerConfig[0]}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  {(summary.winRate[0] * 100).toFixed(1)}%
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #4b5563' }}>
                <td style={{ padding: '8px 12px' }}>{nameB}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{summary.winsPerConfig[1]}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  {(summary.winRate[1] * 100).toFixed(1)}%
                </td>
              </tr>
            </tbody>
          </table>

          {/* Breakdown */}
          <div style={boxStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
              Strategy vs Card Advantage Breakdown
            </h3>
            <p style={{ margin: '4px 0' }}>
              Total simulations: {summary.totalGames}
            </p>
            <p style={{ margin: '4px 0' }}>
              Strategy mattered (winner changed on swap): {summary.strategyMattersCount}{' '}
              ({summary.totalGames > 0 ? ((summary.strategyMattersCount / (summary.totalGames / 2)) * 100).toFixed(1) : 0}% of deck/rotation pairs)
            </p>
            <p style={{ margin: '4px 0' }}>
              Card advantage dominated (same winner both ways): {summary.cardAdvantageDominatedCount}
            </p>
          </div>
        </div>
      )}

      {/* ── Results tab (round-robin) ─────────────────────────── */}
      {activeTab === 'results' && isRR && (
        <div>
          {/* Win Rate table */}
          <div style={boxStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
              Win Rates
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #374151' }}>
                  <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: '13px' }}>Strategy</th>
                  <th style={{ padding: '6px 12px', textAlign: 'right', fontSize: '13px' }}>Games</th>
                  <th style={{ padding: '6px 12px', textAlign: 'right', fontSize: '13px' }}>Wins</th>
                  <th style={{ padding: '6px 12px', textAlign: 'right', fontSize: '13px' }}>Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {strategyNames.map((name, i) => {
                  const wins = summary.strategyWins?.[i] ?? 0;
                  const games = summary.strategyGames?.[i] ?? 0;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #4b5563' }}>
                      <td style={{ padding: '6px 12px', fontSize: '13px' }}>{name}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: '13px' }}>{games}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: '13px' }}>{wins}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 'bold' }}>
                        {pct(wins, games)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Head-to-Head matrix */}
          {summary.headToHead && (
            <div style={boxStyle}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                Head-to-Head Win Rates
              </h3>
              <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
                Cell shows row strategy's win rate vs column strategy
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...sThLeftStyle, minWidth: '120px' }}>vs</th>
                      {strategyNames.map((name, j) => (
                        <th key={j} style={{ ...sThStyle, textAlign: 'center', minWidth: '80px', fontSize: '11px' }}>
                          {name.length > 15 ? name.slice(0, 13) + '..' : name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {strategyNames.map((name, i) => (
                      <tr key={i}>
                        <td style={{ ...sTdLeftStyle, fontWeight: 'bold', fontSize: '11px' }}>
                          {name.length > 20 ? name.slice(0, 18) + '..' : name}
                        </td>
                        {strategyNames.map((_, j) => {
                          if (i === j) {
                            return (
                              <td key={j} style={{ ...sTdStyle, textAlign: 'center', color: '#4b5563' }}>
                                \u2014
                              </td>
                            );
                          }
                          const wins = summary.headToHead![i][j];
                          const losses = summary.headToHead![j][i];
                          const total = wins + losses;
                          const rate = total > 0 ? wins / total : 0;
                          const bgColor = rate > 0.55
                            ? 'rgba(34, 197, 94, 0.15)'
                            : rate < 0.45
                              ? 'rgba(239, 68, 68, 0.1)'
                              : 'transparent';
                          return (
                            <td
                              key={j}
                              style={{
                                ...sTdStyle,
                                textAlign: 'center',
                                fontWeight: 'bold',
                                backgroundColor: bgColor,
                              }}
                              title={`${wins}W / ${losses}L (${total} games)`}
                            >
                              {pct(wins, total)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Strategy matters breakdown */}
          <div style={boxStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
              Strategy vs Card Advantage
            </h3>
            <p style={{ margin: '4px 0' }}>
              Total simulations: {summary.totalGames}
            </p>
            <p style={{ margin: '4px 0' }}>
              Deck/rotations where strategy mattered: {summary.strategyMattersCount}
            </p>
            <p style={{ margin: '4px 0' }}>
              Deck/rotations dominated by cards: {summary.cardAdvantageDominatedCount}
            </p>
          </div>
        </div>
      )}

      {/* ── Interesting Games tab (by-team) ──────────────────────── */}
      {activeTab === 'interesting' && !isRR && (
        <div>
          {interestingGames.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>No interesting games found — strategy had no effect on outcomes.</p>
          ) : (
            <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #374151', position: 'sticky', top: 0, backgroundColor: '#0f1f15' }}>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>Rot</th>
                    <th style={{ ...thStyle, borderLeft: '1px solid #374151' }}>A Bidder</th>
                    <th style={thStyle}>A Call</th>
                    <th style={thStyle}>A Books</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>A Made?</th>
                    <th style={{ ...thStyle, borderLeft: '1px solid #374151' }}>B Bidder</th>
                    <th style={thStyle}>B Call</th>
                    <th style={thStyle}>B Books</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>B Made?</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Play</th>
                  </tr>
                </thead>
                <tbody>
                  {interestingGames.map((game, idx) => {
                    const rotatedUrl = BidWhistSimulator.rotateDeck(game.deckUrl, game.rotation);
                    const playUrl = `/bidwhist#${rotatedUrl}`;
                    const handA = game.configAResult.hands[0];
                    const handB = game.configBResult.hands[0];

                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #374151' }}>
                        <td style={tdStyle}>{idx + 1}</td>
                        <td style={tdStyle}>{game.rotation}</td>
                        <td style={{ ...tdStyle, borderLeft: '1px solid #374151' }}>
                          {handA ? formatBidder(handA) : '\u2014'}
                        </td>
                        <td style={tdStyle}>
                          {handA ? formatCall(handA) : '\u2014'}
                        </td>
                        <td style={tdStyle}>
                          {handA ? `${handA.booksWon[0]}-${handA.booksWon[1]}` : '\u2014'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {formatMadeIt(handA)}
                        </td>
                        <td style={{ ...tdStyle, borderLeft: '1px solid #374151' }}>
                          {handB ? formatBidder(handB) : '\u2014'}
                        </td>
                        <td style={tdStyle}>
                          {handB ? formatCall(handB) : '\u2014'}
                        </td>
                        <td style={tdStyle}>
                          {handB ? `${handB.booksWon[0]}-${handB.booksWon[1]}` : '\u2014'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {formatMadeIt(handB)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <HandTip label="S" deckUrl={rotatedUrl} player={0}>
                            <a
                              href={playUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#60a5fa', textDecoration: 'underline' }}
                            >
                              Play
                            </a>
                          </HandTip>
                          {' '}
                          <a href="#" onClick={(e) => { e.preventDefault(); openReplay(rotatedUrl, 0, 1, game.rotation); }}
                            style={{ color: '#a78bfa', textDecoration: 'underline', marginLeft: '6px' }}>
                            Replay
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Interesting Games tab (round-robin) ──────────────────── */}
      {activeTab === 'interesting' && isRR && (
        <div>
          {interestingGames.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>No interesting games found — strategy had no effect on outcomes.</p>
          ) : (
            <div style={{ maxHeight: '700px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #374151', position: 'sticky', top: 0, backgroundColor: '#0f1f15', zIndex: 1 }}>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>Score</th>
                    <th style={thStyle}>Rot</th>
                    <th style={{ ...thStyle, width: '40%' }}>Summary</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Play</th>
                  </tr>
                </thead>
                <tbody>
                  {interestingGames.map((game, idx) => {
                    const rotatedUrl = BidWhistSimulator.rotateDeck(game.deckUrl, game.rotation);
                    const playUrl = `/bidwhist#${rotatedUrl}`;
                    const isExpanded = expandedGames.has(idx);
                    const allRes = game.allResults ?? [];

                    // Build summary: per-strategy W/L counts
                    const stratWL: { [si: number]: { w: number; l: number } } = {};
                    for (const r of allRes) {
                      const winIdx = r.winningTeam === 0 ? r.team0StrategyIndex : r.team1StrategyIndex;
                      const loseIdx = r.winningTeam === 0 ? r.team1StrategyIndex : r.team0StrategyIndex;
                      if (!stratWL[winIdx]) stratWL[winIdx] = { w: 0, l: 0 };
                      if (!stratWL[loseIdx]) stratWL[loseIdx] = { w: 0, l: 0 };
                      stratWL[winIdx].w++;
                      stratWL[loseIdx].l++;
                    }
                    const summaryParts = Object.entries(stratWL)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([si, wl]) => {
                        const name = strategyNames[Number(si)] ?? `S${si}`;
                        const short = name.length > 12 ? name.slice(0, 10) + '..' : name;
                        return `${short}: ${wl.w}W/${wl.l}L`;
                      })
                      .join(', ');

                    return (
                      <React.Fragment key={idx}>
                        <tr
                          style={{ borderBottom: '1px solid #374151', cursor: 'pointer' }}
                          onClick={() => toggleExpanded(idx)}
                        >
                          <td style={tdStyle}>{idx + 1}</td>
                          <td style={{ ...tdStyle, fontWeight: 'bold', color: '#fbbf24' }}>
                            {game.interestingnessScore ?? 0}
                          </td>
                          <td style={tdStyle}>{game.rotation}</td>
                          <td style={{ ...tdStyle, fontSize: '12px' }}>
                            <span style={{ marginRight: '6px', color: '#9ca3af' }}>
                              {isExpanded ? '\u25bc' : '\u25b6'}
                            </span>
                            {summaryParts}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <HandTip label="S" deckUrl={rotatedUrl} player={0}>
                              <a
                                href={playUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#60a5fa', textDecoration: 'underline' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                Play
                              </a>
                            </HandTip>
                            {allRes.length > 0 && (
                              <>
                                {' '}
                                <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openReplay(rotatedUrl, allRes[0].team0StrategyIndex, allRes[0].team1StrategyIndex, game.rotation); }}
                                  style={{ color: '#a78bfa', textDecoration: 'underline', marginLeft: '6px' }}>
                                  Replay
                                </a>
                              </>
                            )}
                          </td>
                        </tr>
                        {isExpanded && allRes.map((r, ri) => {
                          const hand = r.hands[0];
                          const t0Name = strategyNames[r.team0StrategyIndex] ?? `S${r.team0StrategyIndex}`;
                          const t1Name = strategyNames[r.team1StrategyIndex] ?? `S${r.team1StrategyIndex}`;
                          const winnerName = r.winningTeam === 0 ? t0Name : t1Name;
                          return (
                            <tr key={`${idx}-${ri}`} style={{
                              borderBottom: '1px solid #2d3748',
                              backgroundColor: 'rgba(255,255,255,0.02)',
                            }}>
                              <td style={{ ...tdStyle, color: '#6b7280', paddingLeft: '20px' }}></td>
                              <td style={{ ...tdStyle, fontSize: '11px', color: '#9ca3af' }}></td>
                              <td style={{ ...tdStyle, fontSize: '11px' }}></td>
                              <td style={{ ...tdStyle, fontSize: '11px' }} colSpan={2}>
                                <span style={{ color: '#9ca3af' }}>T0:</span>{' '}
                                <span style={{ fontWeight: 'bold' }}>{t0Name.length > 15 ? t0Name.slice(0, 13) + '..' : t0Name}</span>
                                <span style={{ color: '#9ca3af' }}> vs T1: </span>
                                <span style={{ fontWeight: 'bold' }}>{t1Name.length > 15 ? t1Name.slice(0, 13) + '..' : t1Name}</span>
                                {hand && (
                                  <>
                                    <span style={{ color: '#9ca3af' }}> | </span>
                                    {formatCall(hand)}
                                    <span style={{ color: '#9ca3af' }}> | Books: </span>
                                    {hand.booksWon[0]}-{hand.booksWon[1]}
                                  </>
                                )}
                                <span style={{ color: '#9ca3af' }}> | Winner: </span>
                                <span style={{ color: '#68d391', fontWeight: 'bold' }}>
                                  {winnerName.length > 15 ? winnerName.slice(0, 13) + '..' : winnerName}
                                </span>
                                {' '}
                                <a href="#" onClick={(e) => { e.preventDefault(); openReplay(rotatedUrl, r.team0StrategyIndex, r.team1StrategyIndex, game.rotation); }}
                                  style={{ color: '#a78bfa', textDecoration: 'underline', marginLeft: '6px', fontSize: '11px' }}>
                                  Replay
                                </a>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Stats Overview tab (by-team) ──────────────────────── */}
      {activeTab === 'stats' && !isRR && (
        <div>
          {stats.totalHands === 0 ? (
            <p style={{ color: '#9ca3af' }}>No hand data available.</p>
          ) : (
            <>
              {/* Strategy Overview */}
              <div style={boxStyle}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  Strategy Overview
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  {[0, 1].map(i => {
                    const o = stats.overall[i];
                    const name = i === 0 ? nameA : nameB;
                    return (
                      <div key={i} style={{
                        backgroundColor: '#0f1f15', borderRadius: '6px', padding: '12px',
                      }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '14px' }}>{name}</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <tbody>
                            <tr>
                              <td style={{ padding: '2px 0', fontSize: '12px', color: '#9ca3af' }}>Declared</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'declaring', label: `${name} declaring` })}
                                style={{ padding: '2px 0', fontSize: '12px', textAlign: 'right' }}>{o.declared} hands</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '2px 0', fontSize: '12px', color: '#9ca3af' }}>Make Rate</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'declaring', outcome: 'made', label: `${name} declaring, made` })}
                                style={{ padding: '2px 0', fontSize: '12px', textAlign: 'right', fontWeight: 'bold',
                                color: o.declared > 0 && o.made / o.declared >= 0.5 ? '#68d391' : '#f56565' }}>
                                {pct(o.made, o.declared)}
                              </td>
                            </tr>
                            <tr>
                              <td style={{ padding: '2px 0', fontSize: '12px', color: '#9ca3af' }}>Avg Bid</td>
                              <td style={{ padding: '2px 0', fontSize: '12px', textAlign: 'right' }}>
                                {o.declared > 0 ? (o.bidSum / o.declared).toFixed(1) : '\u2014'}
                              </td>
                            </tr>
                            <tr style={{ borderTop: '1px solid #374151' }}>
                              <td style={{ padding: '4px 0 2px', fontSize: '12px', color: '#9ca3af' }}>Defended</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'defending', label: `${name} defending` })}
                                style={{ padding: '4px 0 2px', fontSize: '12px', textAlign: 'right' }}>{o.defended} hands</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '2px 0', fontSize: '12px', color: '#9ca3af' }}>Set Rate</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'defending', outcome: 'set', label: `${name} defending, set opponent` })}
                                style={{ padding: '2px 0', fontSize: '12px', textAlign: 'right', fontWeight: 'bold',
                                color: o.defended > 0 && o.setOpp / o.defended >= 0.5 ? '#68d391' : '#f6ad55' }}>
                                {pct(o.setOpp, o.defended)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '8px' }}>
                  Total hands analyzed: {stats.totalHands}
                </div>
              </div>

              {/* Declaring Performance by Bid Level */}
              <div style={boxStyle}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  Declaring Performance by Bid Level
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} style={sThLeftStyle}>Bid</th>
                        <th rowSpan={2} style={sThStyle}>Hands</th>
                        <th rowSpan={2} style={sThStyle}>% of Total</th>
                        <th colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151' }}>{nameA}</th>
                        <th colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151' }}>{nameB}</th>
                      </tr>
                      <tr>
                        <th style={{ ...sThStyle, borderLeft: '1px solid #374151' }}>Declared</th>
                        <th style={sThStyle}>Made%</th>
                        <th style={{ ...sThStyle, borderLeft: '1px solid #374151' }}>Declared</th>
                        <th style={sThStyle}>Made%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.bidLevels.map(({ level, data }) => (
                        <tr key={level}>
                          <td style={{ ...sTdLeftStyle, fontWeight: 'bold' }}>{level}</td>
                          <td className="stat-link" onClick={() => showFiltered({ role: 'any', bidLevel: level, label: `All hands, bid ${level}` })}
                            style={sTdStyle}>{data.total}</td>
                          <td style={sTdStyle}>{pct(data.total, stats.totalHands)}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 0, role: 'declaring', bidLevel: level, label: `${nameA} declaring, bid ${level}` })}
                            style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.decl[0]}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 0, role: 'declaring', bidLevel: level, outcome: 'made', label: `${nameA} declaring, bid ${level}, made` })}
                            style={{
                            ...sTdStyle, fontWeight: 'bold',
                            ...betterBg(data.made[0], data.decl[0], data.made[1], data.decl[1]),
                          }}>
                            {pct(data.made[0], data.decl[0])}
                          </td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 1, role: 'declaring', bidLevel: level, label: `${nameB} declaring, bid ${level}` })}
                            style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.decl[1]}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 1, role: 'declaring', bidLevel: level, outcome: 'made', label: `${nameB} declaring, bid ${level}, made` })}
                            style={{
                            ...sTdStyle, fontWeight: 'bold',
                            ...betterBg(data.made[1], data.decl[1], data.made[0], data.decl[0]),
                          }}>
                            {pct(data.made[1], data.decl[1])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Defending Performance by Bid Level */}
              <div style={boxStyle}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  Defending Performance by Bid Level
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} style={sThLeftStyle}>Bid</th>
                        <th colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151' }}>{nameA}</th>
                        <th colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151' }}>{nameB}</th>
                      </tr>
                      <tr>
                        <th style={{ ...sThStyle, borderLeft: '1px solid #374151' }}>Defended</th>
                        <th style={sThStyle}>Set%</th>
                        <th style={{ ...sThStyle, borderLeft: '1px solid #374151' }}>Defended</th>
                        <th style={sThStyle}>Set%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.bidLevels.map(({ level, data }) => (
                        <tr key={level}>
                          <td style={{ ...sTdLeftStyle, fontWeight: 'bold' }}>{level}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 0, role: 'defending', bidLevel: level, label: `${nameA} defending, bid ${level}` })}
                            style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.def[0]}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 0, role: 'defending', bidLevel: level, outcome: 'set', label: `${nameA} defending, bid ${level}, set opponent` })}
                            style={{
                            ...sTdStyle, fontWeight: 'bold',
                            ...betterBg(data.set[0], data.def[0], data.set[1], data.def[1]),
                          }}>
                            {pct(data.set[0], data.def[0])}
                          </td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 1, role: 'defending', bidLevel: level, label: `${nameB} defending, bid ${level}` })}
                            style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.def[1]}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 1, role: 'defending', bidLevel: level, outcome: 'set', label: `${nameB} defending, bid ${level}, set opponent` })}
                            style={{
                            ...sTdStyle, fontWeight: 'bold',
                            ...betterBg(data.set[1], data.def[1], data.set[0], data.def[0]),
                          }}>
                            {pct(data.set[1], data.def[1])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Performance by Direction */}
              <div style={boxStyle}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  Performance by Direction
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} style={sThLeftStyle}>Direction</th>
                        <th rowSpan={2} style={sThStyle}>Hands</th>
                        <th rowSpan={2} style={sThStyle}>Overall Made%</th>
                        <th colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151' }}>{nameA}</th>
                        <th colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151' }}>{nameB}</th>
                      </tr>
                      <tr>
                        <th style={{ ...sThStyle, borderLeft: '1px solid #374151' }}>Declared</th>
                        <th style={sThStyle}>Made%</th>
                        <th style={{ ...sThStyle, borderLeft: '1px solid #374151' }}>Declared</th>
                        <th style={sThStyle}>Made%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.directions.map(({ key, data }) => (
                        <tr key={key}>
                          <td style={sTdLeftStyle}>{DIRECTION_LABELS[key] || key}</td>
                          <td className="stat-link" onClick={() => showFiltered({ role: 'any', direction: key, label: `All hands, ${DIRECTION_LABELS[key] || key}` })}
                            style={sTdStyle}>{data.total}</td>
                          <td className="stat-link" onClick={() => showFiltered({ role: 'any', direction: key, outcome: 'made', label: `All hands, ${DIRECTION_LABELS[key] || key}, made` })}
                            style={sTdStyle}>{pct(data.madeTotal, data.total)}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 0, role: 'declaring', direction: key, label: `${nameA} declaring, ${DIRECTION_LABELS[key] || key}` })}
                            style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.decl[0]}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 0, role: 'declaring', direction: key, outcome: 'made', label: `${nameA} declaring, ${DIRECTION_LABELS[key] || key}, made` })}
                            style={{
                            ...sTdStyle, fontWeight: 'bold',
                            ...betterBg(data.made[0], data.decl[0], data.made[1], data.decl[1]),
                          }}>
                            {pct(data.made[0], data.decl[0])}
                          </td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 1, role: 'declaring', direction: key, label: `${nameB} declaring, ${DIRECTION_LABELS[key] || key}` })}
                            style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.decl[1]}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 1, role: 'declaring', direction: key, outcome: 'made', label: `${nameB} declaring, ${DIRECTION_LABELS[key] || key}, made` })}
                            style={{
                            ...sTdStyle, fontWeight: 'bold',
                            ...betterBg(data.made[1], data.decl[1], data.made[0], data.decl[0]),
                          }}>
                            {pct(data.made[1], data.decl[1])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Performance by Trump Suit */}
              <div style={boxStyle}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  Performance by Trump Suit
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} style={sThLeftStyle}>Suit</th>
                        <th rowSpan={2} style={sThStyle}>Hands</th>
                        <th rowSpan={2} style={sThStyle}>Overall Made%</th>
                        <th colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151' }}>{nameA}</th>
                        <th colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151' }}>{nameB}</th>
                      </tr>
                      <tr>
                        <th style={{ ...sThStyle, borderLeft: '1px solid #374151' }}>Declared</th>
                        <th style={sThStyle}>Made%</th>
                        <th style={{ ...sThStyle, borderLeft: '1px solid #374151' }}>Declared</th>
                        <th style={sThStyle}>Made%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.trumpSuits.map(({ key, data }) => (
                        <tr key={key}>
                          <td style={sTdLeftStyle}>{suitLabel(key)}</td>
                          <td className="stat-link" onClick={() => showFiltered({ role: 'any', trumpSuit: key, label: `All hands, ${key}` })}
                            style={sTdStyle}>{data.total}</td>
                          <td className="stat-link" onClick={() => showFiltered({ role: 'any', trumpSuit: key, outcome: 'made', label: `All hands, ${key}, made` })}
                            style={sTdStyle}>{pct(data.madeTotal, data.total)}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 0, role: 'declaring', trumpSuit: key, label: `${nameA} declaring, ${key}` })}
                            style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.decl[0]}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 0, role: 'declaring', trumpSuit: key, outcome: 'made', label: `${nameA} declaring, ${key}, made` })}
                            style={{
                            ...sTdStyle, fontWeight: 'bold',
                            ...betterBg(data.made[0], data.decl[0], data.made[1], data.decl[1]),
                          }}>
                            {pct(data.made[0], data.decl[0])}
                          </td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 1, role: 'declaring', trumpSuit: key, label: `${nameB} declaring, ${key}` })}
                            style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.decl[1]}</td>
                          <td className="stat-link" onClick={() => showFiltered({ strategyIndex: 1, role: 'declaring', trumpSuit: key, outcome: 'made', label: `${nameB} declaring, ${key}, made` })}
                            style={{
                            ...sTdStyle, fontWeight: 'bold',
                            ...betterBg(data.made[1], data.decl[1], data.made[0], data.decl[0]),
                          }}>
                            {pct(data.made[1], data.decl[1])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Stats Overview tab (round-robin) ──────────────────── */}
      {activeTab === 'stats' && isRR && rrStats && (
        <div>
          {rrStats.totalHands === 0 ? (
            <p style={{ color: '#9ca3af' }}>No hand data available.</p>
          ) : (
            <>
              {/* Strategy Overview — N cards */}
              <div style={boxStyle}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  Strategy Overview
                </h3>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${Math.min(strategyNames.length, 3)}, 1fr)`,
                  gap: '12px',
                }}>
                  {strategyNames.map((name, i) => {
                    const o = rrStats.overall[i];
                    return (
                      <div key={i} style={{
                        backgroundColor: '#0f1f15', borderRadius: '6px', padding: '12px',
                      }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '13px' }}>
                          {name.length > 22 ? name.slice(0, 20) + '..' : name}
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <tbody>
                            <tr>
                              <td style={{ padding: '2px 0', fontSize: '11px', color: '#9ca3af' }}>Declared</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'declaring', label: `${name} declaring` })}
                                style={{ padding: '2px 0', fontSize: '11px', textAlign: 'right' }}>{o.declared}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '2px 0', fontSize: '11px', color: '#9ca3af' }}>Make Rate</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'declaring', outcome: 'made', label: `${name} declaring, made` })}
                                style={{ padding: '2px 0', fontSize: '11px', textAlign: 'right', fontWeight: 'bold',
                                color: o.declared > 0 && o.made / o.declared >= 0.5 ? '#68d391' : '#f56565' }}>
                                {pct(o.made, o.declared)}
                              </td>
                            </tr>
                            <tr>
                              <td style={{ padding: '2px 0', fontSize: '11px', color: '#9ca3af' }}>Avg Bid</td>
                              <td style={{ padding: '2px 0', fontSize: '11px', textAlign: 'right' }}>
                                {o.declared > 0 ? (o.bidSum / o.declared).toFixed(1) : '\u2014'}
                              </td>
                            </tr>
                            <tr style={{ borderTop: '1px solid #374151' }}>
                              <td style={{ padding: '4px 0 2px', fontSize: '11px', color: '#9ca3af' }}>Defended</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'defending', label: `${name} defending` })}
                                style={{ padding: '4px 0 2px', fontSize: '11px', textAlign: 'right' }}>{o.defended}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '2px 0', fontSize: '11px', color: '#9ca3af' }}>Set Rate</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'defending', outcome: 'set', label: `${name} defending, set opponent` })}
                                style={{ padding: '2px 0', fontSize: '11px', textAlign: 'right', fontWeight: 'bold',
                                color: o.defended > 0 && o.setOpp / o.defended >= 0.5 ? '#68d391' : '#f6ad55' }}>
                                {pct(o.setOpp, o.defended)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '8px' }}>
                  Total hands analyzed: {rrStats.totalHands}
                </div>
              </div>

              {/* Declaring Performance by Bid Level */}
              <div style={boxStyle}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  Declaring Performance by Bid Level
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} style={sThLeftStyle}>Bid</th>
                        <th rowSpan={2} style={sThStyle}>Hands</th>
                        <th rowSpan={2} style={sThStyle}>% of Total</th>
                        {strategyNames.map((name, i) => (
                          <th key={i} colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151', fontSize: '11px' }}>
                            {name.length > 15 ? name.slice(0, 13) + '..' : name}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {strategyNames.map((_, i) => (
                          <React.Fragment key={i}>
                            <th style={{ ...sThStyle, borderLeft: '1px solid #374151', fontSize: '11px' }}>Decl</th>
                            <th style={{ ...sThStyle, fontSize: '11px' }}>Made%</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rrStats.bidLevels.map(({ level, data }) => (
                        <tr key={level}>
                          <td style={{ ...sTdLeftStyle, fontWeight: 'bold' }}>{level}</td>
                          <td className="stat-link" onClick={() => showFiltered({ role: 'any', bidLevel: level, label: `All hands, bid ${level}` })}
                            style={sTdStyle}>{data.total}</td>
                          <td style={sTdStyle}>{pct(data.total, rrStats.totalHands)}</td>
                          {strategyNames.map((sn, i) => (
                            <React.Fragment key={i}>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'declaring', bidLevel: level, label: `${sn} declaring, bid ${level}` })}
                                style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.decl[i] ?? 0}</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'declaring', bidLevel: level, outcome: 'made', label: `${sn} declaring, bid ${level}, made` })}
                                style={{ ...sTdStyle, fontWeight: 'bold' }}>
                                {pct(data.made[i] ?? 0, data.decl[i] ?? 0)}
                              </td>
                            </React.Fragment>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Defending Performance by Bid Level */}
              <div style={boxStyle}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  Defending Performance by Bid Level
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} style={sThLeftStyle}>Bid</th>
                        {strategyNames.map((name, i) => (
                          <th key={i} colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151', fontSize: '11px' }}>
                            {name.length > 15 ? name.slice(0, 13) + '..' : name}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {strategyNames.map((_, i) => (
                          <React.Fragment key={i}>
                            <th style={{ ...sThStyle, borderLeft: '1px solid #374151', fontSize: '11px' }}>Def</th>
                            <th style={{ ...sThStyle, fontSize: '11px' }}>Set%</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rrStats.bidLevels.map(({ level, data }) => (
                        <tr key={level}>
                          <td style={{ ...sTdLeftStyle, fontWeight: 'bold' }}>{level}</td>
                          {strategyNames.map((sn, i) => (
                            <React.Fragment key={i}>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'defending', bidLevel: level, label: `${sn} defending, bid ${level}` })}
                                style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.def[i] ?? 0}</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'defending', bidLevel: level, outcome: 'set', label: `${sn} defending, bid ${level}, set opponent` })}
                                style={{ ...sTdStyle, fontWeight: 'bold' }}>
                                {pct(data.set[i] ?? 0, data.def[i] ?? 0)}
                              </td>
                            </React.Fragment>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Performance by Direction */}
              <div style={boxStyle}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  Performance by Direction
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} style={sThLeftStyle}>Direction</th>
                        <th rowSpan={2} style={sThStyle}>Hands</th>
                        <th rowSpan={2} style={sThStyle}>Made%</th>
                        {strategyNames.map((name, i) => (
                          <th key={i} colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151', fontSize: '11px' }}>
                            {name.length > 15 ? name.slice(0, 13) + '..' : name}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {strategyNames.map((_, i) => (
                          <React.Fragment key={i}>
                            <th style={{ ...sThStyle, borderLeft: '1px solid #374151', fontSize: '11px' }}>Decl</th>
                            <th style={{ ...sThStyle, fontSize: '11px' }}>Made%</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rrStats.directions.map(({ key, data }) => (
                        <tr key={key}>
                          <td style={sTdLeftStyle}>{DIRECTION_LABELS[key] || key}</td>
                          <td className="stat-link" onClick={() => showFiltered({ role: 'any', direction: key, label: `All hands, ${DIRECTION_LABELS[key] || key}` })}
                            style={sTdStyle}>{data.total}</td>
                          <td className="stat-link" onClick={() => showFiltered({ role: 'any', direction: key, outcome: 'made', label: `All hands, ${DIRECTION_LABELS[key] || key}, made` })}
                            style={sTdStyle}>{pct(data.madeTotal, data.total)}</td>
                          {strategyNames.map((sn, i) => (
                            <React.Fragment key={i}>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'declaring', direction: key, label: `${sn} declaring, ${DIRECTION_LABELS[key] || key}` })}
                                style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.decl[i] ?? 0}</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'declaring', direction: key, outcome: 'made', label: `${sn} declaring, ${DIRECTION_LABELS[key] || key}, made` })}
                                style={{ ...sTdStyle, fontWeight: 'bold' }}>
                                {pct(data.made[i] ?? 0, data.decl[i] ?? 0)}
                              </td>
                            </React.Fragment>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Performance by Trump Suit */}
              <div style={boxStyle}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  Performance by Trump Suit
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} style={sThLeftStyle}>Suit</th>
                        <th rowSpan={2} style={sThStyle}>Hands</th>
                        <th rowSpan={2} style={sThStyle}>Made%</th>
                        {strategyNames.map((name, i) => (
                          <th key={i} colSpan={2} style={{ ...sThStyle, textAlign: 'center', borderLeft: '1px solid #374151', fontSize: '11px' }}>
                            {name.length > 15 ? name.slice(0, 13) + '..' : name}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {strategyNames.map((_, i) => (
                          <React.Fragment key={i}>
                            <th style={{ ...sThStyle, borderLeft: '1px solid #374151', fontSize: '11px' }}>Decl</th>
                            <th style={{ ...sThStyle, fontSize: '11px' }}>Made%</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rrStats.trumpSuits.map(({ key, data }) => (
                        <tr key={key}>
                          <td style={sTdLeftStyle}>{suitLabel(key)}</td>
                          <td className="stat-link" onClick={() => showFiltered({ role: 'any', trumpSuit: key, label: `All hands, ${key}` })}
                            style={sTdStyle}>{data.total}</td>
                          <td className="stat-link" onClick={() => showFiltered({ role: 'any', trumpSuit: key, outcome: 'made', label: `All hands, ${key}, made` })}
                            style={sTdStyle}>{pct(data.madeTotal, data.total)}</td>
                          {strategyNames.map((sn, i) => (
                            <React.Fragment key={i}>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'declaring', trumpSuit: key, label: `${sn} declaring, ${key}` })}
                                style={{ ...sTdStyle, borderLeft: '1px solid #374151' }}>{data.decl[i] ?? 0}</td>
                              <td className="stat-link" onClick={() => showFiltered({ strategyIndex: i, role: 'declaring', trumpSuit: key, outcome: 'made', label: `${sn} declaring, ${key}, made` })}
                                style={{ ...sTdStyle, fontWeight: 'bold' }}>
                                {pct(data.made[i] ?? 0, data.decl[i] ?? 0)}
                              </td>
                            </React.Fragment>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Bid Analysis tab ──────────────────────────────────── */}
      {activeTab === 'bidAnalysis' && (
        <div>
          {/* Summary box */}
          <div style={boxStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
              Bid Analysis Summary
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div style={{ backgroundColor: '#0f1f15', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#e5e7eb' }}>
                  {bidAnalysis.analyzedDeckRotations}
                </div>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                  Deck/Rotation Pairs
                </div>
              </div>
              <div style={{ backgroundColor: '#0f1f15', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f56565' }}>
                  {bidAnalysis.alwaysSet.length}
                </div>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                  Bidding Traps
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>
                  (always set)
                </div>
              </div>
              <div style={{ backgroundColor: '#0f1f15', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#68d391' }}>
                  {bidAnalysis.alwaysMade.length}
                </div>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                  Bidding Locks
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>
                  (always made)
                </div>
              </div>
            </div>
          </div>

          {/* Bidding Traps table */}
          <div style={boxStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px', color: '#f56565' }}>
              Bidding Traps
            </h3>
            <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
              Deals where the declarer ALWAYS gets set, regardless of strategy pairing
            </p>
            {bidAnalysis.alwaysSet.length === 0 ? (
              <p style={{ color: '#6b7280', fontStyle: 'italic' }}>No bidding traps found</p>
            ) : (
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #374151', position: 'sticky', top: 0, backgroundColor: '#162b1e' }}>
                      <th style={sThLeftStyle}>#</th>
                      <th style={sThStyle}>Rot</th>
                      <th style={sThLeftStyle}>Bidder</th>
                      <th style={sThLeftStyle}>Call</th>
                      <th style={sThStyle}>Avg Books</th>
                      <th style={sThStyle}>Book Range</th>
                      <th style={sThStyle}>Pairs Tested</th>
                      <th style={{ ...sThStyle, textAlign: 'center' }}>Play</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bidAnalysis.alwaysSet.map((entry, idx) => {
                      const rotatedUrl = BidWhistSimulator.rotateDeck(entry.deckUrl, entry.rotation);
                      const playUrl = `/bidwhist#${rotatedUrl}`;
                      const h = entry.sampleHand;
                      const declarerTeam = h.bidWinner % 2;
                      const defBooks = 13 - entry.avgDeclarerBooks;
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #374151' }}>
                          <td style={sTdLeftStyle}>{idx + 1}</td>
                          <td style={sTdStyle}>{entry.rotation}</td>
                          <td style={sTdLeftStyle}>{formatBidder(h)} (T{declarerTeam})</td>
                          <td style={sTdLeftStyle}>{formatCall(h)}</td>
                          <td style={{ ...sTdStyle, color: '#f56565' }}>
                            {entry.avgDeclarerBooks.toFixed(1)} vs {defBooks.toFixed(1)}
                          </td>
                          <td style={sTdStyle}>
                            {entry.minDeclarerBooks}–{entry.maxDeclarerBooks}
                          </td>
                          <td style={sTdStyle}>{entry.totalResults}</td>
                          <td style={{ ...sTdStyle, textAlign: 'center' }}>
                            <a
                              href={playUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#60a5fa', textDecoration: 'underline' }}
                            >
                              Play
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Bidding Locks table */}
          <div style={boxStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px', color: '#68d391' }}>
              Bidding Locks
            </h3>
            <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
              Deals where the declarer ALWAYS makes, regardless of strategy pairing
            </p>
            {bidAnalysis.alwaysMade.length === 0 ? (
              <p style={{ color: '#6b7280', fontStyle: 'italic' }}>No bidding locks found</p>
            ) : (
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #374151', position: 'sticky', top: 0, backgroundColor: '#162b1e' }}>
                      <th style={sThLeftStyle}>#</th>
                      <th style={sThStyle}>Rot</th>
                      <th style={sThLeftStyle}>Bidder</th>
                      <th style={sThLeftStyle}>Call</th>
                      <th style={sThStyle}>Avg Books</th>
                      <th style={sThStyle}>Book Range</th>
                      <th style={sThStyle}>Pairs Tested</th>
                      <th style={{ ...sThStyle, textAlign: 'center' }}>Play</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bidAnalysis.alwaysMade.map((entry, idx) => {
                      const rotatedUrl = BidWhistSimulator.rotateDeck(entry.deckUrl, entry.rotation);
                      const playUrl = `/bidwhist#${rotatedUrl}`;
                      const h = entry.sampleHand;
                      const declarerTeam = h.bidWinner % 2;
                      const defBooks = 13 - entry.avgDeclarerBooks;
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #374151' }}>
                          <td style={sTdLeftStyle}>{idx + 1}</td>
                          <td style={sTdStyle}>{entry.rotation}</td>
                          <td style={sTdLeftStyle}>{formatBidder(h)} (T{declarerTeam})</td>
                          <td style={sTdLeftStyle}>{formatCall(h)}</td>
                          <td style={{ ...sTdStyle, color: '#68d391' }}>
                            {entry.avgDeclarerBooks.toFixed(1)} vs {defBooks.toFixed(1)}
                          </td>
                          <td style={sTdStyle}>
                            {entry.minDeclarerBooks}–{entry.maxDeclarerBooks}
                          </td>
                          <td style={sTdStyle}>{entry.totalResults}</td>
                          <td style={{ ...sTdStyle, textAlign: 'center' }}>
                            <a
                              href={playUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#60a5fa', textDecoration: 'underline' }}
                            >
                              Play
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Most Decisive Hands table */}
          <div style={boxStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px', color: '#fbbf24' }}>
              Most Decisive Hands
            </h3>
            <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
              Individual hands with the most extreme book margins (top 50)
            </p>
            {bidAnalysis.shutouts.length === 0 ? (
              <p style={{ color: '#6b7280', fontStyle: 'italic' }}>No decisive hands found (threshold: 10+ books by one side)</p>
            ) : (
              <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #374151', position: 'sticky', top: 0, backgroundColor: '#162b1e' }}>
                      <th style={sThLeftStyle}>#</th>
                      <th style={sThStyle}>Rot</th>
                      <th style={sThLeftStyle}>Bidder</th>
                      <th style={sThLeftStyle}>Call</th>
                      <th style={sThStyle}>Books</th>
                      <th style={{ ...sThStyle, textAlign: 'center' }}>Made?</th>
                      <th style={sThLeftStyle}>T0 Strategy</th>
                      <th style={sThLeftStyle}>T1 Strategy</th>
                      <th style={{ ...sThStyle, textAlign: 'center' }}>Play</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bidAnalysis.shutouts.map((entry, idx) => {
                      const rotatedUrl = BidWhistSimulator.rotateDeck(entry.deckUrl, entry.rotation);
                      const playUrl = `/bidwhist#${rotatedUrl}`;
                      const h = entry.hand;
                      const declarerDominant = entry.declarerBooks > entry.defenderBooks;
                      const bookColor = declarerDominant ? '#68d391' : '#f56565';
                      const t0Name = strategyNames[entry.team0StrategyIndex] ?? `S${entry.team0StrategyIndex}`;
                      const t1Name = strategyNames[entry.team1StrategyIndex] ?? `S${entry.team1StrategyIndex}`;
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #374151' }}>
                          <td style={sTdLeftStyle}>{idx + 1}</td>
                          <td style={sTdStyle}>{entry.rotation}</td>
                          <td style={sTdLeftStyle}>{formatBidder(h)}</td>
                          <td style={sTdLeftStyle}>{formatCall(h)}</td>
                          <td style={{ ...sTdStyle, color: bookColor, fontWeight: 'bold' }}>
                            {entry.declarerBooks}:{entry.defenderBooks}
                          </td>
                          <td style={{ ...sTdStyle, textAlign: 'center' }}>
                            {formatMadeIt(h)}
                          </td>
                          <td style={{ ...sTdLeftStyle, fontSize: '11px' }}>
                            {t0Name.length > 18 ? t0Name.slice(0, 16) + '..' : t0Name}
                          </td>
                          <td style={{ ...sTdLeftStyle, fontSize: '11px' }}>
                            {t1Name.length > 18 ? t1Name.slice(0, 16) + '..' : t1Name}
                          </td>
                          <td style={{ ...sTdStyle, textAlign: 'center' }}>
                            <a
                              href={playUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#60a5fa', textDecoration: 'underline' }}
                            >
                              Play
                            </a>
                            {' '}
                            <a href="#" onClick={(e) => { e.preventDefault(); openReplay(rotatedUrl, entry.team0StrategyIndex, entry.team1StrategyIndex, entry.rotation); }}
                              style={{ color: '#a78bfa', textDecoration: 'underline', marginLeft: '6px' }}>
                              Replay
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Hand Strength tab (by-team only) ───────────────────── */}
      {/* ── Filtered List tab ──────────────────────────────────── */}
      {activeTab === 'filtered' && handFilter && (() => {
        const filtered = computeFilteredHands(result, handFilter);
        return (
          <div>
            <div style={{
              ...boxStyle,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <span style={{ color: '#9ca3af', fontSize: '13px' }}>Showing hands where: </span>
                <span style={{ fontWeight: 'bold', fontSize: '13px' }}>{handFilter.label}</span>
                <span style={{ color: '#6b7280', fontSize: '12px', marginLeft: '12px' }}>
                  ({filtered.length} hands)
                </span>
              </div>
              <button
                onClick={() => { setHandFilter(null); setActiveTab('stats'); }}
                style={{
                  padding: '4px 12px', fontSize: '12px', color: '#e5e7eb',
                  backgroundColor: '#374151', border: 'none', borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Clear filter
              </button>
            </div>
            {filtered.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>No matching hands found.</p>
            ) : (
              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #374151', position: 'sticky', top: 0, backgroundColor: '#0f1f15', zIndex: 1 }}>
                      <th style={sThStyle}>#</th>
                      <th style={sThStyle}>Rot</th>
                      <th style={sThLeftStyle}>Bidder</th>
                      <th style={sThLeftStyle}>Call</th>
                      <th style={sThStyle}>Books</th>
                      <th style={{ ...sThStyle, textAlign: 'center' }}>Made?</th>
                      <th style={sThLeftStyle}>T0 Strategy</th>
                      <th style={sThLeftStyle}>T1 Strategy</th>
                      <th style={{ ...sThStyle, textAlign: 'center' }}>Play</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry, idx) => {
                      const rotatedUrl = BidWhistSimulator.rotateDeck(entry.game.deckUrl, entry.game.rotation);
                      const playUrl = `/bidwhist#${rotatedUrl}`;
                      const h = entry.hand;
                      const t0Name = strategyNames[entry.game.team0StrategyIndex] ?? `S${entry.game.team0StrategyIndex}`;
                      const t1Name = strategyNames[entry.game.team1StrategyIndex] ?? `S${entry.game.team1StrategyIndex}`;
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #374151' }}>
                          <td style={sTdStyle}>{idx + 1}</td>
                          <td style={sTdStyle}>{entry.game.rotation}</td>
                          <td style={sTdLeftStyle}>{formatBidder(h)}</td>
                          <td style={sTdLeftStyle}>{formatCall(h)}</td>
                          <td style={sTdStyle}>{h.booksWon[0]}-{h.booksWon[1]}</td>
                          <td style={{ ...sTdStyle, textAlign: 'center' }}>{formatMadeIt(h)}</td>
                          <td style={{ ...sTdLeftStyle, fontSize: '11px' }}>
                            {t0Name.length > 18 ? t0Name.slice(0, 16) + '..' : t0Name}
                          </td>
                          <td style={{ ...sTdLeftStyle, fontSize: '11px' }}>
                            {t1Name.length > 18 ? t1Name.slice(0, 16) + '..' : t1Name}
                          </td>
                          <td style={{ ...sTdStyle, textAlign: 'center' }}>
                            <HandTip label="S" deckUrl={rotatedUrl} player={0}>
                              <a
                                href={playUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#60a5fa', textDecoration: 'underline' }}
                              >
                                Play
                              </a>
                            </HandTip>
                            {' '}
                            <a href="#" onClick={(e) => { e.preventDefault(); openReplay(rotatedUrl, entry.game.team0StrategyIndex, entry.game.team1StrategyIndex, entry.game.rotation); }}
                              style={{ color: '#a78bfa', textDecoration: 'underline', marginLeft: '6px' }}>
                              Replay
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Hand Strength tab (by-team only) ───────────────────── */}
      {activeTab === 'handStrength' && !isRR && (
        <div>
          {interestingGames.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>No interesting games — run a comparison first.</p>
          ) : (
            <>
              <div style={{ ...boxStyle, fontSize: '12px', color: '#9ca3af', lineHeight: 1.6 }}>
                <strong style={{ color: '#e5e7eb' }}>Hand Strength (V1)</strong> — Each card is scored 0–1 based on rank position.
                <strong> Pre-Bid</strong> is direction-agnostic (best of uptown/downtown), so both high-card and low-card hands score well.
                <strong> Post-Trump</strong> applies the actual trump suit and direction — trump cards retain value, wrong-direction and off-suit cards drop sharply.
                Hand strength = sum of 12 card values (range 0–12).
                <strong> ADV</strong> = |mean(S,N) − mean(E,W)| — how lopsided the deal is between teams (0 = even, higher = more advantage).
                <br />
                <span style={{ color: '#6b7280' }}>
                  Note: Strengths are computed on the initial 12-card deal only (kitty not included).
                  Post-Trump values use {nameA}'s call; rows where {nameB} made a different call are highlighted.
                </span>
              </div>
              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #374151', position: 'sticky', top: 0, backgroundColor: '#0f1f15', zIndex: 2 }}>
                      <th style={{ ...sThStyle, borderBottom: '1px solid #374151' }}></th>
                      <th colSpan={6} style={{ ...sThStyle, borderLeft: '2px solid #4b5563', borderBottom: '1px solid #374151', textAlign: 'center' }}>Pre-Bid</th>
                      <th colSpan={2} style={{ ...sThStyle, borderLeft: '2px solid #4b5563', borderBottom: '1px solid #374151', textAlign: 'center' }}>Calls</th>
                      <th colSpan={6} style={{ ...sThStyle, borderLeft: '2px solid #4b5563', borderBottom: '1px solid #374151', textAlign: 'center' }}>Post-Trump</th>
                      <th colSpan={2} style={{ ...sThStyle, borderLeft: '2px solid #4b5563', borderBottom: '1px solid #374151', textAlign: 'center' }}>Won</th>
                      <th style={{ ...sThStyle, borderLeft: '2px solid #4b5563', borderBottom: '1px solid #374151' }}></th>
                    </tr>
                    <tr style={{ borderBottom: '2px solid #374151', position: 'sticky', top: '27px', backgroundColor: '#0f1f15', zIndex: 2 }}>
                      <th style={{ ...sThStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleHsSort('id')}>
                        #{hsSortKey === 'id' ? (hsSortAsc ? ' \u25b2' : ' \u25bc') : ''}
                      </th>
                      {/* Pre-Bid group */}
                      {(['S', 'E', 'N', 'W'] as const).map((lbl, i) => {
                        const key = `preBid${lbl}` as HsSortKey;
                        return (
                          <th key={`pb-${lbl}`} style={{
                            ...sThStyle,
                            cursor: 'pointer', userSelect: 'none',
                            ...(i === 0 ? { borderLeft: '2px solid #4b5563' } : {}),
                          }} onClick={() => toggleHsSort(key)}>
                            {lbl}{hsSortKey === key ? (hsSortAsc ? ' \u25b2' : ' \u25bc') : ''}
                          </th>
                        );
                      })}
                      <th style={sThStyle}>Rank</th>
                      <th style={{ ...sThStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleHsSort('preBidAdv')}>
                        ADV{hsSortKey === 'preBidAdv' ? (hsSortAsc ? ' \u25b2' : ' \u25bc') : ''}
                      </th>
                      {/* Calls group */}
                      <th style={{ ...sThStyle, borderLeft: '2px solid #4b5563' }}>A</th>
                      <th style={sThStyle}>B</th>
                      {/* Post-Trump group */}
                      {(['S', 'E', 'N', 'W'] as const).map((lbl, i) => {
                        const key = `post${lbl}` as HsSortKey;
                        return (
                          <th key={`pt-${lbl}`} style={{
                            ...sThStyle,
                            cursor: 'pointer', userSelect: 'none',
                            ...(i === 0 ? { borderLeft: '2px solid #4b5563' } : {}),
                          }} onClick={() => toggleHsSort(key)}>
                            {lbl}{hsSortKey === key ? (hsSortAsc ? ' \u25b2' : ' \u25bc') : ''}
                          </th>
                        );
                      })}
                      <th style={sThStyle}>Rank</th>
                      <th style={{ ...sThStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleHsSort('postAdv')}>
                        ADV{hsSortKey === 'postAdv' ? (hsSortAsc ? ' \u25b2' : ' \u25bc') : ''}
                      </th>
                      {/* Won group */}
                      <th style={{ ...sThStyle, borderLeft: '2px solid #4b5563' }}>A</th>
                      <th style={sThStyle}>B</th>
                      {/* Play link */}
                      <th style={{ ...sThStyle, borderLeft: '2px solid #4b5563' }}>Play</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hsSortedIndices.map(idx => {
                      const hs = handStrengths[idx];
                      const game = interestingGames[idx];
                      const rotatedUrl = BidWhistSimulator.rotateDeck(game.deckUrl, game.rotation);
                      const playUrl = `/bidwhist#${rotatedUrl}`;
                      const handA = game.configAResult.hands[0];
                      const handB = game.configBResult.hands[0];
                      const wonA = game.configAResult.winningTeam;
                      const wonB = game.configBResult.winningTeam;
                      const preBidAdv = teamAdvantage(hs.preBid);
                      const postAdv = teamAdvantage(hs.postTrumpA);
                      const callsDiffer = handA && handB && (
                        handA.trumpSuit !== handB.trumpSuit || handA.direction !== handB.direction
                      );

                      return (
                        <tr key={idx} style={{
                          borderBottom: '1px solid #374151',
                          ...(callsDiffer ? { backgroundColor: 'rgba(251, 191, 36, 0.07)' } : {}),
                        }}>
                          <td style={sTdStyle}>{idx + 1}</td>
                          {/* Pre-Bid */}
                          {([0, 1, 2, 3] as const).map(p => (
                            <td key={`pb${p}`} style={{
                              ...sTdStyle,
                              color: strengthColor(hs.preBid[p]),
                              cursor: 'default',
                              ...(p === 0 ? { borderLeft: '2px solid #4b5563' } : {}),
                            }}>
                              <HandTip label={PLAYER_LABELS[p]} deckUrl={rotatedUrl} player={p}>
                                {hs.preBid[p].toFixed(1)}
                              </HandTip>
                            </td>
                          ))}
                          <td style={{ ...sTdStyle, fontFamily: 'monospace', letterSpacing: '1px' }}>
                            {hs.preBidRanking}
                          </td>
                          <td style={{ ...sTdStyle, fontWeight: 'bold', color: preBidAdv >= 2.0 ? '#f6ad55' : '#9ca3af' }}>
                            {preBidAdv.toFixed(2)}
                          </td>
                          {/* Calls */}
                          <td style={{ ...sTdStyle, borderLeft: '2px solid #4b5563' }}>
                            {handA ? formatCall(handA) : '\u2014'}
                          </td>
                          <td style={{
                            ...sTdStyle,
                            ...(callsDiffer ? { color: '#fbbf24' } : {}),
                          }}>
                            {handB ? (callsDiffer ? formatCall(handB) : '\u2014') : '\u2014'}
                          </td>
                          {/* Post-Trump (based on A's call) */}
                          {([0, 1, 2, 3] as const).map(p => (
                            <td key={`pt${p}`} style={{
                              ...sTdStyle,
                              color: strengthColor(hs.postTrumpA[p]),
                              cursor: 'default',
                              ...(p === 0 ? { borderLeft: '2px solid #4b5563' } : {}),
                            }}>
                              <HandTip label={PLAYER_LABELS[p]} deckUrl={rotatedUrl} player={p}>
                                {hs.postTrumpA[p].toFixed(1)}
                              </HandTip>
                            </td>
                          ))}
                          <td style={{ ...sTdStyle, fontFamily: 'monospace', letterSpacing: '1px' }}>
                            {hs.postTrumpARanking}
                          </td>
                          <td style={{ ...sTdStyle, fontWeight: 'bold', color: postAdv >= 2.0 ? '#f6ad55' : '#9ca3af' }}>
                            {postAdv.toFixed(2)}
                          </td>
                          {/* Won */}
                          <td style={{ ...sTdStyle, borderLeft: '2px solid #4b5563', color: wonA === 0 ? '#68d391' : '#f6ad55', fontWeight: 'bold' }}>
                            {wonA === 0 ? 'S/N' : 'E/W'}
                          </td>
                          <td style={{ ...sTdStyle, color: wonB === 0 ? '#68d391' : '#f6ad55', fontWeight: 'bold' }}>
                            {wonB === 0 ? 'S/N' : 'E/W'}
                          </td>
                          {/* Play link */}
                          <td style={{ ...sTdStyle, borderLeft: '2px solid #4b5563', textAlign: 'center' }}>
                            <HandTip label="S" deckUrl={rotatedUrl} player={0}>
                              <a
                                href={playUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#60a5fa', textDecoration: 'underline' }}
                              >
                                Play
                              </a>
                            </HandTip>
                            {' '}
                            <a href="#" onClick={(e) => { e.preventDefault(); openReplay(rotatedUrl, 0, 1, game.rotation); }}
                              style={{ color: '#a78bfa', textDecoration: 'underline', marginLeft: '6px' }}>
                              Replay
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ComparisonResults;
