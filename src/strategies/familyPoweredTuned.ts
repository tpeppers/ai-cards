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
}

export function generateFamilyPoweredTuned(p: FamilyPoweredParams): string {
  const minStop = p.minStoppers ?? 0;
  const bid3T = p.bid3Threshold ?? p.sigThreshold;
  const defT = p.defensiveTakeThreshold ?? 99;
  const def5T = p.defensiveTakeAt5Threshold ?? 99;
  const contestedT = p.contestedPushThreshold ?? 99;
  const parts = [
    `sig=${p.sigThreshold}`,
    `trust=${p.trustBonus}`,
    `opp=${p.oppPassThreshold}`,
    `minStop=${minStop}`,
    `bid3=${bid3T}`,
    `defT=${defT}`,
    `def5T=${def5T}`,
    `contested=${contestedT}`,
  ];
  const name = `Family (Powered ${parts.join(' ')})`;
  const stopGuard = minStop > 0 ? ' and king_ace_count() >= min_stoppers' : '';

  return `strategy "${name}"
game: bidwhist

let sig_threshold = ${p.sigThreshold}
let trust = ${p.trustBonus}
let opp_pass = ${p.oppPassThreshold}
let dealer_bid4_suit_req = ${p.dealerLongSuit}
let min_stoppers = ${minStop}
let bid3_threshold = ${bid3T}
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
  # Signal 3: strong both directions. bid3_threshold is independent of
  # sig_threshold so it can be loosened/tightened without breaking the
  # bid-1/bid-2 calibration. Set to 99 to disable bid 3 entirely.
  when bid_count < 2 and hand_power(uptown) >= bid3_threshold and hand_power(downtown) >= bid3_threshold${stopGuard} and bid.current < 3:
    bid 3
  # 6+ long suit
  when bid_count < 2 and max_suit_count() >= 6 and bid.current < 4:
    bid 4
  # 7+ very long suit
  when bid_count < 2 and max_suit_count() >= 7 and bid.current < 5:
    bid 5
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
  # Contested-signal push to 5: partner signaled one way, enemy the other.
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
  when is_dealer and bid.current == 4 and max_suit_count() >= dealer_bid4_suit_req:
    bid take
  when is_dealer and bid.current == 4 and hand_power(uptown) >= sig_threshold:
    bid take
  when is_dealer and bid.current == 4 and hand_power(downtown) >= sig_threshold:
    bid take
  default:
    pass

trump:
  # Partner signaled downtown (bid 1) — trust it with the 'trust' bonus
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
  when enemy_bid == 1 and bid_direction != "uptown" and partner_bid != 3:
    drop void_candidates()
  when enemy_bid == 2 and bid_direction == "uptown" and partner_bid != 3:
    drop void_candidates()
  when min_suit_count() <= 2 and min_suit_count() > 0:
    drop void_candidates()
`;
}
