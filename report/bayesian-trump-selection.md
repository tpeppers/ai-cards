# Signal-conditioned trump selection: exclusion information as a strategy

*Companion to the suit-role DSL work (see `report/roles-benchmark.json`,
`report/makeable-sweep.json`). Status: theory + v1 implementation + sweep.*

## 1. The core claim: your hand re-weights everyone else's signals

When the declarer picks trump they hold 16 cards (hand + kitty) and have seen
up to three bids. The bids are usually read as *absolute* statements —
"partner is strong high", "enemy is strong low". The claim examined here is
that they are much sharper than that, because every card in the declarer's
hand is a card the signaler **cannot** hold.

A signal (under the Roles+MTC convention, `makeable_trick_count(dir) >= 4`)
says: "my 12 cards contain ≥ 4 makeable winners in direction D." Winners in a
direction live at the top of that direction's rank order. So the signal is a
statement about which of the direction's **top cards** the signaler holds —
drawn only from the tops the declarer *doesn't* hold. Two consequences:

1. **Posterior concentration.** Unconditionally, each unseen card is with a
   given other player with probability 12/36 = 1/3. Conditioning on "partner
   has ≥ 4 winners in D" pushes partner's expected share of the outstanding
   D-tops up toward "at least ~4 of them". If the declarer holds most of D's
   tops already — say only 6 of the 12 top-3-per-suit cards remain outstanding
   — the same signal now implies partner holds roughly **4 of those 6
   specific cards**. The fewer tops the declarer leaves outstanding, the more
   precisely the signal localizes partner's holding. Holding cards yourself
   *amplifies* what a signal tells you. That is the "additional signal
   information" effect, and it is real, quantifiable, and currently unused by
   every strategy in the registry.

2. **Per-suit steering.** Given the signal, partner's tops are distributed
   over the *outstanding* tops — proportionally, absent other information.
   If I hold A/Q/10 of diamonds, partner's high-signal strength is mostly
   NOT in diamonds (only K/J remain there); it concentrates in the suits
   whose tops I lack. So the signal doesn't just say "partner is strong
   high" — combined with my hand it says *where*.

The same logic applies to the enemy's signal, with the sign flipped, plus one
extra prior: an outstanding top card with **no** signal attached lands on an
enemy 2/3 of the time (two of the three unseen hands are enemies). Unsignaled
hope is usually enemy strength.

## 2. Worked example (the motivating hand)

Dealer takes the bid holding (before discard, simplified to the 12 relevant
cards): ♠ 2/3/4/7/9/J, ♦ A/Q/10/3/2, plus K/Q doubleton elsewhere. Partner
bid 2 (high). Enemy bid 1 (low). Hotseat bid 4+ (length, no direction info).

- **Call high diamonds?** My A/Q/10 are real; partner's high signal can only
  add K/J *in diamonds* (I hold the rest of its tops) — but by concentration,
  partner's high tops are likely elsewhere: A/K/Q of the suits I'm weak in,
  covering my side-suit holes. Floor is solid (my own tops), partner coverage
  lands in side suits. Reasonable call.
- **Call high spades?** My spades are low; A/K/Q/10 of spades are all
  outstanding. Partner *might* hold them — but so might the enemies, at 2/3
  prior each, and the enemy low-bidder's partner is unconstrained. Gambling
  the trump suit itself on partner coverage is high-variance: trump tops you
  don't hold are the one thing you can't ruff.
- **Call low (noaces) spades?** Exclusion cuts the *enemy's* signal: I hold
  2/3/4/7 of spades, so the enemy's low winners are provably **not** low
  spades — their strength sits in side suits, where my 6-card trump
  eventually ruffs it. My 2/3/4 are boss the moment aces are no good. The
  costs: partner's high hand goes mostly dead (opposite direction), and the
  enemy's low side-winners are live early.

The scoring model below weighs exactly these terms instead of today's
"longest/strongest suit in my own hand" heuristic, which sees none of it.

## 3. Scoring model (v1, implemented as `signal_aware_*` primitives)

For each candidate call (S = trump suit, D ∈ {uptown, downtown,
downtown-noaces}), from the declarer's 16-card context:

```
score(S, D) = MyTricks(D) + len(S)                    # own structure + trump length
            + PartnerCoverage(D, S)                   # signal + exclusion
            - EnemyThreat(D, S)                       # signal + exclusion
            + Counterpick(D)                          # devalue enemy direction
```

with:

- **outTop(s, D)** = how many of suit s's top-3 cards under D are outstanding
  (not in my 16). **totalOutTop(D)** = Σ over suits (0–12).
- **MyTricks(D)** = boss + backed count over my hand under D (the existing
  role math), plus raw trump length — consistent with `best_suit_by_tricks`.
- **PartnerCoverage**: if partner signaled D's direction group, their
  expected top-card count is `max(totalOutTop/3, 4)` (the concentration
  step), distributed per suit ∝ outTop(s, D). Side-suit coverage counts at
  1.0 (winners partner brings), trump-suit coverage at 1.0 (trump support).
  If partner signaled the opposite group: −1 (their hand is mostly dead
  weight). Pass / length bids: 0.
- **EnemyThreat**: same distribution for the enemy signaler. Side-suit
  threats count 0.75 (my trump eventually ruffs their long-suit winners);
  threats *in my trump suit* count 1.25 (nothing beats their high trump).
  Note the exclusion effect: if I hold a direction's low tops (the 2/3/4
  case), outTop in that suit is 0 and the enemy's signal poses zero threat
  there — "they can't have what I'm holding."
- **Counterpick**: +1 when D is opposite the enemy's signaled direction
  (their signaled winners degrade to junk).

Weights are v1 round numbers, deliberately unfitted; the sweep measures the
model, thresholds can be tuned later through the same harness.

**Strength-not-length corollary**: when you *do* call into the enemy's
signaled direction, their surviving winners pressure your trump control, so
suit choice should favor top-density over length (`best_suit_by_power`)
rather than the length-biased `best_suit`. Tested as a rules-only variant.

## 4. What the DSL can and cannot express

The counterpick and strength-not-length ideas are expressible as plain rules
with existing primitives (plus a trivial `best_suit_by_power`). The exclusion
arithmetic is not: the DSL has `+`/`-` only — no ratios, no argmax over
(suit × direction) pairs. Hence two new evaluator built-ins:

- `signal_aware_direction()` → direction maximizing score over all 12 calls
- `signal_aware_suit(direction)` → suit maximizing score under that direction

so the whole trump section can be one rule:

```
trump:
  default:
    choose suit: signal_aware_suit(signal_aware_direction()) direction: signal_aware_direction()
```

## 5. Experiment design

Sweep vs the current champion, ClaudeFam (Roles+MTC), 20k games/matchup,
train seed 73313 → holdout 999999 → third seed 555555 for any winner
(the established methodology):

| Variant | Trump section | Tests |
|---|---|---|
| parity | unchanged | harness validity (must be exactly 50%) |
| T1 | `best_suit` → `best_suit_by_tricks` everywhere | role-aware suit quality alone |
| T2 | T1 + counterpick rules + strength-not-length on contested direction | signal *rules* without the exclusion math |
| T3 | single-rule `signal_aware_*` model | the full exclusion/coverage model |

T1/T2/T3 are not cumulative in implementation (T3 replaces the section), but
conceptually each adds information: own-hand structure → opponent signal
rules → full posterior model.

## 6. v1 results (20k games/matchup, seed 73313): all three variants LOSE

| Variant | vs ClaudeFam (Roles+MTC) |
|---|---|
| parity | 50.00% (harness valid) |
| T1 tricks | 48.25% ±0.68 |
| T2 counterpick | 48.60% ±0.68 (confounded: built on T1's suit picker) |
| T3 signal-aware (lenWeight 1) | 48.01% ±0.69 |

**Diagnosis: trump length is sovereign.** The role model's documented
blind spot — it ignores ruffs and exhaustion — is fatal specifically for
trump selection: a low trump is close to a full trick once opponents are
stripped, so any scorer that trades a card of length for "structure"
(T1's blended tricks+length key; T3's lenWeight=1) picks losing trumps on
split-length hands. `best_suit`'s crude 13-per-card length bias encodes
the right priority. T2 additionally inherited T1's handicap, so the
counterpick idea itself was not cleanly measured.

## 7. v2: length-first, structure and signals as tiebreaks

- `best_suit_by_tricks` re-keyed to (length, makeable tricks, honor power) —
  identical to `best_suit`'s priority, with structural tricks replacing
  honor points as the tiebreak.
- `signal_aware_*` gains a lenWeight parameter (v1 = 1). Tested at 3
  (length mostly dominant, big signal edges can still overcome one card)
  and 13 (length-first; signals choose direction and break length ties —
  note the length term cancels across directions, so direction choice
  remains fully signal/structure-driven at any weight).
- Counterpick re-tested unconfounded (base rules keep `best_suit`).

## 8. v2 results: counterpick CONFIRMED (+1.1pp); the scored model stays negative

20k games/matchup vs ClaudeFam (Roles+MTC), across independent pools:

| Config | 73313 | 999999 | 111111 | 555555 | 222222 | Pooled |
|---|---|---|---|---|---|---|
| parity | 50.00 | 50.00 | — | 50.00 | — | harness valid |
| tricksb (len-first, structure tiebreak) | 50.03 | 49.41 | — | 49.69 | — | null |
| **counterpickb** | 50.57 | **51.58** | **50.92** | **51.11** | **51.27** | **51.09 ±0.30** |
| signal3 (full model, lenWeight 3) | 48.50 | 49.17 | — | 48.94 | — | loses |
| signal-dir (direction-only model) | 49.33 | 49.24 | — | 48.91 | — | loses |

(±0.65–0.69 per pool. lenWeight 13 was dropped after measuring it changes
<0.1% of calls vs lenWeight 3.)

**Adopted**: the counterpick rules — counter the enemy's signaled direction
on near-balanced hands, and switch to honor-density suit picking
(`best_suit_by_power`) when partner and enemy signal the SAME direction —
are registered as **ClaudeFam (Roles+MTC+CP)**, confirmed at 51.09% ±0.30
pooled over ~108k games (CI floor 50.79%).

**Rejected with confidence**: the v1-weighted scored model. Both the full
version and the direction-only isolation lose consistently (~48.5–49.3%)
to the tuned trust-rules. Reading: the exclusion *information* is real
(the adopted counterpick rules use enemy-signal information and win), but
the v1 *scoring* — particularly partner-coverage weight vs own-hand lean —
converts it into worse decisions than Family's simple +trust counting.
The structural suit tiebreak (tricksb) is also a null: once length decides,
residual suit choice barely matters.

**v3 attempted and resolved (negative).** The ES loop was generalized
(`runGenericOptimizer` in strategyOptimizer.ts) and run over a
direction-lean parameter space (`src/strategies/trumpLean.ts`): net mode
(9 signal-state branches comparing `makeable_trick_count(up)` vs the best
downtown variant with fitted integer trust/counter/bias adjustments) and
cover mode (scalar `partner_cover`/`enemy_cover` primitives — the
exclusion model as direction-lean terms). Pop 16 × 12 generations at
2k hands/eval vs ClaudeFam (Roles+MTC+CP): training fitness crept to 52.1%
— and the 20k holdout returned **49.0–49.4%** for the top-3 configs. The
training gains were pool overfitting.

That makes the negative *triple-confirmed* (hand-tuned scoring; direction-
only isolation; optimizer-fitted lean) and the explanation clean:
**direction choice depends on the low-vs-high MASS of all 12 cards**,
which `low_count()`/`high_count()` measure directly; makeable-trick
counting compresses the hand to its top structure and discards exactly the
middle-mass information direction fit needs. Structure counting wins
bidding signals; mass counting wins direction selection. The exclusion
information itself is real — it wins where used as *rules* (counterpick,
contested strength) — but converting it into a scored direction lean loses
to mass counting at every weight setting tried.

## 9. Risks and honest caveats

- Partner coverage is an expectation; the variance is real (2/3 of unseen
  hands are enemies). The model hedges by valuing own-hand structure first.
- The enemy that did NOT signal is unmodeled (as is the kitty-discard
  information asymmetry — the declarer's own discards are handled, see the
  roles work).
- Signals here are the *Roles+MTC* convention (mtc ≥ 4). If the opponent pool
  plays a different convention, coverage estimates degrade gracefully (they
  reduce to the proportional-outstanding prior) but aren't sharp.
- v1 weights are unfitted by design. A win here is a win for the *model
  shape*; the numbers have headroom.
