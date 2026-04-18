"""
Bid Whist game engine for CFR solver.

Stage 2: Game mechanics — trick-taking, scoring, full game flow.

This engine applies actions to game states, advancing through all phases:
  DEAL → BIDDING → TRUMP_SELECTION → DISCARDING → PLAY → SCORING

Design principles:
  - Pure functions: apply_action(state, action) → new_state
  - No mutation of input state (returns copies)
  - Every transition is deterministic given the action
"""

from __future__ import annotations

import random
from game_state import (
    Card, Suit, Rank, Direction, Phase,
    GameState, Action, TrumpChoice,
    BID_PASS, BID_TAKE,
    card_strength, make_deck,
    legal_actions, acting_player,
    legal_play_actions,
)


# ── Deal ──────────────────────────────────────────────────────────────

def deal_hand(dealer: int = 0, deck: list[Card] | None = None,
              team_scores: tuple[int, int] = (0, 0)) -> GameState:
    """
    Deal a new hand. Shuffles the deck, deals 12 cards to each of 4 players,
    and 4 cards to the kitty.

    Parameters:
        dealer: Player index (0-3) who deals this hand.
        deck: Optional pre-arranged deck (for testing). If None, shuffled.
        team_scores: Carry-over scores from previous hands.
    """
    if deck is None:
        deck = make_deck()
        random.shuffle(deck)
    else:
        deck = list(deck)  # don't mutate input

    assert len(deck) == 52, f"Deck must have 52 cards, got {len(deck)}"

    # Deal round-robin: card i goes to player i%4, first 48 cards
    hands: list[list[Card]] = [[], [], [], []]
    for i in range(48):
        hands[i % 4].append(deck[i])

    # Last 4 are the kitty
    kitty = deck[48:]

    # Sort hands for readability
    for h in hands:
        h.sort()

    gs = GameState(
        hands=hands,
        kitty=kitty,
        dealer=dealer,
        phase=Phase.BIDDING,
        team_scores=team_scores,
    )
    return gs


# ── Apply action ──────────────────────────────────────────────────────

def apply_action(gs: GameState, action: Action) -> GameState:
    """
    Apply an action to the game state, returning a new state.

    This is the central state-transition function. Dispatches by phase.
    """
    new_gs = gs.copy()

    if gs.phase == Phase.BIDDING:
        _apply_bid(new_gs, action)
    elif gs.phase == Phase.TRUMP_SELECTION:
        _apply_trump(new_gs, action)
    elif gs.phase == Phase.DISCARDING:
        _apply_discard(new_gs, action)
    elif gs.phase == Phase.PLAY:
        _apply_play(new_gs, action)
    else:
        raise ValueError(f"Cannot apply action in phase {gs.phase}")

    return new_gs


# ── Bidding ───────────────────────────────────────────────────────────

def _apply_bid(gs: GameState, action: Action) -> None:
    """Apply a bid action (mutates gs in place, called on a copy)."""
    assert action.bid is not None, f"Expected bid action, got {action}"
    amount = action.bid
    player = gs.current_bidder

    if amount == BID_TAKE:
        # Dealer takes the current high bid
        assert player == gs.dealer, "Only dealer can take"
        assert gs.high_bid > 0, "Nothing to take"
        gs.bids.append((player, BID_TAKE))
        gs.high_bidder = player
        # high_bid stays the same
    elif amount == BID_PASS:
        gs.bids.append((player, BID_PASS))
    else:
        # Regular bid
        assert 1 <= amount <= 6, f"Bid must be 1-6, got {amount}"
        assert amount > gs.high_bid, f"Bid {amount} must exceed current high {gs.high_bid}"
        gs.bids.append((player, amount))
        gs.high_bid = amount
        gs.high_bidder = player

    gs.bid_count += 1
    gs.current_bidder = (gs.current_bidder + 1) % 4

    # Check if bidding is complete (all 4 have bid)
    if gs.bid_count >= 4:
        if gs.high_bidder is not None:
            # Someone won the bid
            gs.declarer = gs.high_bidder
            gs.phase = Phase.TRUMP_SELECTION
            gs.current_player = gs.declarer

            # Give kitty to declarer
            gs.hands[gs.declarer].extend(gs.kitty)
            gs.hands[gs.declarer].sort()
        else:
            # Everyone passed → redeal
            # We signal this by moving to SCORING with special state
            gs.phase = Phase.DEAL  # signals need to redeal


# ── Trump selection ───────────────────────────────────────────────────

def _apply_trump(gs: GameState, action: Action) -> None:
    """Apply trump/direction selection (mutates gs)."""
    assert action.trump is not None
    choice = action.trump
    gs.trump_suit = choice.suit
    gs.direction = choice.direction
    gs.phase = Phase.DISCARDING
    gs.current_player = gs.declarer  # type: ignore


# ── Discarding ────────────────────────────────────────────────────────

def _apply_discard(gs: GameState, action: Action) -> None:
    """Apply discard action: remove 4 cards from declarer's hand (mutates gs)."""
    assert action.discard is not None
    assert gs.declarer is not None
    discard_set = action.discard

    assert len(discard_set) == 4, f"Must discard exactly 4 cards, got {len(discard_set)}"

    hand = gs.hands[gs.declarer]
    assert len(hand) == 16, f"Expected 16-card hand for discard, got {len(hand)}"

    # Verify all discards are in hand
    hand_set = set(hand)
    for card in discard_set:
        assert card in hand_set, f"Card {card} not in declarer's hand"

    # Remove discards, keep the rest
    gs.hands[gs.declarer] = [c for c in hand if c not in discard_set]
    gs.discards = list(discard_set)

    assert len(gs.hands[gs.declarer]) == 12, f"After discard, hand should have 12 cards"

    # Move to play phase — declarer leads first trick
    gs.phase = Phase.PLAY
    gs.trick_leader = gs.declarer
    gs.current_player = gs.declarer


# ── Play ──────────────────────────────────────────────────────────────

def resolve_trick(trick: list[tuple[int, Card]],
                  trump_suit: Suit | None, direction: Direction) -> int:
    """
    Determine the winner of a completed trick.

    Returns the player_id of the winner.

    Rules:
    - Lead suit must be followed. Trump beats non-trump.
    - Among same-suit cards, highest by direction wins.
    - Trump card beats all non-trump cards.
    - If multiple trumps, highest trump wins.
    """
    assert len(trick) == 4, f"Trick must have 4 cards, got {len(trick)}"

    lead_suit = trick[0][1].suit
    best_player = trick[0][0]
    best_strength = card_strength(trick[0][1], trump_suit, direction)

    for player, card in trick[1:]:
        strength = card_strength(card, trump_suit, direction)

        # A card only competes if it's trump or matches lead suit
        card_is_trump = trump_suit is not None and card.suit == trump_suit
        card_follows_lead = card.suit == lead_suit
        best_is_trump = best_strength[0] == 1

        if card_is_trump:
            # Trump always competes
            if not best_is_trump or strength > best_strength:
                best_player = player
                best_strength = strength
        elif card_follows_lead and not best_is_trump:
            # Follows lead and no trump played yet
            if strength > best_strength:
                best_player = player
                best_strength = strength
        # else: off-suit non-trump, can never win

    return best_player


def _apply_play(gs: GameState, action: Action) -> None:
    """Apply a card play action (mutates gs)."""
    assert action.card is not None
    card = action.card
    player = gs.current_player

    # Remove card from hand
    hand = gs.hands[player]
    assert card in hand, f"Card {card} not in player {player}'s hand"
    hand.remove(card)

    # Add to current trick
    gs.current_trick.append((player, card))
    gs.played_cards.append(card)

    if len(gs.current_trick) == 4:
        # Trick complete — resolve winner
        winner = resolve_trick(gs.current_trick, gs.trump_suit, gs.direction)
        team = GameState.team_of(winner)

        # Update books
        b = list(gs.books)
        b[team] += 1
        gs.books = tuple(b)

        # Save trick history
        gs.tricks_history.append(list(gs.current_trick))
        gs.current_trick = []
        gs.tricks_played += 1

        if gs.tricks_played >= 12:
            # Hand is over
            _score_hand(gs)
        else:
            # Winner leads next trick
            gs.trick_leader = winner
            gs.current_player = winner
    else:
        # Next player clockwise
        gs.current_player = (gs.current_player + 1) % 4


# ── Scoring ───────────────────────────────────────────────────────────

def _score_hand(gs: GameState) -> None:
    """Score a completed hand and update team_scores (mutates gs)."""
    assert gs.declarer is not None

    declarer_team = GameState.team_of(gs.declarer)
    defending_team = 1 - declarer_team

    # Declarer's books include the kitty (counts as 1 book)
    declarer_books = gs.books[declarer_team] + 1  # +1 for kitty
    contract = gs.high_bid + 6  # need this many books total

    scores = list(gs.team_scores)

    # Check for whisting (all 13 books = 12 tricks + kitty)
    if declarer_books == 13:
        gs.whisting_winner = declarer_team
        gs.phase = Phase.GAME_OVER
        return

    if declarer_books >= contract:
        # Made contract
        overtricks = declarer_books - contract
        points = gs.high_bid + (overtricks // 2)
        scores[declarer_team] += points
    else:
        # Failed contract
        undertricks = contract - declarer_books
        points = gs.high_bid + (undertricks // 2)
        scores[defending_team] += points

    gs.team_scores = tuple(scores)

    # Check for game over
    if scores[0] >= 21 or scores[1] >= 21:
        gs.phase = Phase.GAME_OVER
    elif (scores[0] >= 11 and scores[1] == 0) or (scores[1] >= 11 and scores[0] == 0):
        # Mercy/shutout
        gs.phase = Phase.GAME_OVER
    else:
        gs.phase = Phase.SCORING  # hand done, not game


# ── Utility functions ─────────────────────────────────────────────────

def hand_payoff(gs: GameState) -> tuple[float, float]:
    """
    Terminal payoff for a completed hand, from team 0's perspective.

    Returns (team0_delta, team1_delta) — the score change this hand caused.
    For CFR, we typically want the utility from each player's perspective.
    """
    if gs.whisting_winner >= 0:
        # Whisting: huge bonus
        if gs.whisting_winner == 0:
            return (21.0, 0.0)
        else:
            return (0.0, 21.0)

    # Calculate delta from the hand
    assert gs.declarer is not None
    declarer_team = GameState.team_of(gs.declarer)
    declarer_books = gs.books[declarer_team] + 1
    contract = gs.high_bid + 6

    if declarer_books >= contract:
        overtricks = declarer_books - contract
        points = gs.high_bid + (overtricks // 2)
        if declarer_team == 0:
            return (float(points), 0.0)
        else:
            return (0.0, float(points))
    else:
        undertricks = contract - declarer_books
        points = gs.high_bid + (undertricks // 2)
        defending_team = 1 - declarer_team
        if defending_team == 0:
            return (float(points), 0.0)
        else:
            return (0.0, float(points))


def is_terminal(gs: GameState) -> bool:
    """Is the game state terminal (hand over)?"""
    return gs.phase in (Phase.SCORING, Phase.GAME_OVER, Phase.DEAL)


def needs_redeal(gs: GameState) -> bool:
    """Did everyone pass, requiring a redeal?"""
    return gs.phase == Phase.DEAL


# ── Full random rollout ──────────────────────────────────────────────

def random_rollout(dealer: int = 0, deck: list[Card] | None = None,
                   team_scores: tuple[int, int] = (0, 0),
                   max_redeals: int = 10) -> GameState:
    """
    Play one complete hand with all players choosing uniformly at random
    from legal actions.

    This is used for Stage 2b validation: confirm the engine runs to
    completion without illegal states, crashes, or scoring anomalies.

    For the discard phase, we use a random subset selection instead of
    enumerating all C(16,4) options (too expensive for random play).
    """
    for _ in range(max_redeals + 1):
        gs = deal_hand(dealer=dealer, deck=deck, team_scores=team_scores)

        while not is_terminal(gs):
            player = acting_player(gs)

            if gs.phase == Phase.DISCARDING:
                # Random discard: pick 4 random cards from the 16-card hand
                assert gs.declarer is not None
                hand = gs.hands[gs.declarer]
                discard_cards = frozenset(random.sample(hand, 4))
                action = Action(discard=discard_cards)
            else:
                actions = legal_actions(gs)
                assert len(actions) > 0, f"No legal actions in phase {gs.phase} for player {player}"
                action = random.choice(actions)

            gs = apply_action(gs, action)

        if not needs_redeal(gs):
            return gs

        # Redeal: shuffle new deck, keep dealer
        deck = None  # use fresh random deck

    raise RuntimeError(f"Exceeded {max_redeals} redeals")


# ── Multi-hand game ──────────────────────────────────────────────────

def play_random_game(target_score: int = 21, max_hands: int = 100) -> GameState:
    """
    Play a complete multi-hand game to target_score with random play.
    Returns the final GameState.
    """
    team_scores = (0, 0)
    dealer = 0
    last_gs = None

    for _ in range(max_hands):
        gs = random_rollout(dealer=dealer, team_scores=team_scores)
        last_gs = gs

        if gs.phase == Phase.GAME_OVER:
            return gs

        # Carry scores forward, rotate dealer
        team_scores = gs.team_scores
        dealer = (dealer + 1) % 4

    assert last_gs is not None
    return last_gs
