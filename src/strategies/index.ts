// Strategy file contents exported as string constants.
// These mirror the .cstrat files in this directory.

export const BIDWHIST_STANDARD = `strategy "Bid Whist Standard"
game: bidwhist

play:
  leading:
    # If on declarer's team, lead with trump to pull opponents' trump
    when on_declarer_team and has_trump:
      play hand.trump.strongest
    # Otherwise lead weakest card
    default:
      play hand.weakest

  following:
    # If we have cards that can win the trick, play the weakest winner
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    # Otherwise dump our weakest card of the suit
    default:
      play hand.suit(lead_suit).weakest

  void:
    # If partner is not winning and we have trump, trump in with weakest
    when not partner_winning and has_trump:
      play hand.trump.weakest
    # Otherwise dump weakest card
    default:
      play hand.weakest

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
    pass

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
    choose suit: best_suit() direction: uptown
`;

export const BIDWHIST_AGGRESSIVE = `strategy "Bid Whist Aggressive"
game: bidwhist

play:
  leading:
    # Always lead with strongest trump to dominate
    when has_trump:
      play hand.trump.strongest
    # Lead strongest card of any suit
    default:
      play hand.strongest

  following:
    # Always play strongest winner if possible
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.strongest
    # Play strongest of suit even if losing
    default:
      play hand.suit(lead_suit).strongest

  void:
    # Always trump aggressively with strongest trump
    when has_trump:
      play hand.trump.strongest
    # Dump strongest card
    default:
      play hand.strongest

bid:
  # Dealer takes anything up to 4
  when is_dealer and bid.current > 0 and bid.current <= 4:
    bid take
  when is_dealer and bid.current > 4:
    pass
  when is_dealer and bid.current == 0:
    bid 2

  # 3rd bidder: push hard
  when bid_count == 2 and bid.current < 5:
    bid 5
  when bid_count == 2 and bid.current == 5 and max_suit_count() >= 5:
    bid 6
  when bid_count == 2:
    pass

  # 1st/2nd bidder: strong suit -> bid 5
  when bid_count < 2 and max_suit_count() >= 5 and bid.current < 5:
    bid 5

  # 1st/2nd bidder: both low and high -> bid 4
  when bid_count < 2 and deuce_trey_count() >= 2 and king_ace_count() >= 2 and bid.current < 4:
    bid 4

  # 1st/2nd bidder: Kings/Aces -> bid 3 (signals uptown aggressively)
  when bid_count < 2 and king_ace_count() >= 2 and bid.current < 3:
    bid 3

  # 1st/2nd bidder: 2s/3s -> bid 2 (signals downtown aggressively)
  when bid_count < 2 and deuce_trey_count() >= 2 and bid.current < 2:
    bid 2

  # 1st/2nd bidder: bid 1 with anything
  when bid_count < 2 and bid.current < 1:
    bid 1

  default:
    pass

trump:
  # Partner signaled downtown
  when partner_bid == 1:
    choose suit: best_suit() direction: downtown
  # Partner signaled uptown
  when partner_bid == 2:
    choose suit: best_suit() direction: uptown
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when low_count() > high_count():
    choose suit: best_suit() direction: downtown-noaces
  default:
    choose suit: best_suit() direction: uptown
`;

export const BIDWHIST_CONSERVATIVE = `strategy "Bid Whist Conservative"
game: bidwhist

play:
  leading:
    # Lead weakest card to minimize risk
    default:
      play hand.weakest

  following:
    # Play weakest winner to conserve strong cards
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.weakest
    # Dump weakest
    default:
      play hand.suit(lead_suit).weakest

  void:
    # Only trump if partner is not winning, use weakest trump
    when not partner_winning and has_trump:
      play hand.trump.weakest
    # Dump weakest card
    default:
      play hand.weakest

bid:
  # Dealer takes only low bids
  when is_dealer and bid.current > 0 and bid.current <= 1:
    bid take
  when is_dealer and bid.current > 1:
    pass
  when is_dealer and bid.current == 0:
    bid 1

  # 3rd bidder: bid 4 only with a strong hand
  when bid_count == 2 and bid.current < 4 and max_suit_count() >= 5:
    bid 4
  when bid_count == 2 and bid.current < 4 and king_ace_count() >= 3:
    bid 4
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
    pass

trump:
  # Partner signaled downtown
  when partner_bid == 1:
    choose suit: best_suit() direction: downtown
  # Partner signaled uptown
  when partner_bid == 2:
    choose suit: best_suit() direction: uptown
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  when low_count() > high_count():
    choose suit: best_suit() direction: downtown-noaces
  default:
    choose suit: best_suit() direction: uptown
`;

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

export interface StrategyRegistryEntry {
  name: string;
  game: string;
  text: string;
}

export const STRATEGY_REGISTRY: StrategyRegistryEntry[] = [
  { name: 'Standard', game: 'bidwhist', text: BIDWHIST_STANDARD },
  { name: 'Aggressive', game: 'bidwhist', text: BIDWHIST_AGGRESSIVE },
  { name: 'Conservative', game: 'bidwhist', text: BIDWHIST_CONSERVATIVE },
  { name: 'Standard', game: 'hearts', text: HEARTS_STANDARD },
];
