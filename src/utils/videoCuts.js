// Playback helpers for the Table Cam video player: YouTube URL parsing and
// CustomCuts cut lists. A CustomCuts queue entry carries
//   cuts: { skip: [{start,end}], only: [{start,end}], ... }
// (seconds). `skip` ranges are jumped over; when `only` ranges exist,
// everything outside them is jumped over and playback stops after the last.

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11-character video id of a YouTube URL (or a bare id), else null. */
export function parseYouTubeId(input) {
  const s = String(input || '').trim();
  if (YT_ID.test(s)) return s;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

/** Start offset in seconds from a YouTube t= / start= parameter. */
export function parseYouTubeStart(input) {
  try {
    const u = new URL(String(input || ''));
    const raw = u.searchParams.get('t') || u.searchParams.get('start');
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) return Number(raw);
    const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return 0;
    return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  } catch {
    return 0;
  }
}

function ranges(list) {
  return (Array.isArray(list) ? list : [])
    .map(r => ({ start: Number(r.start), end: Number(r.end) }))
    .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * What the player should do at time `t`:
 *   { seek: seconds } | { stop: true } | null (keep playing).
 */
export function cutAction(t, cuts) {
  if (!cuts) return null;
  const only = ranges(cuts.only);
  if (only.length) {
    if (only.some(r => t >= r.start && t < r.end)) return null;
    const next = only.find(r => r.start > t);
    return next ? { seek: next.start } : { stop: true };
  }
  const skip = ranges(cuts.skip);
  // Overlapping/adjacent skips chain into one jump.
  let target = null;
  let at = t;
  for (const r of skip) {
    if (at >= r.start && at < r.end) {
      target = r.end;
      at = r.end;
    }
  }
  return target === null ? null : { seek: target };
}

/** Where playback should begin: the first `only` range, or 0. */
export function cutStart(cuts) {
  const only = ranges(cuts && cuts.only);
  if (only.length) return only[0].start;
  const a = cutAction(0, cuts);
  return a && a.seek !== undefined ? a.seek : 0;
}
