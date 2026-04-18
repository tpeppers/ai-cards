"""
Stage 3: Vanilla CFR (Counterfactual Regret Minimization) solver.

CPU-only, correct before fast. Uses the Stage 2 game engine as the
evaluator for terminal states.

Key design: ABSTRACT INFORMATION SETS.
  The raw info set space (exact hand + exact bids) is ~2e11 states.
  We abstract hands into strategic features:
    - ace_count, king_ace_count, deuce_trey_count
    - max_suit_count, high_count vs low_count
  This reduces the info set space to ~10-50K reachable states.

Architecture:
  - External sampling MCCFR (Monte Carlo CFR)
  - Bidding + Trump selection are solved by CFR
  - Discard phase uses a heuristic
  - Play phase evaluated by random rollouts
  - Regret matching for strategy updates
  - Average strategy converges to Nash equilibrium
"""

from __future__ import annotations

import random
import sys
import time
import numpy as np
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from game_state import (
    Card, Suit, Rank, Direction, Phase,
    GameState, InfoSet, Action, TrumpChoice,
    BID_PASS, BID_TAKE,
    card_strength, make_deck,
    legal_actions, acting_player, legal_play_actions,
    legal_bid_actions, legal_trump_actions,
)
from game_engine import (
    deal_hand, apply_action, resolve_trick,
    hand_payoff, is_terminal, needs_redeal,
)


# ── Abstract info set ─────────────────────────────────────────────────

def compute_hand_features(hand: list[Card]) -> dict:
    """
    Compute strategic features from a hand.
    These features abstract away exact card identities.
    """
    aces = sum(1 for c in hand if c.rank == 14)
    kings = sum(1 for c in hand if c.rank == 13)
    king_ace = aces + kings
    deuce_trey = sum(1 for c in hand if c.rank in (2, 3))

    # High = 8-14, Low = 2-7
    high = sum(1 for c in hand if c.rank >= 8)
    low = sum(1 for c in hand if c.rank <= 7)

    # Suit counts
    suit_counts = [0, 0, 0, 0]
    for c in hand:
        suit_counts[c.suit] += 1
    max_suit = max(suit_counts) if suit_counts else 0
    max_suit_idx = suit_counts.index(max_suit) if max_suit > 0 else 0

    # Per-suit strength for trump selection
    suit_high = [0, 0, 0, 0]  # high cards per suit
    suit_low = [0, 0, 0, 0]   # low cards per suit
    suit_aces = [0, 0, 0, 0]
    for c in hand:
        if c.rank >= 8:
            suit_high[c.suit] += 1
        else:
            suit_low[c.suit] += 1
        if c.rank == 14:
            suit_aces[c.suit] += 1

    return {
        "aces": aces,
        "kings": kings,
        "king_ace": king_ace,
        "deuce_trey": deuce_trey,
        "high": high,
        "low": low,
        "max_suit": max_suit,
        "max_suit_idx": max_suit_idx,
        "suit_counts": tuple(suit_counts),
        "suit_high": tuple(suit_high),
        "suit_low": tuple(suit_low),
        "suit_aces": tuple(suit_aces),
    }


def _bin(val: int, thresholds: list[int]) -> int:
    """Bin a value: returns the index of the bin it falls into."""
    for i, t in enumerate(thresholds):
        if val <= t:
            return i
    return len(thresholds)


def abstract_bid_key(gs: GameState, player: int) -> str:
    """
    Abstract information set key for BIDDING decisions.

    Features:
      - Binned hand features (ace, king_ace, deuce_trey, max_suit, high-low)
      - Bidding position (seat: 0-3 from first bidder)
      - Current high bid (0-6)
      - Partner's bid (0-6, 0 if not yet bid)
      - Is dealer
    """
    hand = gs.hands[player]
    f = compute_hand_features(hand)

    # Bin hand features
    ace_bin = min(f["aces"], 3)                         # 0, 1, 2, 3+
    ka_bin = _bin(f["king_ace"], [1, 3, 5])             # 0-1, 2-3, 4-5, 6+
    dt_bin = _bin(f["deuce_trey"], [1, 3, 5])           # 0-1, 2-3, 4-5, 6+
    suit_bin = _bin(f["max_suit"], [4, 5, 7])           # <=4, 5, 6-7, 8+
    hl_bin = 0 if f["high"] > f["low"] + 2 else (2 if f["low"] > f["high"] + 2 else 1)  # high/balanced/low

    # Bidding context
    partner = (player + 2) % 4
    partner_bid = 0
    for p, amt in gs.bids:
        if p == partner and amt > 0:
            partner_bid = amt
            break

    is_dealer = 1 if player == gs.dealer else 0
    seat = gs.bid_count  # 0=first, 1=second, 2=third, 3=dealer

    return (f"B|s{seat}|d{is_dealer}|"
            f"a{ace_bin}ka{ka_bin}dt{dt_bin}ms{suit_bin}hl{hl_bin}|"
            f"hb{gs.high_bid}pb{partner_bid}")


def abstract_trump_key(gs: GameState, player: int) -> str:
    """
    Abstract information set key for TRUMP SELECTION decisions.

    Features:
      - Binned hand features (per-suit strength matters more here)
      - Partner's bid (signal)
      - Best suit for uptown vs downtown
    """
    hand = gs.hands[player]  # 16 cards at this point
    f = compute_hand_features(hand)

    ace_bin = min(f["aces"], 3)
    hl_bin = 0 if f["high"] > f["low"] + 3 else (2 if f["low"] > f["high"] + 3 else 1)
    suit_bin = _bin(f["max_suit"], [5, 7, 9])

    # Which suit is strongest for each direction?
    # Uptown: most high cards
    best_up = max(range(4), key=lambda s: (f["suit_high"][s], f["suit_counts"][s]))
    # Downtown: most low cards + aces
    best_down = max(range(4), key=lambda s: (f["suit_low"][s] + f["suit_aces"][s], f["suit_counts"][s]))

    # Partner's bid
    partner = (player + 2) % 4
    partner_bid = 0
    for p, amt in gs.bids:
        if p == partner and amt > 0:
            partner_bid = min(amt, 3)  # cap at 3 (signal range)
            break

    # Enemy bids
    enemies = [(player + 1) % 4, (player + 3) % 4]
    enemy_bid = 0
    for p, amt in gs.bids:
        if p in enemies and 1 <= amt <= 2:  # only signal bids
            enemy_bid = amt
            break

    return (f"T|a{ace_bin}hl{hl_bin}ms{suit_bin}|"
            f"bu{best_up}bd{best_down}|"
            f"pb{partner_bid}eb{enemy_bid}")


# ── CFR Node ──────────────────────────────────────────────────────────

@dataclass
class CFRNode:
    """A node in the CFR decision tree, indexed by abstract info set."""
    num_actions: int
    regret_sum: np.ndarray = field(init=False)
    strategy_sum: np.ndarray = field(init=False)
    visit_count: int = 0

    def __post_init__(self):
        self.regret_sum = np.zeros(self.num_actions, dtype=np.float64)
        self.strategy_sum = np.zeros(self.num_actions, dtype=np.float64)

    def get_strategy(self, realization_weight: float = 1.0) -> np.ndarray:
        """Regret-matching: proportional to positive regrets."""
        positive = np.maximum(self.regret_sum, 0)
        total = positive.sum()
        if total > 0:
            strategy = positive / total
        else:
            strategy = np.ones(self.num_actions) / self.num_actions
        self.strategy_sum += realization_weight * strategy
        self.visit_count += 1
        return strategy

    def get_average_strategy(self) -> np.ndarray:
        """Converged strategy (Nash equilibrium)."""
        total = self.strategy_sum.sum()
        if total > 0:
            return self.strategy_sum / total
        return np.ones(self.num_actions) / self.num_actions


# ── Heuristic discard ─────────────────────────────────────────────────

def heuristic_discard(gs: GameState) -> Action:
    """Keep trump + long suit cards, discard weakest short-suit cards."""
    assert gs.declarer is not None
    hand = list(gs.hands[gs.declarer])
    trump = gs.trump_suit
    direction = gs.direction

    def keep_score(card: Card) -> float:
        is_trump = card.suit == trump if trump is not None else False
        strength = card_strength(card, trump, direction)
        score = strength[0] * 100 + strength[1]
        suit_count = sum(1 for c in hand if c.suit == card.suit)
        score += suit_count * 5
        return score

    scored = sorted(hand, key=keep_score)
    discard_cards = frozenset(scored[:4])
    return Action(discard=discard_cards)


# ── Play phase evaluator ─────────────────────────────────────────────

def _winner_score(rank: int, direction: Direction) -> float:
    """
    Score how likely this card is to be a trick winner (0.0 to 1.0).
    Depends on direction (which ranks are "high").
    """
    if direction == Direction.UPTOWN:
        # A(14)=1.0, K(13)=0.92, Q(12)=0.84, ..., 2=0.0
        return (rank - 2) / 12.0
    elif direction == Direction.DOWNTOWN:
        # A(14)=1.0, 2=0.92, 3=0.84, ..., K(13)=0.0
        if rank == 14:
            return 1.0
        elif rank == 2:
            return 0.92
        else:
            # 3->0.84, 4->0.77, ..., 13->0.0
            return max(0.0, (15 - rank) / 13.0)
    else:  # DOWNTOWN_NOACES
        # 2=1.0, 3=0.92, ..., K=0.08, A=0.0
        if rank == 14:
            return 0.0
        elif rank == 2:
            return 1.0
        else:
            # 3->0.92, 4->0.84, ..., 13->0.08
            return max(0.0, (15 - rank) / 13.0)


def evaluate_play_heuristic(gs: GameState) -> float:
    """
    Fast heuristic evaluation of a play-phase game state.
    Estimates expected books for the declarer's team based on:
      - Trump card count and strength
      - Side-suit winner probability (direction-aware)
      - Long suit potential

    Returns utility from team 0 perspective.
    """
    assert gs.declarer is not None
    trump = gs.trump_suit
    direction = gs.direction
    declarer_team = gs.declarer % 2

    team_tricks = [0.0, 0.0]

    for player in range(4):
        hand = gs.hands[player]
        team = player % 2

        trump_count = 0
        trump_strength = 0.0
        side_winners = 0.0

        for card in hand:
            is_trump = trump is not None and card.suit == trump
            if is_trump:
                trump_count += 1
                trump_strength += _winner_score(card.rank, direction)
            else:
                # Non-trump: score by direction-aware winner probability
                ws = _winner_score(card.rank, direction)
                if ws >= 0.9:
                    side_winners += 0.7
                elif ws >= 0.7:
                    side_winners += 0.35
                elif ws >= 0.5:
                    side_winners += 0.1

        estimated = trump_count * 0.45 + trump_strength * 0.3 + side_winners
        team_tricks[team] += estimated

    # Normalize to 12 tricks
    total = team_tricks[0] + team_tricks[1]
    if total > 0:
        team_tricks[0] = team_tricks[0] / total * 12
        team_tricks[1] = team_tricks[1] / total * 12

    # Add kitty book for declarer
    declarer_books = team_tricks[declarer_team] + 1
    contract = gs.high_bid + 6

    if declarer_books >= contract:
        overtricks = declarer_books - contract
        points = gs.high_bid + overtricks / 2
    else:
        undertricks = contract - declarer_books
        points = -(gs.high_bid + undertricks / 2)

    return points if declarer_team == 0 else -points


def evaluate_play_random(gs: GameState, n_rollouts: int = 1) -> float:
    """
    Evaluate a play-phase state by random rollouts.
    Returns utility from team 0 perspective (positive = team 0 wins).
    Slower but more accurate than heuristic.
    """
    total = 0.0
    for _ in range(n_rollouts):
        sim = gs.copy()
        while not is_terminal(sim):
            player = acting_player(sim)
            actions = legal_play_actions(sim, player)
            if not actions:
                break
            sim = apply_action(sim, random.choice(actions))
        payoff = hand_payoff(sim)
        total += payoff[0] - payoff[1]
    return total / n_rollouts


# ── CFR Solver ────────────────────────────────────────────────────────

class BidWhistCFR:
    """
    External-sampling MCCFR for Bid Whist bidding + trump selection.

    The game is modeled as 2-team zero-sum: team 0 (players 0,2) vs
    team 1 (players 1,3). Utility is from team 0's perspective.

    Teammates share an interest but have private information (their own hand).
    Each player has their own info sets and strategies.
    """

    def __init__(self, play_rollouts: int = 1):
        self.nodes: dict[str, CFRNode] = {}
        self.play_rollouts = play_rollouts
        self.iterations = 0

    def get_node(self, key: str, n_actions: int) -> CFRNode:
        if key not in self.nodes:
            self.nodes[key] = CFRNode(num_actions=n_actions)
        return self.nodes[key]

    def cfr_iterate(self, gs: GameState, updating_team: int) -> float:
        """
        External-sampling MCCFR traversal.

        Key optimization: for the UPDATING team's players, we traverse
        ALL actions. For the other team's players, we SAMPLE one action
        from the current strategy. This reduces branching from O(A^4) to O(A^2).

        Parameters:
            gs: current game state
            updating_team: which team (0 or 1) we are updating regrets for

        Returns:
            Expected utility for TEAM 0 from this state.
        """
        # ── Terminal ──
        if is_terminal(gs):
            if needs_redeal(gs):
                return 0.0
            payoff = hand_payoff(gs)
            return payoff[0] - payoff[1]

        # ── Discard: heuristic ──
        if gs.phase == Phase.DISCARDING:
            action = heuristic_discard(gs)
            return self.cfr_iterate(apply_action(gs, action), updating_team)

        # ── Play: heuristic evaluation (fast) ──
        if gs.phase == Phase.PLAY:
            if self.play_rollouts > 0:
                return evaluate_play_random(gs, self.play_rollouts)
            return evaluate_play_heuristic(gs)

        # ── Decision node (BIDDING or TRUMP_SELECTION) ──
        player = acting_player(gs)
        team = player % 2

        actions = legal_actions(gs)
        n = len(actions)

        # Abstract info set
        if gs.phase == Phase.BIDDING:
            key = abstract_bid_key(gs, player)
        else:
            key = abstract_trump_key(gs, player)

        node = self.get_node(key, n)
        strategy = node.get_strategy()

        if team != updating_team:
            # OPPONENT: sample one action from strategy
            idx = np.random.choice(n, p=strategy)
            return self.cfr_iterate(apply_action(gs, actions[idx]), updating_team)

        # UPDATING TEAM: traverse all actions
        action_values = np.zeros(n)
        for i, action in enumerate(actions):
            action_values[i] = self.cfr_iterate(apply_action(gs, action), updating_team)

        # Node value
        node_value = float(np.dot(strategy, action_values))

        # Update regrets (team 0 maximizes, team 1 minimizes)
        sign = 1.0 if team == 0 else -1.0
        for i in range(n):
            node.regret_sum[i] += sign * (action_values[i] - node_value)

        return node_value

    def train(self, n_iterations: int, seed: int = 42,
              progress_every: int = 100) -> dict:
        """
        Train for n_iterations using external-sampling MCCFR.

        Each iteration deals a random hand and traverses for both teams
        (alternating the updating team).
        """
        random.seed(seed)
        np.random.seed(seed)

        t0 = time.time()
        stats = {"node_counts": []}

        for t in range(n_iterations):
            gs = deal_hand(dealer=t % 4)

            # Update both teams each iteration
            for team in (0, 1):
                self.cfr_iterate(gs, updating_team=team)

            self.iterations += 1

            if (t + 1) % progress_every == 0:
                elapsed = time.time() - t0
                rate = (t + 1) / elapsed
                print(f"  [{t+1:6d}/{n_iterations}] "
                      f"{len(self.nodes):6d} info sets | "
                      f"{rate:.0f} iter/s | "
                      f"{elapsed:.1f}s")
                stats["node_counts"].append(len(self.nodes))

        elapsed = time.time() - t0
        print(f"\n  Done: {n_iterations} iterations, "
              f"{len(self.nodes)} info sets, {elapsed:.1f}s")
        return stats

    # ── Analysis methods ──────────────────────────────────────────────

    def analyze_bidding(self):
        """Analyze converged bidding strategies by abstract features."""
        print("\n" + "=" * 60)
        print("BIDDING STRATEGY ANALYSIS")
        print("=" * 60)

        bid_nodes = {k: v for k, v in self.nodes.items() if k.startswith("B|")}
        print(f"\n  Total bidding info sets: {len(bid_nodes)}")

        if not bid_nodes:
            return

        # Group by seat position
        for seat in range(4):
            seat_nodes = {k: v for k, v in bid_nodes.items() if f"|s{seat}|" in k}
            if not seat_nodes:
                continue

            seat_label = ["1st bidder", "2nd bidder", "3rd bidder (hot seat)", "Dealer"][seat]
            print(f"\n  --- {seat_label} ({len(seat_nodes)} info sets) ---")

            # Find most-visited nodes for this seat
            sorted_nodes = sorted(seat_nodes.items(),
                                  key=lambda x: x[1].visit_count,
                                  reverse=True)

            for key, node in sorted_nodes[:8]:
                if node.visit_count < 3:
                    continue
                avg = node.get_average_strategy()

                # Parse key: B|s0|d0|a1ka2dt1ms0hl1|hb0pb0
                parts = key.split("|")
                hand_feat = parts[3] if len(parts) > 3 else "?"  # hand features
                hb = int(key.split("hb")[1].split("pb")[0])
                pb = int(key.split("pb")[1]) if "pb" in key else 0
                is_dealer = "d1" in parts[2] if len(parts) > 2 else False

                action_labels = ["Pass"]
                for b in range(max(1, hb + 1), 7):
                    action_labels.append(f"Bid {b}")
                if is_dealer and hb > 0:
                    action_labels.append("Take")

                top_actions = [(action_labels[i] if i < len(action_labels) else f"a{i}", avg[i])
                               for i in range(len(avg)) if avg[i] > 0.01]
                top_actions.sort(key=lambda x: -x[1])

                top_str = ", ".join(f"{name}:{prob:.0%}" for name, prob in top_actions[:4])
                context = f"hb={hb}"
                if pb > 0:
                    context += f",pb={pb}"
                print(f"    {hand_feat:28s} ({context}, n={node.visit_count:3d}) => {top_str}")

    def analyze_trump(self):
        """Analyze converged trump selection strategies."""
        print("\n" + "=" * 60)
        print("TRUMP SELECTION ANALYSIS")
        print("=" * 60)

        trump_nodes = {k: v for k, v in self.nodes.items() if k.startswith("T|")}
        print(f"\n  Total trump info sets: {len(trump_nodes)}")

        if not trump_nodes:
            return

        # All trump actions (fixed order)
        trump_actions = legal_trump_actions()
        action_labels = [repr(a.trump) for a in trump_actions]

        # Aggregate: what direction is preferred given partner bid?
        dir_prefs = defaultdict(lambda: np.zeros(3))  # pb -> [uptown, downtown, noaces]
        dir_counts = defaultdict(int)

        for key, node in trump_nodes.items():
            if node.visit_count < 2:
                continue
            avg = node.get_average_strategy()
            pb = int(key.split("pb")[1].split("eb")[0])

            # Sum probabilities by direction
            for i, action in enumerate(trump_actions):
                d = action.trump.direction
                if d == Direction.UPTOWN:
                    dir_prefs[pb][0] += avg[i]
                elif d == Direction.DOWNTOWN:
                    dir_prefs[pb][1] += avg[i]
                else:
                    dir_prefs[pb][2] += avg[i]
            dir_counts[pb] += 1

        print(f"\n  Direction preference by partner bid:")
        print(f"    {'PB':>4s}  {'N':>5s}  {'Uptown':>8s}  {'Downtown':>8s}  {'NoAces':>8s}")
        for pb in sorted(dir_prefs):
            n = dir_counts[pb]
            if n > 0:
                prefs = dir_prefs[pb] / n
                print(f"    {pb:4d}  {n:5d}  {prefs[0]:8.1%}  {prefs[1]:8.1%}  {prefs[2]:8.1%}")

        # Show most-visited trump nodes
        sorted_nodes = sorted(trump_nodes.items(),
                              key=lambda x: x[1].visit_count,
                              reverse=True)

        print(f"\n  Top trump selection info sets:")
        for key, node in sorted_nodes[:10]:
            if node.visit_count < 3:
                continue
            avg = node.get_average_strategy()
            features = key.split("|")[1]  # hand features
            partner_info = key.split("|")[3]  # pb/eb

            top = [(action_labels[i], avg[i])
                   for i in range(len(avg)) if avg[i] > 0.02]
            top.sort(key=lambda x: -x[1])
            top_str = ", ".join(f"{name}:{prob:.0%}" for name, prob in top[:4])

            print(f"    {features} {partner_info} (n={node.visit_count:3d}) => {top_str}")

    def analyze_signal_optimality(self):
        """
        Key analysis: Is signal bidding (1/2/3) optimal?

        Compares what the solver learned about:
        1. What early bidders should bid (signal or not?)
        2. How trump selection uses partner's bid
        """
        print("\n" + "=" * 60)
        print("SIGNAL BID OPTIMALITY ANALYSIS")
        print("=" * 60)

        bid_nodes = {k: v for k, v in self.nodes.items() if k.startswith("B|")}

        # Focus on early bidders (seat 0 and 1)
        for seat in range(2):
            seat_nodes = {k: v for k, v in bid_nodes.items()
                         if f"|s{seat}|d0|" in k and v.visit_count >= 5}

            if not seat_nodes:
                print(f"\n  Seat {seat+1}: insufficient data")
                continue

            print(f"\n  --- Seat {seat+1} early bidder ---")

            # Group by hand feature pattern
            signal_bid_pcts = defaultdict(lambda: np.zeros(7))  # feature -> [pass, b1, b2, b3, b4, b5, b6]
            signal_counts = defaultdict(int)

            for key, node in seat_nodes.items():
                avg = node.get_average_strategy()
                parts = key.split("|")
                features = parts[3] if len(parts) > 3 else "?"
                hb = int(key.split("hb")[1].split("pb")[0])

                # Only look at cases where signal bids are available (hb < 3)
                if hb > 2:
                    continue

                # Map strategy to bid amounts
                bid_probs = np.zeros(7)  # pass, b1, b2, b3, b4, b5, b6
                bid_probs[0] = avg[0]  # pass
                for i in range(1, len(avg)):
                    bid_amount = hb + i  # action i = bid (hb + i)
                    if 1 <= bid_amount <= 6:
                        bid_probs[bid_amount] = avg[i]

                signal_bid_pcts[features] += bid_probs
                signal_counts[features] += 1

            # Show signal bid preferences
            print(f"    {'Hand Features':30s} {'N':>4s}  {'Pass':>6s}  {'B1':>6s}  {'B2':>6s}  {'B3':>6s}  {'B4+':>6s}")
            for features in sorted(signal_counts, key=signal_counts.get, reverse=True):
                n = signal_counts[features]
                probs = signal_bid_pcts[features] / n
                b4plus = probs[4:].sum()
                print(f"    {features:30s} {n:4d}  {probs[0]:6.1%}  {probs[1]:6.1%}  "
                      f"{probs[2]:6.1%}  {probs[3]:6.1%}  {b4plus:6.1%}")


# ── Main ──────────────────────────────────────────────────────────────

def main():
    n_iters = int(sys.argv[1]) if len(sys.argv) > 1 else 10000
    rollouts = int(sys.argv[2]) if len(sys.argv) > 2 else 0  # 0 = heuristic (fast)

    print("=" * 60)
    print("  BID WHIST CFR SOLVER")
    print("=" * 60)
    print(f"  Iterations:      {n_iters}")
    print(f"  Play rollouts:   {rollouts}")
    print(f"  Phases solved:   Bidding + Trump Selection")
    print(f"  Play evaluator:  Random rollouts")
    print()

    solver = BidWhistCFR(play_rollouts=rollouts)
    solver.train(n_iterations=n_iters,
                 progress_every=max(1, n_iters // 10))

    solver.analyze_bidding()
    solver.analyze_trump()
    solver.analyze_signal_optimality()

    # ── Example hand ──
    print("\n" + "=" * 60)
    print("EXAMPLE HAND")
    print("=" * 60)

    random.seed(999)
    gs = deal_hand(dealer=0)

    print(f"\n  Dealer: Player 0")
    for p in range(4):
        hand = sorted(gs.hands[p], key=lambda c: (c.suit, c.rank))
        hand_str = " ".join(repr(c) for c in hand)
        f = compute_hand_features(hand)
        print(f"  P{p}: {hand_str}")
        print(f"      aces={f['aces']} ka={f['king_ace']} dt={f['deuce_trey']} "
              f"hi={f['high']} lo={f['low']} ms={f['max_suit']}")

    # Show bidding strategy
    print("\n  Bidding:")
    for i in range(4):
        bidder = (gs.dealer + 1 + i) % 4
        key = abstract_bid_key(gs, bidder)
        node = solver.nodes.get(key)

        if node and node.visit_count > 0:
            avg = node.get_average_strategy()
            actions = legal_actions(gs)
            top = [(repr(a), avg[j]) for j, a in enumerate(actions) if avg[j] > 0.01]
            top.sort(key=lambda x: -x[1])
            top_str = ", ".join(f"{name}:{prob:.0%}" for name, prob in top[:5])
            print(f"  P{bidder} [{key.split('|')[2]}]: {top_str}")

            # Apply most likely action
            best_idx = int(np.argmax(avg))
            gs = apply_action(gs, actions[best_idx])
        else:
            print(f"  P{bidder}: (unseen abstract state, using pass)")
            gs = apply_action(gs, Action(bid=BID_PASS))

    if gs.phase == Phase.TRUMP_SELECTION and gs.declarer is not None:
        key = abstract_trump_key(gs, gs.declarer)
        node = solver.nodes.get(key)
        if node and node.visit_count > 0:
            avg = node.get_average_strategy()
            actions = legal_actions(gs)
            top = [(repr(a.trump), avg[j]) for j, a in enumerate(actions) if avg[j] > 0.01]
            top.sort(key=lambda x: -x[1])
            top_str = ", ".join(f"{name}:{prob:.0%}" for name, prob in top[:5])
            print(f"\n  Trump (P{gs.declarer}): {top_str}")

    return solver


if __name__ == "__main__":
    solver = main()
