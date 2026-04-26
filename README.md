# Hearts & Bid Whist Card Game

**[DEMO: PLAY BID-WHIST](https://tpeppers.github.io/ai-cards/)**

A full-featured trick-taking card game platform with AI opponents, multiplayer support, game analysis tools, and ML-powered card recognition from photos.

## Game Mode (self-hosted)

When Settings → Game Mode is on, the Upload page turns into a multi-player hand-capture flow:
each of 4 players uploads their photo tagged with their seat (Dealer / 1st / 2nd / 3rd bidder)
and a shared 6-character session code. When all 4 uploads arrive within a 10-minute window, the
server dedups the detected cards, verifies 48 unique across the four hands, reconstructs a
52-character deck URL (`dealer → positions 0,4,8,…,44`, bidders 1–3 → offsets 1/2/3), and
writes a zip archive named by the URL to the storage volume.

Self-host the backend with the provided Docker image:

```bash
# From repo root:
docker compose up --build
# → backend at http://localhost:3001, zips land in ./game-mode-storage/
```

ML-based card detection is a separate service (`ml/server/inference_server.py`). Set
`ML_SERVICE_URL` in `docker-compose.yml` to point at it.

### Offline / ad-hoc WiFi (Steam Deck host)

For card-table sessions with no internet, run the host (e.g. a Steam Deck in Desktop Mode)
as the WiFi access point:

```bash
# Custom SSID + password, and start the server in the same shell:
./scripts/start-hotspot.sh bidwhist-table hunter2 --serve

# Or random password, just bring up the network:
./scripts/start-hotspot.sh
# (then in another shell: HOTSPOT_SSID=… HOTSPOT_PASSWORD=… npm run server)
```

The script uses NetworkManager (`nmcli`) to host a WPA2 hotspot. With `HOTSPOT_SSID` and
`HOTSPOT_PASSWORD` set in the server's environment, the Upload page renders **two QR
codes**: Step 1 to join the WiFi (standard `WIFI:` URI), Step 2 to open the upload URL on
the host's hotspot IP. Phones scan both, hand-photo upload works with no internet involved.

Stop the hotspot with `nmcli connection down Hotspot && nmcli connection delete Hotspot`.

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide React icons
- **Backend**: Express.js, Socket.io (multiplayer), Multer (file uploads), Sharp (image processing)
- **ML Pipeline**: Python, YOLOv8 (Ultralytics), FastAPI, OpenCV, PyTorch
- **iOS App**: Swift / Xcode (camera capture for physical card hands)
- **Testing**: Jest, React Testing Library, Selenium (E2E)
- **Tooling**: Create React App, Concurrently, PostCSS, ESLint

## Prerequisites

- Node.js and npm
- Python 3 (for ML card recognition and E2E tests)
- Xcode (only for iOS development)

## Installation

```bash
npm install
```

For the ML card recognition pipeline:

```bash
npm run ml:install
```

For Selenium E2E tests:

```bash
pip install -r requirements.txt
```

## Running the App

```bash
# Web app + API server together (recommended)
npm run dev

# Web app only (port 3000)
npm start

# API server only (port 3001)
npm run server

# Full stack including ML inference server and Label Studio
npm run dev:full
```

## Games

### Hearts
- Classic trick-avoiding card game for 4 players
- Queen of Spades = 13 points, each Heart = 1 point
- Shoot the moon to give all opponents 26 points
- Configurable AI strategies

### Bid Whist
- Partnership trick-taking game (2v2)
- Bidding phase with trump selection (uptown/downtown)
- Custom strategy language (`.cstrat` files) for AI behavior
- Whisting bonus bids with themed animations

## Features

- **Multiplayer** — Socket.io-based lobbies with passphrase protection, seat swapping, and AI fill-in on disconnect
- **Strategy Comparison** — Run thousands of simulated games to compare AI strategies
- **Replay Analyzer** — Step through past games with move-by-move review
- **Table Analysis** — Evaluate hand strength with percentile rankings
- **Hand Creator** — Manually construct hands for testing scenarios
- **Settings** — Card back designs (7 SVG themes), suit colors, animation modes, sound effects
- **URL Seeding** — Share specific deals via URL hash (`#[52-letter-code]`)

## ML Card Recognition

Recognizes playing cards from photos using a YOLOv8 object detection model.

```bash
npm run ml:prepare       # Split labeled images into train/val sets
npm run ml:train         # Train YOLOv8 model
npm run ml:server        # Start inference server (port 3002)
npm run label-studio     # Start Label Studio annotation UI (port 8080)
```

The web app proxies upload requests from the Express server (3001) to the ML inference server (3002).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload card hand image for recognition |
| GET | `/api/upload/:uuid` | Get upload details by UUID |
| GET | `/api/uploads` | List all uploads |
| GET | `/health` | Server health check |

## iOS App

A companion camera app (Swift) for capturing photos of physical card hands and sending them to the server for recognition.

```bash
npm run build:ios
```

## Testing

```bash
npm test                        # Run tests in watch mode
npm test -- --watchAll=false    # Run all tests once
npm test -- -t "component"     # Run tests matching a name
```

## Build

```bash
npm run build
```
