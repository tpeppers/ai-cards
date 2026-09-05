/**
 * What happens when someone types a room code for a game already in progress.
 *
 * Three modes, chosen by the host:
 *
 *   'dropin'    The table stays open. A returning player reclaims their seat
 *               straight away; anyone new asks the host, who accepts or
 *               declines, and on accept they pick up mid-hand.
 *   'reconnect' No new faces mid-hand. A returning player still reclaims their
 *               seat immediately; everyone else waits and is seated at the
 *               next hand boundary.
 *   'disabled'  Nobody joins once the game starts.
 *
 * ── On identifying a "returning player" ──────────────────────────────
 *
 * IP address alone is not enough. The whole point of this app is four people
 * around one card table, which means one WiFi network and one public IP — so
 * an IP match would let any of them claim any vacated seat. The primary signal
 * is therefore a per-device token the client stores itself; IP is only ever a
 * fallback, and then only together with the same display name.
 */

const JOIN_POLICIES = ['dropin', 'reconnect', 'disabled'];
const DEFAULT_JOIN_POLICY = 'reconnect';

function isValidJoinPolicy(policy) {
  return JOIN_POLICIES.includes(policy);
}

/**
 * Does `claimant` look like the player who vacated `vacancy`?
 *
 * @returns {'device'|'ip'|null} which signal matched, strongest first.
 */
function matchStrength(vacancy, claimant) {
  if (!vacancy || !claimant) return null;

  // A device token is issued per browser and survives a reload, so it is the
  // only signal that actually distinguishes people on a shared network.
  //
  // When both sides present a token it is decisive in BOTH directions: a
  // mismatch is positive evidence of a different device, so it must not fall
  // through to the weaker IP check — otherwise anyone on the same WiFi could
  // take a seat just by retyping the name that left it.
  if (vacancy.deviceId && claimant.deviceId) {
    return vacancy.deviceId === claimant.deviceId ? 'device' : null;
  }

  // Fallback for a cleared/absent token: same address AND same name. Weaker,
  // but it takes a deliberate impersonation on the same network to abuse.
  const sameName =
    vacancy.name && claimant.name &&
    vacancy.name.toLowerCase() === claimant.name.toLowerCase();
  if (vacancy.ip && claimant.ip && vacancy.ip === claimant.ip && sameName) {
    return 'ip';
  }

  return null;
}

/**
 * Find the seat a claimant is entitled to reclaim.
 *
 * @param {Map<number, object>} vacancies seat -> { name, deviceId, ip, ts }
 * @returns {{ seat: number, via: 'device'|'ip' } | null}
 */
function findReclaimableSeat(vacancies, claimant) {
  let best = null;
  for (const [seat, vacancy] of vacancies) {
    const via = matchStrength(vacancy, claimant);
    if (!via) continue;
    // A device match always wins over an IP match.
    if (!best || (best.via === 'ip' && via === 'device')) {
      best = { seat, via };
    }
  }
  return best;
}

/**
 * Decide what to do with someone joining a room.
 *
 * @param {object} opts
 * @param {string}  opts.policy          one of JOIN_POLICIES
 * @param {boolean} opts.gameInProgress
 * @param {object}  opts.claimant        { name, deviceId, ip }
 * @param {Map}     opts.vacancies       seat -> vacancy record
 * @param {number[]} opts.botSeats       seats currently played by a bot
 * @param {number}  [opts.requestedSeat] seat the joiner asked for, if any
 *
 * @returns {{ action: 'seat'|'reclaim'|'ask-host'|'queue'|'reject',
 *             seat?: number, via?: string, reason?: string }}
 */
function decideJoin({
  policy,
  gameInProgress,
  claimant,
  vacancies = new Map(),
  botSeats = [],
  requestedSeat = null,
}) {
  // Before the game starts every mode behaves the same: walk up and sit down.
  if (!gameInProgress) {
    return { action: 'seat' };
  }

  if (policy === 'disabled') {
    return { action: 'reject', reason: 'That game has already started' };
  }

  // Coming back to a seat you were already in never needs anyone's approval.
  const reclaim = findReclaimableSeat(vacancies, claimant);
  if (reclaim) {
    return { action: 'reclaim', seat: reclaim.seat, via: reclaim.via };
  }

  if (botSeats.length === 0) {
    return { action: 'reject', reason: 'Every seat at that table is taken' };
  }

  // An explicit seat request only counts if that seat is actually free.
  const seat =
    requestedSeat !== null && botSeats.includes(requestedSeat)
      ? requestedSeat
      : botSeats[0];

  if (policy === 'dropin') {
    return { action: 'ask-host', seat };
  }

  // 'reconnect': wait for the hand to finish, then take the seat.
  return { action: 'queue', seat, reason: 'Waiting for the current hand to finish' };
}

module.exports = {
  JOIN_POLICIES,
  DEFAULT_JOIN_POLICY,
  isValidJoinPolicy,
  matchStrength,
  findReclaimableSeat,
  decideJoin,
};
