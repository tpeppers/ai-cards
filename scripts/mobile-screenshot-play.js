#!/usr/bin/env node
/* Extended version: after loading, click the Deal button, then auto-play through bidding/trump/discard
   to reach the play stage, then screenshot.
   Usage: node scripts/mobile-screenshot-play.js <url> <width> <height> <outpath> */
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const [, , url, wStr, hStr, outPath] = process.argv;
const width = Number(wStr);
const height = Number(hStr);

const newTarget = () => new Promise((resolve, reject) => {
  const req = http.request({ host: 'localhost', port: 9224, path: '/json/new?about:blank', method: 'PUT' }, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => resolve(JSON.parse(data)));
  });
  req.on('error', reject);
  req.end();
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
  await sleep(1500);

  // Click Deal
  await evalJs(`document.getElementById('dealButton')?.click(); 'ok';`);
  await sleep(2000);

  // Retry loop: click Auto Play whenever it becomes available, wait for AI turns
  // to take their time in between. Bail once we're clearly past the bidding /
  // trump / discard phases (no more modals in the DOM).
  for (let i = 0; i < 25; i++) {
    const state = await evalJs(`(function(){
      const btns = Array.from(document.querySelectorAll('button'));
      const ap = btns.find(b => b.textContent && b.textContent.trim() === 'Auto Play');
      if (ap) { ap.click(); return 'clicked'; }
      // A modal with z-50 present means we're still in bidding/trump/discard
      const modals = document.querySelectorAll('.z-50');
      return modals.length > 0 ? 'modal' : 'play';
    })();`);
    if (state === 'play') break;
    await sleep(1200);
  }
  await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log('Wrote', outPath, `(${width}x${height})`);
  ws.close();
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
