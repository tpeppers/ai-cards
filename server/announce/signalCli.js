/**
 * Signal adapter, talking JSON-RPC to a signal-cli daemon.
 *
 * Signal has no official bot API, so this drives signal-cli running in
 * --http daemon mode (see docker/Dockerfile.signal). The number must already
 * be registered; registration is a one-time manual step documented in
 * docker/SIGNAL.md.
 */

function createSignalCliAdapter({ rpcUrl, account, groupId, recipient, timeoutMs = 10000 }) {
  if (!rpcUrl) throw new Error('signal-cli adapter needs a rpcUrl');
  if (!account) throw new Error('signal-cli adapter needs an account number');
  if (!groupId && !recipient) {
    throw new Error('signal-cli adapter needs either a groupId or a recipient');
  }

  let nextId = 1;

  return {
    name: 'signal-cli',

    async send(text) {
      const params = { account, message: text };
      // A group id takes precedence; recipient is the 1:1 fallback, which is
      // handy while testing before a group exists.
      if (groupId) params.groupId = groupId;
      else params.recipient = [recipient];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: nextId++,
            method: 'send',
            params,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          return { ok: false, error: `signal-cli HTTP ${response.status}` };
        }

        const body = await response.json();
        if (body.error) {
          return { ok: false, error: body.error.message || 'signal-cli error' };
        }
        return { ok: true, result: body.result };
      } catch (error) {
        // A dead Signal daemon must never take the game server down.
        return {
          ok: false,
          error: error.name === 'AbortError' ? 'signal-cli timed out' : error.message,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { createSignalCliAdapter };
