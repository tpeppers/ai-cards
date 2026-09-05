const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const os = require('os');
// NOTE: deliberately NOT requiring the npm 'form-data' package — it would
// shadow Node's native FormData, whose undici multipart encoding is the
// only one FastAPI accepts through Node's built-in fetch.
const { spawn } = require('child_process');
const sharp = require('sharp');
const http = require('http');
const labelStudio = require('./labelStudio');
const { initMultiplayer } = require('./multiplayer');
const { Announcer } = require('./announce');
const gameMode = require('./gameMode');
const { normalizeMlCards } = require('./mlCards');
const { aggregateBurst, composeFourSnapDeck } = require('./fourSnap');

// ML service configuration
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:3002';

// Announcer configuration. Both files live alongside the Game Mode storage
// volume so they can be edited without rebuilding the image; both are
// optional and the announcer falls back to a no-op adapter without them.
const ANNOUNCE_CONFIG_PATH =
  process.env.ANNOUNCE_CONFIG || path.join(gameModeDataRoot(), 'announce.json');
const ANNOUNCE_WORDLIST_PATH =
  process.env.ANNOUNCE_WORDLIST || path.join(gameModeDataRoot(), 'profanity.json');

/** Directory that holds operator-editable config (the mounted /data volume). */
function gameModeDataRoot() {
  return process.env.GAME_MODE_STORAGE
    ? path.dirname(path.resolve(process.env.GAME_MODE_STORAGE))
    : path.join(__dirname, '..');
}

// Public URL advertised in the "someone is hosting" Signal post.
const PUBLIC_URL = process.env.PUBLIC_URL || '';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve the built React frontend from /build when it exists. Populated
// by `npm run build` in the Docker image. In dev (react-scripts on 3000)
// this directory is absent and the handler is skipped. SPA fallback
// (sendFile on unmatched GETs) is registered AFTER api routes at the
// bottom of this file.
const buildDir = path.join(__dirname, '../build');
const hasBuild = fs.existsSync(buildDir);
if (hasBuild) {
  app.use(express.static(buildDir));
}

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const handsDir = path.join(__dirname, '../hands');
if (!fs.existsSync(handsDir)) {
  fs.mkdirSync(handsDir, { recursive: true });
}

const labelingDir = path.join(__dirname, '../labeling/images');
if (!fs.existsSync(labelingDir)) {
  fs.mkdirSync(labelingDir, { recursive: true });
}

const handsFilePath = path.join(handsDir, 'stored_hands.txt');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueId = uuidv4();
    const extension = path.extname(file.originalname);
    cb(null, uniqueId + extension);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const uploadDatabase = new Map();

// When true (default), all detected images are automatically saved to labeling/images/ for retraining.
// When false, images are deleted after 10 minutes unless manually reported as incorrect.
let autoSaveForRetraining = true;

app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const uuid = uuidv4();
    const uploadRecord = {
      uuid: uuid,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadTime: new Date().toISOString(),
      processed: false
    };

    uploadDatabase.set(uuid, uploadRecord);

    console.log(`Image uploaded: ${uploadRecord.originalName} -> ${uploadRecord.filename} (UUID: ${uuid})`);

    res.json({
      uuid: uuid,
      status: 'uploaded',
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/upload/:uuid', (req, res) => {
  const uuid = req.params.uuid;
  const uploadRecord = uploadDatabase.get(uuid);

  if (!uploadRecord) {
    return res.status(404).json({ error: 'Upload not found' });
  }

  res.json({
    uuid: uploadRecord.uuid,
    originalName: uploadRecord.originalName,
    size: uploadRecord.size,
    uploadTime: uploadRecord.uploadTime,
    processed: uploadRecord.processed,
    status: 'found'
  });
});

app.get('/api/uploads', (req, res) => {
  const uploads = Array.from(uploadDatabase.values()).map(record => ({
    uuid: record.uuid,
    originalName: record.originalName,
    size: record.size,
    uploadTime: record.uploadTime,
    processed: record.processed
  }));

  res.json({ uploads });
});

// Auto-save for retraining setting
app.get('/api/settings/auto-save', (req, res) => {
  res.json({ autoSaveForRetraining });
});

app.post('/api/settings/auto-save', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  autoSaveForRetraining = enabled;
  res.json({ autoSaveForRetraining });
});

app.get('/ios/download', (req, res) => {
  const iosAppPath = path.join(__dirname, '../ios/build/HeartsCardCapture.app');
  
  if (fs.existsSync(iosAppPath)) {
    res.download(iosAppPath, 'HeartsCardCapture.app', (err) => {
      if (err) {
        console.error('Download error:', err);
        res.status(500).json({ error: 'Download failed' });
      }
    });
  } else {
    res.status(404).json({ 
      error: 'iOS app not built yet',
      message: 'Run `npm run build:ios` to build the iOS application first'
    });
  }
});

// Get all stored hands
app.get('/api/hands', (req, res) => {
  try {
    if (fs.existsSync(handsFilePath)) {
      const content = fs.readFileSync(handsFilePath, 'utf8');
      const hands = content.split('\n').filter(hand => hand.trim() !== '');
      res.json({ hands });
    } else {
      res.json({ hands: [] });
    }
  } catch (error) {
    console.error('Error reading hands:', error);
    res.status(500).json({ error: 'Failed to read stored hands' });
  }
});

// Save hands (merge with existing)
app.post('/api/hands', (req, res) => {
  try {
    const { hands } = req.body;
    if (!Array.isArray(hands)) {
      return res.status(400).json({ error: 'Hands must be an array' });
    }

    // Get existing hands
    let existingHands = [];
    if (fs.existsSync(handsFilePath)) {
      const content = fs.readFileSync(handsFilePath, 'utf8');
      existingHands = content.split('\n').filter(hand => hand.trim() !== '');
    }

    // Merge with new hands and deduplicate
    const allHands = new Set([...existingHands, ...hands]);
    const sortedHands = Array.from(allHands).sort();

    // Save to file
    fs.writeFileSync(handsFilePath, sortedHands.join('\n'));

    res.json({
      message: 'Hands saved successfully',
      totalHands: sortedHands.length,
      newHands: hands.length
    });
  } catch (error) {
    console.error('Error saving hands:', error);
    res.status(500).json({ error: 'Failed to save hands' });
  }
});

// ── 4-Snap Table ─────────────────────────────────────────────────────
// A shutter press can send several nearby camera frames. The ML service
// evaluates them in one batch; the pure aggregator favors cards that are
// stable across frames and returns a 12- or 16-card capture candidate.
app.post('/api/four-snap/detect', upload.array('images', 7), async (req, res) => {
  const startedAt = Date.now();
  const tempImagePaths = [];

  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Provide at least one image using the images form field',
      });
    }

    const formData = new FormData();
    for (const file of files) {
      const imagePath = path.join(uploadDir, file.filename);
      tempImagePaths.push(imagePath);
      const imageBuffer = fs.readFileSync(imagePath);
      formData.append(
        'images',
        new Blob([imageBuffer], { type: file.mimetype || 'image/jpeg' }),
        file.originalname || 'frame.jpg',
      );
    }

    const parsedConfidence = Number.parseFloat(req.query.confidence);
    const confidence = Number.isFinite(parsedConfidence) ? parsedConfidence : 0.35;
    const mlResponse = await fetch(
      `${ML_SERVICE_URL}/recognize-burst?confidence=${confidence}`,
      { method: 'POST', body: formData },
    );

    if (!mlResponse.ok) {
      const details = await mlResponse.text();
      return res.status(mlResponse.status).json({
        success: false,
        error: `ML service error: ${mlResponse.statusText}`,
        details,
      });
    }

    const mlResult = await mlResponse.json();
    const aggregation = aggregateBurst(
      mlResult.frames,
      req.body && req.body.expectedCount,
    );

    return res.json({
      success: true,
      ...aggregation,
      processingTimeMs: mlResult.processingTimeMs,
      totalProcessingTimeMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (
      error
      && (error.code === 'ECONNREFUSED' || (error.cause && error.cause.code === 'ECONNREFUSED'))
    ) {
      return res.status(503).json({
        success: false,
        error: 'ML service unavailable',
        message: 'Start the ML inference server with: npm run ml:server',
      });
    }
    if (error && /expectedCount must be/.test(error.message)) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({
      success: false,
      error: 'Four-snap detection failed',
      message: error && error.message ? error.message : String(error),
    });
  } finally {
    for (const imagePath of tempImagePaths) {
      fs.unlink(imagePath, () => {});
    }
  }
});

// Compose four reviewed 12-card snaps into the hand creator's 52-character
// alpha representation. An explicit four-card kitty produces a complete
// pangram; otherwise the final four positions remain "____".
app.post('/api/four-snap/complete', (req, res) => {
  const { snaps, kittyCards } = req.body || {};
  const result = composeFourSnapDeck(snaps, kittyCards);
  if (!result.url) {
    return res.status(400).json({
      success: false,
      url: null,
      errors: result.errors,
    });
  }
  return res.json({ success: true, ...result });
});

// ── Game Mode upload ─────────────────────────────────────────────────
// Session-aware upload: 4 players each post their hand photo tagged
// with a seat (dealer|bid1|bid2|bid3) and a shared session code.
// Runs ML detection on the image, then defers session coordination to
// gameMode.registerUpload. When 4 seats complete within the 10-minute
// window, the reconstructed deck URL is returned and a zip is written
// to GAME_MODE_STORAGE.
app.post('/api/game-mode/upload', upload.single('image'), async (req, res) => {
  let tempImagePath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file provided' });
    }
    const seat = req.body.seat;
    const pos = req.body.pos !== undefined && req.body.pos !== '' ? parseInt(req.body.pos, 10) : undefined;
    const sessionCode = req.body.session || null;
    if (!seat && pos === undefined) {
      return res.status(400).json({ success: false, error: 'seat (dealer|bid1|bid2|bid3) or pos (0-3) is required' });
    }

    tempImagePath = path.join(uploadDir, req.file.filename);
    const imageBuffer = fs.readFileSync(tempImagePath);
    const imageExt = path.extname(req.file.originalname).replace('.', '') || 'png';

    // Forward to ML service for card detection. Native undici FormData —
    // the npm form-data package's stream is rejected by FastAPI when sent
    // through Node's built-in fetch ("There was an error parsing the body").
    const fd = new FormData();
    fd.append(
      'image',
      new Blob([imageBuffer], { type: req.file.mimetype || 'image/jpeg' }),
      req.file.originalname || 'photo.jpg',
    );
    const confidence = parseFloat(req.query.confidence) || 0.5;
    const mlResponse = await fetch(
      `${ML_SERVICE_URL}/recognize?confidence=${confidence}`,
      { method: 'POST', body: fd },
    );
    if (!mlResponse.ok) {
      const errorText = await mlResponse.text();
      return res.status(mlResponse.status).json({
        success: false,
        error: `ML service error: ${mlResponse.statusText}`,
        details: errorText,
      });
    }
    const mlJson = await mlResponse.json();
    // The ML service returns card OBJECTS ({rank_name, suit, ...});
    // everything downstream (display, EDIT, deck reconstruction) needs
    // '10h'-style strings.
    const cards = normalizeMlCards(mlJson.cards || []);

    const result = gameMode.registerUpload({
      sessionCode,
      seat,
      pos,
      cards,
      imageBuffer,
      imageExt,
    });

    res.json({
      success: result.status !== 'error',
      status: result.status,
      session: result.session,
      seat: result.seat || seat,
      seatRole: result.seat || seat,
      pos: result.pos !== undefined ? result.pos : (pos ?? null),
      dealerPos: result.dealerPos !== undefined ? result.dealerPos : gameMode.getDealerPos(),
      detectedCards: cards,
      seatsFilled: result.seatsFilled,
      seatsMissing: result.seatsMissing,
      url: result.url,
      zipPath: result.zipPath,
      errors: result.errors,
    });
  } catch (e) {
    if (e && (e.code === 'ECONNREFUSED' || (e.cause && e.cause.code === 'ECONNREFUSED'))) {
      return res.status(503).json({
        success: false,
        error: 'ML service unavailable',
        message: 'Start the ML inference server with: npm run ml:server',
      });
    }
    res.status(500).json({ success: false, error: String(e && e.message || e) });
  } finally {
    if (tempImagePath) {
      fs.unlink(tempImagePath, () => {});
    }
  }
});

// Table state for phones + host screen: current dealer position, the
// pos→role mapping for this hand, and live seat-fill status. Never 404s.
app.get('/api/game-mode/table', (req, res) => {
  try {
    const status = gameMode.getSessionStatus(req.query.session || null);
    res.json({
      success: true,
      dealerPos: gameMode.getDealerPos(),
      posRoles: gameMode.posRoles(),
      session: status ? status.session : null,
      seatsFilled: status ? status.seatsFilled : [],
      seatsMissing: status ? status.seatsMissing : ['dealer', 'bid1', 'bid2', 'bid3'],
    });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e && e.message || e) });
  }
});

// Set who is dealing THIS hand (host screen). Rotates automatically
// after each completed/archived hand.
app.post('/api/game-mode/dealer', (req, res) => {
  try {
    const pos = parseInt(req.body && req.body.pos, 10);
    gameMode.setDealerPos(pos);
    res.json({ success: true, dealerPos: gameMode.getDealerPos(), posRoles: gameMode.posRoles() });
  } catch (e) {
    res.status(400).json({ success: false, error: String(e && e.message || e) });
  }
});

// Rounds history: every completed/archived hand, newest first.
app.get('/api/game-mode/rounds', (req, res) => {
  try {
    res.json({ success: true, rounds: gameMode.getRounds() });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e && e.message || e) });
  }
});

// Status lookup for a session
app.get('/api/game-mode/session/:code', (req, res) => {
  const status = gameMode.getSessionStatus(req.params.code);
  if (!status) return res.status(404).json({ success: false, error: 'session not found or expired' });
  res.json({ success: true, ...status });
});

// Frontend config probe — tells the UI whether to show the session-code
// field. Single-session mode (default) hides it; multi-session shows it.
app.get('/api/game-mode/config', (req, res) => {
  res.json({
    success: true,
    multiSession: gameMode.isMultiSession(),
    storageDir: gameMode.STORAGE_DIR,
  });
});

// Returns a URL that phones on the local LAN can scan (via QR code) to
// reach the Upload page. Prefers GAME_MODE_HOST_URL env override; falls
// back to the server's first external IPv4 interface on PORT.
app.get('/api/game-mode/host-url', (req, res) => {
  if (process.env.GAME_MODE_HOST_URL) {
    return res.json({ success: true, url: process.env.GAME_MODE_HOST_URL });
  }
  let lanIp = null;
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        lanIp = iface.address;
        break;
      }
    }
    if (lanIp) break;
  }
  res.json({
    success: true,
    url: `http://${lanIp || 'localhost'}:${PORT}/upload`,
    lanIp,
  });
});

// WiFi credentials for the offline / ad-hoc hotspot setup. Returns the
// SSID and password (set via env vars HOTSPOT_SSID/HOTSPOT_PASSWORD —
// typically by scripts/start-hotspot.sh) plus a qrPayload formatted
// per the standard WIFI: URI so phones offer to join on scan. When
// either var is unset, configured=false and the client hides the
// "join WiFi" QR.
app.get('/api/game-mode/wifi', (req, res) => {
  const ssid = process.env.HOTSPOT_SSID;
  const password = process.env.HOTSPOT_PASSWORD;
  const auth = process.env.HOTSPOT_AUTH || 'WPA';
  if (!ssid) {
    return res.json({ success: true, configured: false });
  }
  // WIFI URI escapes: \;,":
  const esc = (s) => String(s).replace(/([\\;,":])/g, '\\$1');
  const passPart = password ? `;P:${esc(password)}` : '';
  const authPart = password ? `T:${esc(auth)};` : 'T:nopass;';
  const qrPayload = `WIFI:${authPart}S:${esc(ssid)}${passPart};;`;
  res.json({
    success: true,
    configured: true,
    ssid,
    password: password || '',
    auth,
    qrPayload,
  });
});

// Replace the cards for an already-uploaded seat with a corrected list
// from the Hand Creator. Server preserves the original detection so the
// final zip can emit detection_mods.txt.
app.post('/api/game-mode/correct', (req, res) => {
  const { session = null, seat, pos, cards } = req.body || {};
  const posNum = pos !== undefined && pos !== null && pos !== '' ? parseInt(pos, 10) : undefined;
  const result = gameMode.correctSeat({ sessionCode: session, seat, pos: posNum, cards });
  res.json({ success: result.status !== 'error', ...result });
});

// New hand — archive the current session's uploads as a partial zip
// (if 2+ seats filled) and clear the session. Missing seats' positions
// and the kitty all fill with '_'.
app.post('/api/game-mode/new-hand', (req, res) => {
  const sessionCode = (req.body && req.body.session) || null;
  const result = gameMode.newHand(sessionCode);
  res.json({
    success: result.status !== 'error',
    status: result.status,
    session: result.session,
    seatsFilled: result.seatsFilled,
    url: result.url,
    zipPath: result.zipPath,
    errors: result.errors,
  });
});

// Card recognition endpoint - forwards to ML service
app.post('/api/recognize', upload.single('image'), async (req, res) => {
  const startTime = Date.now();

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }

    // Read the uploaded file
    const imagePath = path.join(uploadDir, req.file.filename);
    const imageBuffer = fs.readFileSync(imagePath);

    // Create form data for ML service (native undici FormData — the npm
    // form-data package's stream is rejected by FastAPI via Node fetch)
    const fd = new FormData();
    fd.append(
      'image',
      new Blob([imageBuffer], { type: req.file.mimetype || 'image/jpeg' }),
      req.file.originalname || 'photo.jpg'
    );

    // Get confidence threshold from query param (default 0.5)
    const confidence = parseFloat(req.query.confidence) || 0.5;

    // Forward to ML service
    const mlResponse = await fetch(
      `${ML_SERVICE_URL}/recognize?confidence=${confidence}`,
      {
        method: 'POST',
        body: fd
      }
    );

    // Clean up uploaded file
    fs.unlink(imagePath, (err) => {
      if (err) console.error('Failed to clean up temp file:', err);
    });

    if (!mlResponse.ok) {
      const errorText = await mlResponse.text();
      console.error(`ML service error (${mlResponse.status}):`, errorText);
      return res.status(mlResponse.status).json({
        success: false,
        error: `ML service error: ${mlResponse.statusText}`,
        details: errorText
      });
    }

    const mlResult = await mlResponse.json();

    // Add total processing time (including network overhead)
    const totalTime = Date.now() - startTime;

    res.json({
      ...mlResult,
      totalProcessingTimeMs: totalTime
    });

  } catch (error) {
    console.error('Recognition error:', error);

    // Check if ML service is unavailable
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        error: 'ML service unavailable',
        message: 'Start the ML inference server with: npm run ml:server'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Recognition failed',
      message: error.message
    });
  }
});

// Store recent detections for reporting (in-memory, keyed by filename)
const recentDetections = new Map();

// Direct card detection using local model
app.post('/api/detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const imagePath = path.join(uploadDir, req.file.filename);
    const modelPath = path.join(__dirname, '../models/card_detector_best.pt');

    // Check if model exists
    if (!fs.existsSync(modelPath)) {
      fs.unlink(imagePath, () => {});
      return res.status(500).json({ error: 'Model not found. Run training first.' });
    }

    // Get image dimensions using sharp
    let imageWidth, imageHeight;
    try {
      const metadata = await sharp(imagePath).metadata();
      imageWidth = metadata.width;
      imageHeight = metadata.height;
    } catch (err) {
      console.error('Failed to get image dimensions:', err);
      imageWidth = 0;
      imageHeight = 0;
    }

    // Run Python detection script with bbox output
    const python = spawn('python', ['-c', `
import sys
import json
from pathlib import Path
from ultralytics import YOLO

model = YOLO(r'${modelPath.replace(/\\/g, '\\\\')}')
results = model.predict(r'${imagePath.replace(/\\/g, '\\\\')}', conf=0.25, verbose=False)

cards = []
for result in results:
    for box in result.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        name = result.names[cls_id]
        # Get bbox as [x1, y1, x2, y2] in pixel coordinates
        bbox = box.xyxy[0].tolist()
        cards.append({
            'name': name,
            'confidence': conf,
            'bbox': [round(x, 1) for x in bbox]
        })

cards.sort(key=lambda x: -x['confidence'])
card_names = [c['name'] for c in cards]

print(json.dumps({
    'cards': card_names,
    'count': len(cards),
    'detections': cards
}))
`]);

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        fs.unlink(imagePath, () => {});
        console.error('Detection error:', errorOutput);
        return res.status(500).json({ error: 'Detection failed', details: errorOutput });
      }

      try {
        const result = JSON.parse(output.trim());

        const detectionId = req.file.filename;

        if (autoSaveForRetraining) {
          // Auto-save: copy to labeling directory for retraining
          const labelingFilename = `${Date.now()}_${path.basename(imagePath)}`;
          const labelingPath = path.join(labelingDir, labelingFilename);
          try {
            fs.copyFileSync(imagePath, labelingPath);
            const metaPath = labelingPath.replace(/\.[^.]+$/, '_meta.json');
            fs.writeFileSync(metaPath, JSON.stringify({
              originalDetections: result.detections,
              imageWidth,
              imageHeight,
              timestamp: new Date().toISOString(),
              autoSaved: true
            }, null, 2));
          } catch (err) {
            console.error('Failed to auto-save for retraining:', err);
          }
          fs.unlink(imagePath, () => {});

          res.json({
            ...result,
            detectionId,
            imageWidth,
            imageHeight,
            autoSaved: true
          });
        } else {
          // Manual mode: keep image for 10 minutes for potential reporting
          recentDetections.set(detectionId, {
            imagePath,
            imageWidth,
            imageHeight,
            detections: result.detections,
            timestamp: Date.now()
          });

          setTimeout(() => {
            const detection = recentDetections.get(detectionId);
            if (detection) {
              recentDetections.delete(detectionId);
              fs.unlink(detection.imagePath, () => {});
            }
          }, 10 * 60 * 1000);

          res.json({
            ...result,
            detectionId,
            imageWidth,
            imageHeight,
            autoSaved: false
          });
        }
      } catch (parseError) {
        fs.unlink(imagePath, () => {});
        console.error('Parse error:', output);
        res.status(500).json({ error: 'Failed to parse detection results' });
      }
    });

  } catch (error) {
    console.error('Detection error:', error);
    res.status(500).json({ error: 'Detection failed', message: error.message });
  }
});

// Label Studio endpoints

// Check Label Studio status
app.get('/api/label-studio/status', async (req, res) => {
  try {
    const status = await labelStudio.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Setup Label Studio with API key
app.post('/api/label-studio/setup', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    const result = await labelStudio.setup(apiKey);
    res.json({
      success: true,
      message: 'Label Studio configured successfully',
      ...result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve labeling images statically
app.use('/labeling', express.static(labelingDir));

// Report incorrect detection
app.post('/api/label-studio/report', async (req, res) => {
  try {
    const { detectionId } = req.body;
    if (!detectionId) {
      return res.status(400).json({ error: 'Detection ID is required' });
    }

    // Get stored detection info
    const detection = recentDetections.get(detectionId);
    if (!detection) {
      return res.status(404).json({
        error: 'Detection not found or expired. Please re-upload the image.'
      });
    }

    // Check Label Studio status
    const status = await labelStudio.getStatus();
    if (!status.running) {
      return res.status(503).json({
        error: 'Label Studio is not running. Start it with: npm run label-studio'
      });
    }

    // Copy image to labeling directory with detection info
    const labelingFilename = `${Date.now()}_${path.basename(detection.imagePath)}`;
    const labelingPath = path.join(labelingDir, labelingFilename);
    fs.copyFileSync(detection.imagePath, labelingPath);

    // Save detection metadata for reference
    const metaPath = labelingPath.replace(/\.[^.]+$/, '_meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      originalDetections: detection.detections,
      imageWidth: detection.imageWidth,
      imageHeight: detection.imageHeight,
      timestamp: new Date().toISOString()
    }, null, 2));

    // Try API-based task creation first
    const config = labelStudio.loadConfig();
    if (config.refreshToken && status.projectId) {
      try {
        const imageUrl = `http://localhost:3001/labeling/${labelingFilename}`;
        const task = await labelStudio.createTask(
          status.projectId,
          imageUrl,
          detection.detections,
          detection.imageWidth,
          detection.imageHeight
        );

        return res.json({
          success: true,
          message: 'Task created in Label Studio',
          taskUrl: task.taskUrl,
          taskId: task.taskId
        });
      } catch (apiError) {
        console.log('API task creation failed, falling back to manual import:', apiError.message);
      }
    }

    // Fallback: Manual import flow
    const projectId = config.projectId || 10;
    res.json({
      success: true,
      message: 'Image ready for Label Studio import',
      manualImport: true,
      imageUrl: `http://localhost:3001/labeling/${labelingFilename}`,
      importUrl: `http://localhost:8080/projects/${projectId}/data?tab=13`,
      instructions: 'Click the import URL, then add the image URL to import it'
    });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check ML service health
app.get('/api/recognize/health', async (req, res) => {
  try {
    const mlResponse = await fetch(`${ML_SERVICE_URL}/health`);
    const mlHealth = await mlResponse.json();

    res.json({
      status: 'ok',
      mlService: mlHealth,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      status: 'degraded',
      mlService: { status: 'unavailable', error: error.message },
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large (max 10MB)' });
    }
  }
  
  res.status(500).json({ error: error.message || 'Internal server error' });
});

// SPA fallback: any non-/api GET that hasn't matched serves index.html
// so React Router can handle client-side routes (/settings, /upload, etc.)
if (hasBuild) {
  app.get(/^(?!\/api\b|\/socket\.io\b|\/ios\b).*$/, (req, res) => {
    res.sendFile(path.join(buildDir, 'index.html'));
  });
}

const server = http.createServer(app);

const announcer = new Announcer({
  configPath: ANNOUNCE_CONFIG_PATH,
  wordlistPath: ANNOUNCE_WORDLIST_PATH,
});

initMultiplayer(server, {
  announcer,
  hostUrl: () => PUBLIC_URL,
});
gameMode.startCleanupTimer();

server.listen(PORT, () => {
  console.log(`Hearts Card Capture API server running on port ${PORT}`);
  console.log(`Upload endpoint: http://localhost:${PORT}/api/upload`);
  console.log(`iOS app download: http://localhost:${PORT}/ios/download`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Multiplayer: socket.io enabled`);
  console.log(`Game Mode storage: ${gameMode.STORAGE_DIR}`);
  console.log(`Signal announcer: ${announcer.adapterName}`);
});
