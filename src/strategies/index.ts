// Strategy file contents exported as string constants.
// These mirror the .cstrat files in this directory.

export const BIDWHIST_STANDARD = `strategy "Bid Whist Standard"
game: bidwhist

play:
  leading:
    # If on declarer's team, lead with trump to pull opponents' trump
    when on_declarer_team and has_trump:
      play hand.trump.highest
    # Otherwise lead lowest card
    default:
      play hand.lowest

  following:
    # If we have cards that can win the trick, play the lowest winner
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.lowest
    # Otherwise dump our lowest card of the suit
    default:
      play hand.suit(lead_suit).lowest

  void:
    # If partner is not winning and we have trump, trump in with lowest
    when not partner_winning and has_trump:
      play hand.trump.lowest
    # Otherwise dump lowest card
    default:
      play hand.lowest

bid:
  # Dealer's 4th bid special handling
  when is_dealer and bid.current > 0 and bid.current <= 3:
    bid take
  when is_dealer and bid.current > 3:
    pass
  when is_dealer and bid.current == 0:
    bid 1
  # Player 1 (East) - conservative, max bid 1
  when me.id == 1 and bid.current >= 1:
    pass
  when me.id == 1:
    bid 1
  # Player 2 (North) - moderate, max bid 2
  when me.id == 2 and bid.current >= 2:
    pass
  when me.id == 2 and bid.current == 1:
    bid 2
  when me.id == 2:
    bid 1
  # Player 3 (West) - aggressive, max bid 3
  when me.id == 3 and bid.current >= 3:
    pass
  when me.id == 3 and bid.current == 2:
    bid 3
  when me.id == 3 and bid.current == 1:
    bid 2
  when me.id == 3:
    bid 1
  default:
    pass

trump:
  # Partner signaled low hand - go downtown
  when partner_bid == 1:
    choose suit: best_suit() direction: downtown
  # Partner signaled high hand - go uptown
  when partner_bid == 2:
    choose suit: best_suit() direction: uptown
  # More low cards than high, and have aces - downtown with aces good
  when low_count() > high_count() and ace_count() >= 2:
    choose suit: best_suit() direction: downtown
  # More low cards but few aces - downtown no aces
  when low_count() > high_count():
    choose suit: best_suit() direction: downtown-noaces
  # Default to uptown
  default:
    choose suit: best_suit() direction: uptown
`;

export const BIDWHIST_AGGRESSIVE = `strategy "Bid Whist Aggressive"
game: bidwhist

play:
  leading:
    # Always lead with highest trump to dominate
    when has_trump:
      play hand.trump.highest
    # Lead highest card of any suit
    default:
      play hand.highest

  following:
    # Always play highest winner if possible
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.highest
    # Play highest of suit even if losing
    default:
      play hand.suit(lead_suit).highest

  void:
    # Always trump aggressively with highest trump
    when has_trump:
      play hand.trump.highest
    # Dump highest card
    default:
      play hand.highest

bid:
  # Dealer takes anything up to 4
  when is_dealer and bid.current > 0 and bid.current <= 4:
    bid take
  when is_dealer and bid.current > 4:
    pass
  when is_dealer and bid.current == 0:
    bid 2
  # All players bid up to 4
  when bid.current >= 4:
    pass
  when bid.current == 3:
    bid 4
  when bid.current == 2:
    bid 3
  when bid.current == 1:
    bid 2
  default:
    bid 1

trump:
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
    # Lead lowest card to minimize risk
    default:
      play hand.lowest

  following:
    # Play lowest winner to conserve high cards
    when hand.suit(lead_suit).winners.count > 0:
      play hand.suit(lead_suit).winners.lowest
    # Dump lowest
    default:
      play hand.suit(lead_suit).lowest

  void:
    # Only trump if partner is not winning, use lowest trump
    when not partner_winning and has_trump:
      play hand.trump.lowest
    # Dump lowest card
    default:
      play hand.lowest

bid:
  # Dealer takes only low bids
  when is_dealer and bid.current > 0 and bid.current <= 1:
    bid take
  when is_dealer and bid.current > 1:
    pass
  when is_dealer and bid.current == 0:
    bid 1
  # Only bid 1
  when bid.current >= 1:
    pass
  default:
    bid 1

trump:
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
      play hand.suit("clubs").lowest
    # If hearts aren't broken, lead a non-heart
    when not hearts_broken and hand.nontrump.count > 0:
      play hand.nontrump.lowest
    # Otherwise play lowest card
    default:
      play hand.lowest

  following:
    # Play highest card that won't win the trick (duck under)
    when hand.suit(lead_suit).losers.count > 0:
      play hand.suit(lead_suit).losers.highest
    # Must win - play lowest of suit
    default:
      play hand.suit(lead_suit).lowest

  void:
    # First trick: can't play hearts or queen of spades
    # Dump queen of spades if possible
    when have("spades_12") and not is_first_trick:
      play hand.suit("spades").highest
    # Dump high hearts
    when hand.hearts.count > 0 and not is_first_trick:
      play hand.hearts.highest
    # First trick - play king of spades if we have it
    when have("spades_13") and is_first_trick:
      play hand.suit("spades").highest
    # Play highest card to dump points
    default:
      play hand.highest
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
