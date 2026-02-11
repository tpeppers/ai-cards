// 100-RED: Adversarial Test Dataset for Bid Whist Strategy Comparison
// 100 curated hands designed to exploit strategy weaknesses

export interface RedTeamDeck {
  url: string;
  category: string;
  description: string;
}

type Suit = 'H' | 'S' | 'C' | 'D';
const SUITS: Suit[] = ['H', 'S', 'C', 'D'];

function cl(suit: Suit, rank: number): string {
  const bases: Record<Suit, number> = { H: 97, S: 110, C: 65, D: 78 };
  return String.fromCharCode(bases[suit] + rank - 1);
}

function cards(suit: Suit, ...ranks: number[]): string {
  return ranks.map(r => cl(suit, r)).join('');
}

function allSuits(...ranks: number[]): string {
  return SUITS.map(s => cards(s, ...ranks)).join('');
}

function buildDeck(s: string, e: string, n: string, w: string, k: string): string {
  let url = '';
  for (let i = 0; i < 12; i++) url += s[i] + e[i] + n[i] + w[i];
  return url + k;
}

function validate(url: string): boolean {
  if (url.length !== 52) return false;
  const ref = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  return url.split('').sort().join('') === ref.split('').sort().join('');
}

function mk(s: string, e: string, n: string, w: string, k: string, cat: string, desc: string): RedTeamDeck {
  const url = buildDeck(s, e, n, w, k);
  if (!validate(url)) {
    const ref = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const have = new Set(url.split(''));
    const missing = ref.split('').filter(c => !have.has(c));
    const cts: Record<string, number> = {};
    url.split('').forEach(c => cts[c] = (cts[c] || 0) + 1);
    const dupes = Object.entries(cts).filter(([, v]) => v > 1).map(([k]) => k);
    throw new Error(`Bad deck [${desc}]: len=${url.length} missing=[${missing}] dupes=[${dupes}]`);
  }
  return { url, category: cat, description: desc };
}

/** Fill unassigned cards into short hands deterministically */
function fill(ps: string, pe: string, pn: string, pw: string, pk: string) {
  const ref = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const used = new Set((ps + pe + pn + pw + pk).split(''));
  const rem = ref.split('').filter(c => !used.has(c));
  let [s, e, n, w, k] = [ps, pe, pn, pw, pk];
  let i = 0;
  while (s.length < 12) s += rem[i++];
  while (e.length < 12) e += rem[i++];
  while (n.length < 12) n += rem[i++];
  while (w.length < 12) w += rem[i++];
  while (k.length < 4) k += rem[i++];
  return { s, e, n, w, k };
}

function mkAuto(ps: string, pe: string, pn: string, pw: string, pk: string, cat: string, desc: string): RedTeamDeck {
  const { s, e, n, w, k } = fill(ps, pe, pn, pw, pk);
  return mk(s, e, n, w, k, cat, desc);
}

// ============================================================================
// Generate all 100 adversarial hands
// ============================================================================

function generateDecks(): RedTeamDeck[] {
  const C1 = 'Hot Seat Trap';
  const C2 = 'Direction Ambiguity';
  const C3 = 'False Long Suit';
  const C4 = 'Defensive Wall';
  const C5 = 'Kitty Trap';
  const C6 = 'Signal Confusion';
  const C7 = 'Cross-Ruff Defense';
  const C8 = 'Symmetric Mirror';
  const C9 = 'Extreme Distribution';
  const C10 = 'Bidding War';

  const D: RedTeamDeck[] = [];

  // ========================================================================
  // CATEGORY 1: Hot Seat Traps (1-10)
  // East (hot seat) gets balanced weak hands with middle ranks.
  // Strategies that always bid aggressively from hot seat will overbid.
  // ========================================================================

  // 1: East 5,6,7 in each suit (3-3-3-3 balanced), opponents hold all power
  D.push(mk(
    cards('H',1,13,12,11) + cards('S',1,13,12,11) + cards('H',8,9,10) + cards('S',8),
    cards('H',5,6,7) + cards('S',5,6,7) + cards('C',5,6,7) + cards('D',5,6,7),
    cards('H',2,3,4) + cards('S',2,3,4) + cards('C',2,3,4) + cards('D',2,3,4),
    cards('C',1,13,12,11) + cards('D',1,13,12,11) + cards('C',8,9,10) + cards('D',8),
    cards('S',9,10) + cards('D',9,10),
    C1, '1: East 5-7 balanced 3-3-3-3, opponents hold all face cards'
  ));

  // 2: East 6,7,8 each suit balanced
  D.push(mk(
    cards('H',1,13,12) + cards('S',1,13,12) + cards('C',1,13,12) + cards('D',1,13,12),
    cards('H',6,7,8) + cards('S',6,7,8) + cards('C',6,7,8) + cards('D',6,7,8),
    cards('H',2,3,11) + cards('S',2,3,11) + cards('C',2,3,11) + cards('D',2,3,11),
    cards('H',4,5,9) + cards('S',4,5,9) + cards('C',4,5,9) + cards('D',4,5,9),
    cards('H',10) + cards('S',10) + cards('C',10) + cards('D',10),
    C1, '2: East 6-8 balanced, power cards distributed to opponents'
  ));

  // 3: East 4,5,6 each suit balanced
  D.push(mk(
    cards('H',1,13,11) + cards('S',1,13,11) + cards('C',1,13,11) + cards('D',1,13,11),
    cards('H',4,5,6) + cards('S',4,5,6) + cards('C',4,5,6) + cards('D',4,5,6),
    cards('H',2,3,10) + cards('S',2,3,10) + cards('C',2,3,10) + cards('D',2,3,10),
    cards('H',7,8,9) + cards('S',7,8,9) + cards('C',7,8,9) + cards('D',7,8,9),
    cards('H',12) + cards('S',12) + cards('C',12) + cards('D',12),
    C1, '3: East 4-6 balanced, no trick winners'
  ));

  // 4: East 7,8,9 each suit balanced
  D.push(mk(
    cards('H',1,2,3) + cards('S',1,2,3) + cards('C',1,2,3) + cards('D',1,2,3),
    cards('H',7,8,9) + cards('S',7,8,9) + cards('C',7,8,9) + cards('D',7,8,9),
    cards('H',10,11,12) + cards('S',10,11,12) + cards('C',10,11,12) + cards('D',10,11,12),
    cards('H',4,5,6) + cards('S',4,5,6) + cards('C',4,5,6) + cards('D',4,5,6),
    cards('H',13) + cards('S',13) + cards('C',13) + cards('D',13),
    C1, '4: East 7-9 balanced, uptown winners with S, downtown with W'
  ));

  // 5: East 8,9,10 each suit balanced
  D.push(mk(
    cards('H',1,2,13) + cards('S',1,2,13) + cards('C',1,2,13) + cards('D',1,2,13),
    cards('H',8,9,10) + cards('S',8,9,10) + cards('C',8,9,10) + cards('D',8,9,10),
    cards('H',3,4,5) + cards('S',3,4,5) + cards('C',3,4,5) + cards('D',3,4,5),
    cards('H',6,11,12) + cards('S',6,11,12) + cards('C',6,11,12) + cards('D',6,11,12),
    cards('H',7) + cards('S',7) + cards('C',7) + cards('D',7),
    C1, '5: East 8-10 balanced, opponents have A,K,2,3'
  ));

  // 6: East 3,4,5 balanced (low-middle)
  D.push(mk(
    cards('H',1,12,13) + cards('S',1,12,13) + cards('C',1,12,13) + cards('D',1,12,13),
    cards('H',3,4,5) + cards('S',3,4,5) + cards('C',3,4,5) + cards('D',3,4,5),
    cards('H',9,10,11) + cards('S',9,10,11) + cards('C',9,10,11) + cards('D',9,10,11),
    cards('H',6,7,8) + cards('S',6,7,8) + cards('C',6,7,8) + cards('D',6,7,8),
    cards('H',2) + cards('S',2) + cards('C',2) + cards('D',2),
    C1, '6: East 3-5 balanced, weak in all directions'
  ));

  // 7: East 4-4-4-0 void diamonds, all middle
  D.push(mk(
    cards('H',1,13,12,11) + cards('D',1,13,12,11) + cards('S',2,3) + cards('C',2,3),
    cards('H',5,6,7,8) + cards('S',5,6,7,8) + cards('C',5,6,7,8),
    cards('S',1,13,12,11) + cards('C',1,13,12,11) + cards('D',2,3,4,5),
    cards('D',6,7,8,9,10) + cards('H',2,3,4) + cards('S',4,9,10) + cards('C',4),
    cards('H',9,10) + cards('C',9,10),
    C1, '7: East 4-4-4-0 void diamonds, all middle ranks'
  ));

  // 8: East 6-3-3-0 long but weak hearts
  D.push(mk(
    cards('S',1,13,12,11,10,9) + cards('C',1,13,12,11,10,9),
    cards('H',4,5,6,7,8,9) + cards('S',5,6,7) + cards('C',5,6,7),
    cards('D',1,13,12,11,10,9) + cards('H',1,13,12,11,10) + cards('D',8),
    cards('D',2,3,4,5,6,7) + cards('S',2,3,4) + cards('C',2,3,4),
    cards('H',2,3) + cards('S',8) + cards('C',8),
    C1, '8: East 6 hearts but all 4-9, opponents hold H-A,K,Q,J,10'
  ));

  // 9: East 4-4-2-2 middle ranks
  D.push(mk(
    cards('H',1,13,12,11) + cards('S',1,13,12,11) + cards('C',1,2) + cards('D',1,2),
    cards('H',5,6,7,8) + cards('S',5,6,7,8) + cards('C',6,7) + cards('D',6,7),
    cards('C',13,12,11,10) + cards('D',13,12,11,10) + cards('H',2,3) + cards('S',2,3),
    cards('H',4,9,10) + cards('S',4,9,10) + cards('C',3,4,5) + cards('D',3,4,5),
    cards('C',8,9) + cards('D',8,9),
    C1, '9: East 4-4-2-2 all middle ranks'
  ));

  // 10: East 5-4-3-0 void clubs, mediocre
  D.push(mk(
    cards('C',1,13,12,11,10,9) + cards('H',1,13) + cards('S',1,13) + cards('D',1,13),
    cards('H',5,6,7,8,9) + cards('S',5,6,7,8) + cards('D',5,6,7),
    cards('H',2,3,4) + cards('S',2,3,4) + cards('C',2,3,4,5,6,7),
    cards('D',2,3,4,8,9,10,11,12) + cards('H',10,11,12) + cards('S',9),
    cards('C',8) + cards('S',10,11,12),
    C1, '10: East 5-4-3-0 void clubs, all middle'
  ));

  // ========================================================================
  // CATEGORY 2: Direction Ambiguity (11-25)
  // low_count (rank 2-7) ≈ high_count (rank 1/A or 8-13) but one direction
  // is clearly superior. Tests whether strategies pick the right direction.
  // ========================================================================

  // 11: East A,7,8 each suit: high_count=8 suggests uptown but aces play well downtown
  D.push(mk(
    cards('H',2,3,13) + cards('S',2,3,13) + cards('C',2,3,13) + cards('D',2,3,13),
    cards('H',1,7,8) + cards('S',1,7,8) + cards('C',1,7,8) + cards('D',1,7,8),
    cards('H',4,5,6) + cards('S',4,5,6) + cards('C',4,5,6) + cards('D',4,5,6),
    cards('H',10,11,12) + cards('S',10,11,12) + cards('C',10,11,12) + cards('D',10,11,12),
    cards('H',9) + cards('S',9) + cards('C',9) + cards('D',9),
    C2, '11: East A+7+8 each suit, high_count=8 but downtown-with-aces strong'
  ));

  // 12: South A,2,3,K,Q,J in H+S: perfect 6-low 6-high split
  D.push(mk(
    cards('H',1,2,3,13,12,11) + cards('S',1,2,3,13,12,11),
    cards('C',1,2,3,13,12,11) + cards('D',1,2,3,13,12,11),
    cards('H',4,5,6) + cards('S',4,5,6) + cards('C',4,5,6) + cards('D',4,5,6),
    cards('H',7,8,9) + cards('S',7,8,9) + cards('C',7,8,9) + cards('D',7,8,9),
    cards('H',10) + cards('S',10) + cards('C',10) + cards('D',10),
    C2, '12: S and E have 6 low + 6 high each, perfect ambiguity'
  ));

  // 13: 7-Q runs: 7s are "low" but hand plays uptown
  D.push(mk(
    cards('H',7,8,9,10,11,12) + cards('S',7,8,9,10,11,12),
    cards('C',7,8,9,10,11,12) + cards('D',7,8,9,10,11,12),
    cards('H',1,2,3) + cards('S',1,2,3) + cards('C',1,2,3) + cards('D',1,2,3),
    cards('H',4,5,6) + cards('S',4,5,6) + cards('C',4,5,6) + cards('D',4,5,6),
    cards('H',13) + cards('S',13) + cards('C',13) + cards('D',13),
    C2, '13: S/E have 7-Q runs, 7s count as low but hand plays uptown'
  ));

  // 14: Team has all 2s and all Aces - downtown dominant
  D.push(mk(
    cards('H',1,2,10,11) + cards('S',1,2,10,11) + cards('C',1,2,10,11),
    cards('H',3,4,5,6) + cards('S',3,4,5,6) + cards('C',3,4,5,6),
    cards('C',13,12,9,8) + cards('D',13,12,11,10) + cards('H',12,7,8,9),
    cards('D',2,3,4,5,6,7,8,9) + cards('S',7,8,9) + cards('C',7),
    cards('D',1) + cards('S',13,12) + cards('H',13),
    C2, '14: S has all A+2 pairs in 3 suits, downtown dominant'
  ));

  // 15: Half aces half 2s split across teams
  D.push(mk(
    cards('H',1,2,11,12) + cards('S',1,2,11,12) + cards('C',1,2,11,12),
    cards('D',1,2,11,12) + cards('H',3,4,5,6) + cards('S',3,4,5,6),
    cards('H',7,8,9,10) + cards('S',7,8,9,10) + cards('C',7,8,9,10),
    cards('D',7,8,9,10) + cards('C',3,4,5,6) + cards('D',3,4,5,6),
    cards('H',13) + cards('S',13) + cards('C',13) + cards('D',13),
    C2, '15: A+2 pairs split across teams, direction choice critical'
  ));

  // 16: One team aces, other team 2s
  D.push(mk(
    cards('H',1,10,11,12) + cards('S',1,10,11,12) + cards('C',1,10) + cards('D',1,10),
    cards('H',2,3,4,5) + cards('S',2,3,4,5) + cards('C',2,3,4,5),
    cards('C',11,12,13) + cards('D',11,12,13) + cards('H',6,7,8) + cards('S',6,7,8),
    cards('D',2,3,4,5,6,7,8,9) + cards('C',6,7,8,9),
    cards('H',9,13) + cards('S',9,13),
    C2, '16: S/N team has aces, E/W team has 2s - direction battle'
  ));

  // 17: King-heavy hand, downtown-noaces optimal
  D.push(mk(
    cards('H',13,12,11,10) + cards('S',13,12,11,10) + cards('C',13,12,11,10),
    cards('H',1,2,3) + cards('S',1,2,3) + cards('C',1,2,3) + cards('D',1,2,3),
    cards('D',13,12,11,10,9,8) + cards('H',9,8) + cards('S',9,8) + cards('C',9,8),
    cards('H',4,5,6,7) + cards('S',4,5,6,7) + cards('C',4,5,6,7),
    cards('D',4,5,6,7),
    C2, '17: S has K,Q,J,10 in 3 suits - downtown-noaces best'
  ));

  // 18: Mixed aces and 3s - downtown strong but high_count misleads
  D.push(mk(
    cards('H',1,3,9,10) + cards('S',1,3,9,10) + cards('C',1,3,9,10),
    cards('H',2,4,8,13) + cards('S',2,4,8,13) + cards('C',2,4,8,13),
    cards('D',1,3,9,10,11,12) + cards('H',11,12) + cards('S',11,12) + cards('C',11,12),
    cards('D',2,4,5,6,7,8,13) + cards('H',5,6,7) + cards('S',5,6),
    cards('S',7) + cards('C',5,6,7),
    C2, '18: S has A+3 combos, strong downtown but count says uptown'
  ));

  // 19: All players have exactly 6 low + 6 high
  D.push(mk(
    cards('H',1,2,8,13) + cards('S',1,2,8,13) + cards('C',1,2,8,13),
    cards('H',3,4,9,10) + cards('S',3,4,9,10) + cards('C',3,4,9,10),
    cards('H',5,6,11,12) + cards('S',5,6,11,12) + cards('C',5,6,11,12),
    cards('H',7) + cards('S',7) + cards('C',7) + cards('D',1,2,3,4,5,6,7,8,9),
    cards('D',10,11,12,13),
    C2, '19: Every player has 6 low + 6 high, pure direction test'
  ));

  // 20: 2s concentrated with one player, aces with partner
  D.push(mk(
    cards('H',1) + cards('S',1) + cards('C',1) + cards('D',1) + cards('H',13,12,11,10,9,8,7,6),
    cards('H',2) + cards('S',2) + cards('C',2) + cards('D',2) + cards('S',13,12,11,10,9,8,7,6),
    cards('C',13,12,11,10,9,8,7,6,5,4,3) + cards('D',13),
    cards('D',12,11,10,9,8,7,6,5,4,3) + cards('H',3,4),
    cards('H',5) + cards('S',3,4,5),
    C2, '20: S has 4 aces, N has 4 twos - team dominates downtown'
  ));

  // 21: Everyone has 3 of each extreme (A,2,3 + J,Q,K)
  D.push(mk(
    cards('H',1,2,13) + cards('S',1,2,13) + cards('C',1,2,13) + cards('D',1,2,13),
    cards('H',3,11,12) + cards('S',3,11,12) + cards('C',3,11,12) + cards('D',3,11,12),
    cards('H',4,5,10) + cards('S',4,5,10) + cards('C',4,5,10) + cards('D',4,5,10),
    cards('H',6,7,8) + cards('S',6,7,8) + cards('C',6,7,8) + cards('D',6,7,8),
    cards('H',9) + cards('S',9) + cards('C',9) + cards('D',9),
    C2, '21: S has A,2,K each suit - low_count=high_count=6 exactly'
  ));

  // 22: 4 aces + 4 twos + 4 threes in one hand
  D.push(mk(
    cards('H',1,2,3,13) + cards('S',1,2,3,13) + cards('C',1,2,3,13),
    cards('H',4,5,6,7) + cards('S',4,5,6,7) + cards('C',4,5,6,7),
    cards('D',1,2,3,13,12,11) + cards('H',8,9,10) + cards('S',8,9,10),
    cards('D',4,5,6,7,8,9,10) + cards('C',8,9,10) + cards('H',12,11),
    cards('S',12,11) + cards('C',12,11),
    C2, '22: S has A,2,3,K each of 3 suits - downtown powerhouse'
  ));

  // 23: Strong uptown hand that looks downtown (many low cards)
  D.push(mk(
    cards('H',2,3,4,5,6,7) + cards('S',2,3,4,5,6,7),
    cards('H',1,13,12,11,10) + cards('S',1,13,12) + cards('C',1,13,12,11),
    cards('C',2,3,4,5,6,7) + cards('D',2,3,4,5,6,7),
    cards('D',1,13,12,11,10) + cards('S',11,10) + cards('C',10,9,8) + cards('H',8,9),
    cards('S',8,9) + cards('D',8,9),
    C2, '23: S has 2-7 in H+S (low_count=12!) but partner E has all top cards'
  ));

  // 24: 3 aces + 3 kings + 3 twos + 3 threes spread
  D.push(mk(
    cards('H',1,13,6) + cards('S',1,13,6) + cards('C',1,13,6) + cards('D',1,13,6),
    cards('H',2,3,7) + cards('S',2,3,7) + cards('C',2,3,7) + cards('D',2,3,7),
    cards('H',4,8,12) + cards('S',4,8,12) + cards('C',4,8,12) + cards('D',4,8,12),
    cards('H',5,9,11) + cards('S',5,9,11) + cards('C',5,9,11) + cards('D',5,9,11),
    cards('H',10) + cards('S',10) + cards('C',10) + cards('D',10),
    C2, '24: S has A,K,6 each suit; E has 2,3,7 - both have direction arguments'
  ));

  // 25: Concentrated power in one suit misleads direction
  D.push(mk(
    cards('H',1,2,3,4,5,6,7,8,9,10,11,12),
    cards('S',1,2,3,4,5,6,7,8,9,10,11,12),
    cards('C',1,2,3,4,5,6,7,8,9,10,11,12),
    cards('D',1,2,3,4,5,6,7,8,9,10,11,12),
    cards('H',13) + cards('S',13) + cards('C',13) + cards('D',13),
    C2, '25: Each player has 12 of one suit - pure trump battle'
  ));

  // ========================================================================
  // CATEGORY 3: False Long Suit (26-35)
  // A player has 7+ of one suit but all middle ranks. max_suit_count()
  // triggers confident bids but trick-taking power is low.
  // ========================================================================

  // 26: South has 8 hearts but all 4-11, opponents hold A,K,Q,2,3
  D.push(mk(
    cards('H',4,5,6,7,8,9,10,11) + cards('S',4,5,6,7),
    cards('H',1,13,12) + cards('S',1,13,12) + cards('C',1,2,3) + cards('D',1,2,3),
    cards('C',4,5,6,7,8,9,10,11) + cards('D',4,5,6,7),
    cards('H',2,3) + cards('S',2,3,8,9,10,11) + cards('C',12,13) + cards('D',12,13),
    cards('D',8,9,10,11),
    C3, '26: S has 8 hearts but 4-J, opponents hold H-A,K,Q,2,3'
  ));

  // 27: East 7 spades all 4-10
  D.push(mk(
    cards('H',1,13,12,11,10,9) + cards('C',1,13,12,11,10,9),
    cards('S',4,5,6,7,8,9,10) + cards('D',4,5,6,7,8),
    cards('D',1,13,12,11,10,9) + cards('H',2,3,4,5,6,7),
    cards('S',1,13,12,11,2,3) + cards('C',2,3,4,5,6,7),
    cards('H',8) + cards('D',2,3) + cards('C',8),
    C3, '27: E has 7 spades but 4-10, opponents hold S-A,K,Q,J,2,3'
  ));

  // 28: South 9 clubs all 3-11
  D.push(mk(
    cards('C',3,4,5,6,7,8,9,10,11) + cards('H',5,6,7),
    cards('S',1,13,12,11,10,9,8,7) + cards('D',5,6,7,8),
    cards('D',1,13,12,11,10,9) + cards('H',8,9,10,11,12,13),
    cards('C',1,13,12,2) + cards('S',2,3,4,5,6) + cards('H',1,2,3),
    cards('H',4) + cards('D',2,3,4),
    C3, '28: S has 9 clubs but 3-J, W holds C-A,K,Q,2'
  ));

  // 29: North 7 diamonds all 5-11
  D.push(mk(
    cards('H',1,13,12,11) + cards('S',1,13,12,11) + cards('C',1,13,12,11),
    cards('H',2,3,4,5) + cards('S',2,3,4,5) + cards('C',2,3,4,5),
    cards('D',5,6,7,8,9,10,11) + cards('H',6,7,8,9,10),
    cards('D',1,13,12,2,3,4) + cards('S',6,7,8,9) + cards('C',6,7),
    cards('C',8,9,10) + cards('S',10),
    C3, '29: N has 7 diamonds but 5-J, W holds D-A,K,Q,2,3,4'
  ));

  // 30: West 8 hearts 3-10
  D.push(mk(
    cards('H',1,13,12,11) + cards('D',1,13,12,11) + cards('S',8,9,10,11),
    cards('S',1,13,12,2,3,4) + cards('C',1,13,12,2,3,4),
    cards('C',5,6,7,8,9,10,11) + cards('D',5,6,7,8,9),
    cards('H',3,4,5,6,7,8,9,10) + cards('S',5,6,7) + cards('D',2),
    cards('H',2) + cards('D',3,4,10),
    C3, '30: W has 8 hearts 3-10, S holds H-A,K,Q,J'
  ));

  // 31: South 7 spades 4-10, with misleading max_suit_count
  D.push(mk(
    cards('S',4,5,6,7,8,9,10) + cards('H',1,13,12,11,10),
    cards('C',1,13,12,11,10,9,8) + cards('D',1,13,12,11,10),
    cards('H',2,3,4,5,6,7) + cards('D',2,3,4,5,6,7),
    cards('S',1,13,12,11,2,3) + cards('C',2,3,4,5,6,7),
    cards('H',8,9) + cards('D',8,9),
    C3, '31: S has 7 spades 4-10 but W holds S-A,K,Q,J,2,3'
  ));

  // 32: East 8 diamonds 3-10
  D.push(mk(
    cards('H',1,13,12,11,10,9) + cards('S',1,13,12,11,10,9),
    cards('D',3,4,5,6,7,8,9,10) + cards('C',5,6,7,8),
    cards('C',1,13,12,11,10,9) + cards('H',2,3,4,5,6,7),
    cards('D',1,13,12,11,2) + cards('S',2,3,4,5,6,7,8),
    cards('H',8) + cards('C',2,3,4),
    C3, '32: E has 8 diamonds 3-10, W holds D-A,K,Q,J,2'
  ));

  // 33: South 10 hearts 2-11 (monster length, bad ranks)
  D.push(mk(
    cards('H',2,3,4,5,6,7,8,9,10,11) + cards('S',5,6),
    cards('S',1,13,12,11,10,9) + cards('C',1,13,12,11,10,9),
    cards('D',1,13,12,11,10,9,8,7) + cards('C',2,3,4,5),
    cards('H',1,13,12) + cards('S',2,3,4,7,8) + cards('D',2,3,4,6),
    cards('C',6,7,8) + cards('D',5),
    C3, '33: S has 10 hearts but only 2-J, W holds H-A,K,Q'
  ));

  // 34: North 7 clubs 4-10 with opponents holding stoppers
  D.push(mk(
    cards('H',1,13,12,11,10,9) + cards('D',1,13,12,11,10,9),
    cards('S',1,13,12,11,10,9,8) + cards('H',2,3,4,5,6),
    cards('C',4,5,6,7,8,9,10) + cards('D',2,3,4,5,6),
    cards('C',1,13,12,11,2,3) + cards('S',2,3,4,5,6,7),
    cards('H',7,8) + cards('D',7,8),
    C3, '34: N has 7 clubs 4-10, W holds C-A,K,Q,J,2,3'
  ));

  // 35: East 7 hearts 3-9, looks biddable but crushed
  D.push(mk(
    cards('H',1,13,12,10) + cards('S',1,13,12,11) + cards('C',1,13,12,11),
    cards('H',3,4,5,6,7,8,9) + cards('S',5,6,7,8,9),
    cards('D',1,13,12,11,10,9,8) + cards('C',2,3,4,5,6),
    cards('H',2,11) + cards('D',2,3,4,5,6,7) + cards('S',2,3,4) + cards('C',10),
    cards('S',10) + cards('C',7,8,9),
    C3, '35: E has 7 hearts 3-9, S holds H-A,K,Q,10'
  ));

  // ========================================================================
  // CATEGORY 4: Defensive Walls (36-50)
  // One defender has all 2s, the other has all Aces (or similar).
  // Blocks both uptown and downtown.
  // ========================================================================

  // 36: N has all four 2s, W has all four Aces
  D.push(mk(
    cards('H',13,12,11,10) + cards('S',13,12,11,10) + cards('C',13,12,11,10),
    cards('H',3,4,5,6) + cards('S',3,4,5,6) + cards('C',3,4,5,6),
    cards('H',2,7,8) + cards('S',2,7,8) + cards('C',2,7,8) + cards('D',2,7,8),
    cards('H',1,9) + cards('S',1,9) + cards('C',1,9) + cards('D',1,9,10,11,12,13),
    cards('D',3,4,5,6),
    C4, '36: N has all four 2s, W has all four Aces - blocks both directions'
  ));

  // 37: N has four 2s + four 3s, W has four Aces + four Kings
  D.push(mk(
    cards('H',12,11,10,9) + cards('S',12,11,10,9) + cards('C',12,11,10,9),
    cards('H',4,5,6,7) + cards('S',4,5,6,7) + cards('C',4,5,6,7),
    cards('H',2,3,8) + cards('S',2,3,8) + cards('C',2,3,8) + cards('D',2,3,8),
    cards('H',1,13) + cards('S',1,13) + cards('C',1,13) + cards('D',1,13,9,10,11,12),
    cards('D',4,5,6,7),
    C4, '37: N has 2s+3s, W has Aces+Kings - total lockdown'
  ));

  // 38: Defenders split A,K,Q vs 2,3,4
  D.push(mk(
    cards('H',5,6,7,8,9,10,11,12,13) + cards('S',5,6,7),
    cards('S',8,9,10,11,12,13) + cards('D',5,6,7,8,9,10),
    cards('H',1,2) + cards('S',1,2) + cards('C',1,2,3,4) + cards('D',1,2,3,4),
    cards('H',3,4) + cards('S',3,4) + cards('C',5,6,7,8,9,10,11,12),
    cards('C',13) + cards('D',11,12,13),
    C4, '38: N has A+2 in 4 suits, W has 3+4 + long clubs - downtown wall'
  ));

  // 39: One defender all Aces, other all 2s, both with length
  D.push(mk(
    cards('H',13,12,11) + cards('S',13,12,11) + cards('C',13,12,11) + cards('D',13,12,11),
    cards('H',10,9,8) + cards('S',10,9,8) + cards('C',10,9,8) + cards('D',10,9,8),
    cards('H',1,2,7) + cards('S',1,2,7) + cards('C',1,2,7) + cards('D',1,2,7),
    cards('H',3,4,6) + cards('S',3,4,6) + cards('C',3,4,6) + cards('D',3,4,6),
    cards('H',5) + cards('S',5) + cards('C',5) + cards('D',5),
    C4, '39: N has A,2,7 each suit; W has 3,4,6 each suit - defense covers both'
  ));

  // 40: Defenders with complementary ranks
  D.push(mk(
    cards('H',13,12,11,10) + cards('S',13,12,11,10) + cards('C',13,12,11,10),
    cards('H',5,6,7,8) + cards('S',5,6,7,8) + cards('C',5,6,7,8),
    cards('H',1,2,3) + cards('S',1,2,3) + cards('C',1,2,3) + cards('D',1,2,3),
    cards('H',9,4) + cards('S',9,4) + cards('D',8,9,10,11,12,13) + cards('C',9,4),
    cards('D',4,5,6,7),
    C4, '40: N has A,2,3 each suit as wall, S has K,Q,J,10 in 3 suits'
  ));

  // 41: West has all Kings and Queens as uptown wall
  D.push(mk(
    cards('H',1,2,3) + cards('S',1,2,3) + cards('C',1,2,3) + cards('D',1,2,3),
    cards('H',4,5,6,10) + cards('S',4,5,6,10) + cards('C',4,5,6,10),
    cards('H',7,8,9) + cards('S',7,8,9) + cards('C',7,8,9) + cards('D',7,8,9),
    cards('H',13,12,11) + cards('S',13,12,11) + cards('C',13,12,11) + cards('D',13,12,11),
    cards('D',4,5,6,10),
    C4, '41: W has K,Q,J each suit (uptown wall), S has A,2,3 each (downtown)'
  ));

  // 42: Defenders have interlocking stoppers
  D.push(mk(
    cards('H',13,10,9,8) + cards('S',13,10,9,8) + cards('C',13,10,9,8),
    cards('H',7,6,5,4) + cards('S',7,6,5,4) + cards('C',7,6,5,4),
    cards('H',1,12,11) + cards('S',1,12,11) + cards('C',1,12,11) + cards('D',1,12,11),
    cards('H',2,3) + cards('S',2,3) + cards('C',2,3) + cards('D',2,3,10,9,8,13),
    cards('D',4,5,6,7),
    C4, '42: N has A,Q,J; W has 2,3 - interlocking stoppers in all suits'
  ));

  // 43: All 2s with North, all Aces with West, extreme version
  D.push(mk(
    cards('H',13,12,11,10,9,8) + cards('S',13,12,11,10,9,8),
    cards('C',13,12,11,10,9,8) + cards('D',13,12,11,10,9,8),
    cards('H',2,3,4,5) + cards('S',2,3,4,5) + cards('C',2,3) + cards('D',2,3),
    cards('H',1,6,7) + cards('S',1,6,7) + cards('C',1,4,5,6,7) + cards('D',1),
    cards('D',4,5,6,7),
    C4, '43: N has all 2s+3s, W has all Aces - complete wall'
  ));

  // 44: Defense has A,2 in every suit on same team
  D.push(mk(
    cards('H',13,12,11,10) + cards('S',13,12,11,10) + cards('C',13,12) + cards('D',13,12),
    cards('H',5,6,7,8,9) + cards('S',5,6,7,8,9) + cards('C',5,6),
    cards('H',1,2) + cards('S',1,2) + cards('C',1,2) + cards('D',1,2,3,4,5,6),
    cards('H',3,4) + cards('S',3,4) + cards('C',3,4,7,8,9,10,11) + cards('D',11),
    cards('D',7,8,9,10),
    C4, '44: N has A,2 in every suit - owns both directions'
  ));

  // 45: Split defense: N has low stoppers, W has high stoppers
  D.push(mk(
    cards('H',5,6,7,8,9,10) + cards('S',5,6,7,8,9,10),
    cards('C',5,6,7,8,9,10) + cards('D',5,6,7,8,9,10),
    cards('H',2,3,4) + cards('S',2,3,4) + cards('C',2,3,4) + cards('D',2,3,4),
    cards('H',1,13,12) + cards('S',1,13,12) + cards('C',1,13,12) + cards('D',1,13,12),
    cards('H',11) + cards('S',11) + cards('C',11) + cards('D',11),
    C4, '45: N has 2,3,4 each suit; W has A,K,Q each suit - total coverage'
  ));

  // 46: Defense has every Ace and every 2
  D.push(mk(
    cards('H',13,12,11,10) + cards('S',13,12,11,10) + cards('C',13,12,11,10),
    cards('H',9,8,7,6) + cards('S',9,8,7,6) + cards('C',9,8,7,6),
    cards('H',1,2,5) + cards('S',1,2,5) + cards('C',1,2,5) + cards('D',1,2,5),
    cards('H',3,4) + cards('S',3,4) + cards('C',3,4) + cards('D',3,4,6,7,12,13),
    cards('D',8,9,10,11),
    C4, '46: N has A,2 in each suit; E/S have middle/high - defense dominates'
  ));

  // 47: One defender void in trump suit of declarer
  D.push(mkAuto(
    cards('H',1,13,12,11,10,9,8,7), // S: 8 hearts (likely trump)
    cards('S',1,13,12,11,10,9,8,7), // E: 8 spades
    cards('C',1,13,12,11,10,9),     // N: 6 top clubs (void hearts possible)
    cards('D',1,13,12,11,10,9),     // W: 6 top diamonds
    '',
    C4, '47: S has 8 hearts, but N void hearts - defense can ruff'
  ));

  // 48: Defensive wall with scattered 2s and Aces
  D.push(mk(
    cards('H',13,12,10,9) + cards('S',13,12,10,9) + cards('C',13,12,10,9),
    cards('H',8,7,6,5) + cards('S',8,7,6,5) + cards('C',8,7,6,5),
    cards('H',1,2,4) + cards('S',1,2,4) + cards('C',1,2,4) + cards('D',1,2,4),
    cards('H',3,11) + cards('S',3,11) + cards('C',3,11) + cards('D',3,11,5,6,12,13),
    cards('D',7,8,9,10),
    C4, '48: N has A,2,4 each suit; W has 3,J each suit - strong defense'
  ));

  // 49: Defense concentrates all extreme ranks
  D.push(mk(
    cards('H',10,9,8,7) + cards('S',10,9,8,7) + cards('C',10,9,8,7),
    cards('H',6,5,4) + cards('S',6,5,4) + cards('C',6,5,4) + cards('D',6,5,4),
    cards('H',1,13,2) + cards('S',1,13,2) + cards('C',1,13,2) + cards('D',1,13,2),
    cards('H',3,12,11) + cards('S',3,12,11) + cards('C',3,12,11) + cards('D',3,12,11),
    cards('D',7,8,9,10),
    C4, '49: N has A,K,2 each suit; W has 3,Q,J each suit - unbreakable'
  ));

  // 50: Maximal defense: N has A,2,3; W has K,Q,J in each suit
  D.push(mk(
    cards('H',10,9,8) + cards('S',10,9,8) + cards('C',10,9,8) + cards('D',10,9,8),
    cards('H',7,6,5) + cards('S',7,6,5) + cards('C',7,6,5) + cards('D',7,6,5),
    cards('H',1,2,3) + cards('S',1,2,3) + cards('C',1,2,3) + cards('D',1,2,3),
    cards('H',13,12,11) + cards('S',13,12,11) + cards('C',13,12,11) + cards('D',13,12,11),
    cards('H',4) + cards('S',4) + cards('C',4) + cards('D',4),
    C4, '50: N=A,2,3 W=K,Q,J each suit - perfect defense wall'
  ));

  // ========================================================================
  // CATEGORY 5: Kitty Traps (51-60)
  // Kitty cards look helpful but force discarding critical stoppers.
  // ========================================================================

  // 51: Kitty has 3 hearts completing S's suit, but S must discard club stoppers
  D.push(mk(
    cards('H',1,13,12,11,10,9) + cards('C',1,13) + cards('S',5,6,7,8),
    cards('S',1,13,12,11,10,9) + cards('D',5,6,7,8,9,10),
    cards('C',2,3,4,5,6,7,8,9) + cards('D',1,13,12,11),
    cards('H',2,3,4,5) + cards('S',2,3,4) + cards('C',10,11,12) + cards('D',2,3),
    cards('H',6,7,8) + cards('D',4),
    C5, '51: Kitty has 3 hearts for S, but taking them means discarding C stoppers'
  ));

  // 52: Kitty completes a long suit but creates void exploitable by defense
  D.push(mk(
    cards('S',1,13,12,11,10,9) + cards('H',1,13) + cards('C',8,9) + cards('D',8,9),
    cards('H',2,3,4,5,6,7) + cards('C',1,13,12,11,10) + cards('D',13),
    cards('D',1,12,11,10) + cards('C',2,3,4,5,6,7) + cards('S',8,7),
    cards('H',8,9,10,11,12) + cards('S',2,3,4,5,6) + cards('D',2,3),
    cards('D',4,5,6,7),
    C5, '52: Kitty fills D for W but forces discarding S stoppers'
  ));

  // 53: Kitty has all 4 Aces - whoever wins bid gets aces but loses suit coherence
  D.push(mk(
    cards('H',13,12,11,10,9,8) + cards('S',13,12,11,10,9,8),
    cards('C',13,12,11,10,9,8) + cards('D',13,12,11,10,9,8),
    cards('H',2,3,4,5,6,7) + cards('S',2,3,4,5,6,7),
    cards('C',2,3,4,5,6,7) + cards('D',2,3,4,5,6,7),
    cards('H',1) + cards('S',1) + cards('C',1) + cards('D',1),
    C5, '53: Kitty has all 4 Aces - tempting but disrupts hand shape'
  ));

  // 54: Kitty has all 4 Kings
  D.push(mk(
    cards('H',1,12,11,10,9,8) + cards('S',1,12,11,10,9,8),
    cards('C',1,12,11,10,9,8) + cards('D',1,12,11,10,9,8),
    cards('H',2,3,4,5,6,7) + cards('S',2,3,4,5,6,7),
    cards('C',2,3,4,5,6,7) + cards('D',2,3,4,5,6,7),
    cards('H',13) + cards('S',13) + cards('C',13) + cards('D',13),
    C5, '54: Kitty has all 4 Kings - second-best cards, tempting pickup'
  ));

  // 55: Kitty has 4 cards of one suit, creating flush draw illusion
  D.push(mk(
    cards('H',1,13,12,11,10,9) + cards('S',7,8,9,10,11,12),
    cards('C',1,13,12,11,10,9) + cards('D',7,8,9,10,11,12),
    cards('H',2,3,4,5,6,7) + cards('S',1,13,2,3,4,5),
    cards('C',2,3,4,5,6,7) + cards('D',1,13,2,3,4,5),
    cards('H',8) + cards('S',6) + cards('C',8) + cards('D',6),
    C5, '55: Kitty has mixed suit cards that look helpful but are not'
  ));

  // 56-60: More kitty traps using autoFill for variety
  D.push(mkAuto(
    cards('H',1,13,12,11,10,9,8,7), cards('S',1,13,12,11,10,9,8,7),
    cards('C',1,13,12,11,10,9), cards('D',1,13,12,11,10,9),
    '',
    C5, '56: Long major suits, kitty random - tests discard decisions'
  ));

  D.push(mkAuto(
    cards('H',1,13,12,11,10,9,8,7,6,5), cards('S',1,13,12,11,10,9),
    cards('C',1,13,12,11,10,9), '',
    '',
    C5, '57: S has 10 hearts, kitty may help or hurt'
  ));

  D.push(mkAuto(
    cards('S',1,13,12,11,10,9,8,7,6), cards('C',1,13,12,11,10,9,8,7,6),
    cards('D',1,13,12,11,10,9,8,7,6), '',
    '',
    C5, '58: Three players have 9-card suits, kitty disrupts'
  ));

  D.push(mkAuto(
    cards('H',1,13,12,11) + cards('S',1,13,12,11),
    cards('C',1,13,12,11) + cards('D',1,13,12,11),
    cards('H',2,3) + cards('S',2,3) + cards('C',2,3),
    cards('D',2,3) + cards('H',4,5) + cards('S',4,5),
    '',
    C5, '59: Balanced power, kitty decides who gets edge'
  ));

  D.push(mkAuto(
    cards('H',1,2,3,13,12,11) + cards('S',1,2),
    cards('S',3,13,12,11) + cards('C',1,2,3,13),
    cards('C',12,11) + cards('D',1,2,3,13,12,11),
    '', '',
    C5, '60: Each team has A,2,3,K,Q,J concentrated, kitty pivotal'
  ));

  // ========================================================================
  // CATEGORY 6: Signal Confusion (61-70)
  // Early bidders' hands produce misleading signals that confuse partner.
  // ========================================================================

  // 61: West (first bidder) has 3K + 3 twos - mixed signal
  D.push(mk(
    cards('H',1,10,11,12) + cards('S',1,10,11,12) + cards('C',1,10,11,12),
    cards('H',5,6,7,8) + cards('S',5,6,7,8) + cards('C',5,6,7,8),
    cards('D',1,10,11,12,13) + cards('H',3,4,9) + cards('S',3,4,9) + cards('C',3),
    cards('H',13,2) + cards('S',13,2) + cards('C',13,2,4) + cards('D',2,3,4,5,6),
    cards('D',7,8,9) + cards('C',9),
    C6, '61: W has K+2 in 3 suits - bids 3 but direction unclear to partner'
  ));

  // 62: North bids based on length but ranks are terrible
  D.push(mk(
    cards('H',1,13,12,11) + cards('S',1,13,12,11) + cards('C',1,13,12,11),
    cards('D',1,13,12,11,10,9) + cards('H',2,3) + cards('S',2,3) + cards('C',2,3),
    cards('H',5,6,7,8,9,10) + cards('S',5,6,7,8,9,10),
    cards('C',4,5,6,7,8,9) + cards('D',2,3,4,5,6,7),
    cards('D',8) + cards('C',10) + cards('S',4) + cards('H',4),
    C6, '62: N has 6H+6S but all middle - bids high on length, disappoints'
  ));

  // 63: West signals uptown but team hand is downtown
  D.push(mk(
    cards('H',7,8,9,10,11,12,13) + cards('S',7,8,9,10,11),
    cards('C',1,2,3,4,5,6,7) + cards('D',1,2,3,4,5),
    cards('H',2,3,4,5,6) + cards('S',2,3,4,5,6) + cards('C',13,12),
    cards('S',1,13,12) + cards('D',13,12,11,10,9) + cards('C',8,9,10,11),
    cards('H',1) + cards('D',6,7,8),
    C6, '63: W has A,K,Q spades (uptown signal) but E has all low clubs'
  ));

  // 64: East signals length in wrong suit
  D.push(mk(
    cards('H',1,13,12,11,10) + cards('D',1,13,12,11,10) + cards('S',10,11),
    cards('S',1,13,12,5,6,7,8,9) + cards('C',5,6,7,8),
    cards('C',1,13,12,11,10,9) + cards('H',2,3,4,5,6,7),
    cards('D',2,3,4,5,6,7,8,9) + cards('S',2,3,4) + cards('C',2),
    cards('H',8,9) + cards('C',3,4),
    C6, '64: E has 8 spades but 5 are low, signals length misleadingly'
  ));

  // 65: Both partners signal high bids independently
  D.push(mk(
    cards('H',1,13,12,11,10,9) + cards('S',1,13,12,11,10,9),
    cards('H',2,3,4,5,6,7) + cards('S',2,3,4,5,6,7),
    cards('C',1,13,12,11,10,9) + cards('D',1,13,12,11,10,9),
    cards('C',2,3,4,5,6,7) + cards('D',2,3,4,5,6,7),
    cards('H',8) + cards('S',8) + cards('C',8) + cards('D',8),
    C6, '65: S and N both signal 6-card suits but in different suits'
  ));

  // 66: West bids 4 (confident) but hand is one-dimensional
  D.push(mk(
    cards('H',2,3,4,5,6,7) + cards('S',2,3,4,5,6,7),
    cards('C',2,3,4,5,6,7) + cards('D',2,3,4,5,6,7),
    cards('H',8,9,10,11,12) + cards('S',8,9,10,11,12) + cards('C',13,12),
    cards('H',1,13) + cards('S',1,13) + cards('C',1,8,9,10,11) + cards('D',1,13,12),
    cards('D',8,9,10,11),
    C6, '66: W has A,K in 3 suits (signals strong) but thin everywhere'
  ));

  // 67: Misleading deuce-trey count
  D.push(mk(
    cards('H',2,3) + cards('S',2,3) + cards('C',2,3) + cards('D',2,3) + cards('H',13,12,11,10),
    cards('H',1,9,8,7) + cards('S',1,9,8,7) + cards('C',1,9,8,7),
    cards('S',13,12,11,10) + cards('C',13,12,11,10) + cards('D',13,12,11,10),
    cards('H',4,5,6) + cards('S',4,5,6) + cards('C',4,5,6) + cards('D',4,5,6),
    cards('D',1,9,8,7),
    C6, '67: S has 8 deuces/treys (strong downtown signal) but also K,Q,J,10 hearts'
  ));

  // 68: Partner interprets bid wrong direction
  D.push(mk(
    cards('H',1,2,3,4,13,12) + cards('C',1,2,3,4,13,12),
    cards('S',1,2,3,4,13,12) + cards('D',1,2,3,4,13,12),
    cards('H',5,6,7,8,9,10) + cards('C',5,6,7,8,9,10),
    cards('S',5,6,7,8,9,10) + cards('D',5,6,7,8,9,10),
    cards('H',11) + cards('S',11) + cards('C',11) + cards('D',11),
    C6, '68: S/E have A,2,3,4,K,Q in 2 suits each - ambiguous direction signal'
  ));

  // 69: High bid with bad trump fit
  D.push(mkAuto(
    cards('H',1,13,12,11,10,9,8,7),
    cards('H',2,3,4,5,6) + cards('S',1,13,12,11),
    cards('S',2,3,4,5,6,7,8,9),
    cards('C',1,13,12,11,10,9),
    '',
    C6, '69: S has 8H, E has 5H+top S - E signals spades but S committed to hearts'
  ));

  // 70: Multiple suit signals compete
  D.push(mkAuto(
    cards('H',1,13,12,11) + cards('S',1,13,12,11),
    cards('C',1,13,12,11) + cards('D',1,13,12,11),
    cards('H',2,3,4,5) + cards('C',2,3,4,5),
    cards('S',2,3,4,5) + cards('D',2,3,4,5),
    '',
    C6, '70: Each player strong in 2 suits, competing signals on trump choice'
  ));

  // ========================================================================
  // CATEGORY 7: Cross-Ruff Defense (71-80)
  // Defending team has complementary voids for cross-ruffing.
  // ========================================================================

  // 71: N void hearts, W void spades
  D.push(mk(
    cards('H',1,13,12,11,10,9) + cards('S',1,13,12,11,10,9),
    cards('H',2,3,4,5,6,7) + cards('S',2,3,4,5,6,7),
    cards('C',1,13,12,11,10,9,8,7,6,5,4,3),
    cards('D',1,13,12,11,10,9,8,7,6,5,4,3),
    cards('H',8) + cards('S',8) + cards('C',2) + cards('D',2),
    C7, '71: N has 12 clubs (void H,S,D), W has 12 diamonds - cross-ruff heaven'
  ));

  // 72: Complementary voids in 2 suits
  D.push(mk(
    cards('H',1,13,12,11,10,9,8,7) + cards('S',1,13,12,11),
    cards('H',2,3,4,5,6) + cards('S',2,3,4,5,6,7,8),
    cards('C',1,13,12,11,10,9,8,7,6,5) + cards('D',13,12),
    cards('D',1,11,10,9,8,7,6,5,4,3) + cards('S',9,10),
    cards('C',2,3,4) + cards('D',2),
    C7, '72: N void H+S (has C+D), W void H+C (has D+S) - cross-ruff'
  ));

  // 73: Defense can ruff declarers trump
  D.push(mk(
    cards('H',1,13,12,11,10,9,8,7,6) + cards('S',1,13,12),
    cards('S',2,3,4,5,6,7,8,9,10) + cards('D',1,13,12),
    cards('C',1,13,12,11,10,9,8,7,6) + cards('D',2,3,4),
    cards('D',5,6,7,8,9,10,11) + cards('C',2,3,4,5) + cards('H',2),
    cards('H',3,4,5) + cards('S',11),
    C7, '73: S has 9H trump, N void hearts with 9 clubs - can ruff'
  ));

  // Fix 73 - syntax error with quote
  D[D.length - 1] = mk(
    cards('H',1,13,12,11,10,9,8,7,6) + cards('S',1,13,12),
    cards('S',2,3,4,5,6,7,8,9,10) + cards('D',1,13,12),
    cards('C',1,13,12,11,10,9,8,7,6) + cards('D',2,3,4),
    cards('D',5,6,7,8,9,10,11) + cards('C',2,3,4,5) + cards('H',2),
    cards('H',3,4,5) + cards('S',11),
    C7, '73: S has 9H trump, N void hearts with 9 clubs - defense ruffs'
  );

  // 74: Both defenders void in declarer's trump
  D.push(mk(
    cards('H',1,13,12,11,10,9,8,7,6,5,4,3),
    cards('S',1,13,12,11,10,9,8,7,6,5,4,3),
    cards('C',1,13,12,11,10,9,8,7,6,5,4,3),
    cards('D',1,13,12,11,10,9,8,7,6,5,4,3),
    cards('H',2) + cards('S',2) + cards('C',2) + cards('D',2),
    C7, '74: Each player has 12 of one suit - guaranteed cross-ruff'
  ));

  // 75: Defense has split voids for maximum ruffing
  D.push(mk(
    cards('H',1,13,12,11) + cards('S',1,13,12,11) + cards('C',1,13,12,11),
    cards('H',10,9,8,7) + cards('S',10,9,8,7) + cards('C',10,9,8,7),
    cards('H',2,3,4,5,6) + cards('D',1,13,12,11,10,9,8),
    cards('S',2,3,4,5,6) + cards('D',2,3,4,5,6,7) + cards('C',6),
    cards('C',2,3,4,5),
    C7, '75: N void S+C (has H+D), W void H+C (has S+D) - split voids'
  ));

  // 76: Alternating voids create ruff opportunities
  D.push(mkAuto(
    cards('H',1,13,12,11,10,9) + cards('C',1,13,12,11,10,9),
    cards('S',1,13,12,11,10,9) + cards('D',1,13,12,11,10,9),
    cards('H',2,3,4,5,6,7) + cards('C',2,3,4,5),
    cards('S',2,3,4,5,6,7) + cards('D',2,3,4,5),
    '',
    C7, '76: Teams split H+C vs S+D, guaranteed cross-suit ruffing'
  ));

  // 77-80: More cross-ruff scenarios using autoFill
  D.push(mkAuto(
    cards('H',1,13,12,11,10,9,8,7), cards('D',1,13,12,11,10,9,8,7),
    cards('S',1,13,12,11,10,9), cards('C',1,13,12,11,10,9),
    '',
    C7, '77: S has 8H, E has 8D, defense has top S+C - ruff battle'
  ));

  D.push(mkAuto(
    cards('H',1,13,12,11,10,9,8) + cards('S',1,13),
    cards('C',1,13,12,11,10,9,8) + cards('D',1,13),
    cards('S',2,3,4,5,6,7,8,9,10),
    cards('D',2,3,4,5,6,7,8,9,10),
    '',
    C7, '78: S team has H+C, defense has S+D length - ruff potential'
  ));

  D.push(mkAuto(
    cards('H',1,13,12,11,10,9,8,7,6,5),
    cards('S',1,13,12,11,10,9,8,7,6,5),
    cards('C',1,13,12,11) + cards('D',1,13,12,11),
    cards('C',2,3,4,5) + cards('D',2,3,4,5),
    '',
    C7, '79: S has 10H, E has 10S, defense split C+D'
  ));

  D.push(mkAuto(
    cards('H',1,13,12,11) + cards('S',1,13,12,11),
    cards('C',1,13,12,11) + cards('D',1,13,12,11),
    cards('H',2,3,4) + cards('C',2,3,4),
    cards('S',2,3,4) + cards('D',2,3,4),
    '',
    C7, '80: Each player has 2 strong suits, cross-ruff inevitable'
  ));

  // ========================================================================
  // CATEGORY 8: Symmetric/Mirror Hands (81-88)
  // All players have exactly 3 cards per suit. Rank distributions create
  // balanced competition where minor strategic differences matter.
  // ========================================================================

  // 81: Perfectly symmetric - each player has 3 per suit
  D.push(mk(
    cards('H',1,5,9) + cards('S',1,5,9) + cards('C',1,5,9) + cards('D',1,5,9),
    cards('H',2,6,10) + cards('S',2,6,10) + cards('C',2,6,10) + cards('D',2,6,10),
    cards('H',3,7,11) + cards('S',3,7,11) + cards('C',3,7,11) + cards('D',3,7,11),
    cards('H',4,8,12) + cards('S',4,8,12) + cards('C',4,8,12) + cards('D',4,8,12),
    cards('H',13) + cards('S',13) + cards('C',13) + cards('D',13),
    C8, '81: Perfect symmetry - S:A,5,9 E:2,6,10 N:3,7,J W:4,8,Q each suit'
  ));

  // 82: Symmetric but with power gradient
  D.push(mk(
    cards('H',1,2,3) + cards('S',1,2,3) + cards('C',1,2,3) + cards('D',1,2,3),
    cards('H',4,5,6) + cards('S',4,5,6) + cards('C',4,5,6) + cards('D',4,5,6),
    cards('H',7,8,9) + cards('S',7,8,9) + cards('C',7,8,9) + cards('D',7,8,9),
    cards('H',10,11,12) + cards('S',10,11,12) + cards('C',10,11,12) + cards('D',10,11,12),
    cards('H',13) + cards('S',13) + cards('C',13) + cards('D',13),
    C8, '82: Rank blocks: S=A,2,3 E=4,5,6 N=7,8,9 W=10,J,Q - direction determines all'
  ));

  // 83: Interleaved ranks
  D.push(mk(
    cards('H',1,4,7) + cards('S',1,4,7) + cards('C',1,4,7) + cards('D',1,4,7),
    cards('H',2,5,8) + cards('S',2,5,8) + cards('C',2,5,8) + cards('D',2,5,8),
    cards('H',3,6,9) + cards('S',3,6,9) + cards('C',3,6,9) + cards('D',3,6,9),
    cards('H',10,11,12) + cards('S',10,11,12) + cards('C',10,11,12) + cards('D',10,11,12),
    cards('H',13) + cards('S',13) + cards('C',13) + cards('D',13),
    C8, '83: S=A,4,7 E=2,5,8 N=3,6,9 W=10,J,Q - interleaved strengths'
  ));

  // 84: Pairs split across teams
  D.push(mk(
    cards('H',1,2,12) + cards('S',1,2,12) + cards('C',1,2,12) + cards('D',1,2,12),
    cards('H',3,4,11) + cards('S',3,4,11) + cards('C',3,4,11) + cards('D',3,4,11),
    cards('H',5,6,13) + cards('S',5,6,13) + cards('C',5,6,13) + cards('D',5,6,13),
    cards('H',7,8,10) + cards('S',7,8,10) + cards('C',7,8,10) + cards('D',7,8,10),
    cards('H',9) + cards('S',9) + cards('C',9) + cards('D',9),
    C8, '84: S=A,2,Q E=3,4,J N=5,6,K W=7,8,10 - mixed power each suit'
  ));

  // 85: Top-bottom vs middle
  D.push(mk(
    cards('H',1,7,13) + cards('S',1,7,13) + cards('C',1,7,13) + cards('D',1,7,13),
    cards('H',2,8,12) + cards('S',2,8,12) + cards('C',2,8,12) + cards('D',2,8,12),
    cards('H',3,9,11) + cards('S',3,9,11) + cards('C',3,9,11) + cards('D',3,9,11),
    cards('H',4,6,10) + cards('S',4,6,10) + cards('C',4,6,10) + cards('D',4,6,10),
    cards('H',5) + cards('S',5) + cards('C',5) + cards('D',5),
    C8, '85: S=A,7,K E=2,8,Q N=3,9,J W=4,6,10 - each has top+bottom+middle'
  ));

  // 86: Consecutive rank blocks offset by suit
  D.push(mk(
    cards('H',1,2,3) + cards('S',4,5,6) + cards('C',7,8,9) + cards('D',10,11,12),
    cards('H',4,5,6) + cards('S',7,8,9) + cards('C',10,11,12) + cards('D',1,2,3),
    cards('H',7,8,9) + cards('S',10,11,12) + cards('C',1,2,3) + cards('D',4,5,6),
    cards('H',10,11,12) + cards('S',1,2,3) + cards('C',4,5,6) + cards('D',7,8,9),
    cards('H',13) + cards('S',13) + cards('C',13) + cards('D',13),
    C8, '86: Rotating rank blocks per suit - each strong in different suit'
  ));

  // 87: Mirror image teams
  D.push(mk(
    cards('H',1,13,6) + cards('S',1,13,6) + cards('C',1,13,6) + cards('D',1,13,6),
    cards('H',2,12,7) + cards('S',2,12,7) + cards('C',2,12,7) + cards('D',2,12,7),
    cards('H',3,11,8) + cards('S',3,11,8) + cards('C',3,11,8) + cards('D',3,11,8),
    cards('H',4,10,5) + cards('S',4,10,5) + cards('C',4,10,5) + cards('D',4,10,5),
    cards('H',9) + cards('S',9) + cards('C',9) + cards('D',9),
    C8, '87: S=A,K,6 E=2,Q,7 N=3,J,8 W=4,10,5 - mirror strength each suit'
  ));

  // 88: Alternating high-low per team
  D.push(mk(
    cards('H',1,3,11) + cards('S',1,3,11) + cards('C',1,3,11) + cards('D',1,3,11),
    cards('H',2,4,10) + cards('S',2,4,10) + cards('C',2,4,10) + cards('D',2,4,10),
    cards('H',5,9,13) + cards('S',5,9,13) + cards('C',5,9,13) + cards('D',5,9,13),
    cards('H',6,8,12) + cards('S',6,8,12) + cards('C',6,8,12) + cards('D',6,8,12),
    cards('H',7) + cards('S',7) + cards('C',7) + cards('D',7),
    C8, '88: S=A,3,J E=2,4,10 N=5,9,K W=6,8,Q - alternating ranks'
  ));

  // ========================================================================
  // CATEGORY 9: Extreme Distributions (89-95)
  // Wildly unbalanced hands: 8-2-1-1, 9-2-1-0, 7-0-3-2 etc.
  // ========================================================================

  // 89: South 10-1-1-0
  D.push(mkAuto(
    cards('H',1,2,3,4,5,6,7,8,9,10) + cards('S',5) + cards('C',5),
    cards('S',1,2,3,4) + cards('D',1,2,3,4),
    cards('C',1,2,3,4) + cards('S',6,7,8,9),
    cards('D',5,6,7,8,9,10,11,12),
    '',
    C9, '89: S has 10 hearts + 1S + 1C, extreme void'
  ));

  // 90: All four players have 7-3-2-0 or similar
  D.push(mk(
    cards('H',1,13,12,11,10,9,8) + cards('S',1,13,12) + cards('C',1,13),
    cards('S',2,3,4,5,6,7,8) + cards('C',2,3,4) + cards('D',1,13),
    cards('C',5,6,7,8,9,10,11) + cards('D',2,3,4) + cards('H',2,3),
    cards('D',5,6,7,8,9,10,11) + cards('H',4,5,6) + cards('S',9,10),
    cards('H',7) + cards('S',11) + cards('C',12) + cards('D',12),
    C9, '90: Each player has 7-3-2-0 distribution, multiple voids'
  ));

  // 91: One player has 13 of a suit (impossible normally but tests edge)
  // Actually max is 12 + kitty gives 4. Let's do 12-0-0-0
  D.push(mk(
    cards('H',1,2,3,4,5,6,7,8,9,10,11,12),
    cards('S',1,2,3,4,5,6,7,8,9,10,11,12),
    cards('C',1,2,3,4,5,6,7,8,9,10,11,12),
    cards('D',1,2,3,4,5,6,7,8,9,10,11,12),
    cards('H',13) + cards('S',13) + cards('C',13) + cards('D',13),
    C9, '91: Each player has exactly one complete suit (12 cards) - extreme'
  ));

  // 92: 9-3-0-0 distribution
  D.push(mk(
    cards('H',1,13,12,11,10,9,8,7,6) + cards('S',1,13,12),
    cards('S',11,10,9,8,7,6,5,4,3) + cards('C',1,13,12),
    cards('C',11,10,9,8,7,6,5,4,3) + cards('D',1,13,12),
    cards('D',11,10,9,8,7,6,5,4,3) + cards('H',2,3,4),
    cards('H',5) + cards('S',2) + cards('C',2) + cards('D',2),
    C9, '92: Each player has 9-3-0-0 distribution'
  ));

  // 93: 8-4-0-0 distribution
  D.push(mk(
    cards('H',1,13,12,11,10,9,8,7) + cards('C',1,13,12,11),
    cards('S',1,13,12,11,10,9,8,7) + cards('D',1,13,12,11),
    cards('H',2,3,4,5,6) + cards('C',2,3,4,5,6,7,8),
    cards('S',2,3,4,5,6) + cards('D',2,3,4,5,6,7,8),
    cards('C',9,10) + cards('D',9,10),
    C9, '93: S/E have 8-4-0-0, N/W have 5-7-0-0 - maximum voids'
  ));

  // 94: 6-6-0-0 across all players
  D.push(mk(
    cards('H',1,13,12,11,10,9) + cards('S',1,13,12,11,10,9),
    cards('C',1,13,12,11,10,9) + cards('D',1,13,12,11,10,9),
    cards('H',2,3,4,5,6,7) + cards('S',2,3,4,5,6,7),
    cards('C',2,3,4,5,6,7) + cards('D',2,3,4,5,6,7),
    cards('H',8) + cards('S',8) + cards('C',8) + cards('D',8),
    C9, '94: Every player has exactly 2 suits (6-6-0-0), all void in 2 suits'
  ));

  // 95: 11-1-0-0 extreme
  D.push(mk(
    cards('H',1,13,12,11,10,9,8,7,6,5,4) + cards('S',1),
    cards('S',13,12,11,10,9,8,7,6,5,4,3) + cards('C',1),
    cards('C',13,12,11,10,9,8,7,6,5,4,3) + cards('D',1),
    cards('D',13,12,11,10,9,8,7,6,5,4,3) + cards('H',2),
    cards('H',3) + cards('S',2) + cards('C',2) + cards('D',2),
    C9, '95: Each player 11-1-0-0, near-complete suits'
  ));

  // ========================================================================
  // CATEGORY 10: Bidding War Escalators (96-100)
  // Multiple players independently trigger high bids, creating wars.
  // ========================================================================

  // 96: All four players have 6-card suits with top cards
  D.push(mk(
    cards('H',1,13,12,11,10,9) + cards('S',8,7,6,5,4,3),
    cards('S',1,13,12,11,10,9) + cards('C',8,7,6,5,4,3),
    cards('C',1,13,12,11,10,9) + cards('D',8,7,6,5,4,3),
    cards('D',1,13,12,11,10,9) + cards('H',8,7,6,5,4,3),
    cards('H',2) + cards('S',2) + cards('C',2) + cards('D',2),
    C10, '96: Each player has A,K,Q,J,10,9 in one suit - all bid high'
  ));

  // 97: Three players have 7+ card suits
  D.push(mk(
    cards('H',1,13,12,11,10,9,8) + cards('S',1,13,12,11,10),
    cards('C',1,13,12,11,10,9,8,7) + cards('D',1,13,12,11),
    cards('S',2,3,4,5,6,7,8) + cards('D',2,3,4,5,6),
    cards('H',2,3,4,5,6,7) + cards('C',2,3,4,5,6) + cards('S',9),
    cards('D',7,8,9,10),
    C10, '97: S has 7H+5S, E has 8C+4D - both bid aggressively, war ensues'
  ));

  // 98: Two players with 8-card suits
  D.push(mk(
    cards('H',1,13,12,11,10,9,8,7) + cards('C',1,13,12,11),
    cards('S',1,13,12,11,10,9,8,7) + cards('D',1,13,12,11),
    cards('H',2,3,4,5,6) + cards('C',2,3,4,5,6,7,8),
    cards('S',2,3,4,5,6) + cards('D',2,3,4,5,6,7,8),
    cards('C',9,10) + cards('D',9,10),
    C10, '98: S has 8H+4C, E has 8S+4D - head-to-head bidding war'
  ));

  // 99: Everyone has strong suit + Aces
  D.push(mk(
    cards('H',1,13,12,11,10) + cards('S',1) + cards('C',8,9,10,11,12,13),
    cards('S',13,12,11,10,9) + cards('C',1) + cards('D',8,9,10,11,12,13),
    cards('D',7,6,5,4,3,2) + cards('H',2,3,4,5,6,7),
    cards('S',2,3,4,5,6,7,8) + cards('C',2,3,4,5,6),
    cards('H',8,9) + cards('D',1) + cards('C',7),
    C10, '99: S has 5H+AceS+6C, E has 5S+AceC+6D - multi-suit bidding war'
  ));

  // 100: Maximum contention - all players have exactly A,K,Q in different suits
  D.push(mk(
    cards('H',1,13,12) + cards('S',4,5,6) + cards('C',4,5,6) + cards('D',4,5,6),
    cards('S',1,13,12) + cards('H',4,5,6) + cards('C',7,8,9) + cards('D',7,8,9),
    cards('C',1,13,12) + cards('D',1,13,12) + cards('H',7,8,9) + cards('S',7,8,9),
    cards('H',10,11) + cards('S',10,11) + cards('C',10,11) + cards('D',10,11) + cards('H',2,3) + cards('S',2,3),
    cards('C',2,3) + cards('D',2,3),
    C10, '100: S=AKQ hearts, E=AKQ spades, N=AKQ clubs+diamonds - everyone bids'
  ));

  return D;
}

// Build and export the deck array (validated at import time)
export const RED_TEAM_DECKS: RedTeamDeck[] = generateDecks();
