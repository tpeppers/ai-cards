// Strategy file contents exported as string constants.
// Built from composable sections: play (varies by signal mode) + bid + trump.

// ── Trump section: Ignore Signals (reads own hand only) ──

const TRUMP_SECTION_NOSIGNAL = `\
trump:
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when low_count() > high_count():
    choose suit: best_suit() direction: downtown-noaces
  default:
    choose suit: best_suit() direction: uptown`;

// ── Trump section: Partner Signals (reads partner bid, falls back to own hand) ──

const TRUMP_SECTION = `\
trump:
  # Partner signaled downtown (bid 1 = low cards)
  when partner_bid == 1:
    choose suit: best_suit() direction: downtown
  # Partner signaled uptown (bid 2 = high cards)
  when partner_bid == 2:
    choose suit: best_suit() direction: uptown
  # Partner bid 3+ or no signal - read own hand
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when low_count() > high_count():
    choose suit: best_suit() direction: downtown-noaces
  default:
    choose suit: best_suit() direction: uptown`;

// ── Trump section: All Signals (factors partner + enemy bids) ──

const TRUMP_SECTION_ALL = `\
trump:
  # Partner downtown + Enemy uptown → very strong downtown
  when partner_bid == 1 and enemy_bid == 2 and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when partner_bid == 1 and enemy_bid == 2:
    choose suit: best_suit() direction: downtown-noaces
  # Partner downtown (FAMILY-style +3 bonus)
  when partner_bid == 1 and low_count() + 3 > high_count() and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when partner_bid == 1 and low_count() + 3 > high_count():
    choose suit: best_suit() direction: downtown-noaces
  when partner_bid == 1:
    choose suit: best_suit() direction: uptown
  # Partner uptown + Enemy downtown → very strong uptown
  when partner_bid == 2 and enemy_bid == 1:
    choose suit: best_suit() direction: uptown
  # Partner uptown (FAMILY-style +3 bonus)
  when partner_bid == 2 and high_count() + 3 > low_count():
    choose suit: best_suit() direction: uptown
  when partner_bid == 2 and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when partner_bid == 2:
    choose suit: best_suit() direction: downtown-noaces
  # No partner signal, enemy downtown → lean uptown (+2 counter)
  when enemy_bid == 1 and high_count() + 2 > low_count():
    choose suit: best_suit() direction: uptown
  # No partner signal, enemy uptown → lean downtown (+2 counter)
  when enemy_bid == 2 and low_count() + 2 > high_count() and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when enemy_bid == 2 and low_count() + 2 > high_count():
    choose suit: best_suit() direction: downtown-noaces
  # No signals → read own hand
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when low_count() > high_count():
    choose suit: best_suit() direction: downtown-noaces
  default:
    choose suit: best_suit() direction: uptown`;

// ── Bid sections ────────────────────────────────────────────────────

const STANDARD_BID = `\
bid:
  # Dealer (4th bidder) handling
  when is_dealer and bid.current > 0 and bid.current <= 3:
    bid take
  when is_dealer and bid.current > 3:
    pass
  when is_dealer and bid.current == 0:
    bid 1

  # 3rd bidder: always bid at least 4
  when bid_count == 2 and bid.current < 4:
    bid 4
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6:
    bid 5
  when bid_count == 2:
    pass

  # 1st/2nd bidder: strong suit (5+ cards) -> bid 4
  when bid_count < 2 and max_suit_count() >= 5 and bid.current < 4:
    bid 4

  # 1st/2nd bidder: both low and high cards -> bid 3 (mixed signal)
  when bid_count < 2 and deuce_trey_count() >= 2 and king_ace_count() >= 2 and bid.current < 3:
    bid 3

  # 1st/2nd bidder: Kings/Aces but no strong suit -> bid 2 (signals uptown)
  when bid_count < 2 and king_ace_count() >= 2 and max_suit_count() < 5 and bid.current < 2:
    bid 2

  # 1st/2nd bidder: 2s/3s but no strong suit -> bid 1 (signals downtown)
  when bid_count < 2 and deuce_trey_count() >= 2 and max_suit_count() < 5 and bid.current < 1:
    bid 1

  default:
    pass`;

const AGGRESSIVE_BID = `\
bid:
  # Dealer takes anything up to 4
  when is_dealer and bid.current > 0 and bid.current <= 4:
    bid take
  when is_dealer and bid.current > 4:
    pass
  when is_dealer and bid.current == 0:
    bid 2

  # 3rd bidder: NEVER let a low bid through — always bid at least 4
  when bid_count == 2 and bid.current < 4:
    bid 4
  # Push to 5 with any strength
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 5:
    bid 5
  when bid_count == 2 and bid.current == 4 and king_ace_count() >= 2:
    bid 5
  when bid_count == 2 and bid.current == 4 and deuce_trey_count() >= 2:
    bid 5
  when bid_count == 2:
    pass

  # 1st/2nd bidder: strong suit -> bid 5
  when bid_count < 2 and max_suit_count() >= 5 and bid.current < 5:
    bid 5

  # 1st/2nd bidder: both low and high -> bid 4
  when bid_count < 2 and deuce_trey_count() >= 2 and king_ace_count() >= 2 and bid.current < 4:
    bid 4

  # 1st/2nd bidder: Kings/Aces -> bid 2 (signals uptown)
  when bid_count < 2 and king_ace_count() >= 2 and bid.current < 3:
    bid 2

  # 1st/2nd bidder: 2s/3s -> bid 1 (signals downtown)
  when bid_count < 2 and deuce_trey_count() >= 2 and bid.current < 2:
    bid 1

  default:
    pass`;

const CONSERVATIVE_BID = `\
bid:
  # Dealer takes only low bids
  when is_dealer and bid.current > 0 and bid.current <= 3:
    bid take
  when is_dealer and bid.current > 3:
    pass
  when is_dealer and bid.current == 0:
    bid 1

  # 3rd bidder: NEVER let a 1 or 2 bid reach dealer
  when bid_count == 2 and bid.current < 3:
    bid 3
  # With a strong hand, bid 4
  when bid_count == 2 and bid.current == 3 and max_suit_count() >= 5:
    bid 4
  when bid_count == 2 and bid.current == 3 and king_ace_count() >= 3:
    bid 4
  # Garbage hand: let a 3 pass through to 3rd seat
  when bid_count == 2:
    pass

  # 1st/2nd bidder: very strong suit (6+) -> bid 4
  when bid_count < 2 and max_suit_count() >= 6 and bid.current < 4:
    bid 4

  # 1st/2nd bidder: lots of both -> bid 3
  when bid_count < 2 and deuce_trey_count() >= 3 and king_ace_count() >= 3 and bid.current < 3:
    bid 3

  # 1st/2nd bidder: strong Kings/Aces -> bid 2 (signals uptown)
  when bid_count < 2 and king_ace_count() >= 3 and max_suit_count() < 5 and bid.current < 2:
    bid 2

  # 1st/2nd bidder: strong 2s/3s -> bid 1 (signals downtown)
  when bid_count < 2 and deuce_trey_count() >= 3 and max_suit_count() < 5 and bid.current < 1:
    bid 1

  default:
    pass`;

// ── Play sections: Standard × 3 signal modes ───────────────────────

const STANDARD_PLAY_NOSIGNAL = `\
play:
  leading:
    # On declarer's team, lead trump to pull opponents' trump
    when on_declarer_team and has_trump:
      play hand.trump.strongest
    default:
      play hand.weakest

  following:
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    when not partner_winning and has_trump:
      play hand.trump.weakest
    default:
      play hand.weakest`;

const STANDARD_PLAY_PARTNER = `\
play:
  leading:
    # Partner signaled a suit - lead it to pass control
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).weakest
    # On declarer's team, lead trump to pull opponents' trump
    when on_declarer_team and has_trump:
      play hand.trump.strongest
    default:
      play hand.weakest

  following:
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    # First void: signal partner with weakest non-trump
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    when not partner_winning and has_trump:
      play hand.trump.weakest
    default:
      play hand.weakest`;

const STANDARD_PLAY_ALL = `\
play:
  leading:
    # Partner signaled a suit - lead it to pass control
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).weakest
    # Cash boss cards (guaranteed winners, safe vs enemy strength)
    when hand.boss.count > 0:
      play hand.boss.weakest
    # On declarer's team, lead trump to pull opponents' trump
    when on_declarer_team and has_trump:
      play hand.trump.strongest
    default:
      play hand.weakest

  following:
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    # First void: signal partner with weakest non-trump
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    when not partner_winning and has_trump:
      play hand.trump.weakest
    default:
      play hand.weakest`;

// ── Play sections: Aggressive × 3 signal modes ─────────────────────

const AGGRESSIVE_PLAY_NOSIGNAL = `\
play:
  leading:
    when has_trump:
      play hand.trump.strongest
    default:
      play hand.strongest

  following:
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.strongest
    default:
      play hand.suit(lead_suit).strongest

  void:
    when has_trump:
      play hand.trump.strongest
    default:
      play hand.strongest`;

const AGGRESSIVE_PLAY_PARTNER = `\
play:
  leading:
    # Partner signaled - lead their suit aggressively
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).strongest
    when has_trump:
      play hand.trump.strongest
    default:
      play hand.strongest

  following:
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.strongest
    default:
      play hand.suit(lead_suit).strongest

  void:
    # First void: signal partner with weakest non-trump
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    when has_trump:
      play hand.trump.strongest
    default:
      play hand.strongest`;

const AGGRESSIVE_PLAY_ALL = `\
play:
  leading:
    # Partner signaled - lead their suit aggressively
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).strongest
    # Cash boss cards aggressively
    when hand.boss.count > 0:
      play hand.boss.strongest
    when has_trump:
      play hand.trump.strongest
    default:
      play hand.strongest

  following:
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.strongest
    default:
      play hand.suit(lead_suit).strongest

  void:
    # First void: signal partner with weakest non-trump
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    when has_trump:
      play hand.trump.strongest
    default:
      play hand.strongest`;

// ── Play sections: Conservative × 3 signal modes ───────────────────

const CONSERVATIVE_PLAY_NOSIGNAL = `\
play:
  leading:
    default:
      play hand.weakest

  following:
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    when not partner_winning and has_trump:
      play hand.trump.weakest
    default:
      play hand.weakest`;

const CONSERVATIVE_PLAY_PARTNER = `\
play:
  leading:
    # Partner signaled - cautiously lead their suit
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).weakest
    default:
      play hand.weakest

  following:
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    # First void: signal partner with weakest non-trump
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    when not partner_winning and has_trump:
      play hand.trump.weakest
    default:
      play hand.weakest`;

const CONSERVATIVE_PLAY_ALL = `\
play:
  leading:
    # Partner signaled - cautiously lead their suit
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).weakest
    # Cash boss cards only (guaranteed safe leads)
    when hand.boss.count > 0:
      play hand.boss.weakest
    default:
      play hand.weakest

  following:
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    # First void: signal partner with weakest non-trump
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    when not partner_winning and has_trump:
      play hand.trump.weakest
    default:
      play hand.weakest`;

// ── Family strategy sections ──────────────────────────────────────

const FAMILY_BID = `\
bid:
  # ── Seats 1/2 (early bidders): signal bids ──
  # 6+ sure winners (long suit) → always bid 4
  when bid_count < 2 and max_suit_count() >= 6 and bid.current < 4:
    bid 4
  # 7+ sure winners → bid 5
  when bid_count < 2 and max_suit_count() >= 7 and bid.current < 5:
    bid 5
  # Signal 3: strong both directions (>3 winners each way)
  when bid_count < 2 and king_ace_count() >= 3 and deuce_trey_count() >= 3 and bid.current < 3:
    bid 3
  # Signal 2: high cards (uptown signal)
  when bid_count < 2 and high_count() > low_count() and bid.current < 2:
    bid 2
  # Signal 1: low cards (downtown signal)
  when bid_count < 2 and low_count() >= high_count() and bid.current < 1:
    bid 1

  # ── Seat 3 (hot seat): ALWAYS bid at least 4 ──
  when bid_count == 2 and bid.current < 4:
    bid 4
  # Partner signaled same direction → +1 (max 5, NEVER 6)
  when bid_count == 2 and bid.current == 4 and partner_bid == 1 and low_count() >= high_count():
    bid 5
  when bid_count == 2 and bid.current == 4 and partner_bid == 2 and high_count() > low_count():
    bid 5
  # Strong hand (long suit or lots of face cards) → bid 5
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6:
    bid 5
  when bid_count == 2:
    pass

  # ── Dealer: take if bid matches what you'd bid, pass if too high ──
  when is_dealer and bid.current == 0:
    bid 1
  # Low signal bids → always take (you get to call trump)
  when is_dealer and bid.current <= 3:
    bid take
  # Take a 4 only if hand supports it
  when is_dealer and bid.current == 4 and max_suit_count() >= 5:
    bid take
  when is_dealer and bid.current == 4 and king_ace_count() >= 3:
    bid take
  default:
    pass`;

const FAMILY_TRUMP = `\
trump:
  # ── Partner bid 1 (low signal): factor as +3 low winners ──
  when partner_bid == 1 and low_count() + 3 > high_count() and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when partner_bid == 1 and low_count() + 3 > high_count():
    choose suit: best_suit() direction: downtown-noaces
  # Partner signaled low but our hand is overwhelmingly high
  when partner_bid == 1:
    choose suit: best_suit() direction: uptown

  # ── Partner bid 2 (high signal): factor as +3 high winners ──
  when partner_bid == 2 and high_count() + 3 > low_count():
    choose suit: best_suit() direction: uptown
  # Partner signaled high but our hand is overwhelmingly low
  when partner_bid == 2 and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when partner_bid == 2:
    choose suit: best_suit() direction: downtown-noaces

  # ── No partner signal (bid 3+ or passed): read own hand ──
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when low_count() > high_count():
    choose suit: best_suit() direction: downtown-noaces
  default:
    choose suit: best_suit() direction: uptown`;

const FAMILY_PLAY = `\
play:
  leading:
    # Cash boss cards (guaranteed winners)
    when hand.boss.count > 0:
      play hand.boss.weakest
    # Lead partner's shortsuit (they can trump it)
    when partner_shortsuit.count > 0:
      play partner_shortsuit.weakest
    # Pull trump ONLY when enemies still have trump (never pull partner's trump)
    when on_declarer_team and has_trump and enemy_has_trump:
      play hand.trump.strongest
    # Lead partner's signal suit
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).weakest
    default:
      play hand.weakest

  following:
    # Standard: play weakest winner, else weakest of suit
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    # Trump immediately when void (family style), unless partner winning
    when not partner_winning and has_trump:
      play hand.trump.weakest
    # Signal with non-trump after
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest`;

// ── Strategy builder ────────────────────────────────────────────────

function buildStrategy(name: string, play: string, bid: string, trump: string): string {
  return `strategy "${name}"\ngame: bidwhist\n\n${play}\n\n${bid}\n\n${trump}\n`;
}

// ── Composed Bid Whist strategies (3 base × 3 signal modes = 9) ─────

export const BIDWHIST_STANDARD_NOSIGNAL = buildStrategy(
  'Standard (Ignore Signals)', STANDARD_PLAY_NOSIGNAL, STANDARD_BID, TRUMP_SECTION_NOSIGNAL);
export const BIDWHIST_STANDARD_PARTNER = buildStrategy(
  'Standard (Partner Signals)', STANDARD_PLAY_PARTNER, STANDARD_BID, TRUMP_SECTION);
export const BIDWHIST_STANDARD_ALL = buildStrategy(
  'Standard (All Signals)', STANDARD_PLAY_ALL, STANDARD_BID, TRUMP_SECTION_ALL);

export const BIDWHIST_AGGRESSIVE_NOSIGNAL = buildStrategy(
  'Aggressive (Ignore Signals)', AGGRESSIVE_PLAY_NOSIGNAL, AGGRESSIVE_BID, TRUMP_SECTION_NOSIGNAL);
export const BIDWHIST_AGGRESSIVE_PARTNER = buildStrategy(
  'Aggressive (Partner Signals)', AGGRESSIVE_PLAY_PARTNER, AGGRESSIVE_BID, TRUMP_SECTION);
export const BIDWHIST_AGGRESSIVE_ALL = buildStrategy(
  'Aggressive (All Signals)', AGGRESSIVE_PLAY_ALL, AGGRESSIVE_BID, TRUMP_SECTION_ALL);

export const BIDWHIST_CONSERVATIVE_NOSIGNAL = buildStrategy(
  'Conservative (Ignore Signals)', CONSERVATIVE_PLAY_NOSIGNAL, CONSERVATIVE_BID, TRUMP_SECTION_NOSIGNAL);
export const BIDWHIST_CONSERVATIVE_PARTNER = buildStrategy(
  'Conservative (Partner Signals)', CONSERVATIVE_PLAY_PARTNER, CONSERVATIVE_BID, TRUMP_SECTION);
export const BIDWHIST_CONSERVATIVE_ALL = buildStrategy(
  'Conservative (All Signals)', CONSERVATIVE_PLAY_ALL, CONSERVATIVE_BID, TRUMP_SECTION_ALL);

// ── Family strategy ──────────────────────────────────────────────────

export const BIDWHIST_FAMILY = buildStrategy('Family', FAMILY_PLAY, FAMILY_BID, FAMILY_TRUMP);

// Backward-compatible aliases (point to Partner Signals variants)
export const BIDWHIST_STANDARD = BIDWHIST_STANDARD_PARTNER;
export const BIDWHIST_AGGRESSIVE = BIDWHIST_AGGRESSIVE_PARTNER;
export const BIDWHIST_CONSERVATIVE = BIDWHIST_CONSERVATIVE_PARTNER;

// ── Hearts ──────────────────────────────────────────────────────────

export const HEARTS_STANDARD = `strategy "Hearts Standard"
game: hearts

play:
  leading:
    # Must play 2 of clubs if we have it (first trick)
    when have("clubs_2"):
      play hand.suit("clubs").weakest
    # If hearts aren't broken, lead a non-heart
    when not hearts_broken and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    # Otherwise play weakest card
    default:
      play hand.weakest

  following:
    # Play strongest card that won't win the trick (duck under)
    when hand.suit(lead_suit).losers.count > 0:
      play hand.suit(lead_suit).losers.strongest
    # Must win - play weakest of suit
    default:
      play hand.suit(lead_suit).weakest

  void:
    # Dump queen of spades if possible
    when have("spades_12") and not is_first_trick:
      play hand.suit("spades").strongest
    # Dump high hearts
    when hand.hearts.count > 0 and not is_first_trick:
      play hand.hearts.strongest
    # First trick - play king of spades if we have it
    when have("spades_13") and is_first_trick:
      play hand.suit("spades").strongest
    # Play strongest card to dump points
    default:
      play hand.strongest
`;

// ── Section split/replace utilities ──────────────────────────────────

export interface StrategySections {
  header: string;
  play: string;
  bid: string;
  trump: string;
}

const SECTION_KEYWORDS = ['play', 'bid', 'trump'] as const;
type SectionKey = typeof SECTION_KEYWORDS[number];

/**
 * Splits a full strategy string into { header, play, bid, trump }.
 * Detects top-level section keywords (play:, bid:, trump:) at the start of a line.
 * Everything before the first section is `header`.
 */
export function splitStrategySections(text: string): StrategySections {
  const lines = text.split('\n');
  const result: StrategySections = { header: '', play: '', bid: '', trump: '' };
  let currentSection: SectionKey | 'header' = 'header';
  const buckets: Record<string, string[]> = { header: [], play: [], bid: [], trump: [] };

  for (const line of lines) {
    const trimmed = line.trimStart();
    let matched = false;
    for (const kw of SECTION_KEYWORDS) {
      if (trimmed.startsWith(kw + ':') && (trimmed.length === kw.length + 1 || trimmed[kw.length + 1] === ' ' || trimmed[kw.length + 1] === '\n' || trimmed[kw.length + 1] === '\r')) {
        currentSection = kw;
        matched = true;
        break;
      }
    }
    // Skip blank lines between sections (don't add leading blanks to a new section)
    if (matched && buckets[currentSection].length === 0) {
      buckets[currentSection].push(line);
    } else {
      buckets[currentSection].push(line);
    }
  }

  for (const key of ['header', ...SECTION_KEYWORDS]) {
    // Trim trailing blank lines from each section
    const bucket = buckets[key];
    while (bucket.length > 0 && bucket[bucket.length - 1].trim() === '') {
      bucket.pop();
    }
    result[key as keyof StrategySections] = bucket.join('\n');
  }

  return result;
}

/**
 * Replaces one section in a strategy text string.
 * Splits into sections, swaps the target, recomposes.
 */
export function replaceStrategySection(text: string, section: SectionKey, newSectionText: string): string {
  const sections = splitStrategySections(text);
  sections[section] = newSectionText;
  const parts = [sections.header, sections.play, sections.bid, sections.trump].filter(s => s.length > 0);
  return parts.join('\n\n') + '\n';
}

// ── Registry ────────────────────────────────────────────────────────

export interface StrategyRegistryEntry {
  name: string;
  game: string;
  text: string;
}

export const STRATEGY_REGISTRY: StrategyRegistryEntry[] = [
  { name: 'Standard (Ignore Signals)', game: 'bidwhist', text: BIDWHIST_STANDARD_NOSIGNAL },
  { name: 'Standard (Partner Signals)', game: 'bidwhist', text: BIDWHIST_STANDARD_PARTNER },
  { name: 'Standard (All Signals)', game: 'bidwhist', text: BIDWHIST_STANDARD_ALL },
  { name: 'Aggressive (Ignore Signals)', game: 'bidwhist', text: BIDWHIST_AGGRESSIVE_NOSIGNAL },
  { name: 'Aggressive (Partner Signals)', game: 'bidwhist', text: BIDWHIST_AGGRESSIVE_PARTNER },
  { name: 'Aggressive (All Signals)', game: 'bidwhist', text: BIDWHIST_AGGRESSIVE_ALL },
  { name: 'Conservative (Ignore Signals)', game: 'bidwhist', text: BIDWHIST_CONSERVATIVE_NOSIGNAL },
  { name: 'Conservative (Partner Signals)', game: 'bidwhist', text: BIDWHIST_CONSERVATIVE_PARTNER },
  { name: 'Conservative (All Signals)', game: 'bidwhist', text: BIDWHIST_CONSERVATIVE_ALL },
  { name: 'Family', game: 'bidwhist', text: BIDWHIST_FAMILY },
  { name: 'Standard', game: 'hearts', text: HEARTS_STANDARD },
];
