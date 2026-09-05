const assert = require('assert');
const { Announcer, POST_TYPES } = require('./index');

let tests = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  tests++;
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(() => console.log(`  ✓ ${name}`))
      .catch(error => {
        failed++;
        console.error(`  ✗ ${name}: ${error.message}`);
      })
  );
}

/** Adapter that records what it was asked to send. */
function recordingAdapter() {
  const sent = [];
  return {
    name: 'recording',
    sent,
    async send(text, meta) {
      sent.push({ text, meta });
      return { ok: true };
    },
  };
}

function makeConfig(posts, extra = {}) {
  const full = {};
  for (const type of POST_TYPES) {
    full[type] = { enabled: false, roomPattern: null, ...(posts[type] || {}) };
  }
  return { adapter: 'noop', blockProfanity: true, signal: {}, posts: full, ...extra };
}

function makeAnnouncer(posts, extra) {
  const adapter = recordingAdapter();
  return {
    adapter,
    announcer: new Announcer({ adapter, config: makeConfig(posts, extra) }),
  };
}

console.log('\nannounce');

test('a disabled type is not posted', async () => {
  const { announcer, adapter } = makeAnnouncer({ score: { enabled: false } });
  const result = await announcer.post('score', { room: 'BAGGLE BYTES', text: 'hi' });
  assert.strictEqual(result.sent, false);
  assert.strictEqual(result.reason, 'disabled');
  assert.strictEqual(adapter.sent.length, 0);
});

test('an enabled type is posted', async () => {
  const { announcer, adapter } = makeAnnouncer({ score: { enabled: true } });
  const result = await announcer.post('score', { room: 'BAGGLE BYTES', text: 'hi' });
  assert.strictEqual(result.sent, true);
  assert.strictEqual(adapter.sent.length, 1);
  assert.strictEqual(adapter.sent[0].text, 'hi');
  assert.strictEqual(adapter.sent[0].meta.type, 'score');
});

test('each type toggles independently', async () => {
  const { announcer, adapter } = makeAnnouncer({
    hosting: { enabled: true },
    score: { enabled: false },
    archive: { enabled: true },
    redacted: { enabled: false },
  });
  for (const type of POST_TYPES) {
    await announcer.post(type, { room: 'ROOM', text: type });
  }
  assert.deepStrictEqual(adapter.sent.map(s => s.text), ['hosting', 'archive']);
});

test('roomPattern filters by room code', async () => {
  const { announcer, adapter } = makeAnnouncer({
    score: { enabled: true, roomPattern: '^LEAGUE' },
  });
  await announcer.post('score', { room: 'LEAGUE NIGHT', text: 'in' });
  await announcer.post('score', { room: 'BAGGLE BYTES', text: 'out' });
  assert.deepStrictEqual(adapter.sent.map(s => s.text), ['in']);
});

test('roomPattern is case-insensitive', async () => {
  const { announcer, adapter } = makeAnnouncer({
    score: { enabled: true, roomPattern: 'league' },
  });
  await announcer.post('score', { room: 'LEAGUE NIGHT', text: 'yes' });
  assert.strictEqual(adapter.sent.length, 1);
});

test('an invalid roomPattern is ignored rather than fatal', async () => {
  const { announcer, adapter } = makeAnnouncer({
    score: { enabled: true, roomPattern: '([unclosed' },
  });
  await announcer.post('score', { room: 'ANY', text: 'still sent' });
  assert.strictEqual(adapter.sent.length, 1);
});

test('profanity in the room code blocks the post', async () => {
  const { announcer, adapter } = makeAnnouncer({ score: { enabled: true } });
  const result = await announcer.post('score', { room: 'FUCK TABLE', text: 'clean text' });
  assert.strictEqual(result.sent, false);
  assert.match(result.reason, /profanity/);
  assert.strictEqual(adapter.sent.length, 0);
});

test('profanity in the body blocks the post', async () => {
  const { announcer, adapter } = makeAnnouncer({ score: { enabled: true } });
  const result = await announcer.post('score', { room: 'CLEAN', text: 'nice sh1t play' });
  assert.strictEqual(result.sent, false);
  assert.strictEqual(adapter.sent.length, 0);
});

test('the profanity gate can be turned off', async () => {
  const { announcer, adapter } = makeAnnouncer(
    { score: { enabled: true } },
    { blockProfanity: false }
  );
  await announcer.post('score', { room: 'FUCK TABLE', text: 'x' });
  assert.strictEqual(adapter.sent.length, 1);
});

test('hosting announcement fires once per room', async () => {
  const { announcer, adapter } = makeAnnouncer({ hosting: { enabled: true } });
  const first = await announcer.announceHosting('BAGGLE BYTES', { hostName: 'Tai' });
  const second = await announcer.announceHosting('BAGGLE BYTES', { hostName: 'Tai' });
  assert.strictEqual(first.sent, true);
  assert.strictEqual(second.sent, false);
  assert.match(second.reason, /already announced/);
  assert.strictEqual(adapter.sent.length, 1);
  assert.match(adapter.sent[0].text, /Tai is hosting/);
  assert.match(adapter.sent[0].text, /BAGGLE BYTES/);
});

test('a blocked hosting post does not consume the one-shot', async () => {
  const { announcer } = makeAnnouncer({ hosting: { enabled: false } });
  await announcer.announceHosting('ROOM');
  assert.strictEqual(announcer.hostingAnnounced.has('ROOM'), false);
});

test('forgetRoom re-arms the hosting announcement', async () => {
  const { announcer, adapter } = makeAnnouncer({ hosting: { enabled: true } });
  await announcer.announceHosting('ROOM');
  announcer.forgetRoom('ROOM');
  await announcer.announceHosting('ROOM');
  assert.strictEqual(adapter.sent.length, 2);
});

test('score line names both teams by seat pairing', async () => {
  const { announcer, adapter } = makeAnnouncer({ score: { enabled: true } });
  await announcer.announceScore('ROOM', {
    teamScores: [7, 4],
    names: ['Tai', 'Bot East', 'Ada', 'Bot West'],
    hands: 9,
  });
  const text = adapter.sent[0].text;
  assert.match(text, /Tai & Ada 7/);
  assert.match(text, /Bot East & Bot West 4/);
  assert.match(text, /9 hands/);
});

test('redacted post carries the deal but no names', async () => {
  const { announcer, adapter } = makeAnnouncer({ redacted: { enabled: true } });
  await announcer.announceRedacted('ROOM', {
    deal: 'a'.repeat(52),
    teamScores: [7, 4],
    hands: 1,
  });
  const text = adapter.sent[0].text;
  assert.match(text, /A\/C 7/);
  assert.match(text, /1 hand\b/);
  assert.ok(!/Tai/.test(text));
});

test('archive post with no record is skipped', async () => {
  const { announcer, adapter } = makeAnnouncer({ archive: { enabled: true } });
  const result = await announcer.announceArchive('ROOM', { encoded: null });
  assert.strictEqual(result.sent, false);
  assert.strictEqual(adapter.sent.length, 0);
});

test('an adapter failure is reported, not thrown', async () => {
  const failing = {
    name: 'failing',
    async send() {
      return { ok: false, error: 'signal-cli timed out' };
    },
  };
  const announcer = new Announcer({
    adapter: failing,
    config: makeConfig({ score: { enabled: true } }),
  });
  const result = await announcer.post('score', { room: 'ROOM', text: 'x' });
  assert.strictEqual(result.sent, false);
  assert.strictEqual(result.reason, 'signal-cli timed out');
});

test('an adapter that throws does not take the caller down', async () => {
  const throwing = {
    name: 'throwing',
    async send() {
      throw new Error('boom');
    },
  };
  const announcer = new Announcer({
    adapter: throwing,
    config: makeConfig({ score: { enabled: true } }),
  });
  const result = await announcer.post('score', { room: 'ROOM', text: 'x' });
  assert.strictEqual(result.sent, false);
  assert.strictEqual(result.reason, 'boom');
});

test('an unknown post type is rejected', async () => {
  const { announcer } = makeAnnouncer({ score: { enabled: true } });
  const result = await announcer.post('nope', { room: 'ROOM', text: 'x' });
  assert.strictEqual(result.sent, false);
  assert.match(result.reason, /unknown post type/);
});

Promise.all(pending).then(() => {
  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) process.exit(1);
});
