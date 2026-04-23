/**
 * Parameterized Family-Powered strategy generator.
 *
 * Produces a strategy text that mirrors Family's structure but exposes
 * the signal thresholds and partner-trust parameters as numbers, so
 * sweeps over (signal strength, receiver adjustment) can run without
 * touching the DSL source for each config. Raising the signal threshold
 * means "takes more good cards before I'll signal a direction"; the
 * partner-trust bonus says how much extra weight the receiver gives the
 * signal when reading their own hand for the trump decision.
 *
 * The dealer-opp-pass threshold is an extra experiment: when partner
 * signaled direction X and I hold hand_power(opposite-X) >= this, pass
 * in seat 3 and let the enemy take the bid. (Set to a large value like
 * 99 to disable.)
 */

export interface FamilyPoweredParams {
  /** hand_power(direction) threshold to be willing to signal in seat 1/2 */
  sigThreshold: number;
  /** low/high count bonus added to my side when partner signaled */
  trustBonus: number;
  /** when partner signaled and I'm heavily opposite, pass in seat 3 (set >=99 to disable) */
  oppPassThreshold: number;
  /** strong-suit length required by dealer to take a 4 */
  dealerLongSuit: number;
  /**
   * Minimum king_ace_count required in addition to hand_power to signal.
   * 0 means "pure hand_power" (Q/J-only hands can signal). 2 is the
   * compound predicate: hand must have hand_power(dir)>=sig AND at least
   * 2 stoppers. Families implicitly requires 3.
   */
  minStoppers?: number;

  // ── Bid-3 (both-directions) tuning ──
  /**
   * Threshold for bid 3 ("both directions"). Defaults to sigThreshold.
   * Lower values let more hands fire bid 3; setting to 99 disables bid 3.
   */
  bid3Threshold?: number;

  // ── Opponent-signal defensive takes ──
  /**
   * When partner_bid and enemy_bid signal OPPOSITE directions, the dealer
   * takes a bid 4 if hand_power(partner's_direction) >= this threshold.
   * 99 disables the defensive take. The rationale: if we let the
   * opponents win the bid, they'd call the direction they signaled;
   * taking defensively forces the direction we're strong in.
   */
  defensiveTakeThreshold?: number;
  /**
   * Same logic as defensiveTakeThreshold but for bid 5 (requires stronger
   * hand to take a higher contract). 99 disables.
   */
  defensiveTakeAt5Threshold?: number;

  // ── Seat-3 contested push ──
  /**
   * Seat-3 (hot seat) pushes to 5 when partner_bid and enemy_bid signal
   * OPPOSITE directions AND hand_power(partner's direction) >= this
   * threshold. 99 disables. Complements the existing "partner signaled
   * same direction + low/high count edge" push rules.
   */
  contestedPushThreshold?: number;

  // ── Bid 3 re-interpretation ──
  /**
   * How the bid-3 rule is structured:
   *   - 'hand_power' (default): fire when hand_power(up) >= bid3Threshold
   *     AND hand_power(down) >= bid3Threshold. Legacy / original sense.
   *   - 'aces': fire when ace_count() >= 2. The bid now specifically
   *     signals "I have 2+ aces" — a concrete stopper count that the
   *     receiver can act on. Placed AFTER the long-suit rules so a
   *     6+-card hand that would win with bid 4 doesn't get downgraded
   *     to a 3. (Mechanism A in the bid3 deep-dive.)
   * Set `bid3Threshold = 99` to disable bid 3 entirely regardless of mode.
   */
  bid3Mode?: 'hand_power' | 'aces';

  /**
   * When true, add receiver-side trump-selection rules for partner_bid == 3.
   * Only meaningful when bid3Mode = 'aces' (the signal carries semantic
   * content). The new rules prefer downtown-aces-good when the signaler's
   * 2+ aces combined with our own aces or a voidable short suit make
   * that direction viable.
   */
  trumpBid3Aware?: boolean;

  /**
   * Minimum ace_count to trigger bid 3 in aces mode. Default 2. Tightening
   * to 3 (or 4) makes bid 3 a rarer, more specific signal about partner's
   * stopper density. With 2 the signal fires on ~20% of hands; with 3
   * on ~1.5%; with 4 on ~0.25%.
   */
  bid3AceCount?: number;

  /**
   * When true AND bid3Mode = 'aces', seat 3 pushes to 5 on partner_bid == 3
   * based on my own ace or downtown-strength contribution. Without this,
   * the existing seat-3 push rules only look at partner_bid in {1, 2}.
   */
  bid3ReceiverSeat3?: boolean;

  /**
   * When true AND bid3Mode = 'aces', the dealer is more willing to TAKE
   * bid 4 specifically on partner_bid == 3 — even with a moderate hand
   * because partner's 2+ aces combine with our own hand to usually make
   * the contract.
   */
  bid3ReceiverDealer?: boolean;

  /**
   * When true, add receiver rules that interpret partner's bid 1 or bid 2
   * at sig=17 as a genuinely strong signal (3+ winners in the signaled
   * direction) rather than the weaker "3+ K/A" semantics of Family's
   * existing rules. Pushes to 5 more aggressively in seat 3 and has
   * dealer take bid 4 more often when we have any support in partner's
   * direction.
   */
  sig17ReceiverBoost?: boolean;

  /**
   * Add a bid-4 rule triggered by "hand_power(direction) >= sig AND
   * max_suit_count >= this threshold". 0 disables the rule. Typical
   * values: 4 (liberal — commits to 4 on sig-strong hands with a 4+
   * suit) or 5 (conservative). Placed after the existing max_suit >= 6
   * rule so truly long hands still bid 4 via length.
   */
  bid4OnSigAndSuit?: number;

  /**
   * When true, add explicit void-creation discard rules for the case
   * where partner signaled a direction but I called the opposite —
   * specifically `partner_bid == 1 and bid_direction == "uptown"` and
   * the symmetric `partner_bid == 2 and bid_direction != "uptown"`. In
   * those cases partner's signal is non-useful in the chosen direction,
   * so we want to create a void to regain control via trumping.
   * Family's min_suit_count fallback already does this implicitly; the
   * flag makes it an explicit, earlier-matching rule.
   */
  smartDiscardOpposite?: boolean;
}

export function generateFamilyPoweredTuned(p: FamilyPoweredParams): string {
  const minStop = p.minStoppers ?? 0;
  const bid3T = p.bid3Threshold ?? p.sigThreshold;
  const defT = p.defensiveTakeThreshold ?? 99;
  const def5T = p.defensiveTakeAt5Threshold ?? 99;
  const contestedT = p.contestedPushThreshold ?? 99;
  const bid3Mode = p.bid3Mode ?? 'hand_power';
  const trumpBid3Aware = p.trumpBid3Aware ?? false;
  const smartDiscardOpposite = p.smartDiscardOpposite ?? false;
  const bid3AceCount = p.bid3AceCount ?? 2;
  const bid3ReceiverSeat3 = p.bid3ReceiverSeat3 ?? false;
  const bid3ReceiverDealer = p.bid3ReceiverDealer ?? false;
  const sig17ReceiverBoost = p.sig17ReceiverBoost ?? false;
  const bid4OnSigAndSuit = p.bid4OnSigAndSuit ?? 0;
  const parts = [
    `sig=${p.sigThreshold}`,
    `trust=${p.trustBonus}`,
    `opp=${p.oppPassThreshold}`,
    `minStop=${minStop}`,
    `bid3=${bid3T}`,
    `bid3Mode=${bid3Mode}`,
    bid3Mode === 'aces' ? `aces=${bid3AceCount}` : '',
    `defT=${defT}`,
    `def5T=${def5T}`,
    `contested=${contestedT}`,
    trumpBid3Aware ? 'b3trump' : '',
    bid3ReceiverSeat3 ? 'b3seat3' : '',
    bid3ReceiverDealer ? 'b3dealer' : '',
    sig17ReceiverBoost ? 'sigBoost' : '',
    bid4OnSigAndSuit > 0 ? `bid4sig${bid4OnSigAndSuit}` : '',
    smartDiscardOpposite ? 'b3discard' : '',
  ].filter(s => s);
  const name = `Family (Powered ${parts.join(' ')})`;
  const stopGuard = minStop > 0 ? ' and king_ace_count() >= min_stoppers' : '';

  // Bid-3 rule — content + placement depend on bid3Mode. In 'aces' mode
  // the rule fires on ace_count >= 2 and is placed AFTER the long-suit
  // rules (fixes the "under-commit" mechanism). In 'hand_power' mode the
  // rule fires on compound hand_power and is placed FIRST (legacy).
  const bid3RuleHandPower =
    `  # Signal 3: strong both directions (legacy hand_power mode).
  when bid_count < 2 and hand_power(uptown) >= bid3_threshold and hand_power(downtown) >= bid3_threshold${stopGuard} and bid.current < 3:
    bid 3`;
  const bid3RuleAces =
    `  # Signal 3: ${bid3AceCount}+ aces (aces-signal mode). Placed after long-suit
  # rules so hands with a 6+ suit get bid 4 via length, not downgraded.
  when bid_count < 2 and ace_count() >= bid3_ace_count and bid.current < 3:
    bid 3`;
  const longSuitRules =
    `  # 6+ long suit
  when bid_count < 2 and max_suit_count() >= 6 and bid.current < 4:
    bid 4
  # 7+ very long suit
  when bid_count < 2 and max_suit_count() >= 7 and bid.current < 5:
    bid 5`;
  const bid4SigAndSuitRules = bid4OnSigAndSuit > 0 ? `
  # Direct bid 4 on strong hand with a moderately long suit (opt-in).
  # Fires before bid 2/bid 1 signals so strong-enough hands commit to a
  # 4-contract rather than sending a lesser signal.
  when bid_count < 2 and hand_power(uptown) >= sig_threshold and max_suit_count() >= bid4_on_sig_suit and bid.current < 4:
    bid 4
  when bid_count < 2 and hand_power(downtown) >= sig_threshold and max_suit_count() >= bid4_on_sig_suit and bid.current < 4:
    bid 4` : '';

  const bidHeader = bid3Mode === 'aces'
    ? `${longSuitRules}\n${bid3RuleAces}${bid4SigAndSuitRules}`
    : `${bid3RuleHandPower}\n${longSuitRules}${bid4SigAndSuitRules}`;

  // Trump rules for partner_bid == 3 under the aces interpretation.
  // Only relevant when trumpBid3Aware is true and bid3Mode is 'aces'
  // (otherwise the signal isn't guaranteed to mean "2+ aces").
  const trumpBid3Rules = (trumpBid3Aware && bid3Mode === 'aces') ? `
  # Partner signaled 2+ aces (bid 3). Downtown-aces-good is strong:
  # combined ace count ≥ 3, so low cards in our hand become winners.
  # I have at least 1 ace — combined ≥ 3 aces, strong downtown
  when partner_bid == 3 and ace_count() >= 1:
    choose suit: best_suit(downtown) direction: downtown
  # I have no aces but can create a void — partner's aces stop the other
  # three suits, I trump the fourth.
  when partner_bid == 3 and min_suit_count() == 0:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 3 and min_suit_count() <= 2:
    choose suit: best_suit(downtown) direction: downtown
  # I'm predominantly high — go uptown, partner's aces still help.
  when partner_bid == 3 and high_count() + 2 > low_count():
    choose suit: best_suit(uptown) direction: uptown
  # Fallback: downtown but tag aces as no-good (conservative — partner's
  # aces still work as the only stoppers).
  when partner_bid == 3:
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
` : '';

  // Discard rules for the "going opposite to partner's signal" case.
  // Makes the void-creation explicit rather than relying on fall-through
  // to min_suit_count.
  const smartDiscardRules = smartDiscardOpposite ? `
  # Partner signaled down but we called up (or vice versa) — partner's
  # direction doesn't help, so create a void to regain control by
  # trumping.
  when partner_bid == 1 and bid_direction == "uptown":
    drop void_candidates()
  when partner_bid == 2 and bid_direction != "uptown":
    drop void_candidates()
` : '';

  // Seat-3 push rules for partner_bid == 3 under aces mode. The signal
  // says partner has 2+ aces — with any support in my hand, push to 5.
  const seat3Bid3Rules = (bid3ReceiverSeat3 && bid3Mode === 'aces') ? `  # Partner signaled 2+ aces (bid 3) — push to 5 if I have any ace support
  # or moderate downtown depth (combined aces stop tricks in downtown).
  when bid_count == 2 and bid.current == 4 and partner_bid == 3 and ace_count() >= 1:
    bid 5
  when bid_count == 2 and bid.current == 4 and partner_bid == 3 and hand_power(downtown) >= 8:
    bid 5
` : '';

  // Seat-3 push rules when partner signaled bid 1/2 at sig=17 — the
  // signal means "3+ winners in my direction", so push to 5 if I have
  // any matching depth (not just a low/high count edge).
  const seat3Sig17Rules = sig17ReceiverBoost ? `  # Sig-17 aware: partner's bid 1/2 = 3+ winners in signaled direction.
  # Push to 5 on any matching depth (not just count edge).
  when bid_count == 2 and bid.current == 4 and partner_bid == 1 and hand_power(downtown) >= 8:
    bid 5
  when bid_count == 2 and bid.current == 4 and partner_bid == 2 and hand_power(uptown) >= 8:
    bid 5
` : '';

  // Dealer take rules for partner_bid == 3 under aces mode. Take the 4
  // if I have any ace or a 4+ suit — combined strength usually makes.
  const dealerBid3Rules = (bid3ReceiverDealer && bid3Mode === 'aces') ? `  # Partner signaled 2+ aces (bid 3) — take bid 4 aggressively.
  when is_dealer and bid.current == 4 and partner_bid == 3 and ace_count() >= 1:
    bid take
  when is_dealer and bid.current == 4 and partner_bid == 3 and max_suit_count() >= 4:
    bid take
` : '';

  // Dealer take rules when partner signaled bid 1/2 at sig=17 — take
  // more aggressively knowing partner's signal carries real strength.
  const dealerSig17Rules = sig17ReceiverBoost ? `  # Sig-17 aware dealer take: partner's signal is 3+ winners.
  when is_dealer and bid.current == 4 and partner_bid == 1 and hand_power(downtown) >= 8:
    bid take
  when is_dealer and bid.current == 4 and partner_bid == 2 and hand_power(uptown) >= 8:
    bid take
` : '';

  return `strategy "${name}"
game: bidwhist

let sig_threshold = ${p.sigThreshold}
let trust = ${p.trustBonus}
let opp_pass = ${p.oppPassThreshold}
let dealer_bid4_suit_req = ${p.dealerLongSuit}
let min_stoppers = ${minStop}
let bid3_threshold = ${bid3T}
let bid3_ace_count = ${bid3AceCount}
let bid4_on_sig_suit = ${bid4OnSigAndSuit}
let defense_take = ${defT}
let defense_take_at_5 = ${def5T}
let contested_push = ${contestedT}

play:
  leading:
    when on_declarer_team and has_trump and hand.nontrump.count == 1:
      play hand.trump.strongest
    when on_declarer_team and has_trump and enemy_has_trump and outstanding_trump() > 0:
      play hand.trump.strongest
    when hand.boss.nontrump.count > 0:
      play hand.boss.nontrump.weakest
    when on_declarer_team and partner_has_trump and partner_shortsuit.count > 0:
      play partner_shortsuit.weakest
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).weakest
    when hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest

  following:
    when partner_winning and outstanding_threats() == 0:
      play hand.suit(lead_suit).weakest
    when partner_winning and hand.suit(lead_suit).winners.boss.count > 0:
      play hand.suit(lead_suit).winners.boss.weakest
    when partner_winning:
      play hand.suit(lead_suit).weakest
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    when not partner_winning and has_trump:
      play hand.trump.weakest
    when partner_winning and outstanding_threats() > 0 and has_trump:
      play hand.trump.weakest
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest

bid:
${bidHeader}
  # Signal 2: uptown power (optional stopper guard)
  when bid_count < 2 and hand_power(uptown) >= sig_threshold${stopGuard} and bid.current < 2:
    bid 2
  # Signal 1: downtown power
  when bid_count < 2 and hand_power(downtown) >= sig_threshold${stopGuard} and bid.current < 1:
    bid 1

  # ── Seat 3 (hot seat) ──
  # Opposite-direction pass: if partner signaled DOWN but I'm strongly UP,
  # let enemies take the bid — partner can stop uptown, I can stop downtown.
  when bid_count == 2 and bid.current == 4 and partner_bid == 1 and hand_power(uptown) >= opp_pass:
    pass
  when bid_count == 2 and bid.current == 4 and partner_bid == 2 and hand_power(downtown) >= opp_pass:
    pass
  # Always bid at least 4 in seat 3
  when bid_count == 2 and bid.current < 4:
    bid 4
${seat3Bid3Rules}${seat3Sig17Rules}  # Contested-signal push to 5: partner signaled one way, enemy the other.
  # If I'm also strong in partner's direction, push to 5 before the
  # opponents can take the bid and call their signaled direction.
  when bid_count == 2 and bid.current == 4 and partner_bid == 1 and enemy_bid == 2 and hand_power(downtown) >= contested_push:
    bid 5
  when bid_count == 2 and bid.current == 4 and partner_bid == 2 and enemy_bid == 1 and hand_power(uptown) >= contested_push:
    bid 5
  # Standard same-direction edge → push to 5
  when bid_count == 2 and bid.current == 4 and partner_bid == 1 and low_count() >= high_count():
    bid 5
  when bid_count == 2 and bid.current == 4 and partner_bid == 2 and high_count() > low_count():
    bid 5
  # Long suit + matching signal → push to 5
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6 and hand_power(uptown) >= sig_threshold:
    bid 5
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6 and hand_power(downtown) >= sig_threshold:
    bid 5
  when bid_count == 2:
    pass

  # ── Dealer ──
  when is_dealer and bid.current == 0:
    bid 1
  when is_dealer and partner_bid == bid.current and partner_bid > 0 and max_suit_count() <= 8:
    pass
  when is_dealer and bid.current <= 3:
    bid take
  # Defensive take at bid 4: partner and enemy signaled opposite directions.
  # If I have power in partner's direction, take so we call that direction.
  when is_dealer and bid.current == 4 and partner_bid == 1 and enemy_bid == 2 and hand_power(downtown) >= defense_take:
    bid take
  when is_dealer and bid.current == 4 and partner_bid == 2 and enemy_bid == 1 and hand_power(uptown) >= defense_take:
    bid take
  # Defensive take at bid 5 (more committed — usually requires more power)
  when is_dealer and bid.current == 5 and partner_bid == 1 and enemy_bid == 2 and hand_power(downtown) >= defense_take_at_5:
    bid take
  when is_dealer and bid.current == 5 and partner_bid == 2 and enemy_bid == 1 and hand_power(uptown) >= defense_take_at_5:
    bid take
${dealerBid3Rules}${dealerSig17Rules}  when is_dealer and bid.current == 4 and max_suit_count() >= dealer_bid4_suit_req:
    bid take
  when is_dealer and bid.current == 4 and hand_power(uptown) >= sig_threshold:
    bid take
  when is_dealer and bid.current == 4 and hand_power(downtown) >= sig_threshold:
    bid take
  default:
    pass

trump:
${trumpBid3Rules}  # Partner signaled downtown (bid 1) — trust it with the 'trust' bonus
  when partner_bid == 1 and low_count() + trust > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 1 and low_count() + trust > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  when partner_bid == 1:
    choose suit: best_suit(uptown) direction: uptown

  # Partner signaled uptown (bid 2)
  when partner_bid == 2 and high_count() + trust > low_count():
    choose suit: best_suit(uptown) direction: uptown
  when partner_bid == 2 and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 2:
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces

  # No partner signal — read own hand
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when low_count() > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  default:
    choose suit: best_suit(uptown) direction: uptown

discard:
  default:
    keep stopper_cards()
  when has_trump:
    keep hand.trump
  when partner_bid == 3:
    keep suit_keepers(1)
  when partner_bid == 1 and bid_direction != "uptown":
    keep suit_keepers(1)
  when partner_bid == 2 and bid_direction == "uptown":
    keep suit_keepers(1)
${smartDiscardRules}  when enemy_bid == 1 and bid_direction != "uptown" and partner_bid != 3:
    drop void_candidates()
  when enemy_bid == 2 and bid_direction == "uptown" and partner_bid != 3:
    drop void_candidates()
  when min_suit_count() <= 2 and min_suit_count() > 0:
    drop void_candidates()
`;
}
