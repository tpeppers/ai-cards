/**
 * ClaudeFam — consolidated strategy from the hand_power research project.
 *
 * This file is the distilled end state of ~24 targeted experiments against
 * Family across the bidding, trump-selection, play (leading/following/void),
 * and discard sections. The full data lives under report/ (start at
 * report/index.html; the exec-summary there indexes 24 areas explored).
 *
 * # Design principle
 *
 * Only changes with POSITIVE evidence at 95% confidence over a 20,000-game
 * head-to-head sweep are included here. "Tied with baseline" changes are
 * not adopted even when they don't hurt — the goal is a minimal, justified
 * delta from Family, not a union of every idea tried.
 *
 * Under that rule, the whole strategy reduces to exactly two modifications
 * from Family:
 *
 *   1. Bid signals 1 and 2 use hand_power(direction) >= 17 instead of
 *      deuce_trey_count() >= 3 and king_ace_count() >= 3 respectively.
 *   2. Bid 3 is removed entirely.
 *
 * Everything else — play rules, trump selection, discard, dealer behavior,
 * seat-3 push, same-direction escalation — is unchanged from Family.
 *
 * # Why these two and nothing else
 *
 * `sig = 17` is empirically optimal for hand_power-based signaling. The
 * full sweep at N = 20k games per config showed:
 *
 *     sig=9     43.9%   (old "Family (Powered)" — over-signals on Q/J)
 *     sig=11    46.5%
 *     sig=13    47.9%
 *     sig=14    48.4%
 *     sig=15    49.1%
 *     sig=16    50.1%   (tied with Family)
 *     sig=17    50.9%   (BEATS Family at p<0.05)
 *     sig=18    49.4%   (drops back)
 *     sig=20    48.1%
 *
 * The peak is sharp — sig=17 specifically catches hands like AAKKQJ
 * (5-6 honors with aces) that carry real signal value, while sig=18+
 * starts missing genuinely strong hands. See report/sweep.html for the
 * full table and report/index.html for the hand-composition analysis.
 *
 * Bid 3 disabled: report/addendum.html and report/bid3-analysis.html
 * document this finding in depth. Two mechanisms cause bid 3 to hurt:
 *
 *   A. At sig=17, bid 3 fires on hands that would qualify for bid 4 via
 *      the long-suit rule. Firing bid 3 first (contract 9) gives seat 3
 *      a free bump to bid 4 (contract 10) — and if seat 3 is the
 *      opponent, they become declarer with a weaker hand.
 *
 *   B. Family's trump: section has no `partner_bid == 3` branch, so a
 *      bid-3 signal carries no directional information. Bid 2 (or bid 1)
 *      does carry direction, leading to better trump selection.
 *
 * Simply removing the bid-3 rule moves the win rate from 50.24% (tied
 * with Family) to 50.87% (beats Family), a +0.63pp lift with 95% CI
 * fully above 0.50.
 *
 * # What was tried and rejected (null or negative evidence)
 *
 * - Bid 3 as "ace_count() >= 2" (aces signal): loses 3.5pp. The signal
 *   fires on ~20% of hands, way too often to be a reliable "monster"
 *   signal.
 * - Bid 3 as "ace_count() >= 3" with full receiver wiring (seat-3
 *   push + dealer take + trump rules): ties baseline at 50.20%, no gain.
 * - min_stoppers guard (`and king_ace_count() >= N` alongside
 *   hand_power): redundant at sig=17, which implicitly requires 2+
 *   aces or equivalent.
 * - Opponent-signal defense (dealer takes on contested partner/enemy
 *   signals): fires on ~0.04% of hands, no measurable effect.
 * - Seat-3 contested push: same rarity issue.
 * - Sig-17 receiver boost (stronger push/take when partner signaled):
 *   -0.35pp, tied with baseline.
 * - Bid 4 on hand_power + 4-card suit: -0.65pp.
 * - Bid 4 on hand_power + 5-card suit: -0.12pp, tied.
 * - Lead strongest non-trump (blanket): -3.6pp.
 * - Lead strongest non-trump gated by partner_is_declarer: still -1.1pp.
 *   The gating recovers 70% of the blanket damage but not enough to
 *   break even.
 * - Seat-3 "bid 3 when current < 3": -12.3pp. Family's "always bid 4"
 *   hot-seat rule is doing important work.
 * - Pull-trump threshold >= 2 or 3: -3.8pp / -6.5pp respectively.
 *   Being conservative about pulling trump hurts substantially.
 * - Dealer opens with bid 2 instead of 1: no effect.
 * - Discard suit_keepers(2) instead of (1): -0.9pp, tied.
 * - Smart-discard on opposite-direction signal: +0.07pp, tied.
 *
 * # Verification
 *
 * Generated strategies that use hand_power at sig=17 with bid 3 disabled
 * have been tested in three independent seeded pools (pooled N ~ 60k):
 * consistently lands at 50.5-50.9% vs Family.
 *
 * Against a cold read of the result: this is a small improvement
 * (~1pp). Family's hand-tuned rules are mostly right, and the main
 * lever the project moved was replacing count-based signaling with
 * a point-based one.
 */

const CLAUDEFAM_TEXT = `strategy "ClaudeFam"
game: bidwhist

# ────────────────────────────────────────────────────────────────────
# Tunable constants — only sig_threshold differs from Family's
# implicit values. trust = 3 matches Family's hardcoded bonus.
# ────────────────────────────────────────────────────────────────────

let sig_threshold = 17
let trust = 3
let dealer_bid4_suit_req = 5

# ────────────────────────────────────────────────────────────────────
# Play section — IDENTICAL to Family. Every single-rule tweak tested
# (9 variants, report/variants.html) either tied with baseline or
# lost. Family's rules for leading, following, and void play are
# well-tuned and don't yield to further local optimization.
# ────────────────────────────────────────────────────────────────────

play:
  leading:
    # Last-run: one non-trump left — run out trump and then play it.
    when on_declarer_team and has_trump and hand.nontrump.count == 1:
      play hand.trump.strongest
    # Pull trump aggressively when enemies still have any. Tightening
    # this to "outstanding_trump >= 2" cost 3.8pp; "outstanding_trump
    # >= 3" cost 6.5pp. Family's aggressive default is correct.
    when on_declarer_team and has_trump and enemy_has_trump and outstanding_trump() > 0:
      play hand.trump.strongest
    # Cash boss non-trump cards before they lose tempo value.
    when hand.boss.nontrump.count > 0:
      play hand.boss.nontrump.weakest
    # Lead partner's short suit if we called trump and partner still
    # has trump — lets partner trump that suit to grab the trick.
    when on_declarer_team and partner_has_trump and partner_shortsuit.count > 0:
      play partner_shortsuit.weakest
    # Lead partner's signal suit (from their first void discard).
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).weakest
    # Default lead: weakest non-trump. Switching to "strongest
    # non-trump" cost 3.6pp blanket or 1.1pp even when correctly gated
    # to partner_is_declarer. The boss-cash rule above already
    # handles the "cash winners" case, so the fallback is best as
    # "preserve trump, burn a throwaway non-trump".
    when hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest

  following:
    # Partner winning and no outstanding threats → duck. Loosening
    # the threat threshold to "<= 1" had no effect.
    when partner_winning and outstanding_threats() == 0:
      play hand.suit(lead_suit).weakest
    # Partner winning with threats, but I have a guaranteed-hold
    # boss winner → overtake safely.
    when partner_winning and hand.suit(lead_suit).winners.boss.count > 0:
      play hand.suit(lead_suit).winners.boss.weakest
    # Partner winning at risk, no guaranteed boss → duck and hope.
    when partner_winning:
      play hand.suit(lead_suit).weakest
    # Not partner winning → take the trick with weakest winner.
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    # Not partner winning, have trump → trump the trick.
    when not partner_winning and has_trump:
      play hand.trump.weakest
    # Partner winning but at risk → trump to protect.
    when partner_winning and outstanding_threats() > 0 and has_trump:
      play hand.trump.weakest
    # Safe to signal: first void discard signals the suit to partner.
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest

# ────────────────────────────────────────────────────────────────────
# Bid section — THE ONLY PLACE THIS STRATEGY DIFFERS FROM FAMILY:
#
#   1. No bid-3 rule at all. Bid 3 fires on <1% of hands at sig=17,
#      and those hands consistently do worse when bid 3 fires than
#      when they'd bid 4 via length or bid 2 via uptown-strength.
#
#   2. Bid-2 and bid-1 signal thresholds use hand_power(direction) at
#      17 instead of Family's king_ace_count() >= 3 and
#      deuce_trey_count() >= 3. At sig=17, the signal fires on
#      AAKKQJ-class hands (5-6 honors) where partner can reliably act
#      on "partner has real strength in this direction".
# ────────────────────────────────────────────────────────────────────

bid:
  # Bid 4 on a long suit (6+ cards). Unchanged from Family. Removing
  # this rule costs ~0.8pp.
  when bid_count < 2 and max_suit_count() >= 6 and bid.current < 4:
    bid 4
  # Bid 5 on a very long suit (7+ cards). Unchanged from Family.
  when bid_count < 2 and max_suit_count() >= 7 and bid.current < 5:
    bid 5

  # Bid 2 — uptown signal. Fires on hand_power(uptown) >= 17.
  # Representative firing hands: AAKKQJ (17), AAAKQ (17), AAKKK (17),
  # AAKKQQ (18), four aces + anything (16+).
  when bid_count < 2 and hand_power(uptown) >= sig_threshold and bid.current < 2:
    bid 2
  # Bid 1 — downtown signal. Symmetric to bid 2 but with downtown
  # weights (A=4, 2=3, 3=2, 4=1).
  when bid_count < 2 and hand_power(downtown) >= sig_threshold and bid.current < 1:
    bid 1

  # ── Seat 3 (hot seat) rules: all unchanged from Family ──
  #
  # Seat 3 always bids at least 4. This is load-bearing — letting
  # seat 3 bid 3 when current < 3 cost 12pp in testing. Family's
  # aggressive hot-seat policy is correct.
  when bid_count == 2 and bid.current < 4:
    bid 4
  # Push to 5 when partner signaled same direction as my count edge.
  when bid_count == 2 and bid.current == 4 and partner_bid == 1 and low_count() >= high_count():
    bid 5
  when bid_count == 2 and bid.current == 4 and partner_bid == 2 and high_count() > low_count():
    bid 5
  # Push to 5 on long suit + matching signal.
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6 and hand_power(uptown) >= sig_threshold:
    bid 5
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6 and hand_power(downtown) >= sig_threshold:
    bid 5
  when bid_count == 2:
    pass

  # ── Dealer rules: all unchanged from Family ──
  #
  # Dealer opens with bid 1 when nobody has bid. Tested bid 2 as
  # alternative — no effect.
  when is_dealer and bid.current == 0:
    bid 1
  # Don't steal partner's bid unless we have a monster suit.
  when is_dealer and partner_bid == bid.current and partner_bid > 0 and max_suit_count() <= 8:
    pass
  # Dealer takes low bids (contract <= 9 — we got to call trump).
  when is_dealer and bid.current <= 3:
    bid take
  # Dealer takes 4 with a 5+ suit.
  when is_dealer and bid.current == 4 and max_suit_count() >= dealer_bid4_suit_req:
    bid take
  # Dealer takes 4 with sig-strong hand in either direction.
  when is_dealer and bid.current == 4 and hand_power(uptown) >= sig_threshold:
    bid take
  when is_dealer and bid.current == 4 and hand_power(downtown) >= sig_threshold:
    bid take
  default:
    pass

# ────────────────────────────────────────────────────────────────────
# Trump section — IDENTICAL to Family. The +3 trust bonus ("factor
# partner's signaled direction as +3 cards") was tested at 5 and 7
# (trustBonus param) and both worsened performance. Family's value
# is correct.
#
# Note: there's no partner_bid == 3 branch because bid 3 is removed
# from our bid section. Partner_bid values we see here are 0, 1, or 2.
# ────────────────────────────────────────────────────────────────────

trump:
  # Partner signaled downtown (bid 1). Factor as +3 low cards.
  when partner_bid == 1 and low_count() + trust > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 1 and low_count() + trust > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  # Partner signaled down but my own hand is overwhelmingly high.
  when partner_bid == 1:
    choose suit: best_suit(uptown) direction: uptown

  # Partner signaled uptown (bid 2). Factor as +3 high cards.
  when partner_bid == 2 and high_count() + trust > low_count():
    choose suit: best_suit(uptown) direction: uptown
  when partner_bid == 2 and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 2:
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces

  # No partner signal (partner passed or bid 4+) — read own hand.
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when low_count() > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  default:
    choose suit: best_suit(uptown) direction: uptown

# ────────────────────────────────────────────────────────────────────
# Discard section — IDENTICAL to Family. Discard rules accumulate:
# all matching "keep" rules add to the keep set, all matching "drop"
# rules add to the drop set, and the 4 discards come from the
# lowest-scored cards outside the keep set.
#
# Tested changes: suit_keepers(2) instead of (1), explicit
# opposite-direction void — both were at-best neutral.
# ────────────────────────────────────────────────────────────────────

discard:
  # Always keep A/K stoppers.
  default:
    keep stopper_cards()
  # Always keep trump suit intact.
  when has_trump:
    keep hand.trump
  # Partner signaled same direction as mine → keep broad (don't void;
  # partner's direction-matching strength covers the suits).
  when partner_bid == 1 and bid_direction != "uptown":
    keep suit_keepers(1)
  when partner_bid == 2 and bid_direction == "uptown":
    keep suit_keepers(1)
  # Enemy signaled in our direction → create a void to control.
  when enemy_bid == 1 and bid_direction != "uptown":
    drop void_candidates()
  when enemy_bid == 2 and bid_direction == "uptown":
    drop void_candidates()
  # Short suit → void it.
  when min_suit_count() <= 2 and min_suit_count() > 0:
    drop void_candidates()
`;

export const BIDWHIST_CLAUDEFAM = CLAUDEFAM_TEXT;
