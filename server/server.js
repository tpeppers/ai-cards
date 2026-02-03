const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const { spawn } = require('child_process');

// ML service configuration
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:3002';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const handsDir = path.join(__dirname, '../hands');
if (!fs.existsSync(handsDir)) {
  fs.mkdirSync(handsDir, { recursive: true });
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

    // Create form data for ML service
    const formData = new FormData();
    formData.append('image', imageBuffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Get confidence threshold from query param (default 0.5)
    const confidence = parseFloat(req.query.confidence) || 0.5;

    // Forward to ML service
    const mlResponse = await fetch(
      `${ML_SERVICE_URL}/recognize?confidence=${confidence}`,
      {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders()
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

    // Run Python detection script
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
        cards.append({'name': name, 'confidence': conf})

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
      // Clean up uploaded file
      fs.unlink(imagePath, () => {});

      if (code !== 0) {
        console.error('Detection error:', errorOutput);
        return res.status(500).json({ error: 'Detection failed', details: errorOutput });
      }

      try {
        const result = JSON.parse(output.trim());
        res.json(result);
      } catch (parseError) {
        console.error('Parse error:', output);
        res.status(500).json({ error: 'Failed to parse detection results' });
      }
    });

  } catch (error) {
    console.error('Detection error:', error);
    res.status(500).json({ error: 'Detection failed', message: error.message });
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

app.listen(PORT, () => {
  console.log(`Hearts Card Capture API server running on port ${PORT}`);
  console.log(`Upload endpoint: http://localhost:${PORT}/api/upload`);
  console.log(`iOS app download: http://localhost:${PORT}/ios/download`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});