#!/usr/bin/env node
/* Take a screenshot of a URL at a precise mobile viewport by driving headless Chrome over CDP.
   Usage: node scripts/mobile-screenshot.js <url> <width> <height> <outpath>
   Requires chrome already running with --remote-debugging-port. */
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const [, , url, wStr, hStr, outPath] = process.argv;
const width = Number(wStr);
const height = Number(hStr);

const fetchTargets = () => new Promise((resolve, reject) => {
  http.get('http://localhost:9224/json', (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => resolve(JSON.parse(data)));
  }).on('error', reject);
});

const newTarget = () => new Promise((resolve, reject) => {
  const req = http.request({
    host: 'localhost', port: 9224, path: '/json/new?about:blank', method: 'PUT',
  }, (r) => {
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

  await send('Page.enable', {});
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: true, fitWindow: false,
  });
  await send('Page.navigate', { url });
  // Wait for load event
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
  // Give React a moment
  await new Promise(r => setTimeout(r, 2000));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log('Wrote', outPath, `(${width}x${height})`);
  ws.close();
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
