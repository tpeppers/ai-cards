"""
Bid Whist game state representation for CFR solver.

Stage 1: Define the full information state, information sets, and action space.

Design principles:
  - Immutable-style: methods return new states rather than mutating.
  - All state needed for legal-move generation and scoring is explicit.
  - Information sets capture what a single player can observe.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from enum import IntEnum, Enum
from typing import Optional

# ── Cards ─────────────────────────────────────────────────────────────

class Suit(IntEnum):
    CLUBS = 0
    DIAMONDS = 1
    HEARTS = 2
    SPADES = 3

SUIT_NAMES = {Suit.CLUBS: "C", Suit.DIAMONDS: "D", Suit.HEARTS: "H", Suit.SPADES: "S"}
SUIT_SYMBOLS = {Suit.CLUBS: "\u2663", Suit.DIAMONDS: "\u2666", Suit.HEARTS: "\u2665", Suit.SPADES: "\u2660"}

class Rank(IntEnum):
    TWO = 2
    THREE = 3
    FOUR = 4
    FIVE = 5
    SIX = 6
    SEVEN = 7
    EIGHT = 8
    NINE = 9
    TEN = 10
    JACK = 11
    QUEEN = 12
    KING = 13
    ACE = 14

RANK_NAMES = {
    2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
    9: "9", 10: "T", 11: "J", 12: "Q", 13: "K", 14: "A",
}


@dataclass(frozen=True, order=True)
class Card:
    """A single playing card. Immutable and hashable."""
    suit: Suit
    rank: int  # 2-14 (using Rank values)

    def __repr__(self) -> str:
        return f"{RANK_NAMES[self.rank]}{SUIT_NAMES[self.suit]}"

    @staticmethod
    def from_str(s: str) -> Card:
        """Parse 'AS' -> Ace of Spades, 'TC' -> Ten of Clubs, etc."""
        rank_char = s[0].upper()
        suit_char = s[1].upper()
        rank_map = {v: k for k, v in RANK_NAMES.items()}
        suit_map = {v: k for k, v in SUIT_NAMES.items()}
        return Card(suit=suit_map[suit_char], rank=rank_map[rank_char])


def make_deck() -> list[Card]:
    """Standard 52-card deck, sorted by suit then rank."""
    return [Card(suit=s, rank=r) for s in Suit for r in range(2, 15)]


# ── Direction & Trump ─────────────────────────────────────────────────

class Direction(Enum):
    UPTOWN = "uptown"           # A high, 2 low
    DOWNTOWN = "downtown"       # A high, 2 high (A > 2 > 3 > ... > K)
    DOWNTOWN_NOACES = "noaces"  # 2 high, A low (2 > 3 > ... > K > A)


def card_strength(card: Card, trump_suit: Optional[Suit], direction: Direction) -> tuple[int, int]:
    """
    Return (is_trump, rank_value) for card ordering.
    Higher tuple = stronger card. Ties on suit are broken by the tuple.

    For trick evaluation: only cards of the same suit or trump compete.
    """
    is_trump = 1 if (trump_suit is not None and card.suit == trump_suit) else 0

    if direction == Direction.UPTOWN:
        # A(14) > K(13) > ... > 2(2)
        rank_val = card.rank
    elif direction == Direction.DOWNTOWN:
        # A(14) > 2(2) > 3(3) > ... > K(13)
        # Map: A -> 27, 2 -> 26, 3 -> 25, ..., K -> 14
        if card.rank == 14:
            rank_val = 27
        elif card.rank == 2:
            rank_val = 26
        else:
            # 3->25, 4->24, ..., 13->14
            rank_val = 28 - card.rank
    else:  # DOWNTOWN_NOACES
        # 2(high) > 3 > ... > K > A(low)
        # Map: 2 -> 26, 3 -> 25, ..., K -> 14, A -> 1
        if card.rank == 14:
            rank_val = 1
        elif card.rank == 2:
            rank_val = 26
        else:
            rank_val = 28 - card.rank

    return (is_trump, rank_val)


# ── Bid actions ───────────────────────────────────────────────────────

# Bid amounts: 0 = pass, 1-6 = bid that many, -1 = "take it" (dealer only)
BID_PASS = 0
BID_TAKE = -1

# Trump selection action: (suit, direction)
@dataclass(frozen=True)
class TrumpChoice:
    suit: Suit
    direction: Direction

    def __repr__(self) -> str:
        return f"{SUIT_NAMES[self.suit]}-{self.direction.value}"


# ── Game phases ───────────────────────────────────────────────────────

class Phase(Enum):
    DEAL = "deal"
    BIDDING = "bidding"
    TRUMP_SELECTION = "trump_selection"
    DISCARDING = "discarding"
    PLAY = "play"
    SCORING = "scoring"
    GAME_OVER = "game_over"


# ── Core game state ──────────────────────────────────────────────────

@dataclass
class GameState:
    """
    Complete information state for one hand of Bid Whist.

    4 players: 0=South, 1=East, 2=North, 3=West
    Teams: even (0,2) vs odd (1,3)
    """

    # ── Deal ──
    hands: list[list[Card]]             # 4 hands, each 12 cards (or 16 during discard)
    kitty: list[Card]                   # 4 cards
    dealer: int                         # 0-3

    # ── Bidding ──
    phase: Phase = Phase.BIDDING
    bids: list[tuple[int, int]] = field(default_factory=list)  # (player_id, amount)
    current_bidder: int = -1            # set during init
    high_bid: int = 0
    high_bidder: Optional[int] = None
    bid_count: int = 0                  # how many players have bid

    # ── Trump / Direction ──
    trump_suit: Optional[Suit] = None
    direction: Direction = Direction.UPTOWN
    declarer: Optional[int] = None      # same as high_bidder after bidding

    # ── Discards ──
    discards: list[Card] = field(default_factory=list)  # 4 cards discarded by declarer

    # ── Play ──
    current_trick: list[tuple[int, Card]] = field(default_factory=list)  # (player_id, card)
    trick_leader: int = -1
    current_player: int = -1
    tricks_played: int = 0
    books: tuple[int, int] = (0, 0)    # books won by team 0, team 1

    # ── Scoring ──
    team_scores: tuple[int, int] = (0, 0)  # cumulative across hands
    whisting_winner: int = -1           # team that whistied (-1 = none)

    # ── History (for information sets) ──
    played_cards: list[Card] = field(default_factory=list)  # all cards played so far
    tricks_history: list[list[tuple[int, Card]]] = field(default_factory=list)  # completed tricks

    def __post_init__(self):
        if self.current_bidder == -1:
            # First bidder is to the left of the dealer
            self.current_bidder = (self.dealer + 1) % 4
            self.current_player = self.current_bidder

    @staticmethod
    def team_of(player: int) -> int:
        """Team 0 = players 0,2; Team 1 = players 1,3."""
        return player % 2

    @staticmethod
    def partner_of(player: int) -> int:
        return (player + 2) % 4

    def copy(self) -> GameState:
        """Fast copy for branching game trees (avoids generic deepcopy)."""
        return GameState(
            hands=[list(h) for h in self.hands],
            kitty=list(self.kitty),
            dealer=self.dealer,
            phase=self.phase,
            bids=list(self.bids),
            current_bidder=self.current_bidder,
            high_bid=self.high_bid,
            high_bidder=self.high_bidder,
            bid_count=self.bid_count,
            trump_suit=self.trump_suit,
            direction=self.direction,
            declarer=self.declarer,
            discards=list(self.discards),
            current_trick=list(self.current_trick),
            trick_leader=self.trick_leader,
            current_player=self.current_player,
            tricks_played=self.tricks_played,
            books=self.books,
            team_scores=self.team_scores,
            whisting_winner=self.whisting_winner,
            played_cards=list(self.played_cards),
            tricks_history=[list(t) for t in self.tricks_history],
        )


# ── Information set ──────────────────────────────────────────────────

@dataclass(frozen=True)
class InfoSet:
    """
    What a single player can observe at a decision point.

    This is the key abstraction for CFR: two game states that produce
    the same InfoSet must offer the same actions and must be treated
    identically by the player's strategy.
    """

    phase: Phase
    player: int
    hand: frozenset[Card]               # own cards

    # Bidding info (observable by all)
    bids: tuple[tuple[int, int], ...]   # all bids so far
    high_bid: int
    bid_count: int
    dealer: int

    # Trump (observable after selection)
    trump_suit: Optional[Suit]
    direction: Direction
    declarer: Optional[int]

    # Play info
    current_trick: tuple[tuple[int, Card], ...]  # current partial trick
    tricks_played: int
    books: tuple[int, int]
    played_cards: frozenset[Card]       # all previously played cards

    @staticmethod
    def from_game_state(gs: GameState, player: int) -> InfoSet:
        """Extract what `player` can see from the full game state."""
        return InfoSet(
            phase=gs.phase,
            player=player,
            hand=frozenset(gs.hands[player]),
            bids=tuple(gs.bids),
            high_bid=gs.high_bid,
            bid_count=gs.bid_count,
            dealer=gs.dealer,
            trump_suit=gs.trump_suit,
            direction=gs.direction,
            declarer=gs.declarer,
            current_trick=tuple(gs.current_trick),
            tricks_played=gs.tricks_played,
            books=gs.books,
            played_cards=frozenset(gs.played_cards),
        )

    def key(self) -> str:
        """
        Compact string key for hash-map storage in CFR.
        Must be deterministic and unique per distinct info set.
        """
        parts = [
            f"P{self.player}",
            f"ph={self.phase.value}",
            f"d={self.dealer}",
        ]

        # Hand (sorted for determinism)
        hand_str = ",".join(repr(c) for c in sorted(self.hand))
        parts.append(f"h=[{hand_str}]")

        # Bids
        if self.bids:
            bid_str = ",".join(f"{p}:{a}" for p, a in self.bids)
            parts.append(f"b=[{bid_str}]")

        # Trump
        if self.trump_suit is not None:
            parts.append(f"t={SUIT_NAMES[self.trump_suit]}{self.direction.value[0]}")

        # Trick state
        if self.current_trick:
            trick_str = ",".join(f"{p}:{c!r}" for p, c in self.current_trick)
            parts.append(f"tr=[{trick_str}]")

        parts.append(f"bk={self.books[0]}-{self.books[1]}")
        parts.append(f"tp={self.tricks_played}")

        return "|".join(parts)


# ── Action space ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class Action:
    """
    A single action a player can take. Tagged union by phase.

    Bidding:   Action(bid=N)           where N in {0, 1..6, -1}
    Trump:     Action(trump=TrumpChoice(...))
    Discard:   Action(discard=frozenset of 4 Cards)
    Play:      Action(card=Card)
    """
    bid: Optional[int] = None
    trump: Optional[TrumpChoice] = None
    discard: Optional[frozenset[Card]] = None
    card: Optional[Card] = None

    def __repr__(self) -> str:
        if self.bid is not None:
            if self.bid == BID_PASS:
                return "Pass"
            if self.bid == BID_TAKE:
                return "Take"
            return f"Bid({self.bid})"
        if self.trump is not None:
            return f"Trump({self.trump})"
        if self.discard is not None:
            return f"Discard({','.join(repr(c) for c in sorted(self.discard))})"
        if self.card is not None:
            return f"Play({self.card})"
        return "NoOp"


# ── Action enumeration ───────────────────────────────────────────────

def legal_bid_actions(gs: GameState) -> list[Action]:
    """
    Legal bid actions for the current bidder.

    Rules:
    - Can always pass (bid 0)
    - Can bid any amount > current high bid, up to 6
    - Dealer can "take it" (bid -1) if there's a standing bid
    """
    actions = [Action(bid=BID_PASS)]

    for amount in range(gs.high_bid + 1, 7):
        actions.append(Action(bid=amount))

    # Dealer "take it"
    is_dealer = gs.current_bidder == gs.dealer
    if is_dealer and gs.high_bid > 0:
        actions.append(Action(bid=BID_TAKE))

    return actions


def legal_trump_actions() -> list[Action]:
    """All 12 possible trump choices: 4 suits x 3 directions."""
    actions = []
    for suit in Suit:
        for direction in Direction:
            actions.append(Action(trump=TrumpChoice(suit=suit, direction=direction)))
    return actions


def legal_play_actions(gs: GameState, player: int) -> list[Action]:
    """
    Legal cards the player can play.

    Must follow suit if possible. If void in lead suit, can play anything.
    """
    hand = gs.hands[player]
    if not hand:
        return []

    # If leading (no cards in current trick), can play anything
    if not gs.current_trick:
        return [Action(card=c) for c in hand]

    # Must follow lead suit if possible
    lead_suit = gs.current_trick[0][1].suit
    in_suit = [c for c in hand if c.suit == lead_suit]

    if in_suit:
        return [Action(card=c) for c in in_suit]
    else:
        # Void: can play anything
        return [Action(card=c) for c in hand]


def legal_discard_actions(gs: GameState, player: int) -> list[Action]:
    """
    Legal discard actions: choose exactly 4 cards from hand to discard.

    The hand has 16 cards (12 dealt + 4 kitty). Must discard 4 to get back to 12.

    NOTE: The discard action space is C(16,4) = 1820 which is large.
    For CFR, we'll likely need to abstract this (e.g., heuristic discard).
    For now, we enumerate all possibilities.
    """
    from itertools import combinations
    hand = gs.hands[player]
    assert len(hand) == 16, f"Expected 16 cards for discard, got {len(hand)}"

    actions = []
    for combo in combinations(hand, 4):
        actions.append(Action(discard=frozenset(combo)))
    return actions


def legal_actions(gs: GameState) -> list[Action]:
    """Return all legal actions for the current acting player."""
    if gs.phase == Phase.BIDDING:
        return legal_bid_actions(gs)
    elif gs.phase == Phase.TRUMP_SELECTION:
        return legal_trump_actions()
    elif gs.phase == Phase.DISCARDING:
        assert gs.declarer is not None
        return legal_discard_actions(gs, gs.declarer)
    elif gs.phase == Phase.PLAY:
        return legal_play_actions(gs, gs.current_player)
    else:
        return []


def acting_player(gs: GameState) -> int:
    """Which player must act next."""
    if gs.phase == Phase.BIDDING:
        return gs.current_bidder
    elif gs.phase == Phase.TRUMP_SELECTION:
        assert gs.declarer is not None
        return gs.declarer
    elif gs.phase == Phase.DISCARDING:
        assert gs.declarer is not None
        return gs.declarer
    elif gs.phase == Phase.PLAY:
        return gs.current_player
    else:
        return -1
