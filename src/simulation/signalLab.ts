/**
 * Signal Lab: Parameterized signal-bid strategy generator for Bid Whist.
 *
 * Generates complete strategy text from a compact config, making it easy to
 * compare many signal-bid variants without hand-editing strategy DSL.
 */

import { STRATEGY_REGISTRY, splitStrategySections } from '../strategies/index.ts';

// ── Config type ──────────────────────────────────────────────────────

export interface SignalLabConfig {
  name: string;

  // ── Bid signals (seats 1 & 2) ──
  bid1Enabled: boolean;           // Enable bid 1 = downtown signal
  bid1Threshold: number;          // deuce_trey_count() >= N to trigger (2-4)
  bid2Enabled: boolean;           // Enable bid 2 = uptown signal
  bid2Threshold: number;          // king_ace_count() >= N to trigger (2-4)
  bid3Mode: 'mixed' | 'aces2' | 'aces3' | 'disabled';
  bid3MixedThreshold: number;     // For 'mixed': both high+low >= N
  strongSuitThreshold: number;    // Bid 4 when max_suit_count() >= N

  // ── Seat 3 (hot seat) ──
  seat3MinBid: number;            // Always bid at least N in seat 3
  seat3PushOnPartner: boolean;    // Bid higher when partner signal aligns

  // ── Dealer ──
  dealerTakeMax: number;          // Max bid dealer will "take"
  dealerStealProtection: boolean; // Don't steal partner's winning bid

  // ── Trump selection ──
  partnerBonus: number;           // +N to count when partner signals align (0-5)
  enemyCounter: number;           // +N counter against enemy signal (0-5)
  aceThreshold: number;           // Aces needed for downtown vs downtown-noaces
  trustBid3Aces: boolean;         // Treat partner bid 3 as "has 2+ aces"

  // ── Base style for play/discard ──
  baseStyle: string;              // Registry name to pull play & discard sections from
}

// ── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: SignalLabConfig = {
  name: 'Custom',
  bid1Enabled: true,
  bid1Threshold: 2,
  bid2Enabled: true,
  bid2Threshold: 2,
  bid3Mode: 'mixed',
  bid3MixedThreshold: 2,
  strongSuitThreshold: 5,
  seat3MinBid: 4,
  seat3PushOnPartner: true,
  dealerTakeMax: 3,
  dealerStealProtection: true,
  baseStyle: 'Claude',
  partnerBonus: 3,
  enemyCounter: 2,
  aceThreshold: 2,
  trustBid3Aces: false,
};

// ── Presets ──────────────────────────────────────────────────────────

export const SIGNAL_LAB_PRESETS: SignalLabConfig[] = [
  {
    name: 'No Signals',
    bid1Enabled: false,
    bid1Threshold: 2,
    bid2Enabled: false,
    bid2Threshold: 2,
    bid3Mode: 'disabled',
    bid3MixedThreshold: 2,
    strongSuitThreshold: 5,
    seat3MinBid: 4,
    seat3PushOnPartner: false,
    dealerTakeMax: 3,
    dealerStealProtection: false,
    baseStyle: 'Standard (Ignore Signals)',
    partnerBonus: 0,
    enemyCounter: 0,
    aceThreshold: 2,
    trustBid3Aces: false,
  },
  {
    name: 'Standard (2+, no bonus)',
    bid1Enabled: true,
    bid1Threshold: 2,
    bid2Enabled: true,
    bid2Threshold: 2,
    bid3Mode: 'mixed',
    bid3MixedThreshold: 2,
    strongSuitThreshold: 5,
    seat3MinBid: 4,
    seat3PushOnPartner: false,
    dealerTakeMax: 3,
    dealerStealProtection: false,
    baseStyle: 'Standard (Partner Signals)',
    partnerBonus: 0,
    enemyCounter: 0,
    aceThreshold: 2,
    trustBid3Aces: false,
  },
  {
    name: 'Standard (2+, +2 counter)',
    bid1Enabled: true,
    bid1Threshold: 2,
    bid2Enabled: true,
    bid2Threshold: 2,
    bid3Mode: 'mixed',
    bid3MixedThreshold: 2,
    strongSuitThreshold: 5,
    seat3MinBid: 4,
    seat3PushOnPartner: false,
    dealerTakeMax: 3,
    dealerStealProtection: false,
    baseStyle: 'Standard (All Signals)',
    partnerBonus: 3,
    enemyCounter: 2,
    aceThreshold: 2,
    trustBid3Aces: false,
  },
  {
    name: 'Family (3+, +3 bonus)',
    bid1Enabled: true,
    bid1Threshold: 3,
    bid2Enabled: true,
    bid2Threshold: 3,
    bid3Mode: 'mixed',
    bid3MixedThreshold: 3,
    strongSuitThreshold: 6,
    seat3MinBid: 4,
    seat3PushOnPartner: true,
    dealerTakeMax: 3,
    dealerStealProtection: true,
    baseStyle: 'Family',
    partnerBonus: 3,
    enemyCounter: 0,
    aceThreshold: 2,
    trustBid3Aces: false,
  },
  {
    name: 'Ace Signal (bid 3 = 2+ aces)',
    bid1Enabled: true,
    bid1Threshold: 3,
    bid2Enabled: true,
    bid2Threshold: 3,
    bid3Mode: 'aces2',
    bid3MixedThreshold: 2,
    strongSuitThreshold: 6,
    seat3MinBid: 4,
    seat3PushOnPartner: true,
    dealerTakeMax: 3,
    dealerStealProtection: true,
    baseStyle: 'Claude',
    partnerBonus: 3,
    enemyCounter: 2,
    aceThreshold: 2,
    trustBid3Aces: true,
  },
  {
    name: 'Ace Signal (3+ aces, +4 bonus)',
    bid1Enabled: true,
    bid1Threshold: 3,
    bid2Enabled: true,
    bid2Threshold: 3,
    bid3Mode: 'aces3',
    bid3MixedThreshold: 2,
    strongSuitThreshold: 6,
    seat3MinBid: 4,
    seat3PushOnPartner: true,
    dealerTakeMax: 3,
    dealerStealProtection: true,
    baseStyle: 'Claude',
    partnerBonus: 4,
    enemyCounter: 2,
    aceThreshold: 1,
    trustBid3Aces: true,
  },
  {
    name: 'Loose Signals (1+)',
    bid1Enabled: true,
    bid1Threshold: 1,
    bid2Enabled: true,
    bid2Threshold: 1,
    bid3Mode: 'mixed',
    bid3MixedThreshold: 1,
    strongSuitThreshold: 5,
    seat3MinBid: 4,
    seat3PushOnPartner: true,
    dealerTakeMax: 3,
    dealerStealProtection: true,
    baseStyle: 'Claude',
    partnerBonus: 2,
    enemyCounter: 1,
    aceThreshold: 2,
    trustBid3Aces: false,
  },
  {
    name: 'Tight Signals (4+)',
    bid1Enabled: true,
    bid1Threshold: 4,
    bid2Enabled: true,
    bid2Threshold: 4,
    bid3Mode: 'aces3',
    bid3MixedThreshold: 3,
    strongSuitThreshold: 6,
    seat3MinBid: 4,
    seat3PushOnPartner: true,
    dealerTakeMax: 3,
    dealerStealProtection: true,
    baseStyle: 'Claude',
    partnerBonus: 4,
    enemyCounter: 2,
    aceThreshold: 2,
    trustBid3Aces: true,
  },
  {
    name: 'No Bid-3 (signals 1 & 2 only)',
    bid1Enabled: true,
    bid1Threshold: 2,
    bid2Enabled: true,
    bid2Threshold: 2,
    bid3Mode: 'disabled',
    bid3MixedThreshold: 2,
    strongSuitThreshold: 5,
    seat3MinBid: 4,
    seat3PushOnPartner: true,
    dealerTakeMax: 3,
    dealerStealProtection: true,
    baseStyle: 'Claude',
    partnerBonus: 3,
    enemyCounter: 2,
    aceThreshold: 2,
    trustBid3Aces: false,
  },
  {
    name: 'Counter-Heavy (low trust, high counter)',
    bid1Enabled: true,
    bid1Threshold: 2,
    bid2Enabled: true,
    bid2Threshold: 2,
    bid3Mode: 'mixed',
    bid3MixedThreshold: 2,
    strongSuitThreshold: 5,
    seat3MinBid: 4,
    seat3PushOnPartner: false,
    dealerTakeMax: 3,
    dealerStealProtection: false,
    baseStyle: 'Standard (All Signals)',
    partnerBonus: 1,
    enemyCounter: 4,
    aceThreshold: 2,
    trustBid3Aces: false,
  },
];

// ── Strategy text generators ─────────────────────────────────────────

function generateBidSection(c: SignalLabConfig): string {
  const lines: string[] = ['bid:'];

  // ── Seats 1/2: strength bids first ──
  lines.push(`  # Seats 1/2: strength bids`);
  if (c.strongSuitThreshold <= 6) {
    lines.push(`  when bid_count < 2 and max_suit_count() >= ${c.strongSuitThreshold + 1} and bid.current < 5:`);
    lines.push('    bid 5');
  }
  lines.push(`  when bid_count < 2 and max_suit_count() >= ${c.strongSuitThreshold} and bid.current < 4:`);
  lines.push('    bid 4');

  // ── Seats 1/2: signal bids ──
  if (c.bid3Mode === 'mixed') {
    lines.push(`  # Signal 3: mixed (high+low >= ${c.bid3MixedThreshold})`);
    lines.push(`  when bid_count < 2 and deuce_trey_count() >= ${c.bid3MixedThreshold} and king_ace_count() >= ${c.bid3MixedThreshold} and bid.current < 3:`);
    lines.push('    bid 3');
  } else if (c.bid3Mode === 'aces2') {
    lines.push('  # Signal 3: 2+ aces');
    lines.push('  when bid_count < 2 and ace_count() >= 2 and bid.current < 3:');
    lines.push('    bid 3');
  } else if (c.bid3Mode === 'aces3') {
    lines.push('  # Signal 3: 3+ aces');
    lines.push('  when bid_count < 2 and ace_count() >= 3 and bid.current < 3:');
    lines.push('    bid 3');
  }

  if (c.bid2Enabled) {
    lines.push(`  # Signal 2: uptown (king_ace >= ${c.bid2Threshold})`);
    lines.push(`  when bid_count < 2 and king_ace_count() >= ${c.bid2Threshold} and max_suit_count() < ${c.strongSuitThreshold} and bid.current < 2:`);
    lines.push('    bid 2');
  }

  if (c.bid1Enabled) {
    lines.push(`  # Signal 1: downtown (deuce_trey >= ${c.bid1Threshold})`);
    lines.push(`  when bid_count < 2 and deuce_trey_count() >= ${c.bid1Threshold} and max_suit_count() < ${c.strongSuitThreshold} and bid.current < 1:`);
    lines.push('    bid 1');
  }

  // ── Seat 3 ──
  lines.push(`  # Seat 3: always bid at least ${c.seat3MinBid}`);
  lines.push(`  when bid_count == 2 and bid.current < ${c.seat3MinBid}:`);
  lines.push(`    bid ${c.seat3MinBid}`);

  if (c.seat3PushOnPartner) {
    const push = Math.min(c.seat3MinBid + 1, 6);
    if (c.trustBid3Aces && c.bid3Mode !== 'disabled') {
      lines.push(`  when bid_count == 2 and bid.current == ${c.seat3MinBid} and partner_bid == 3 and low_count() >= 3:`);
      lines.push(`    bid ${push}`);
    }
    lines.push(`  when bid_count == 2 and bid.current == ${c.seat3MinBid} and partner_bid == 1 and low_count() >= high_count():`);
    lines.push(`    bid ${push}`);
    lines.push(`  when bid_count == 2 and bid.current == ${c.seat3MinBid} and partner_bid == 2 and high_count() > low_count():`);
    lines.push(`    bid ${push}`);
    lines.push(`  when bid_count == 2 and bid.current == ${c.seat3MinBid} and max_suit_count() >= 6:`);
    lines.push(`    bid ${push}`);
  }

  lines.push('  when bid_count == 2:');
  lines.push('    pass');

  // ── Dealer ──
  lines.push('  # Dealer');
  lines.push('  when is_dealer and bid.current == 0:');
  lines.push('    bid 1');
  if (c.dealerStealProtection) {
    lines.push('  when is_dealer and partner_bid == bid.current and partner_bid > 0 and max_suit_count() <= 8:');
    lines.push('    pass');
  }
  lines.push(`  when is_dealer and bid.current <= ${c.dealerTakeMax}:`);
  lines.push('    bid take');
  if (c.dealerTakeMax < 6) {
    // Take a dealerTakeMax+1 only with hand support
    const next = c.dealerTakeMax + 1;
    lines.push(`  when is_dealer and bid.current == ${next} and max_suit_count() >= 5:`);
    lines.push('    bid take');
    lines.push(`  when is_dealer and bid.current == ${next} and king_ace_count() >= 3:`);
    lines.push('    bid take');
    if (c.trustBid3Aces) {
      lines.push(`  when is_dealer and bid.current == ${next} and ace_count() >= 2:`);
      lines.push('    bid take');
    }
  }
  lines.push('  default:');
  lines.push('    pass');

  return lines.join('\n');
}

function generateTrumpSection(c: SignalLabConfig): string {
  const lines: string[] = ['trump:'];
  const bonus = c.partnerBonus;
  const counter = c.enemyCounter;
  const aceReq = c.aceThreshold;

  // ── Partner bid 3 → "has aces" ──
  if (c.trustBid3Aces && c.bid3Mode !== 'disabled') {
    lines.push('  # Partner has aces (bid 3)');
    lines.push('  when partner_bid == 3 and ace_count() >= 1:');
    lines.push('    choose suit: best_suit(downtown) direction: downtown');
    lines.push('  when partner_bid == 3 and low_count() >= high_count():');
    lines.push('    choose suit: best_suit(downtown) direction: downtown');
    lines.push('  when partner_bid == 3:');
    lines.push('    choose suit: best_suit(uptown) direction: uptown');
  }

  // ── Partner downtown + enemy uptown → strong downtown ──
  if (c.bid1Enabled && counter > 0) {
    lines.push('  # Partner downtown + enemy uptown');
    lines.push(`  when partner_bid == 1 and enemy_bid == 2 and ace_count() >= ${aceReq}:`);
    lines.push('    choose suit: best_suit(downtown) direction: downtown');
    lines.push('  when partner_bid == 1 and enemy_bid == 2:');
    lines.push('    choose suit: best_suit(downtown-noaces) direction: downtown-noaces');
  }

  // ── Partner downtown (bid 1) ──
  if (c.bid1Enabled) {
    if (bonus > 0) {
      lines.push(`  # Partner downtown (+${bonus} bonus)`);
      lines.push(`  when partner_bid == 1 and low_count() + ${bonus} > high_count() and ace_count() >= ${aceReq}:`);
      lines.push('    choose suit: best_suit(downtown) direction: downtown');
      lines.push(`  when partner_bid == 1 and low_count() + ${bonus} > high_count():`);
      lines.push('    choose suit: best_suit(downtown-noaces) direction: downtown-noaces');
    } else {
      lines.push('  # Partner downtown');
      lines.push(`  when partner_bid == 1 and low_count() > high_count() and ace_count() >= ${aceReq}:`);
      lines.push('    choose suit: best_suit(downtown) direction: downtown');
      lines.push('  when partner_bid == 1 and low_count() > high_count():');
      lines.push('    choose suit: best_suit(downtown-noaces) direction: downtown-noaces');
    }
    lines.push('  when partner_bid == 1:');
    lines.push('    choose suit: best_suit(uptown) direction: uptown');
  }

  // ── Partner uptown + enemy downtown → strong uptown ──
  if (c.bid2Enabled && counter > 0) {
    lines.push('  # Partner uptown + enemy downtown');
    lines.push('  when partner_bid == 2 and enemy_bid == 1:');
    lines.push('    choose suit: best_suit(uptown) direction: uptown');
  }

  // ── Partner uptown (bid 2) ──
  if (c.bid2Enabled) {
    if (bonus > 0) {
      lines.push(`  # Partner uptown (+${bonus} bonus)`);
      lines.push(`  when partner_bid == 2 and high_count() + ${bonus} > low_count():`);
      lines.push('    choose suit: best_suit(uptown) direction: uptown');
    } else {
      lines.push('  # Partner uptown');
      lines.push('  when partner_bid == 2 and high_count() > low_count():');
      lines.push('    choose suit: best_suit(uptown) direction: uptown');
    }
    lines.push(`  when partner_bid == 2 and ace_count() >= ${aceReq}:`);
    lines.push('    choose suit: best_suit(downtown) direction: downtown');
    lines.push('  when partner_bid == 2:');
    lines.push('    choose suit: best_suit(downtown-noaces) direction: downtown-noaces');
  }

  // ── Counter enemy signals (no partner signal) ──
  if (counter > 0) {
    lines.push(`  # Counter enemy signals (+${counter})`);
    lines.push(`  when enemy_bid == 1 and high_count() + ${counter} > low_count():`);
    lines.push('    choose suit: best_suit(uptown) direction: uptown');
    lines.push(`  when enemy_bid == 2 and low_count() + ${counter} > high_count() and ace_count() >= ${aceReq}:`);
    lines.push('    choose suit: best_suit(downtown) direction: downtown');
    lines.push(`  when enemy_bid == 2 and low_count() + ${counter} > high_count():`);
    lines.push('    choose suit: best_suit(downtown-noaces) direction: downtown-noaces');
  }

  // ── Fallback: own hand ──
  lines.push('  # No signals — read own hand');
  lines.push(`  when low_count() > high_count() and ace_count() >= ${aceReq}:`);
  lines.push('    choose suit: best_suit(downtown) direction: downtown');
  lines.push('  when low_count() > high_count():');
  lines.push('    choose suit: best_suit(downtown-noaces) direction: downtown-noaces');
  lines.push('  default:');
  lines.push('    choose suit: best_suit(uptown) direction: uptown');

  return lines.join('\n');
}

/**
 * Generate a complete strategy text string from a SignalLabConfig.
 * Bid and trump sections are generated from parameters.
 * Play and discard sections are pulled from the base strategy.
 */
export function generateSignalStrategy(config: SignalLabConfig): string {
  const baseEntry = STRATEGY_REGISTRY.find(s => s.name === config.baseStyle);
  const baseSections = baseEntry
    ? splitStrategySections(baseEntry.text)
    : splitStrategySections(STRATEGY_REGISTRY[0].text);

  const header = `strategy "${config.name}"\ngame: bidwhist`;
  const play = baseSections.play;
  const bid = generateBidSection(config);
  const trump = generateTrumpSection(config);
  const discard = baseSections.discard;

  const parts = [header, play, bid, trump];
  if (discard) parts.push(discard);
  return parts.join('\n\n') + '\n';
}

// ── Short summary of a config (for UI labels) ────────────────────────

export function configSummary(c: SignalLabConfig): string {
  const parts: string[] = [];
  if (!c.bid1Enabled && !c.bid2Enabled && c.bid3Mode === 'disabled') {
    parts.push('no signals');
  } else {
    if (c.bid1Enabled) parts.push(`b1≥${c.bid1Threshold}`);
    if (c.bid2Enabled) parts.push(`b2≥${c.bid2Threshold}`);
    if (c.bid3Mode === 'mixed') parts.push(`b3=mix≥${c.bid3MixedThreshold}`);
    else if (c.bid3Mode === 'aces2') parts.push('b3=2A');
    else if (c.bid3Mode === 'aces3') parts.push('b3=3A');
  }
  if (c.partnerBonus > 0) parts.push(`+${c.partnerBonus}p`);
  if (c.enemyCounter > 0) parts.push(`+${c.enemyCounter}e`);
  return parts.join(' ');
}

// ── Available base styles ────────────────────────────────────────────

export function getAvailableBaseStyles(): string[] {
  return STRATEGY_REGISTRY
    .filter(s => s.game === 'bidwhist')
    .map(s => s.name);
}
