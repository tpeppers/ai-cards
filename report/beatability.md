# Can Claude Omni be beaten — and can you prove it?

*Companion to `report/bayesian-trump-selection.md` and the Omni information
audit (`src/strategies/claudeOmni.ts`). Written July 2026.*

## 1. Is it beatable? Almost certainly yes.

Claude Omni is the fixed point of a greedy hill-climb over a restricted
hypothesis class: first-match rule lists over the DSL's primitives, adopted
one confirmed change at a time. Nothing in that process approaches a game-
theoretic optimum. Specific, known daylight:

- **No score-state adaptation.** The DSL cannot see team scores. A team at
  19 points should bid and risk differently than a team at 3; Omni plays
  every hand as if the match were 0-0.
- **Memoryless heuristics, not belief-state play.** Omni recomputes counts
  from public information each trick, but it does not infer *hidden hands*
  from opponents' choices (e.g., "East ducked the second round of hearts,
  so East likely holds the guarded Q"). Every play by a known deterministic
  opponent leaks information Omni ignores.
- **No positional play.** Second-hand-low / third-hand-high / finesse
  positioning based on who sits behind whom is entirely absent.
- **Greedy, per-section optimization.** Discard, bid, trump, and play rules
  were each adopted against a fixed rest-of-strategy. Joint optima across
  sections were never searched.
- **The silent enemy is a uniform prior.** Only the signaling opponent is
  modeled.

Counter-evidence worth taking seriously: within the *current* DSL
vocabulary, the well is running dry — the last several single-rule
experiments (books-bid-4, establishment leads, structural trump tiebreaks,
scored direction leans at any weights, fitted or not) were nulls or losses.
Historically, every real gain came from a NEW information channel (suit
roles +10.7pp, structural signals +3pp, enemy-signal exclusion +1.1pp), not
from rearranging existing rules. Expect future gains to look the same:
expressiveness first, rules second.

## 2. Can you PROVE it?

Three different claims, three different standards:

**"Strategy A beats strategy B" — yes, effectively proven.** The harness
plays A vs B over seeded deck pools, both seat-orientations, N large enough
to shrink the 95% CI below the observed edge, then confirms on independent
seeds. This is statistical proof to arbitrary confidence, and because the
pools and engine are deterministic, every claim is exactly reproducible
(the regenerated makeable-sweep reproduced its numbers to the hundredth of
a percent). Every adoption in the Omni lineage carries this certificate.

**"Nothing beats B" (optimality) — not provable exactly, boundable in
practice.** Exact optimality for 4-player partnership Bid Whist with hidden
hands is computationally out of reach. But there is a rigorous middle path:

**Exploitability against a fixed strategy — the right next experiment.**
Omni is deterministic and public. Fix the other three seats to it and the
game collapses into a single-agent decision problem. Build a best-response
player: at each decision, sample hidden-card layouts consistent with
everything observed (weighting by what Omni's own deterministic bids and
plays reveal — its signals are *exactly true*, which a best-response can
exploit ruthlessly), roll each sampled layout forward (cheap: the other
three policies are known code), and pick the action with the best expected
books. Its win rate vs Omni measures Omni's exploitability:

- ~50% → Omni is near-unexploitable at that search depth: strong evidence
  the rules are close to the ceiling for this game against itself.
- 55-65% → proven beatable by at least that much — and every decision where
  the searcher deviates from Omni is a mined candidate for a new rule.

That searcher is not itself a "strategy" in the DSL sense (it's search, not
rules, and it over-fits to Omni's tells), but it is the honest yardstick,
and its deviations are the discovery instrument.

**The challenge page is the human version of the same yardstick.** Every
flagged hand — where a human's choices beat the shadow-simulated all-Omni
counterfactual on the identical deal — is a human-found exploit, recorded
in a replayable format (BWR1) with the assistance level noted so
full-information wins can be discounted appropriately.

## 3. The candidate ideas (from human play descriptions) — RESULTS

Tested vs Claude Omni, 20k games/matchup (report/human-tools-sweep*.json):

1. **Probe leads by beater count** (`.least_beaten`) — **CONFIRMED, +1.4pp,
   ADOPTED.** With control, throw the spare with the fewest outstanding
   cards that beat it — it wins the trick now or forces its beater out —
   instead of the weakest spare. Five independent pools: 50.56 / 51.33 /
   51.97 / 50.71 / 52.28 (±0.65-0.69), pooled 51.37% ±0.30 over ~105k
   games. Now in the champion as ClaudeFam (Roles+MTC+CP+PL) / Claude Omni.
   This directly validates the section-1 thesis: a NEW information channel
   (per-card beater counts) wins where rule rearrangement had gone dry.
2. **Control passing** (`partner_cover_suit()`) — null (49.80 / 49.95 /
   50.17). The exit-suit steering doesn't add tricks; by the time boss is
   spent, control passes to a strong partner organically. The primitive
   stays available.
3. **Conventional 3-bids** ("5+ clubs") — null at 5+ (49.86 / 49.54 /
   49.59): the trump-quality information partner gains is worth almost
   exactly the 3-bid's contract-bump cost. At 4+ clubs it over-fires and
   LOSES (48.23 / 47.56 / 47.68) — the same tax that killed every prior
   bid-3 experiment. For a convention to pay, its content must be worth
   more than one contract step.
