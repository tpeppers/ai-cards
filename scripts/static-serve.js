#!/usr/bin/env node
/* Tiny static file server for the Bid Whist standalone bundle. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || 'standalone/bidwhist');
const PORT = Number(process.argv[3] || 8088);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  try {
    let reqPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(ROOT, reqPath);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        // fallback to index.html for SPA-style routes
        const idx = path.join(ROOT, 'index.html');
        fs.createReadStream(idx).pipe(res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }));
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
server.listen(PORT, () => {
  console.log(`Static server: http://localhost:${PORT}  root=${ROOT}`);
});
