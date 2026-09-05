/**
 * Development adapter: prints what would have been posted.
 *
 * Useful for exercising the toggle/regex/profanity logic without registering
 * a Signal number.
 */
module.exports = {
  name: 'console',
  async send(text, meta) {
    console.log(`[announce:${meta.type}] ${text}`);
    return { ok: true };
  },
};
