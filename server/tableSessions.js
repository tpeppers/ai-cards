/**
 * Table Cam sessions: a phone watching a real card table.
 *
 * A session is one sitting at the table. It holds the game-play string
 * (TPS1, see tablePlay.js), the per-play timestamps that line it up with
 * the video, and — when one was recorded or uploaded — the video itself.
 * Everything for a session lives in one directory so it can be copied,
 * backed up or moved to another host as a unit:
 *
 *   {TABLE_STORAGE}/<id>/session.json
 *   {TABLE_STORAGE}/<id>/video.<mp4|mov|webm>
 *
 * Two ways in:
 *   - LIVE: the phone posts sampled frames (/frame) while it records; each
 *     frame goes to the ML service and through the tracker, and the phone
 *     shows the play string growing. The recording itself is streamed up in
 *     chunks (/video-chunk) so a long sitting never has to fit in the
 *     phone's memory for one big upload.
 *   - OFFLINE: a video recorded earlier (Camera app, or a Table Cam
 *     recording saved to the phone) is uploaded (/video) and processed
 *     frame by frame by the ML service's /recognize-video.
 *
 * Sharing: /table/s/<id> on this host plays the video with the string;
 * /export + /video?download=1 carry a session to another host, where
 * /api/table/import takes them back in.
 *
 * Optional CustomCuts integration (CUSTOMCUTS_URL + CUSTOMCUTS_TOKEN):
 * the CustomCuts host's queue is proxied so the Table Cam video player can
 * play tagged videos with their cuts applied.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const {
  createTracker, encodePlayString, decodePlayString, mergeTimes, normalizeSettings,
} = require('./tablePlay');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const VIDEO_EXT = {
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'video/x-matroska': '.mkv', 'video/3gpp': '.3gp',
};
const EXT_MIME = Object.fromEntries(Object.entries(VIDEO_EXT).map(([m, e]) => [e, m]));

function newId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`;
}

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

function videoExt(mime, originalName) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  if (VIDEO_EXT[base]) return VIDEO_EXT[base];
  const ext = path.extname(originalName || '').toLowerCase();
  if (EXT_MIME[ext]) return ext;
  return '.mp4';
}

function createTableSessions({ storageDir, mlServiceUrl, ports = {} }) {
  fs.mkdirSync(storageDir, { recursive: true });
  const router = express.Router();
  const trackers = new Map(); // id -> tracker (live sessions)
  const processing = new Set(); // ids with an offline pass running

  // ── storage ────────────────────────────────────────────────────────
  const dirOf = (id) => path.join(storageDir, id);
  const fileOf = (id) => path.join(dirOf(id), 'session.json');

  function load(id) {
    if (!ID_RE.test(id || '')) return null;
    try {
      return JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
    } catch {
      return null;
    }
  }

  function save(session) {
    session.updatedAt = new Date().toISOString();
    session.playString = encodePlayString(session.game, session.hands);
    session.playCount = session.hands.reduce((n, h) => n + h.plays.length, 0);
    const tmp = `${fileOf(session.id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
    fs.renameSync(tmp, fileOf(session.id));
    return session;
  }

  function create({ title, game, settings, source, playString }) {
    const s = normalizeSettings({ ...(settings || {}), game: game || (settings && settings.game) });
    const id = newId();
    fs.mkdirSync(dirOf(id), { recursive: true });
    let hands = [{ plays: [] }];
    if (playString) {
      const decoded = decodePlayString(playString);
      s.game = decoded.game;
      hands = decoded.hands.map(h => ({ plays: h.plays.map(p => ({ ...p, t: null })) }));
    }
    return save({
      id,
      title: String(title || '').slice(0, 120) || `Table ${id.slice(0, 13)}`,
      createdAt: new Date().toISOString(),
      game: s.game,
      source: source || 'live',
      status: 'ready',
      progress: null,
      error: null,
      settings: { roi: s.roi, seatAtBottom: s.seatAtBottom, minConfidence: s.minConfidence, sampleFps: 3 },
      video: null,
      hands,
    });
  }

  function summary(s) {
    return {
      id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt,
      game: s.game, source: s.source, status: s.status, progress: s.progress,
      playString: s.playString, playCount: s.playCount, hands: s.hands.length,
      hasVideo: !!(s.video && s.video.file), videoSize: s.video ? s.video.size : null,
    };
  }

  function trackerFor(session) {
    let tr = trackers.get(session.id);
    if (!tr) {
      tr = createTracker({ ...session.settings, game: session.game }, session.hands);
      trackers.set(session.id, tr);
    }
    return tr;
  }

  function videoPath(session) {
    return session.video && session.video.file ? path.join(dirOf(session.id), session.video.file) : null;
  }

  function withSession(req, res) {
    const s = load(req.params.id);
    if (!s) res.status(404).json({ success: false, error: 'No such session' });
    return s;
  }

  // ── uploads ────────────────────────────────────────────────────────
  const frameUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
  });
  const fileUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const tmp = path.join(storageDir, '.incoming');
        fs.mkdirSync(tmp, { recursive: true });
        cb(null, tmp);
      },
      filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`),
    }),
    limits: { fileSize: 8 * 1024 * 1024 * 1024 },
  });

  /** Move an uploaded temp file in as the session's video. */
  function adoptVideo(session, file) {
    const old = videoPath(session);
    if (old && fs.existsSync(old)) fs.unlinkSync(old);
    const ext = videoExt(file.mimetype, file.originalname);
    const name = `video${ext}`;
    fs.renameSync(file.path, path.join(dirOf(session.id), name));
    session.video = {
      file: name,
      mime: EXT_MIME[ext] || file.mimetype || 'video/mp4',
      size: file.size,
      originalName: file.originalname || null,
    };
  }

  // ── ML ─────────────────────────────────────────────────────────────
  async function detectFrame(buffer, mime, confidence) {
    const fd = new FormData();
    fd.append('image', new Blob([buffer], { type: mime || 'image/jpeg' }), 'frame.jpg');
    const r = await fetch(`${mlServiceUrl}/recognize?confidence=${confidence}`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(`ML service returned ${r.status}`);
    const data = await r.json();
    // Older ML servers return only the deduped `cards` list (one box per
    // card); newer ones add every box in `detections`.
    return {
      detections: Array.isArray(data.detections) ? data.detections : (data.cards || []),
      width: data.imageWidth || null,
      height: data.imageHeight || null,
    };
  }

  async function processVideo(id) {
    if (processing.has(id)) return;
    processing.add(id);
    trackers.delete(id);
    let session = load(id);
    const file = videoPath(session);
    const fps = Math.max(0.5, Math.min(10, Number(session.settings.sampleFps) || 3));
    const previous = session.playString;
    session.status = 'processing';
    session.progress = 0;
    session.error = null;
    save(session);

    const tracker = createTracker({ ...session.settings, game: session.game });
    let duration = 0;
    let lastSave = Date.now();
    try {
      const blob = await fs.openAsBlob(file, { type: session.video.mime });
      const fd = new FormData();
      fd.append('video', blob, session.video.file);
      const conf = Math.max(0.05, session.settings.minConfidence - 0.1);
      const r = await fetch(`${mlServiceUrl}/recognize-video?fps=${fps}&confidence=${conf}`, { method: 'POST', body: fd });
      if (!r.ok) {
        let detail = '';
        try { detail = (await r.json()).detail || ''; } catch { /* not json */ }
        throw new Error(`ML service returned ${r.status}${detail ? `: ${detail}` : ''}`);
      }
      const decoder = new TextDecoder();
      let buf = '';
      let done = false;
      for await (const chunk of r.body) {
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.type === 'meta') { duration = msg.duration || 0; continue; }
          if (msg.type === 'done') { done = true; continue; }
          if (msg.type === 'error') throw new Error(msg.error);
          tracker.addFrame(msg);
          if (Date.now() - lastSave > 1500) {
            session = load(id);
            session.hands = tracker.hands;
            session.progress = duration ? Math.min(0.99, msg.t / duration) : null;
            save(session);
            lastSave = Date.now();
          }
        }
      }
      if (!done) throw new Error('ML service stopped before the end of the video');
      session = load(id);
      session.hands = tracker.hands;
      session.status = 'ready';
      session.progress = 1;
      session.previousPlayString = previous;
      session.video.duration = duration || session.video.duration || null;
      save(session);
    } catch (e) {
      session = load(id) || session;
      session.status = 'error';
      session.error = e.message;
      save(session);
    } finally {
      processing.delete(id);
    }
  }

  // ── routes ─────────────────────────────────────────────────────────
  router.get('/config', async (req, res) => {
    const ip = lanIp();
    const host = process.env.TABLE_PUBLIC_HOST || ip || 'localhost';
    let ml = false;
    try {
      const r = await fetch(`${mlServiceUrl}/health`, { signal: AbortSignal.timeout(1500) });
      ml = r.ok && (await r.json()).model_loaded === true;
    } catch { /* unreachable */ }
    res.json({
      success: true,
      mlReady: ml,
      customcuts: !!process.env.CUSTOMCUTS_URL,
      httpUrl: ports.http ? `http://${host}:${ports.http}/table` : null,
      httpsUrl: ports.https ? `https://${host}:${ports.https}/table` : null,
      caCertUrl: ports.https ? `http://${host}:${ports.http}/table-ca.crt` : null,
      storageDir,
    });
  });

  router.get('/sessions', (req, res) => {
    const out = [];
    for (const id of fs.readdirSync(storageDir)) {
      if (id.startsWith('.')) continue;
      const s = load(id);
      if (s) out.push(summary(s));
    }
    out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ success: true, sessions: out });
  });

  router.post('/sessions', (req, res) => {
    try {
      const { title, game, settings } = req.body || {};
      res.json({ success: true, session: create({ title, game, settings, source: 'live' }) });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  router.get('/sessions/:id', (req, res) => {
    const s = withSession(req, res);
    if (s) res.json({ success: true, session: s });
  });

  router.patch('/sessions/:id', (req, res) => {
    const s = withSession(req, res);
    if (!s) return;
    const { title, playString, settings } = req.body || {};
    try {
      if (typeof title === 'string') s.title = title.slice(0, 120);
      if (settings && typeof settings === 'object') {
        const n = normalizeSettings({ ...s.settings, ...settings, game: s.game });
        s.settings = {
          ...s.settings, roi: n.roi, seatAtBottom: n.seatAtBottom, minConfidence: n.minConfidence,
          sampleFps: Math.max(0.5, Math.min(10, Number(settings.sampleFps ?? s.settings.sampleFps) || 3)),
        };
      }
      if (typeof playString === 'string') {
        const decoded = decodePlayString(playString);
        s.game = decoded.game;
        s.hands = mergeTimes(s.hands, decoded.hands);
        s.edited = true;
      }
      trackers.delete(s.id);
      res.json({ success: true, session: save(s) });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  router.delete('/sessions/:id', (req, res) => {
    const s = withSession(req, res);
    if (!s) return;
    if (processing.has(s.id)) return res.status(409).json({ success: false, error: 'Still processing' });
    trackers.delete(s.id);
    fs.rmSync(dirOf(s.id), { recursive: true, force: true });
    res.json({ success: true });
  });

  // One sampled frame from a live camera. Fields: image, t (seconds since
  // the recording started), width/height of the frame.
  router.post('/sessions/:id/frame', frameUpload.single('image'), async (req, res) => {
    const s = withSession(req, res);
    if (!s) return;
    if (processing.has(s.id)) return res.status(409).json({ success: false, error: 'Session is processing a video' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No image' });
    try {
      const tr = trackerFor(s);
      const det = await detectFrame(req.file.buffer, req.file.mimetype, Math.max(0.05, tr.settings.minConfidence - 0.1));
      const width = det.width || Number(req.body.width) || 0;
      const height = det.height || Number(req.body.height) || 0;
      const { newPlays, visible } = tr.addFrame({ t: Number(req.body.t) || 0, width, height, detections: det.detections });
      if (newPlays.length) {
        const fresh = load(s.id);
        fresh.hands = tr.hands;
        save(fresh);
      }
      res.json({
        success: true,
        newPlays,
        visible,
        playString: tr.toString(),
        hand: tr.hands.length,
        handPlays: tr.hands[tr.hands.length - 1].plays.length,
      });
    } catch (e) {
      res.status(502).json({ success: false, error: `Detection failed: ${e.message}` });
    }
  });

  router.post('/sessions/:id/new-hand', (req, res) => {
    const s = withSession(req, res);
    if (!s) return;
    const tr = trackerFor(s);
    tr.newHand();
    s.hands = tr.hands;
    res.json({ success: true, session: save(s) });
  });

  // A whole video file, from the phone's Photos/Files or a finished
  // recording. process=1 runs detection over it afterwards.
  router.post('/sessions/:id/video', fileUpload.single('video'), (req, res) => {
    const s = withSession(req, res);
    if (!s) { if (req.file) fs.unlink(req.file.path, () => {}); return; }
    if (!req.file) return res.status(400).json({ success: false, error: 'No video' });
    if (processing.has(s.id)) {
      fs.unlink(req.file.path, () => {});
      return res.status(409).json({ success: false, error: 'Still processing the previous video' });
    }
    adoptVideo(s, req.file);
    if (s.source === 'live' && s.playCount === 0) s.source = 'upload';
    save(s);
    if (String(req.body.process ?? req.query.process) === '1') processVideo(s.id);
    res.json({ success: true, session: load(s.id) });
  });

  // Streamed recording: raw body chunks appended in order. `rec` names one
  // recording (a new one replaces an unfinished one); `seq` starts at 0 and
  // a repeated seq is acknowledged without appending (a retried request).
  router.post('/sessions/:id/video-chunk', express.raw({ type: () => true, limit: '64mb' }), (req, res) => {
    const s = withSession(req, res);
    if (!s) return;
    const seq = Number(req.query.seq);
    const rec = String(req.query.rec || '');
    if (!Number.isInteger(seq) || seq < 0 || !ID_RE.test(rec)) {
      return res.status(400).json({ success: false, error: 'seq and rec are required' });
    }
    const ext = videoExt(req.query.mime, '');
    const partName = `recording${ext}.part`;
    const part = path.join(dirOf(s.id), partName);
    const same = s.recording && s.recording.rec === rec;
    const expected = same ? s.recording.next : 0;
    if (seq < expected) return res.json({ success: true, next: expected, duplicate: true });
    if (seq !== expected) return res.status(409).json({ success: false, error: 'Out of order', next: expected });
    if (seq === 0) {
      if (s.recording && s.recording.part) fs.rmSync(path.join(dirOf(s.id), s.recording.part), { force: true });
      fs.rmSync(part, { force: true });
    }
    fs.appendFileSync(part, req.body);
    s.recording = { rec, part: partName, next: seq + 1, bytes: fs.statSync(part).size, mime: req.query.mime || null };
    save(s);
    res.json({ success: true, next: seq + 1 });
  });

  router.post('/sessions/:id/video-finish', (req, res) => {
    const s = withSession(req, res);
    if (!s) return;
    if (!s.recording) return res.status(400).json({ success: false, error: 'Nothing was recorded' });
    const part = path.join(dirOf(s.id), s.recording.part);
    const finalName = s.recording.part.replace(/\.part$/, '');
    const ext = path.extname(finalName);
    const old = videoPath(s);
    if (old && fs.existsSync(old)) fs.unlinkSync(old);
    const name = `video${ext}`;
    fs.renameSync(part, path.join(dirOf(s.id), name));
    s.video = {
      file: name,
      mime: EXT_MIME[ext] || 'video/mp4',
      size: fs.statSync(path.join(dirOf(s.id), name)).size,
      duration: Number(req.body && req.body.duration) || null,
    };
    delete s.recording;
    save(s);
    if (req.body && req.body.process) processVideo(s.id);
    res.json({ success: true, session: load(s.id) });
  });

  router.post('/sessions/:id/process', (req, res) => {
    const s = withSession(req, res);
    if (!s) return;
    if (!videoPath(s) || !fs.existsSync(videoPath(s))) {
      return res.status(400).json({ success: false, error: 'This session has no video' });
    }
    if (req.body && req.body.sampleFps) {
      s.settings.sampleFps = Math.max(0.5, Math.min(10, Number(req.body.sampleFps) || 3));
      save(s);
    }
    processVideo(s.id);
    res.json({ success: true, session: load(s.id) });
  });

  router.get('/sessions/:id/video', (req, res) => {
    const s = withSession(req, res);
    if (!s) return;
    const file = videoPath(s);
    if (!file || !fs.existsSync(file)) return res.status(404).json({ success: false, error: 'No video' });
    const safeTitle = s.title.replace(/[^\w .-]+/g, '_').slice(0, 60) || s.id;
    if (req.query.download) {
      return res.download(file, `${safeTitle}${path.extname(file)}`);
    }
    res.type(s.video.mime);
    res.sendFile(file);
  });

  // Portable copy of a session (no video): import it on another host
  // together with the video download.
  router.get('/sessions/:id/export', (req, res) => {
    const s = withSession(req, res);
    if (!s) return;
    res.setHeader('Content-Disposition', `attachment; filename="table-${s.id}.json"`);
    res.json({ format: 'ai-cards-table-session', version: 1, ...s });
  });

  // Bring a session in from elsewhere: a session .json (from /export, or
  // saved on the phone), a video, a bare play string, or any mix.
  router.post('/import', fileUpload.fields([{ name: 'session', maxCount: 1 }, { name: 'video', maxCount: 1 }]), (req, res) => {
    const sessionFile = req.files && req.files.session && req.files.session[0];
    const video = req.files && req.files.video && req.files.video[0];
    const cleanup = () => {
      if (sessionFile) fs.unlink(sessionFile.path, () => {});
      if (video && fs.existsSync(video.path)) fs.unlink(video.path, () => {});
    };
    try {
      let src = null;
      if (sessionFile) {
        src = JSON.parse(fs.readFileSync(sessionFile.path, 'utf8'));
        if (!src || !Array.isArray(src.hands)) throw new Error('Not a table session file');
      }
      const playString = (req.body && req.body.playString) || (src && !src.hands.length && src.playString) || null;
      const s = create({
        title: (req.body && req.body.title) || (src && src.title) || 'Imported table',
        game: src ? src.game : req.body && req.body.game,
        settings: src && src.settings,
        source: 'import',
        playString,
      });
      if (src && !playString) {
        // Validate the hands by round-tripping them through the string.
        const checked = decodePlayString(encodePlayString(src.game, src.hands));
        s.hands = mergeTimes(src.hands, checked.hands);
        s.importedFrom = { id: src.id || null, createdAt: src.createdAt || null };
        if (src.createdAt) s.recordedAt = src.createdAt;
      }
      if (video) adoptVideo(s, video);
      save(s);
      const runDetection = String(req.body && req.body.process) === '1' && video;
      if (sessionFile) fs.unlink(sessionFile.path, () => {});
      if (runDetection) processVideo(s.id);
      res.json({ success: true, session: load(s.id) });
    } catch (e) {
      cleanup();
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // ── CustomCuts ─────────────────────────────────────────────────────
  const ccUrl = () => (process.env.CUSTOMCUTS_URL || '').replace(/\/+$/, '');
  const ccToken = () => process.env.CUSTOMCUTS_TOKEN || '';

  router.get('/customcuts/queue', async (req, res) => {
    if (!ccUrl()) return res.status(404).json({ success: false, error: 'CUSTOMCUTS_URL is not set on the host' });
    try {
      const r = await fetch(`${ccUrl()}/queue.json`, {
        headers: { 'X-CC-Auth': ccToken() },
        signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) throw new Error(`CustomCuts host returned ${r.status}`);
      const q = await r.json();
      const items = (q.queue || []).map(e => ({
        id: e.id,
        title: e.title || e.url,
        url: e.url,
        cuts: e.cuts || null,
        mute: !!e.mute,
        local: !!e.localPath,
        // Media goes through this host so an HTTPS page can play it and
        // the CustomCuts token never reaches the phone.
        mediaUrl: `/api/table/customcuts/media/${encodeURIComponent(e.id)}`,
      }));
      res.json({ success: true, items });
    } catch (e) {
      res.status(502).json({ success: false, error: e.message });
    }
  });

  router.get('/customcuts/media/:id', (req, res) => {
    if (!ccUrl()) return res.status(404).end();
    const target = new URL(`${ccUrl()}/media/${encodeURIComponent(req.params.id)}`);
    target.searchParams.set('tok', ccToken());
    const lib = target.protocol === 'https:' ? https : http;
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;
    const up = lib.get(target, { headers }, (upRes) => {
      res.status(upRes.statusCode || 502);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        if (upRes.headers[h]) res.setHeader(h, upRes.headers[h]);
      }
      upRes.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.status(502).end(); });
    req.on('close', () => up.destroy());
  });

  return { router, processVideo, _load: load, _create: create };
}

module.exports = { createTableSessions, videoExt };
