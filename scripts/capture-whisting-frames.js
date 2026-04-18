#!/usr/bin/env node
/* Capture a sequence of PNG frames of a Bid Whist game (bidding → whisting → play)
   for later stitching into a GIF.

   Usage:
     node scripts/capture-whisting-frames.js <url> <width> <height> <outdir> <fps> <totalSeconds>

   Requires a Chrome process running with --remote-debugging-port=9224 and a static
   server serving the standalone bundle (we do NOT start either here).
*/
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const [, , url, wStr, hStr, outDir, fpsStr, totalSecondsStr] = process.argv;
const width = Number(wStr);
const height = Number(hStr);
const fps = Number(fpsStr);
const totalSeconds = Number(totalSecondsStr);
const frameIntervalMs = Math.round(1000 / fps);
const totalFrames = Math.round(fps * totalSeconds);

fs.mkdirSync(outDir, { recursive: true });

const newTarget = () => new Promise((resolve, reject) => {
  const req = http.request({ host: 'localhost', port: 9224, path: '/json/new?about:blank', method: 'PUT' }, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => resolve(JSON.parse(data)));
  });
  req.on('error', reject);
  req.end();
});

const closeTarget = (targetId) => new Promise((resolve) => {
  http.get(`http://localhost:9224/json/close/${targetId}`, (r) => {
    r.on('data', () => {});
    r.on('end', resolve);
  }).on('error', resolve);
});

(async () => {
  const target = await newTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.once('open', r));

  let nextId = 1;
  const pending = new Map();
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return r.result ? r.result.value : undefined;
  };

  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, fitWindow: false });

  // Install a setTimeout override BEFORE the page loads so we catch every call.
  // The app uses short timeouts (20ms) after the first Auto Play click which
  // makes the remaining AI plays fly by. We enforce a minimum dwell so the
  // viewer can actually see each card being played. 10ms unaffected → lets
  // microtasks stay snappy; 20ms+ → bumped to our minimum.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      // 1) Enforce a minimum dwell for short-ish timeouts so the game doesn't
      //    fly past every AI play after the human's Auto Play drops the pacing
      //    timeout to 10ms.
      const MIN_DELAY = 350;
      const PASSTHROUGH = 15;
      const origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, delay, ...args){
        let d = typeof delay === 'number' ? delay : 0;
        if (d >= PASSTHROUGH && d < MIN_DELAY) d = MIN_DELAY;
        return origSetTimeout.call(this, fn, d, ...args);
      };

      // 2) Force Math.random() to 0 so the BidWhistGame constructor picks
      //    dealer = 0 (matches our simulator's dealer=0 — otherwise the
      //    declarer, trump, and bid order diverge and the hand no longer
      //    whists). The override stays; any other consumer of randomness in
      //    the app (e.g. whisting animation picker) tolerates a constant.
      Math.random = function(){ return 0; };
    })();`
  });

  await send('Page.navigate', { url });
  await new Promise((resolve) => {
    const handler = raw => {
      const msg = JSON.parse(raw);
      if (msg.method === 'Page.loadEventFired') {
        ws.off('message', handler);
        resolve();
      }
    };
    ws.on('message', handler);
  });
  await sleep(1200);

  // Click Deal to start the hand.
  await evalJs(`document.getElementById('dealButton')?.click(); 'ok';`);

  const captureFrame = async (i) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(outDir, `f${String(i).padStart(4, '0')}.png`);
    fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
  };

  const start = Date.now();
  for (let i = 0; i < totalFrames; i++) {
    const tickTs = start + i * frameIntervalMs;

    // Click Auto Play any time the human owes a decision. The button only
    // appears on player 0's turns, so clicking on every frame is harmless.
    await evalJs(`(function(){
      const btns = Array.from(document.querySelectorAll('button'));
      const ap = btns.find(b => b.textContent && b.textContent.trim() === 'Auto Play');
      if (ap) { ap.click(); return 'clicked'; }
      return 'noop';
    })();`);

    await captureFrame(i);

    const now = Date.now();
    const wait = tickTs + frameIntervalMs - now;
    if (wait > 0) await sleep(wait);
  }

  console.log(`Wrote ${totalFrames} frames to ${outDir} (${width}x${height} @ ${fps}fps)`);

  ws.close();
  await closeTarget(target.id).catch(() => {});
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
