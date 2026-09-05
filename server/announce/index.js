/**
 * Signal announcer.
 *
 * Four independently switchable post types, each with an optional regex that
 * the room code must match. Everything routes through a profanity gate before
 * it can reach the outside world, because room codes and player names are
 * arbitrary text typed by whoever showed up.
 *
 *   hosting  — one-shot "someone is hosting" invite, host-triggered
 *   score    — final score line when a match ends
 *   archive  — the full replayable BWR1 string
 *   redacted — deal + outcome with names reduced to seat letters
 *
 * Config comes from JSON (default /data/announce.json) with env overrides, so
 * an operator can retune it without rebuilding the image.
 */

const fs = require('fs');
const { loadWordlist } = require('../profanity');
const noopAdapter = require('./noop');
const consoleAdapter = require('./console');
const { createSignalCliAdapter } = require('./signalCli');

const POST_TYPES = ['hosting', 'score', 'archive', 'redacted'];

const DEFAULT_CONFIG = {
  adapter: 'noop',
  blockProfanity: true,
  signal: { rpcUrl: '', account: '', groupId: '', recipient: '' },
  posts: {
    hosting: { enabled: true, roomPattern: null },
    score: { enabled: true, roomPattern: null },
    archive: { enabled: false, roomPattern: null },
    redacted: { enabled: true, roomPattern: null },
  },
};

function readConfigFile(filePath) {
  if (!filePath) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[announce] ignoring ${filePath}: ${error.message}`);
    }
    return {};
  }
}

function envBool(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  return /^(1|true|yes|on)$/i.test(raw);
}

/** Layer defaults <- file <- env into one config object. */
function resolveConfig(filePath) {
  const fromFile = readConfigFile(filePath);

  const config = {
    ...DEFAULT_CONFIG,
    ...fromFile,
    signal: { ...DEFAULT_CONFIG.signal, ...(fromFile.signal || {}) },
    posts: {},
  };

  for (const type of POST_TYPES) {
    const base = DEFAULT_CONFIG.posts[type];
    const file = (fromFile.posts || {})[type] || {};
    const upper = type.toUpperCase();

    const enabledEnv = envBool(`ANNOUNCE_${upper}_ENABLED`);
    const patternEnv = process.env[`ANNOUNCE_${upper}_PATTERN`];

    config.posts[type] = {
      enabled:
        enabledEnv !== undefined
          ? enabledEnv
          : file.enabled !== undefined
          ? !!file.enabled
          : base.enabled,
      roomPattern:
        patternEnv !== undefined && patternEnv !== ''
          ? patternEnv
          : file.roomPattern !== undefined
          ? file.roomPattern
          : base.roomPattern,
    };
  }

  if (process.env.ANNOUNCE_ADAPTER) config.adapter = process.env.ANNOUNCE_ADAPTER;
  const blockEnv = envBool('ANNOUNCE_BLOCK_PROFANITY');
  if (blockEnv !== undefined) config.blockProfanity = blockEnv;

  if (process.env.SIGNAL_RPC_URL) config.signal.rpcUrl = process.env.SIGNAL_RPC_URL;
  if (process.env.SIGNAL_ACCOUNT) config.signal.account = process.env.SIGNAL_ACCOUNT;
  if (process.env.SIGNAL_GROUP_ID) config.signal.groupId = process.env.SIGNAL_GROUP_ID;
  if (process.env.SIGNAL_RECIPIENT) config.signal.recipient = process.env.SIGNAL_RECIPIENT;

  return config;
}

function buildAdapter(config) {
  switch (config.adapter) {
    case 'console':
      return consoleAdapter;
    case 'signal-cli':
      try {
        return createSignalCliAdapter(config.signal);
      } catch (error) {
        // Misconfigured Signal must degrade to silence, not crash the server.
        console.warn(`[announce] signal-cli disabled: ${error.message}`);
        return noopAdapter;
      }
    case 'noop':
    default:
      return noopAdapter;
  }
}

class Announcer {
  /**
   * @param {object} opts
   * @param {string} [opts.configPath]   JSON config (default /data/announce.json)
   * @param {string} [opts.wordlistPath] JSON profanity overrides
   * @param {object} [opts.adapter]      injected adapter (tests)
   * @param {object} [opts.config]       injected config (tests)
   */
  constructor({ configPath, wordlistPath, adapter, config } = {}) {
    this.config = config || resolveConfig(configPath);
    this.adapter = adapter || buildAdapter(this.config);
    this.filter = loadWordlist(wordlistPath);
    this.patternCache = new Map();
    // Rooms that already used their one-shot hosting announcement.
    this.hostingAnnounced = new Set();
  }

  get adapterName() {
    return this.adapter.name;
  }

  /** Compiled roomPattern, or null. Invalid regexes are ignored, not fatal. */
  _pattern(type) {
    const settings = this.config.posts[type];
    const raw = settings && settings.roomPattern;
    if (!raw) return null;
    if (this.patternCache.has(raw)) return this.patternCache.get(raw);
    let compiled = null;
    try {
      compiled = new RegExp(raw, 'i');
    } catch (error) {
      console.warn(`[announce] bad roomPattern for ${type}: ${error.message}`);
    }
    this.patternCache.set(raw, compiled);
    return compiled;
  }

  /**
   * Whether a post of this type for this room would be sent.
   * @returns {{ allowed: boolean, reason?: string }}
   */
  shouldPost(type, room) {
    const settings = this.config.posts[type];
    if (!settings) return { allowed: false, reason: 'unknown post type' };
    if (!settings.enabled) return { allowed: false, reason: 'disabled' };

    const pattern = this._pattern(type);
    if (pattern && !pattern.test(room || '')) {
      return { allowed: false, reason: 'room does not match pattern' };
    }
    return { allowed: true };
  }

  /**
   * Send a message if its type is enabled, its room matches, and neither the
   * room code nor the body trips the profanity gate.
   *
   * Never throws: announcing is best-effort decoration on top of the game.
   *
   * @returns {Promise<{sent: boolean, reason?: string}>}
   */
  async post(type, { room, text }) {
    const gate = this.shouldPost(type, room);
    if (!gate.allowed) return { sent: false, reason: gate.reason };

    if (this.config.blockProfanity) {
      const offending = [
        ...this.filter.matches(room || ''),
        ...this.filter.matches(text || ''),
      ];
      if (offending.length > 0) {
        return { sent: false, reason: 'blocked by profanity filter' };
      }
    }

    try {
      const result = await this.adapter.send(text, { type, room });
      if (result && result.ok === false) {
        console.warn(`[announce] ${type} failed: ${result.error}`);
        return { sent: false, reason: result.error };
      }
      return { sent: true };
    } catch (error) {
      console.warn(`[announce] ${type} threw: ${error.message}`);
      return { sent: false, reason: error.message };
    }
  }

  /**
   * The host's one-shot "someone is hosting" button. Rate-limited to a single
   * successful post per room.
   */
  async announceHosting(room, { hostName, url } = {}) {
    if (this.hostingAnnounced.has(room)) {
      return { sent: false, reason: 'already announced for this room' };
    }

    const who = hostName ? `${hostName} is` : 'Someone is';
    const where = url ? ` at ${url}` : '';
    const result = await this.post('hosting', {
      room,
      text: `${who} hosting a Bid Whist table${where} — room code: "${room}"`,
    });

    if (result.sent) this.hostingAnnounced.add(room);
    return result;
  }

  /** Clear the one-shot latch, e.g. when a room empties out. */
  forgetRoom(room) {
    this.hostingAnnounced.delete(room);
  }

  /** Final score line. `names` is by seat; teams are seats 0/2 vs 1/3. */
  async announceScore(room, { teamScores, names = [], hands }) {
    const teamA = [names[0], names[2]].filter(Boolean).join(' & ') || 'Team 1';
    const teamB = [names[1], names[3]].filter(Boolean).join(' & ') || 'Team 2';
    const handLine = hands ? `, ${hands} hand${hands === 1 ? '' : 's'}` : '';
    return this.post('score', {
      room,
      text: `Final in "${room}": ${teamA} ${teamScores[0]} — ${teamB} ${teamScores[1]}${handLine}`,
    });
  }

  /** The full replayable record. */
  async announceArchive(room, { encoded }) {
    if (!encoded) return { sent: false, reason: 'no record to archive' };
    return this.post('archive', {
      room,
      text: `Replay from "${room}":\n${encoded}`,
    });
  }

  /**
   * Deal + outcome with players reduced to seat letters — archive value
   * without naming who misplayed.
   */
  async announceRedacted(room, { deal, teamScores, hands }) {
    const handLine = hands ? ` over ${hands} hand${hands === 1 ? '' : 's'}` : '';
    return this.post('redacted', {
      room,
      text: `Table result${handLine} — A/C ${teamScores[0]} — B/D ${teamScores[1]}\nDeal: ${deal}`,
    });
  }
}

module.exports = {
  Announcer,
  POST_TYPES,
  DEFAULT_CONFIG,
  resolveConfig,
};
