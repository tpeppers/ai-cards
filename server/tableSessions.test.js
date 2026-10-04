/**
 * Integration test for the Table Cam session API, against a fake ML
 * service and a fake CustomCuts host. Plain Node script:
 *   node server/tableSessions.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createTableSessions } = require('./tableSessions');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'table-sessions-test-'));

// A card at pixel (x,y) of a 1000x1000 frame, both index corners.
const card = (alpha, x, y) => [
  { alpha, confidence: 0.9, bbox: [x - 60, y - 90, x - 30, y - 50] },
  { alpha, confidence: 0.9, bbox: [x + 30, y + 50, x + 60, y + 90] },
];
// The fake ML service: a live frame's image bytes are a JSON list of
// [alpha, x, y]; a video is a JSON list of such frames.
const ml = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('latin1');
    const payload = (() => {
      const m = /\r\n\r\n([\s\S]*?)\r\n--/.exec(body);
      return m ? JSON.parse(m[1]) : null;
    })();
    if (req.url.startsWith('/health')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ model_loaded: true }));
    }
    if (req.url.startsWith('/recognize-video')) {
      res.setHeader('content-type', 'application/x-ndjson');
      res.write(JSON.stringify({ type: 'meta', duration: payload.length, frames: payload.length }) + '\n');
      payload.forEach((cards, i) => {
        res.write(JSON.stringify({ t: i, width: 1000, height: 1000, detections: cards.flatMap(c => card(...c)) }) + '\n');
      });
      return res.end(JSON.stringify({ type: 'done' }) + '\n');
    }
    if (req.url.startsWith('/recognize')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({
        success: true, detections: payload.flatMap(c => card(...c)), imageWidth: 1000, imageHeight: 1000,
      }));
    }
    res.statusCode = 404; res.end();
  });
});

const cc = http.createServer((req, res) => {
  if (req.headers['x-cc-auth'] !== 'sekrit' && !req.url.includes('tok=sekrit')) {
    res.statusCode = 401; return res.end();
  }
  if (req.url === '/queue.json') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ version: 3, queue: [
      { id: 'v1', title: 'Match', url: 'https://www.youtube.com/watch?v=abcdefghijk', cuts: { skip: [{ start: 10, end: 20 }], only: [] } },
    ] }));
  }
  if (req.url === '/board/state.json') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, device: { uuid: 'u1', name: 'Den TV' }, now: null, pads: [
      { id: 'p1', label: 'Hurricanrana', url: 'https://www.youtube.com/watch?v=abcdefghijk', start: 61, end: 64.5, media_id: 'pad-p1-abc' },
    ] }));
  }
  if (req.url === '/board/play' || req.url === '/board/control') {
    let body = '';
    req.on('data', c => { body += c; });
    return req.on('end', () => {
      const b = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/json');
      if (req.url === '/board/play' && b.pad_id !== 'p1') { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'no such pad' })); }
      res.end(JSON.stringify({ ok: true, echo: b }));
    });
  }
  if (req.url.startsWith('/media/v1')) {
    res.statusCode = req.headers.range ? 206 : 200;
    res.setHeader('content-type', 'video/mp4');
    return res.end('MEDIA');
  }
  res.statusCode = 404; res.end();
});

let base;
async function api(method, url, body, headers = {}) {
  const opts = { method, headers: { ...headers } };
  if (body instanceof FormData || Buffer.isBuffer(body)) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  const r = await fetch(base + url, opts);
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, text, headers: r.headers };
}
const frameForm = (t, cards) => {
  const fd = new FormData();
  fd.append('image', new Blob([JSON.stringify(cards)], { type: 'image/jpeg' }), 'f.jpg');
  fd.append('t', String(t));
  return fd;
};
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 30));
  }
};

let tests = 0, failed = 0;
async function test(name, fn) {
  tests++;
  try { await fn(); console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack}`); }
}

(async () => {
  await new Promise(r => ml.listen(0, r));
  await new Promise(r => cc.listen(0, r));
  process.env.CUSTOMCUTS_URL = `http://127.0.0.1:${cc.address().port}`;
  process.env.CUSTOMCUTS_TOKEN = 'sekrit';
  const app = express();
  app.use(express.json());
  const { router } = createTableSessions({
    storageDir: tmp, mlServiceUrl: `http://127.0.0.1:${ml.address().port}`, ports: { http: 3001, https: 3443 },
  });
  app.use('/api/table', router);
  const srv = app.listen(0);
  base = `http://127.0.0.1:${srv.address().port}`;

  let id;
  await test('config reports the ML service and HTTPS url', async () => {
    const r = await api('GET', '/api/table/config');
    assert.strictEqual(r.json.mlReady, true);
    assert.ok(r.json.httpsUrl.endsWith(':3443/table'));
    assert.strictEqual(r.json.customcuts, true);
  });

  await test('live frames become a play string', async () => {
    const r = await api('POST', '/api/table/sessions', { title: 'Friday', game: 'bidwhist', settings: { seatAtBottom: 1 } });
    id = r.json.session.id;
    assert.strictEqual(r.json.session.playString, 'TPS1.w.');
    await api('POST', `/api/table/sessions/${id}/frame`, frameForm(1.5, [['a', 500, 750]]));
    const f2 = await api('POST', `/api/table/sessions/${id}/frame`, frameForm(2.0, [['a', 500, 750]]));
    assert.strictEqual(f2.json.newPlays.length, 1);
    await api('POST', `/api/table/sessions/${id}/frame`, frameForm(3, [['a', 500, 750], ['B', 250, 500]]));
    const f4 = await api('POST', `/api/table/sessions/${id}/frame`, frameForm(3.5, [['a', 500, 750], ['B', 250, 500]]));
    assert.strictEqual(f4.json.playString, 'TPS1.w.aB-12');
    const s = await api('GET', `/api/table/sessions/${id}`);
    assert.strictEqual(s.json.session.playString, 'TPS1.w.aB-12', 'persisted');
    assert.strictEqual(s.json.session.hands[0].plays[0].t, 1.5);
  });

  await test('a chunked recording is reassembled, retries are idempotent', async () => {
    const send = (seq, data, rec = 'r1') => api('POST', `/api/table/sessions/${id}/video-chunk?seq=${seq}&rec=${rec}&mime=video/mp4`,
      Buffer.from(data), { 'content-type': 'application/octet-stream' });
    assert.strictEqual((await send(0, 'AAA')).json.next, 1);
    assert.strictEqual((await send(0, 'AAA')).json.duplicate, true);
    assert.strictEqual((await send(2, 'CCC')).status, 409);
    assert.strictEqual((await send(1, 'BBB')).json.next, 2);
    const fin = await api('POST', `/api/table/sessions/${id}/video-finish`, { duration: 12 });
    assert.strictEqual(fin.json.session.video.size, 6);
    const v = await api('GET', `/api/table/sessions/${id}/video`);
    assert.strictEqual(v.text, 'AAABBB');
    assert.strictEqual(v.headers.get('content-type'), 'video/mp4');
  });

  await test('editing the play string keeps timestamps that still line up', async () => {
    const r = await api('PATCH', `/api/table/sessions/${id}`, { playString: 'TPS1.w.aC-1x' });
    assert.strictEqual(r.json.session.playString, 'TPS1.w.aC-1x');
    assert.strictEqual(r.json.session.hands[0].plays[0].t, 1.5);
    assert.strictEqual(r.json.session.hands[0].plays[1].t, null);
    const bad = await api('PATCH', `/api/table/sessions/${id}`, { playString: 'TPS1.w.aa' });
    assert.strictEqual(bad.status, 400);
  });

  let offlineId;
  await test('an uploaded video is processed offline into a play string', async () => {
    const s = await api('POST', '/api/table/sessions', { title: 'From Photos', game: 'bidwhist' });
    offlineId = s.json.session.id;
    const frames = [[['n', 500, 750]], [['n', 500, 750]], [['n', 500, 750], ['N', 750, 500]], [['n', 500, 750], ['N', 750, 500]]];
    const fd = new FormData();
    fd.append('video', new Blob([JSON.stringify(frames)], { type: 'video/quicktime' }), 'IMG_0001.MOV');
    fd.append('process', '1');
    const up = await api('POST', `/api/table/sessions/${offlineId}/video`, fd);
    assert.strictEqual(up.json.session.video.file, 'video.mov');
    const done = await until(async () => {
      const r = await api('GET', `/api/table/sessions/${offlineId}`);
      return r.json.session.status === 'ready' && r.json.session.progress === 1 ? r.json.session : null;
    });
    assert.strictEqual(done.playString, 'TPS1.w.nN-03');
    assert.strictEqual(done.source, 'upload');
  });

  await test('export then import onto another host keeps the plays and times', async () => {
    const ex = await api('GET', `/api/table/sessions/${id}/export`);
    const fd = new FormData();
    fd.append('session', new Blob([ex.text], { type: 'application/json' }), 'table.json');
    fd.append('video', new Blob(['VIDEO'], { type: 'video/mp4' }), 'v.mp4');
    const im = await api('POST', '/api/table/import', fd);
    assert.strictEqual(im.status, 200, im.text);
    assert.notStrictEqual(im.json.session.id, id);
    assert.strictEqual(im.json.session.playString, 'TPS1.w.aC-1x');
    assert.strictEqual(im.json.session.hands[0].plays[0].t, 1.5);
    assert.strictEqual(im.json.session.video.size, 5);
    const bare = new FormData();
    bare.append('playString', 'TPS1.h.zZ');
    const im2 = await api('POST', '/api/table/import', bare);
    assert.strictEqual(im2.json.session.game, 'hearts');
    assert.strictEqual(im2.json.session.playString, 'TPS1.h.zZ');
  });

  await test('list, then delete', async () => {
    const l = await api('GET', '/api/table/sessions');
    assert.strictEqual(l.json.sessions.length, 4);
    assert.ok(!('hands' in l.json.sessions[0]) || typeof l.json.sessions[0].hands === 'number');
    assert.strictEqual((await api('DELETE', `/api/table/sessions/${offlineId}`)).status, 200);
    assert.strictEqual((await api('GET', `/api/table/sessions/${offlineId}`)).status, 404);
    assert.strictEqual((await api('GET', '/api/table/sessions/..%2F..%2Fetc')).status, 404);
  });

  await test('CustomCuts queue and media are proxied without leaking the token', async () => {
    const q = await api('GET', '/api/table/customcuts/queue');
    assert.strictEqual(q.json.items[0].cuts.skip[0].start, 10);
    assert.ok(!q.text.includes('sekrit'));
    const m = await api('GET', q.json.items[0].mediaUrl, undefined, { Range: 'bytes=0-' });
    assert.strictEqual(m.status, 206);
    assert.strictEqual(m.text, 'MEDIA');
  });

  await test('the CustomCuts cast board is proxied: pads, play, control', async () => {
    const b = await api('GET', '/api/table/customcuts/board');
    assert.strictEqual(b.json.success, true);
    assert.strictEqual(b.json.device.name, 'Den TV');
    assert.strictEqual(b.json.pads[0].mediaUrl, '/api/table/customcuts/media/pad-p1-abc');
    const p = await api('POST', '/api/table/customcuts/board/play', { padId: 'p1' });
    assert.deepStrictEqual(p.json.echo, { pad_id: 'p1' });
    const bad = await api('POST', '/api/table/customcuts/board/play', { padId: 'zz' });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.json.success, false);
    assert.strictEqual(bad.json.error, 'no such pad');
    const c = await api('POST', '/api/table/customcuts/board/control', { action: 'stop' });
    assert.deepStrictEqual(c.json.echo, { action: 'stop' });
    assert.ok(!JSON.stringify([b.json, p.json, c.json]).includes('sekrit'));
  });

  srv.close(); ml.close(); cc.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${tests - failed}/${tests} passed`);
  process.exit(failed ? 1 : 0);
})();
