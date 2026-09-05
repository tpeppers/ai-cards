/**
 * Headless dominance check — the CLI counterpart of the Dominance Lab
 * page. Same engine, so a verdict found in the browser can be re-run at
 * a much larger fill count here.
 *
 * Usage: node scripts/dominance-check.js -- [options]
 *
 *   --board=<52-char spec>   board spec, '_' for unknown  (default: random hand for the seat)
 *   --hand=<letters>         up to 12 card letters for the deviating seat; builds
 *                            the "A___B___C___" spec shape
 *   --champion=<name>        registry strategy name        (default: Claude Omni)
 *   --challengers=<a,b,c>    registry names, or 'all'      (default: all)
 *   --seat=<0-3>             deviating seat                (default: 0 = South)
 *   --scope=<seat|team>      deviation scope               (default: seat)
 *   --fills=<n>              Monte Carlo fills             (default: 200)
 *   --dealers=<0,1,2,3>      dealer positions to sweep     (default: 0,1,2,3)
 *   --seed=<n>               RNG seed                      (default: 12345)
 *   --search                 after the registry check, evolve new challengers
 *   --generations=<n>        search generations            (default: 12)
 *   --population=<n>         search population size        (default: 16)
 */

import { STRATEGY_REGISTRY } from '../strategies/index.ts';
import { BIDWHIST_CURRENT_BEST } from '../strategies/index.ts';
import { setStrategyDebug } from '../strategy/evaluator.ts';
import {
  analyzeBoardSpec,
  buildSpecFromSeatHand,
  runDominanceCheck,
  seatLetters,
  DominanceConfig,
  SEAT_LABELS,
  WILDCARD,
  DECK_LENGTH,
} from './dominance.ts';
import { runDominanceSearch, DominanceSearchOptions } from './dominanceSearch.ts';
import { SIGNAL_LAB_PRESETS } from './signalLab.ts';
import { letterToCard } from '../urlGameState.js';

setStrategyDebug(false);
const NOISE = ['[Strategy]', 'Bid Whist dealing deck', 'Trick ended, winner'];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (NOISE.some(n => first.startsWith(n))) return;
  realLog(...args);
};

const RANKS: { [r: number]: string } = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};
const SUIT_CHAR: { [s: string]: string } = {
  spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C',
};

function describeHand(letters: string): string {
  return letters
    .split('')
    .filter(ch => ch !== WILDCARD)
    .map(ch => {
      const c = letterToCard(ch);
      return `${RANKS[c.rank as number] ?? c.rank}${SUIT_CHAR[c.suit] ?? '?'}`;
    })
    .join(' ');
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function findStrategy(name: string) {
  const hit = STRATEGY_REGISTRY.find(
    s => s.game === 'bidwhist' && s.name.toLowerCase() === name.toLowerCase(),
  );
  if (!hit) {
    throw new Error(
      `Unknown strategy "${name}". Available: ${STRATEGY_REGISTRY.filter(s => s.game === 'bidwhist').map(s => s.name).join(', ')}`,
    );
  }
  return { name: hit.name, strategyText: hit.text };
}

async function main() {
  const seat = Number(arg('seat', '0'));
  const scope = arg('scope', 'seat') === 'team' ? 'team' : 'seat';
  const fills = Number(arg('fills', '200'));
  const seed = Number(arg('seed', '12345'));
  const dealers = arg('dealers', '0,1,2,3').split(',').map(Number).filter(d => d >= 0 && d < 4);

  let boardSpec = arg('board', '');
  const hand = arg('hand', '');
  if (!boardSpec && hand) boardSpec = buildSpecFromSeatHand(hand, seat);
  if (!boardSpec) boardSpec = WILDCARD.repeat(DECK_LENGTH);

  const info = analyzeBoardSpec(boardSpec);
  if (!info.valid) {
    console.error(`Invalid board spec: ${info.error}`);
    process.exit(1);
  }

  const championName = arg('champion', BIDWHIST_CURRENT_BEST.name);
  const champion = findStrategy(championName);

  const challengerArg = arg('challengers', 'all');
  const challengers =
    challengerArg === 'all'
      ? STRATEGY_REGISTRY.filter(s => s.game === 'bidwhist' && s.name !== champion.name)
          .map(s => ({ name: s.name, strategyText: s.text }))
      : challengerArg.split(',').map(n => findStrategy(n.trim()));

  const config: DominanceConfig = {
    boardSpec,
    champion,
    challengers,
    deviation: scope,
    seat,
    dealers,
    fills,
    seed,
  };

  console.log('');
  console.log('Dominance check');
  console.log('───────────────');
  console.log(`Champion    ${champion.name}`);
  console.log(`Deviator    ${SEAT_LABELS[seat]} (${scope === 'team' ? 'team' : 'seat only'})`);
  console.log(`Board       ${boardSpec}`);
  console.log(`  ${SEAT_LABELS[seat]} holds  ${describeHand(seatLetters(boardSpec, seat)) || '(unspecified)'}`);
  console.log(`Unknowns    ${info.wildcards} cards${info.exact ? ' — board is exact, results are deterministic' : ''}`);
  console.log(`Trials      ${(info.exact ? 1 : fills) * dealers.length} per challenger (${info.exact ? 1 : fills} fills x ${dealers.length} dealers)`);
  console.log('');

  const started = Date.now();
  let lastPct = -1;
  const report = await runDominanceCheck(config, (done, total) => {
    const pct = Math.floor((done / total) * 100);
    if (pct >= lastPct + 10) {
      lastPct = pct;
      process.stderr.write(`  ${pct}%\r`);
    }
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (report.championParseError) {
    console.error(`Champion failed to parse: ${report.championParseError}`);
    process.exit(1);
  }

  const parity = report.parity;
  if (parity && (parity.wins > 0 || parity.losses > 0)) {
    console.log(`!! PARITY BROKEN: champion-vs-itself produced nonzero deltas (${parity.wins}W/${parity.losses}L).`);
    console.log('   The simulation is not deterministic; treat every number below as suspect.');
    console.log('');
  }

  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (v: number, n: number, digits = 2) => v.toFixed(digits).padStart(n);

  console.log(pad('CHALLENGER', 34) + num(0, 8).replace(/./g, ' ').slice(0, 0) + '  mean Δ    95% CI      W/T/L');
  console.log('─'.repeat(72));
  for (const c of report.challengers) {
    if (c.parseError) {
      console.log(`${pad(c.name, 34)}  parse error: ${c.parseError}`);
      continue;
    }
    const flag = c.refutes ? ' <<< REFUTES' : c.beatsOnSome ? '  (beats on some)' : '';
    console.log(
      `${pad(c.name, 34)}${num(c.meanDelta, 8)}  ${report.exact ? '   exact' : `±${c.ci95.toFixed(2)}`.padStart(8)}  ${`${c.wins}/${c.ties}/${c.losses}`.padStart(10)}${flag}`,
    );
  }
  console.log('');
  console.log(`VERDICT: ${report.verdict.toUpperCase()}  (${elapsed}s)`);
  if (report.verdict === 'dominant') {
    console.log(`No challenger profited by deviating from ${champion.name} on this board.`);
  } else if (report.verdict === 'refuted') {
    const top = report.challengers[0];
    console.log(`${top.name} profits by ${top.meanDelta.toFixed(2)} pts/hand deviating from ${champion.name}.`);
    if (top.bestTrial) {
      console.log(`Worst case for the champion: dealer ${SEAT_LABELS[top.bestTrial.dealer]}, deck`);
      console.log(`  ${top.bestTrial.deckUrl}`);
    }
  } else {
    console.log('No significant refutation, but some challenger beat the champion on individual deals.');
  }
  console.log('');

  if (!process.argv.includes('--search')) return;

  // ── Stage 2: evolve challengers the registry doesn't contain ──

  const searchOpts: DominanceSearchOptions = {
    boardSpec,
    champion,
    seat,
    deviation: scope,
    dealers,
    trainFills: Math.max(1, Math.round(fills / 2)),
    holdoutFills: Math.max(1, Math.round(fills / 2)),
    populationSize: Number(arg('population', '16')),
    eliteSize: 5,
    generations: Number(arg('generations', '12')),
    mutationRate: 0.25,
    finalistCount: 6,
    seed,
    seedConfigs: SIGNAL_LAB_PRESETS,
  };

  console.log('Searching for new refuters');
  console.log('──────────────────────────');
  console.log(`${searchOpts.generations} generations x ${searchOpts.populationSize} candidates, trained on ${searchOpts.trainFills} fills, validated on ${searchOpts.holdoutFills} held-out fills`);
  console.log('');

  const searchStart = Date.now();
  const search = await runDominanceSearch(searchOpts, snap => {
    process.stderr.write(`  gen ${String(snap.generation).padStart(3)}  best Δ ${snap.bestDelta.toFixed(2)}  mean Δ ${snap.meanDelta.toFixed(2)}\r`);
  });
  const searchElapsed = ((Date.now() - searchStart) / 1000).toFixed(1);
  process.stderr.write(' '.repeat(60) + '\r');

  console.log(pad('CANDIDATE', 30) + '  train Δ   holdout Δ    W/T/L (holdout)');
  console.log('─'.repeat(76));
  for (const f of search.finalists) {
    const h = f.holdout;
    console.log(
      `${pad(f.summary || f.name, 30)}${num(f.train.meanDelta, 9)}` +
        (h ? `${num(h.meanDelta, 11)} ±${h.ci95.toFixed(2)}  ${`${h.wins}/${h.ties}/${h.losses}`}` : '      exact') +
        (f.refutes ? '  <<< REFUTES' : ''),
    );
  }
  console.log('');
  if (search.refuter) {
    console.log(`SEARCH FOUND A REFUTER (${searchElapsed}s): ${search.refuter.summary}`);
    console.log('');
    console.log(search.refuter.strategyText);
  } else {
    console.log(`No evolved candidate survived holdout validation (${searchElapsed}s).`);
    console.log(`${champion.name} held against ${searchOpts.generations * searchOpts.populationSize} generated challengers on this board.`);
  }
  console.log('');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
