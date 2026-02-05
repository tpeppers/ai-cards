const fs = require('fs');
const path = require('path');

const LABEL_STUDIO_URL = process.env.LABEL_STUDIO_URL || 'http://localhost:8080';
const CONFIG_PATH = path.join(__dirname, 'config.json');

// In-memory cache for access token
let cachedAccessToken = null;
let accessTokenExpiry = 0;

// Load config from file
function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  return {};
}

// Save config to file
function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Get a valid access token (refresh if needed)
async function getAccessToken() {
  const config = loadConfig();
  if (!config.refreshToken) {
    throw new Error('No refresh token configured');
  }

  // Check if cached token is still valid (with 60s buffer)
  if (cachedAccessToken && Date.now() < accessTokenExpiry - 60000) {
    return cachedAccessToken;
  }

  // Refresh the token
  const response = await fetch(`${LABEL_STUDIO_URL}/api/token/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh: config.refreshToken })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh token: ${error}`);
  }

  const data = await response.json();
  cachedAccessToken = data.access;

  // Parse JWT to get expiry (tokens typically last 5 minutes)
  try {
    const payload = JSON.parse(Buffer.from(data.access.split('.')[1], 'base64').toString());
    accessTokenExpiry = payload.exp * 1000; // Convert to milliseconds
  } catch (e) {
    // Default to 4 minutes from now if parsing fails
    accessTokenExpiry = Date.now() + 4 * 60 * 1000;
  }

  return cachedAccessToken;
}

// Make authenticated request to Label Studio
async function authFetch(url, options = {}) {
  const accessToken = await getAccessToken();
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${accessToken}`
  };
  return fetch(url, { ...options, headers });
}

// Check if Label Studio is running
async function checkHealth() {
  try {
    const response = await fetch(`${LABEL_STUDIO_URL}/health`);
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Get or create project for card labeling
async function ensureProject() {
  const config = loadConfig();

  // Check if we already have a project
  if (config.projectId) {
    // Verify project still exists
    try {
      const response = await authFetch(`${LABEL_STUDIO_URL}/api/projects/${config.projectId}`);
      if (response.ok) {
        return config.projectId;
      }
    } catch (error) {
      // Project doesn't exist, create new one
    }
  }

  // Read labeling config XML
  const labelConfigPath = path.join(__dirname, 'labelStudioConfig.xml');
  const labelConfig = fs.readFileSync(labelConfigPath, 'utf8');

  // Create new project
  const response = await authFetch(`${LABEL_STUDIO_URL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Card Detection Corrections',
      description: 'User-reported incorrect card detections for model improvement',
      label_config: labelConfig
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create project: ${error}`);
  }

  const project = await response.json();

  // Save project ID to config
  config.projectId = project.id;
  saveConfig(config);

  return project.id;
}

// Convert pixel bbox [x1, y1, x2, y2] to Label Studio percentage format
function convertBboxToLabelStudio(bbox, imageWidth, imageHeight) {
  const [x1, y1, x2, y2] = bbox;

  return {
    x: (x1 / imageWidth) * 100,
    y: (y1 / imageHeight) * 100,
    width: ((x2 - x1) / imageWidth) * 100,
    height: ((y2 - y1) / imageHeight) * 100
  };
}

// Create a task in Label Studio with pre-annotations
async function createTask(projectId, imageUrl, predictions, imageWidth, imageHeight) {
  // Convert predictions to Label Studio format
  const preannotations = predictions.map((pred, idx) => {
    const lsBbox = convertBboxToLabelStudio(pred.bbox, imageWidth, imageHeight);

    return {
      id: `pred_${idx}`,
      type: 'rectanglelabels',
      from_name: 'label',
      to_name: 'image',
      original_width: imageWidth,
      original_height: imageHeight,
      value: {
        x: lsBbox.x,
        y: lsBbox.y,
        width: lsBbox.width,
        height: lsBbox.height,
        rotation: 0,
        rectanglelabels: [pred.name]
      }
    };
  });

  // Create task with pre-annotation
  const response = await authFetch(`${LABEL_STUDIO_URL}/api/projects/${projectId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      data: {
        image: imageUrl
      },
      predictions: [{
        model_version: 'card_detector_v1',
        result: preannotations
      }]
    }])
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create task: ${error}`);
  }

  const result = await response.json();
  const taskId = result[0]?.id;

  return {
    taskId,
    taskUrl: `${LABEL_STUDIO_URL}/projects/${projectId}/data?task=${taskId}`
  };
}

// Get status including configured state
async function getStatus() {
  const isRunning = await checkHealth();
  const config = loadConfig();

  return {
    running: isRunning,
    configured: !!(config.refreshToken && config.projectId),
    projectId: config.projectId || null,
    url: LABEL_STUDIO_URL
  };
}

// Setup Label Studio with refresh token
async function setup(refreshToken) {
  const isRunning = await checkHealth();
  if (!isRunning) {
    throw new Error('Label Studio is not running. Start it with: npm run label-studio');
  }

  // Save refresh token first so getAccessToken works
  const config = loadConfig();
  config.refreshToken = refreshToken;
  saveConfig(config);

  // Clear cached access token
  cachedAccessToken = null;
  accessTokenExpiry = 0;

  // Test the token by getting an access token
  try {
    await getAccessToken();
  } catch (error) {
    // Remove invalid token
    delete config.refreshToken;
    saveConfig(config);
    throw new Error('Invalid token: ' + error.message);
  }

  // Ensure project exists
  const projectId = await ensureProject();

  return {
    projectId,
    url: LABEL_STUDIO_URL
  };
}

module.exports = {
  checkHealth,
  ensureProject,
  createTask,
  convertBboxToLabelStudio,
  getStatus,
  setup,
  loadConfig,
  LABEL_STUDIO_URL
};
