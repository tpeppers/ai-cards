/**
 * Default adapter: accepts every message and does nothing.
 *
 * This is what runs when no Signal account is configured, so the rest of the
 * server can call the announcer unconditionally.
 */
module.exports = {
  name: 'noop',
  async send() {
    return { ok: true, skipped: true };
  },
};
