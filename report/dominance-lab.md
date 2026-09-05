# Dominance Lab — asserting a strategy is a best response on a board

*Companion to `report/beatability.md`. The tool lives at `/dominance`
(`src/components/DominanceLab.tsx`), the engine at
`src/simulation/dominance.ts`, the search at
`src/simulation/dominanceSearch.ts`, and the headless runner at
`scripts/dominance-check.js`.*

## What question it answers

`beatability.md` §2 draws the distinction between "A beats B" (statistically
provable) and "nothing beats B" (not provable in general). The Dominance Lab
takes the narrowest useful slice of the second claim — one where the answer
can actually be exact:

> Given **this hand** (or this full board), is the champion the best thing
> to play from my seat?

Restricting to a single board is what buys the rigor. On a fully specified
52-card layout the whole game is deterministic, so the four dealer rotations
are the *complete population*, not a sample. "No challenger profits by
deviating on this board" is then a fact about that board, not a confidence
interval.

## The test: unilateral deviation

The Compare page measures head-to-head win rates. That is the wrong lens for
this question, because a challenger can win a head-to-head match by
exploiting one specific opponent without being better play in general.

Dominance Lab uses the game-theoretic definition instead:

```
BASELINE   champion in all four seats            -> payoff_c
DEVIATED   one seat (or one team) swapped to a
           challenger, the other seats still
           playing champion                      -> payoff_x

delta = payoff_x - payoff_c
```

`delta > 0` is a **refutation**: the deviator profited by abandoning the
champion, so the champion is not a best response here. Holding the other
three seats fixed at champion is the whole point — it removes the "you only
beat *that* opponent" escape hatch.

Scope is selectable:

- **Seat only** — the strict best-response test. Your partner keeps playing
  champion, so a challenger cannot win by re-coordinating the partnership.
- **Whole team** — both partners swap. Answers "could our pair do better",
  which allows joint conventions the seat-only test rules out.

Payoff is the deviating team's net hand points under `scoreHand()` — bid
made or set, plus the over/undertrick bonus. A whisting scores no points in
`scoreHand()` because it ends the game outright, so the engine substitutes
±21, the value of winning.

## Board specs

A board spec is a 52-character deck string in the `urlGameState` schema with
`_` for unknown. Cards deal round-robin, so seat *P* holds indices
*P, P+4, … P+44*, and 48-51 are the kitty.

```
a___b___c___d___e___f___g___n___o___p___q___r_______   South's hand pinned
PVozZIgXJRxcnqOYBfWjNdSTteELHrbApavUshlDKkuMCmyiGQwF   full board
```

Partial specs are resolved by seeded Monte Carlo *before* the game sees
them, so the baseline and every challenger play the identical cards on each
trial. That pairing is what makes small deltas readable — unpaired, fill
noise swamps the strategy difference entirely.

## Two guards worth knowing about

**The parity row.** Every run silently seats the champion as its own
challenger. Those deltas must be exactly zero. If they are not, something
nondeterministic leaked into the simulation and the report says so in red
rather than quietly reporting noise as signal.

**Empty-AST rejection.** `parseStrategy` is lenient — hand it prose and it
returns an AST with no sections instead of throwing, and `BidWhistGame` then
falls back to its built-in AI. A row like that would report the *default
AI's* results under your strategy's name. `loadStrategy()` rejects it up
front: "no play/bid/trump/discard section parsed".

## The search half

The registry table only answers "does any strategy I already wrote beat the
champion here?". The search panel asks whether one *exists*, by evolving
`SignalLabConfig` candidates (the same parameter space
`strategyOptimizer.ts` searches) with fitness set to mean deviation payoff
on this board.

This is where it is easy to fool yourself. On a partial board the trial set
is a Monte Carlo sample, and a long enough search **will** find a config
that beats the champion on those particular fills by luck alone. So:

1. Candidates are evolved against a **training** trial set.
2. Selection within a generation uses the training lower confidence bound,
   not the raw mean, so a lucky spread does not win a generation.
3. The best distinct candidates from the whole run are re-scored on a
   **holdout** trial set drawn from a disjoint seed. Only the holdout number
   is reported as a verdict.
4. A survivor can be re-tested once more with **Confirm** — a fresh seed and
   double the fills, run through the same `runDominanceCheck` the registry
   table uses, which also clears the multiple-comparison worry from picking
   a winner out of six finalists.

An exact board has nothing to overfit to, so the holdout stage is skipped
there and training results stand.

## Verdicts

| Verdict | Meaning |
|---|---|
| **DOMINANT** | No challenger profited by deviating. On an exact board this is a fact about the board; on a partial board it is evidence at the fill count used. |
| **CONTESTED** | No significant refutation overall, but a challenger beat the champion on individual deals. Raise the fill count, or open the row to see which deals. |
| **REFUTED** | A challenger profits significantly by deviating. The champion is not a best response here. |

DOMINANT is always relative to the strategies actually tried. It is evidence
of local optimality within the DSL's reach, never a proof of optimality —
the distinction `beatability.md` §2 makes.

## Headless runs

```
node scripts/dominance-check.js -- --hand=abcdefgnopqr --fills=2000
node scripts/dominance-check.js -- --board=<52 chars> --scope=team --seat=1
node scripts/dominance-check.js -- --hand=abcdefgnopqr --fills=400 --search \
    --generations=20 --population=24
```

Options: `--board`, `--hand`, `--champion`, `--challengers` (names or `all`),
`--seat`, `--scope`, `--fills`, `--dealers`, `--seed`, `--search`,
`--generations`, `--population`. A refuter found by the search prints its
generated `.cstrat` so it can be pasted straight into a Custom slot.

Throughput is roughly 1000 hands/sec, and a trial costs one hand per
challenger plus one shared baseline — so 1000 fills × 4 dealers × 15
registry challengers is about a minute.
