/**
 * Claude Omni — the consolidated best-known Bid Whist strategy, with the
 * argument for why it is hard to beat with rules in this DSL.
 *
 * # Lineage (every step confirmed at 95% confidence, 20k-game pools)
 *
 *   Family            hand-tuned baseline
 *   ClaudeFam         +0.9pp   hand_power(dir) >= 17 signals; bid 3 removed
 *   (Roles)           +10.7pp  suit-role model in discard/sluff/lead
 *   (+MTC)            +3.0pp   signals on makeable_trick_count(dir) >= 4
 *   (+CP)             +1.1pp   trump counterpick + contested strength picks
 *
 * Claude Omni is BEHAVIORALLY IDENTICAL to ClaudeFam (Roles+MTC+CP) — a
 * unit test asserts AST equality — repackaged as one documented file. The
 * text below is the thing that won ~108k pooled head-to-head games; the
 * comments are the provenance.
 *
 * # The information audit (the "approaching optimal" argument)
 *
 * A rule strategy approaches optimality when every information channel the
 * game exposes is either exploited, or demonstrated not to help. Status of
 * every channel, with evidence:
 *
 * USED, with benchmark evidence:
 *   1. Own-hand trick structure (boss/backed/backing/spare roles, makeable
 *      counts) — discards, sluffs, throwaway leads, bid signals. The
 *      single largest gain ever measured here (+10.7pp): the old
 *      value-based discard threw backing cards every hand.
 *   2. Kitty knowledge (declarer's own discards count as dead in all
 *      outstanding-card math via StrategyContext.myDiscards).
 *   3. Bid history — partner/enemy direction signals (structural, ~43%
 *      fire rate: frequency beats selectivity, +3pp), seat position
 *      (hot-seat 4, dealer takes), current price of the contract.
 *   4. Played cards — roles recompute every trick, so boss promotion,
 *      outstanding trump, and safe-overtake checks are live counts.
 *   5. Trick state — partner currently winning, threats outstanding.
 *   6. Void observations — enemy/partner shown void in trump gates
 *      pulling; partner's observed voids drive short-suit leads.
 *   7. Void-discard signals — partner's first sluff names a suit to lead.
 *   8. Enemy signal exclusion — countering the enemy's direction on
 *      near-balanced hands, and switching to honor-density trump picks
 *      when both signals contest the same direction (+1.1pp).
 *
 * TESTED, DOES NOT HELP (kept out on evidence, not oversight):
 *   - Rare "monster" signals (hand_power >= 17 selectivity): loses 4.7pp
 *     to frequent structural signals; mtc >= 7 signals LOSE outright.
 *   - Books-based bid 4 (max makeable across directions >= 6..9): null.
 *   - Bid 3 in any form (prior project): null to harmful.
 *   - Structural trump-suit tiebreaks (length-first tricks key): null.
 *   - Scored Bayesian trump call (coverage/threat arithmetic, hand-tuned
 *     AND optimizer-fitted): loses ~1-2pp. Direction choice needs the
 *     low-vs-high mass of all 12 cards (low_count/high_count measure it
 *     directly); makeable counting compresses to top structure and loses
 *     exactly that. Structure wins bids; mass wins direction.
 *   - Establishment leads (spending backing feeds to force holes): null —
 *     the spare-first throwaway lead already forces the same holes.
 *   - Trading trump length for trump quality anywhere: -1.5 to -2pp.
 *     Length is sovereign; a low trump is a trick once opponents strip.
 *
 * KNOWN, NOT EXPLOITED (the honest gap between this and "optimal"):
 *   - Game-score state: the DSL does not expose team scores, so no
 *     endgame adaptation (a 19-point team should bid/risk differently).
 *   - The silent enemy: only the signaling enemy is modeled; the fourth
 *     hand is a uniform prior.
 *   - Enemy void-discard signals in lead selection (no set-subtraction in
 *     the DSL to "lead anything but their suit").
 *   - Positional play (who sits behind whom) and per-trick Bayesian hand
 *     inference beyond void tracking — CFR/solver territory, not rules.
 *
 * # Reproduce
 *   node scripts/omni-benchmark.js          (vs the whole registry)
 *   REPORT_HANDS=40000 node scripts/omni-benchmark.js
 */

const CLAUDE_OMNI_TEXT = `strategy "Claude Omni"
game: bidwhist

# sig_threshold is vestigial (the hand_power signals it once gated were
# replaced by makeable_trick_count). It is kept so this file's AST is
# EXACTLY the benchmarked champion's — the parity test depends on it.
let sig_threshold = 17
let trust = 3
let dealer_bid4_suit_req = 5
let mtc_sig = 4

play:
  leading:
    # Last-run: one non-trump left — run out trump and then play it.
    when on_declarer_team and has_trump and hand.nontrump.count == 1:
      play hand.trump.strongest
    # Pull trump aggressively when enemies still have any. Tightening this
    # gate cost 3.8-6.5pp in the ClaudeFam project. Length + pulling is
    # the engine of declarer play.
    when on_declarer_team and has_trump and enemy_has_trump and outstanding_trump() > 0:
      play hand.trump.strongest
    # Cash boss non-trump before it loses tempo value. Boss recomputes
    # every trick from played cards, so promotions are cashed too.
    when hand.boss.nontrump.count > 0:
      play hand.boss.nontrump.weakest
    # Lead partner's observed short suit while they still hold trump.
    when on_declarer_team and partner_has_trump and partner_shortsuit.count > 0:
      play partner_shortsuit.weakest
    # Lead the suit partner signaled with their first void discard.
    when partner_signal != "" and hand.suit(partner_signal).count > 0:
      play hand.suit(partner_signal).weakest
    # Throwaway lead: burn a spare, never a backing card that a backed
    # winner depends on. (Part of the +10.7pp roles adoption.)
    when hand.nontrump.spare.count > 0:
      play hand.nontrump.spare.weakest
    when hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest

  following:
    # Partner already winning with nothing outstanding that beats them.
    when partner_winning and outstanding_threats() == 0:
      play hand.suit(lead_suit).weakest
    # Partner winning but at risk, and I hold a guaranteed boss winner:
    # overtake safely rather than hope.
    when partner_winning and hand.suit(lead_suit).winners.boss.count > 0:
      play hand.suit(lead_suit).winners.boss.weakest
    when partner_winning:
      play hand.suit(lead_suit).weakest
    # Otherwise take the trick as cheaply as possible.
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    when not partner_winning and has_trump:
      play hand.trump.weakest
    when partner_winning and outstanding_threats() > 0 and has_trump:
      play hand.trump.weakest
    # Sluff spares first — hand.nontrump.weakest is often a backing card
    # (the 5/3 under a 10/9) whose loss demotes a backed winner.
    when not have_signaled and hand.nontrump.spare.count > 0:
      play hand.nontrump.spare.weakest
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    when hand.nontrump.spare.count > 0:
      play hand.nontrump.spare.weakest
    default:
      play hand.weakest

bid:
  # Long-suit bids first (length is sovereign for trump).
  when bid_count < 2 and max_suit_count() >= 6 and bid.current < 4:
    bid 4
  when bid_count < 2 and max_suit_count() >= 7 and bid.current < 5:
    bid 5
  # Direction signals on STRUCTURAL strength: 4+ makeable winners fires on
  # ~43% of hands. Frequency beats selectivity because the signal's main
  # job is informing partner's trump-direction choice (sweep: 52.9-53.0%
  # on two pools vs the rare hand_power-17 convention, which LOSES when
  # made comparably rare).
  when bid_count < 2 and makeable_trick_count(uptown) >= mtc_sig and bid.current < 2:
    bid 2
  when bid_count < 2 and makeable_trick_count(downtown) >= mtc_sig and bid.current < 1:
    bid 1
  # Hot seat (3rd bidder) always bids 4 — load-bearing (-12pp without).
  when bid_count == 2 and bid.current < 4:
    bid 4
  when bid_count == 2 and bid.current == 4 and partner_bid == 1 and low_count() >= high_count():
    bid 5
  when bid_count == 2 and bid.current == 4 and partner_bid == 2 and high_count() > low_count():
    bid 5
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6 and makeable_trick_count(uptown) >= mtc_sig:
    bid 5
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6 and makeable_trick_count(downtown) >= mtc_sig:
    bid 5
  when bid_count == 2:
    pass
  # Dealer rules.
  when is_dealer and bid.current == 0:
    bid 1
  when is_dealer and partner_bid == bid.current and partner_bid > 0 and max_suit_count() <= 8:
    pass
  when is_dealer and bid.current <= 3:
    bid take
  when is_dealer and bid.current == 4 and max_suit_count() >= dealer_bid4_suit_req:
    bid take
  when is_dealer and bid.current == 4 and makeable_trick_count(uptown) >= mtc_sig:
    bid take
  when is_dealer and bid.current == 4 and makeable_trick_count(downtown) >= mtc_sig:
    bid take
  default:
    pass

trump:
  # Contested direction (partner AND enemy signaled the same way): their
  # winners will pressure trump control, so pick trump by honor density,
  # not length. (Part of the +1.1pp counterpick adoption.)
  when partner_bid == 1 and enemy_bid == 1 and low_count() + trust > high_count() and ace_count() >= 2:
    choose suit: best_suit_by_power(downtown) direction: downtown
  when partner_bid == 1 and enemy_bid == 1 and low_count() + trust > high_count():
    choose suit: best_suit_by_power(downtown-noaces) direction: downtown-noaces
  when partner_bid == 2 and enemy_bid == 2 and high_count() + trust > low_count():
    choose suit: best_suit_by_power(uptown) direction: uptown
  # Partner signaled low: trust their signal as +3 low-mass.
  when partner_bid == 1 and low_count() + trust > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 1 and low_count() + trust > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  when partner_bid == 1:
    choose suit: best_suit(uptown) direction: uptown
  # Partner signaled high.
  when partner_bid == 2 and high_count() + trust > low_count():
    choose suit: best_suit(uptown) direction: uptown
  when partner_bid == 2 and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 2:
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  # No partner signal: counterpick the enemy's direction on a
  # near-balanced hand — their signaled winners degrade to junk. Suit by
  # best_suit (length-first): the by-tricks variant was tested here and
  # confounded the win; plain length-first is what confirmed.
  when enemy_bid == 1 and high_count() + 2 > low_count():
    choose suit: best_suit(uptown) direction: uptown
  when enemy_bid == 2 and low_count() + 2 > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when enemy_bid == 2 and low_count() + 2 > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  # Own hand: direction by low/high MASS (all 12 cards) — repeatedly
  # unbeatable by structural counting for this decision.
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when low_count() > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  default:
    choose suit: best_suit(uptown) direction: uptown

discard:
  # Keep every card with a structural job: boss winners, backed winners,
  # their backing feeds, and (trump override) all trump. This is the
  # single biggest finding of the whole project: the old value-based
  # discard shed backing cards — the lowest cards in the hand are often
  # the most important ones to keep.
  default:
    keep hand.working
  when has_trump:
    keep hand.trump
  # Actively shed the cards with provably no job.
  when hand.nontrump.spare.count > 0:
    drop hand.nontrump.spare
  when partner_bid == 1 and bid_direction != "uptown":
    keep suit_keepers(1)
  when partner_bid == 2 and bid_direction == "uptown":
    keep suit_keepers(1)
  when enemy_bid == 1 and bid_direction != "uptown":
    drop void_candidates()
  when enemy_bid == 2 and bid_direction == "uptown":
    drop void_candidates()
  when min_suit_count() <= 2 and min_suit_count() > 0:
    drop void_candidates()
`;

export const BIDWHIST_CLAUDE_OMNI = CLAUDE_OMNI_TEXT;
