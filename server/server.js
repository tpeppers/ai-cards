const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

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