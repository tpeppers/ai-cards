/**
 * Game Mode session coordinator. Tracks per-table upload sessions so
 * 4 players can each upload their photo of their dealt hand, tagged
 * with their seat, and once all 4 arrive (within a 10-minute window)
 * the deck is reconstructed and a zip is written to long-term storage.
 *
 * Session identifier: a short human-shareable code (6 uppercase chars).
 * The first uploader either provides one or the server generates one;
 * subsequent uploaders must provide the same code.
 *
 * Storage:
 *   - Env var GAME_MODE_STORAGE sets the output directory (default
 *     ./game-mode-storage). This is the volume to mount when running
 *     in Docker.
 *   - On successful reconstruction, write
 *     {STORAGE}/{52-char-url}.zip containing:
 *         seat-dealer.png  (original image)
 *         seat-bid1.png
 *         seat-bid2.png
 *         seat-bid3.png
 *         url.txt          (the 52-char deck URL)
 *         metadata.json    (session code, timestamps, detected cards per seat)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { reconstructDeck, VALID_SEATS } = require('./deckReconstruct');

const SESSION_TTL_MS = 10 * 60 * 1000;           // 10 minutes
const SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;   // sweep every minute

const STORAGE_DIR = process.env.GAME_MODE_STORAGE
  ? path.resolve(process.env.GAME_MODE_STORAGE)
  : path.resolve(__dirname, '..', 'game-mode-storage');

// Multi-session mode — when disabled (default), all uploads from all
// users share a single session keyed by DEFAULT_SESSION_CODE, and any
// session code the client sends is ignored. Admin opts in via env var.
const MULTI_SESSION =
  process.env.GAME_MODE_MULTI_SESSION === '1' ||
  process.env.GAME_MODE_MULTI_SESSION === 'true';
const DEFAULT_SESSION_CODE = 'DEFAULT';

function isMultiSession() {
  return MULTI_SESSION;
}

function ensureStorageDir() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// ── Session state ──
// sessionCode → { createdAt, uploads: { [seat]: { cards, imageBuffer, imageExt, uploadedAt } } }
const sessions = new Map();

function generateSessionCode() {
  // 6-char uppercase alphanumeric; avoids visually ambiguous chars (0/O/1/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tries = 0;
  while (tries++ < 100) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
    if (!sessions.has(code)) return code;
  }
  throw new Error('Failed to generate unique session code');
}

function startCleanupTimer() {
  setInterval(() => {
    const now = Date.now();
    for (const [code, session] of sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        sessions.delete(code);
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS).unref();
}

function getOrCreateSession(sessionCode) {
  // Single-session mode: always use the default code, ignore whatever
  // the client sent. Avoids accidental fragmentation across users who
  // forget the convention.
  if (!MULTI_SESSION) {
    const existing = sessions.get(DEFAULT_SESSION_CODE);
    if (existing) {
      // Single-session sessions have a 10-min TTL only in the sense
      // that getCleanupTimer will purge it; here we always return it
      // if it exists (expired ones were swept).
      return { code: DEFAULT_SESSION_CODE, session: existing, created: false };
    }
    const fresh = { createdAt: Date.now(), uploads: {} };
    sessions.set(DEFAULT_SESSION_CODE, fresh);
    return { code: DEFAULT_SESSION_CODE, session: fresh, created: true };
  }

  // Multi-session: explicit code lookup / create-on-first-use.
  if (sessionCode) {
    const existing = sessions.get(sessionCode);
    if (existing) {
      if (Date.now() - existing.createdAt > SESSION_TTL_MS) {
        sessions.delete(sessionCode);
        throw new Error(`Session ${sessionCode} expired (10 minute TTL)`);
      }
      return { code: sessionCode, session: existing, created: false };
    }
    const fresh = { createdAt: Date.now(), uploads: {} };
    sessions.set(sessionCode, fresh);
    return { code: sessionCode, session: fresh, created: true };
  }
  // No code provided — generate one
  const code = generateSessionCode();
  const fresh = { createdAt: Date.now(), uploads: {} };
  sessions.set(code, fresh);
  return { code, session: fresh, created: true };
}

function listSessionStatus(session) {
  return {
    seatsFilled: Object.keys(session.uploads),
    seatsMissing: VALID_SEATS.filter(s => !session.uploads[s]),
    createdAt: session.createdAt,
    expiresAt: session.createdAt + SESSION_TTL_MS,
  };
}

// ── ZIP writer (minimal, no external dep) ──
// Builds a standard ZIP archive containing the 4 images + url.txt +
// metadata.json. Uses no compression (store mode) — images are
// already compressed, and this avoids pulling in an extra dep.

function crc32(buf) {
  let c = 0 ^ 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = c ^ buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d) {
  const s = Math.floor(d.getSeconds() / 2);
  return (d.getHours() << 11) | (d.getMinutes() << 5) | s;
}

function dosDate(d) {
  return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
}

function writeZip(outPath, files) {
  // files: Array<{ name: string, buffer: Buffer }>
  const now = new Date();
  const dtime = dosTime(now);
  const ddate = dosDate(now);

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.buffer);
    const size = f.buffer.length;

    // Local file header (30 bytes + name + data)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);       // magic
    local.writeUInt16LE(20, 4);               // version
    local.writeUInt16LE(0, 6);                // flags
    local.writeUInt16LE(0, 8);                // compression (0 = store)
    local.writeUInt16LE(dtime, 10);           // last mod time
    local.writeUInt16LE(ddate, 12);           // last mod date
    local.writeUInt32LE(crc, 14);             // crc32
    local.writeUInt32LE(size, 18);            // compressed size
    local.writeUInt32LE(size, 22);            // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);  // name length
    local.writeUInt16LE(0, 28);               // extra length

    localParts.push(local, nameBuf, f.buffer);

    // Central directory record (46 bytes + name)
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);     // magic
    central.writeUInt16LE(20, 4);             // version made by
    central.writeUInt16LE(20, 6);             // version needed
    central.writeUInt16LE(0, 8);              // flags
    central.writeUInt16LE(0, 10);             // compression
    central.writeUInt16LE(dtime, 12);
    central.writeUInt16LE(ddate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);             // extra
    central.writeUInt16LE(0, 32);             // comment
    central.writeUInt16LE(0, 34);             // disk number
    central.writeUInt16LE(0, 36);             // internal attrs
    central.writeUInt32LE(0, 38);             // external attrs
    central.writeUInt32LE(offset, 42);        // offset of local header

    centralParts.push(central, nameBuf);
    offset += 30 + nameBuf.length + size;
  }

  const centralBuf = Buffer.concat(centralParts);
  const localBuf = Buffer.concat(localParts);

  // End-of-central-directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                    // disk number
  eocd.writeUInt16LE(0, 6);                    // disk with central
  eocd.writeUInt16LE(files.length, 8);         // entries on this disk
  eocd.writeUInt16LE(files.length, 10);        // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);   // central size
  eocd.writeUInt32LE(localBuf.length, 16);     // central offset
  eocd.writeUInt16LE(0, 20);                   // comment length

  fs.writeFileSync(outPath, Buffer.concat([localBuf, centralBuf, eocd]));
}

// ── Public API ──

/**
 * Register an upload from one seat. If this completes the session
 * (all 4 seats present), reconstruct the deck and write the zip.
 *
 * Returns:
 *   { status: 'accepted',  session, seatsFilled, seatsMissing }
 *   { status: 'completed', session, url, zipPath }
 *   { status: 'error',     session?, errors }
 */
function registerUpload({ sessionCode, seat, cards, imageBuffer, imageExt }) {
  if (!VALID_SEATS.includes(seat)) {
    return { status: 'error', errors: [`Invalid seat: ${seat}. Must be one of: ${VALID_SEATS.join(', ')}`] };
  }
  if (!Array.isArray(cards) || cards.length === 0) {
    return { status: 'error', errors: ['No detected cards provided'] };
  }
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
    return { status: 'error', errors: ['Image buffer missing'] };
  }

  let session, code;
  try {
    const info = getOrCreateSession(sessionCode);
    session = info.session;
    code = info.code;
  } catch (e) {
    return { status: 'error', errors: [e.message] };
  }

  if (session.uploads[seat]) {
    return {
      status: 'error',
      session: code,
      errors: [`Seat ${seat} already uploaded for session ${code}; use a new session to re-upload`],
    };
  }

  session.uploads[seat] = {
    cards,
    imageBuffer,
    imageExt: imageExt || 'png',
    uploadedAt: Date.now(),
  };

  const seatsFilled = Object.keys(session.uploads);
  const seatsMissing = VALID_SEATS.filter(s => !session.uploads[s]);

  if (seatsFilled.length < VALID_SEATS.length) {
    return {
      status: 'accepted',
      session: code,
      seatsFilled,
      seatsMissing,
    };
  }

  // All 4 seats present — reconstruct
  const seatSubmissions = {};
  for (const s of VALID_SEATS) seatSubmissions[s] = session.uploads[s].cards;
  const { url, errors } = reconstructDeck(seatSubmissions);
  if (!url) {
    // Leave the session in place so uploaders can see the errors; TTL
    // will eventually clear it.
    return { status: 'error', session: code, errors };
  }

  // Write zip
  ensureStorageDir();
  const zipPath = path.join(STORAGE_DIR, `${url}.zip`);
  const files = [];
  for (const s of VALID_SEATS) {
    const u = session.uploads[s];
    files.push({
      name: `seat-${s}.${u.imageExt}`,
      buffer: u.imageBuffer,
    });
  }
  files.push({
    name: 'url.txt',
    buffer: Buffer.from(url + '\n', 'utf8'),
  });
  files.push({
    name: 'metadata.json',
    buffer: Buffer.from(JSON.stringify({
      session: code,
      url,
      createdAt: new Date(session.createdAt).toISOString(),
      completedAt: new Date().toISOString(),
      seats: Object.fromEntries(VALID_SEATS.map(s => [s, {
        uploadedAt: new Date(session.uploads[s].uploadedAt).toISOString(),
        cards: session.uploads[s].cards,
      }])),
    }, null, 2), 'utf8'),
  });

  try {
    writeZip(zipPath, files);
  } catch (e) {
    return { status: 'error', session: code, errors: [`Failed to write zip: ${e.message}`] };
  }

  // Remove completed session from memory
  sessions.delete(code);

  return { status: 'completed', session: code, url, zipPath };
}

function getSessionStatus(sessionCode) {
  const code = MULTI_SESSION ? sessionCode : DEFAULT_SESSION_CODE;
  const session = sessions.get(code);
  if (!session) return null;
  return { session: code, ...listSessionStatus(session) };
}

/**
 * "New hand" — clear the current session. If the session has 2+ seats
 * filled, first write a partial zip with `_` filling the missing seat
 * positions (and kitty), named by the resulting partial URL.
 *
 * Returns:
 *   { status: 'archived',  session, url, zipPath }  — partial saved + cleared
 *   { status: 'discarded', session }                — had 0 or 1 uploads, cleared without saving
 *   { status: 'empty',     session }                — no session existed
 *   { status: 'error',     errors }                 — partial reconstruction failed
 */
function newHand(sessionCode) {
  const code = MULTI_SESSION ? (sessionCode || null) : DEFAULT_SESSION_CODE;
  if (!code) {
    return { status: 'error', errors: ['Session code required when multi-session mode is enabled'] };
  }
  const session = sessions.get(code);
  if (!session) {
    return { status: 'empty', session: code };
  }

  const filled = Object.keys(session.uploads);
  if (filled.length < 2) {
    // 0 or 1 uploads — nothing worth archiving, just clear.
    sessions.delete(code);
    return { status: 'discarded', session: code, seatsFilled: filled };
  }

  const seatSubmissions = {};
  for (const s of filled) seatSubmissions[s] = session.uploads[s].cards;
  const { url, errors } = require('./deckReconstruct').reconstructDeck(
    seatSubmissions,
    { allowPartial: true },
  );
  if (!url) {
    return { status: 'error', session: code, errors };
  }

  ensureStorageDir();
  const zipPath = path.join(STORAGE_DIR, `${url}.zip`);
  const files = [];
  for (const s of filled) {
    const u = session.uploads[s];
    files.push({ name: `seat-${s}.${u.imageExt}`, buffer: u.imageBuffer });
  }
  files.push({ name: 'url.txt', buffer: Buffer.from(url + '\n', 'utf8') });
  files.push({
    name: 'metadata.json',
    buffer: Buffer.from(JSON.stringify({
      session: code,
      url,
      partial: true,
      createdAt: new Date(session.createdAt).toISOString(),
      archivedAt: new Date().toISOString(),
      seats: Object.fromEntries(filled.map(s => [s, {
        uploadedAt: new Date(session.uploads[s].uploadedAt).toISOString(),
        cards: session.uploads[s].cards,
      }])),
      missingSeats: VALID_SEATS.filter(s => !filled.includes(s)),
    }, null, 2), 'utf8'),
  });

  try {
    writeZip(zipPath, files);
  } catch (e) {
    return { status: 'error', session: code, errors: [`Failed to write zip: ${e.message}`] };
  }

  sessions.delete(code);
  return { status: 'archived', session: code, url, zipPath, seatsFilled: filled };
}

module.exports = {
  registerUpload,
  getSessionStatus,
  newHand,
  startCleanupTimer,
  isMultiSession,
  STORAGE_DIR,
  MULTI_SESSION,
  DEFAULT_SESSION_CODE,
  // Exposed for tests
  _sessions: sessions,
  _generateSessionCode: generateSessionCode,
};
