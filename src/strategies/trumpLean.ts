/**
 * Parameterized trump-direction lean sections for the trump-lean
 * optimizer (src/simulation/runTrumpLeanOptimizer.ts).
 *
 * Two modes for choosing the bid direction:
 *   net   — 9 explicit (partner signal × enemy signal) uptown rules whose
 *           makeable-trick comparison is shifted by a NET adjustment
 *           combining partner trust (pTrust), enemy counterpick (eCounter)
 *           and a flat uptown bias (upBias).
 *   cover — a single uptown rule using the exclusion-conditioned cover
 *           primitives partner_cover()/enemy_cover(), which read the
 *           signals themselves; only upBias applies.
 * Both modes share a downtown-vs-noaces tail (noacesBias) and an optional
 * contested-direction best_suit_by_power block (contestedPower), and are
 * grafted onto the ClaudeFam (Roles+MTC) champion body.
 */

import { parseStrategy } from '../strategy/parser.ts';
import { MTC_BID_SECTION, buildRolesVariant } from './claudeFamRoles.ts';

export interface TrumpLeanParams {
  mode: 'net' | 'cover';
  pTrust: number;      // 0..5, net mode only
  eCounter: number;    // 0..4, net mode only
  upBias: number;      // -2..2, both modes
  noacesBias: number;  // -2..2, both modes
  contestedPower: boolean;
}

// Contested-direction rules (both signals same way): strength, not length.
// They reference the existing `trust` let, which the base lets provide.
const CONTESTED_RULES = `  when partner_bid == 1 and enemy_bid == 1 and low_count() + trust > high_count() and ace_count() >= 2:
    choose suit: best_suit_by_power(downtown) direction: downtown
  when partner_bid == 1 and enemy_bid == 1 and low_count() + trust > high_count():
    choose suit: best_suit_by_power(downtown-noaces) direction: downtown-noaces
  when partner_bid == 2 and enemy_bid == 2 and high_count() + trust > low_count():
    choose suit: best_suit_by_power(uptown) direction: uptown
`;

// Formats an integer shift as a DSL expression suffix: '' / ' + N' / ' - N'.
function adj(n: number): string {
  if (n === 0) return '';
  return n > 0 ? ` + ${n}` : ` - ${-n}`;
}

export function generateTrumpLeanSection(p: TrumpLeanParams): string {
  let s = 'trump:\n';
  if (p.contestedPower) s += CONTESTED_RULES;

  if (p.mode === 'net') {
    // One uptown rule per (partner signal P, enemy signal E) cell.
    for (const P of [0, 1, 2]) {
      for (const E of [0, 1, 2]) {
        // P == 0 treats pass AND length bids 3+ as "no signal".
        const pcond = P === 0 ? 'partner_bid != 1 and partner_bid != 2' : `partner_bid == ${P}`;
        const econd = `enemy_bid == ${E}`;
        const net = (P === 2 ? p.pTrust : 0) - (P === 1 ? p.pTrust : 0)
          + (E === 1 ? p.eCounter : 0) - (E === 2 ? p.eCounter : 0)
          + p.upBias;
        s += `  when ${pcond} and ${econd} and makeable_trick_count(uptown)${adj(net)} >= max(makeable_trick_count(downtown), makeable_trick_count(downtown-noaces)):\n`
          + `    choose suit: best_suit(uptown) direction: uptown\n`;
      }
    }
  } else {
    // Cover mode: no signal branching — the cover primitives read the
    // signals themselves.
    s += `  when makeable_trick_count(uptown) + partner_cover(uptown) - enemy_cover(uptown)${adj(p.upBias)} >= max(makeable_trick_count(downtown), makeable_trick_count(downtown-noaces)) + partner_cover(downtown) - enemy_cover(downtown):\n`
      + `    choose suit: best_suit(uptown) direction: uptown\n`;
  }

  // Shared tail: downtown vs downtown-noaces.
  s += `  when makeable_trick_count(downtown)${adj(p.noacesBias)} >= makeable_trick_count(downtown-noaces):\n`
    + `    choose suit: best_suit(downtown) direction: downtown\n`
    + `  default:\n`
    + `    choose suit: best_suit(downtown-noaces) direction: downtown-noaces\n`;
  return s;
}

export function generateTrumpLeanStrategy(name: string, p: TrumpLeanParams): string {
  const text = buildRolesVariant(name, {
    rolesDiscard: true,
    rolesSluff: true,
    rolesLead: true,
  }, {
    bidSection: MTC_BID_SECTION,
    extraLets: 'let mtc_sig = 4',
    trumpSection: generateTrumpLeanSection(p),
  });
  try {
    parseStrategy(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`TrumpLean strategy failed to parse for params ${JSON.stringify(p)}: ${msg}`);
  }
  return text;
}
