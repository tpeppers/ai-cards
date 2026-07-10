/**
 * ClaudeFam (Roles) — ClaudeFam with the suit-role primitives swapped in.
 *
 * Top human players describe a holding by its trick-winning structure:
 * boss winners, holes, backed winners, and the backing cards that feed
 * them (A/K/10/9/5/3 = "2 winners, a 2-hole, 2-with-backing"). The role
 * primitives (.boss/.backed/.backing/.spare/.working, hole_count,
 * makeable_trick_count) expose that structure to the DSL. This strategy
 * is ClaudeFam with three MINIMAL substitutions that put the structure to
 * work — everything else (bidding, trump selection, trick-play rules that
 * tested as load-bearing in the ClaudeFam project) is unchanged so a
 * head-to-head benchmark isolates the role-model effect:
 *
 *   1. DISCARD: `keep stopper_cards()` → `keep hand.working` +
 *      `drop hand.nontrump.spare`. stopper_cards protects one best-card+
 *      protectors pair per suit; hand.working generalizes it to the full
 *      [boss][backed][backing] structure with correct multiplicity, and
 *      spare identifies the cards with provably no structural job.
 *
 *   2. VOID SLUFF: when void and not trumping, sluff from
 *      hand.nontrump.spare before generic weakest. The old rule could
 *      throw a backing card (the 5/3 under a 10/9) that a backed winner
 *      depends on.
 *
 *   3. LEAD DEFAULT: the throwaway lead prefers spares for the same
 *      reason — `hand.nontrump.weakest` is often exactly a backing card.
 *
 * Each toggle is independently benchmarkable via buildRolesVariant.
 */

const PLAY_LEADING_BASE = `    # Last-run: one non-trump left — run out trump and then play it.
    when on_declarer_team and has_trump and hand.nontrump.count == 1:
      play hand.trump.strongest
    # Pull trump aggressively when enemies still have any.
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
`;

const LEAD_DEFAULT_CLASSIC = `    when hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest
`;

const LEAD_DEFAULT_ROLES = `    # Throwaway lead: burn a spare, not a backing card that a backed
    # winner depends on.
    when hand.nontrump.spare.count > 0:
      play hand.nontrump.spare.weakest
    when hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest
`;

// Full leading: block (header included) for RolesOverrides.leadingSection —
// the champion's leading block with the throwaway lead playing
// .least_beaten instead of .weakest. Winner of the human-tools sweep
// (report/human-tools-sweep*.json); adopted as ClaudeFam (Roles+MTC+CP+PL).
export const PROBE_LEADING_SECTION = `  leading:
    # Last-run: one non-trump left — run out trump and then play it.
    when on_declarer_team and has_trump and hand.nontrump.count == 1:
      play hand.trump.strongest
    # Pull trump aggressively when enemies still have any.
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
    # Probe lead: with control, throw the spare with the fewest outstanding
    # beaters — it wins now or forces the beater out; junk stays for later.
    when hand.nontrump.spare.count > 0:
      play hand.nontrump.spare.least_beaten
    when hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest
`;

const PLAY_FOLLOWING = `  following:
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
`;

const VOID_CLASSIC = `  void:
    when not partner_winning and has_trump:
      play hand.trump.weakest
    when partner_winning and outstanding_threats() > 0 and has_trump:
      play hand.trump.weakest
    when not have_signaled and hand.nontrump.count > 0:
      play hand.nontrump.weakest
    default:
      play hand.weakest
`;

const VOID_ROLES = `  void:
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
`;

const BID_SECTION = `bid:
  when bid_count < 2 and max_suit_count() >= 6 and bid.current < 4:
    bid 4
  when bid_count < 2 and max_suit_count() >= 7 and bid.current < 5:
    bid 5
  when bid_count < 2 and hand_power(uptown) >= sig_threshold and bid.current < 2:
    bid 2
  when bid_count < 2 and hand_power(downtown) >= sig_threshold and bid.current < 1:
    bid 1
  when bid_count == 2 and bid.current < 4:
    bid 4
  when bid_count == 2 and bid.current == 4 and partner_bid == 1 and low_count() >= high_count():
    bid 5
  when bid_count == 2 and bid.current == 4 and partner_bid == 2 and high_count() > low_count():
    bid 5
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6 and hand_power(uptown) >= sig_threshold:
    bid 5
  when bid_count == 2 and bid.current == 4 and max_suit_count() >= 6 and hand_power(downtown) >= sig_threshold:
    bid 5
  when bid_count == 2:
    pass
  when is_dealer and bid.current == 0:
    bid 1
  when is_dealer and partner_bid == bid.current and partner_bid > 0 and max_suit_count() <= 8:
    pass
  when is_dealer and bid.current <= 3:
    bid take
  when is_dealer and bid.current == 4 and max_suit_count() >= dealer_bid4_suit_req:
    bid take
  when is_dealer and bid.current == 4 and hand_power(uptown) >= sig_threshold:
    bid take
  when is_dealer and bid.current == 4 and hand_power(downtown) >= sig_threshold:
    bid take
  default:
    pass
`;

// Bid section for ClaudeFam (Roles+MTC): identical to BID_SECTION except the
// six hand_power(<dir>) >= sig_threshold conditions (bid-2 signal, bid-1
// signal, two seat-3 pushes, two dealer takes) use
// makeable_trick_count(<dir>) >= mtc_sig instead. Requires a
// `let mtc_sig = <N>` binding via RolesOverrides.extraLets.
export const MTC_BID_SECTION = `bid:
  when bid_count < 2 and max_suit_count() >= 6 and bid.current < 4:
    bid 4
  when bid_count < 2 and max_suit_count() >= 7 and bid.current < 5:
    bid 5
  when bid_count < 2 and makeable_trick_count(uptown) >= mtc_sig and bid.current < 2:
    bid 2
  when bid_count < 2 and makeable_trick_count(downtown) >= mtc_sig and bid.current < 1:
    bid 1
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
`;

export const TRUMP_SECTION = `trump:
  when partner_bid == 1 and low_count() + trust > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 1 and low_count() + trust > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  when partner_bid == 1:
    choose suit: best_suit(uptown) direction: uptown
  when partner_bid == 2 and high_count() + trust > low_count():
    choose suit: best_suit(uptown) direction: uptown
  when partner_bid == 2 and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when partner_bid == 2:
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when low_count() > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  default:
    choose suit: best_suit(uptown) direction: uptown
`;

// Trump section for ClaudeFam (Roles+MTC+CP): TRUMP_SECTION plus two ideas —
// counterpick the enemy's signaled direction on near-balanced hands, and pick
// trump by honor density (best_suit_by_power) instead of length when partner
// and enemy signaled the SAME direction (contested).
export const COUNTERPICK_TRUMP_SECTION = `trump:
  # Contested direction (both signals same way): strength, not length.
  when partner_bid == 1 and enemy_bid == 1 and low_count() + trust > high_count() and ace_count() >= 2:
    choose suit: best_suit_by_power(downtown) direction: downtown
  when partner_bid == 1 and enemy_bid == 1 and low_count() + trust > high_count():
    choose suit: best_suit_by_power(downtown-noaces) direction: downtown-noaces
  when partner_bid == 2 and enemy_bid == 2 and high_count() + trust > low_count():
    choose suit: best_suit_by_power(uptown) direction: uptown
  # Partner signaled low.
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
  # No partner signal: counterpick the enemy's direction on a near-balanced hand.
  when enemy_bid == 1 and high_count() + 2 > low_count():
    choose suit: best_suit(uptown) direction: uptown
  when enemy_bid == 2 and low_count() + 2 > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when enemy_bid == 2 and low_count() + 2 > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  # Own hand.
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit(downtown) direction: downtown
  when low_count() > high_count():
    choose suit: best_suit(downtown-noaces) direction: downtown-noaces
  default:
    choose suit: best_suit(uptown) direction: uptown
`;

const DISCARD_CLASSIC = `discard:
  default:
    keep stopper_cards()
  when has_trump:
    keep hand.trump
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

const DISCARD_ROLES = `discard:
  # Keep every card with a structural job: boss winners, backed winners,
  # their backing feeds, and (via the trump override) all trump.
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

export interface RolesToggles {
  rolesDiscard: boolean;
  rolesSluff: boolean;
  rolesLead: boolean;
}

export interface RolesOverrides {
  bidSection?: string;     // replaces the bid: block (BID_SECTION)
  trumpSection?: string;   // replaces the trump: block (TRUMP_SECTION)
  leadingSection?: string; // replaces the whole leading: block, header included
  extraLets?: string;      // extra `let` lines appended after the existing three
}

export function buildRolesVariant(name: string, toggles: RolesToggles, overrides: RolesOverrides = {}): string {
  const defaultLeadingSection = `  leading:
${PLAY_LEADING_BASE}${toggles.rolesLead ? LEAD_DEFAULT_ROLES : LEAD_DEFAULT_CLASSIC}`;
  return `strategy "${name}"
game: bidwhist

let sig_threshold = 17
let trust = 3
let dealer_bid4_suit_req = 5
${overrides.extraLets ? overrides.extraLets + '\n' : ''}
play:
${overrides.leadingSection ?? defaultLeadingSection}
${PLAY_FOLLOWING}
${toggles.rolesSluff ? VOID_ROLES : VOID_CLASSIC}
${overrides.bidSection ?? BID_SECTION}
${overrides.trumpSection ?? TRUMP_SECTION}
${toggles.rolesDiscard ? DISCARD_ROLES : DISCARD_CLASSIC}`;
}

export const BIDWHIST_CLAUDEFAM_ROLES = buildRolesVariant('ClaudeFam (Roles)', {
  rolesDiscard: true,
  rolesSluff: true,
  rolesLead: true,
});

// ClaudeFam (Roles+MTC): the confirmed winner of the makeable_trick_count
// bid sweep (report/makeable-sweep.json). Signals bid 1/2 on structural
// makeable tricks (mtc_sig = 4, fires on ~43% of hands) instead of
// hand_power >= 17. Beat ClaudeFam (Roles) 52.93%±0.69 (seed 73313) and
// 52.96%±0.69 (holdout seed 999999) at N = 20k games each.
export const BIDWHIST_CLAUDEFAM_ROLES_MTC = buildRolesVariant('ClaudeFam (Roles+MTC)', {
  rolesDiscard: true,
  rolesSluff: true,
  rolesLead: true,
}, { bidSection: MTC_BID_SECTION, extraLets: 'let mtc_sig = 4' });

// ClaudeFam (Roles+MTC+CP): the trump-sweep winner (report/trump-sweep*.json,
// report/bayesian-trump-selection.md). Two changes to the trump section:
// counterpick the enemy's signaled direction on near-balanced hands (+2
// lean, mirroring the All Signals counters), and pick trump by honor
// density (best_suit_by_power) instead of length when partner and enemy
// signaled the SAME direction (contested). Beat ClaudeFam (Roles+MTC) at
// 51.09%±0.30 pooled over five independent 20k-game pools.
export const BIDWHIST_CLAUDEFAM_ROLES_MTC_CP = buildRolesVariant('ClaudeFam (Roles+MTC+CP)', {
  rolesDiscard: true,
  rolesSluff: true,
  rolesLead: true,
}, { bidSection: MTC_BID_SECTION, extraLets: 'let mtc_sig = 4', trumpSection: COUNTERPICK_TRUMP_SECTION });

// ClaudeFam (Roles+MTC+CP+PL): the human-tools sweep winner
// (report/human-tools-sweep*.json). One change: the throwaway lead
// picks the spare with the FEWEST outstanding beaters (.least_beaten)
// instead of the weakest spare — a near-boss spare wins the trick now
// or forces its beater out, while junk spares keep their flexibility.
// Beat Claude Omni at 51.37%±0.30 pooled over five 20k-game pools.
export const BIDWHIST_CLAUDEFAM_ROLES_MTC_CP_PL = buildRolesVariant('ClaudeFam (Roles+MTC+CP+PL)', {
  rolesDiscard: true,
  rolesSluff: true,
  rolesLead: true,
}, { bidSection: MTC_BID_SECTION, extraLets: 'let mtc_sig = 4', trumpSection: COUNTERPICK_TRUMP_SECTION, leadingSection: PROBE_LEADING_SECTION });
