#!/usr/bin/env python3
"""
FastAPI inference server for card recognition.
Loads YOLOv11 model and exposes /recognize endpoint.
"""

import io
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps


# Paths relative to this script
SCRIPT_DIR = Path(__file__).parent.absolute()
MODELS_DIR = SCRIPT_DIR.parent / "models"
DEFAULT_MODEL = MODELS_DIR / "card_detector_best.pt"

# Alpha encoding mapping (matches src/urlGameState.js)
# Class 0-12: Hearts A-K (alpha: a-m)
# Class 13-25: Spades A-K (alpha: n-z)
# Class 26-38: Clubs A-K (alpha: A-M)
# Class 39-51: Diamonds A-K (alpha: N-Z)

CLASS_TO_ALPHA = {}
# Hearts: classes 0-12 -> a-m
for i in range(13):
    CLASS_TO_ALPHA[i] = chr(ord('a') + i)
# Spades: classes 13-25 -> n-z
for i in range(13):
    CLASS_TO_ALPHA[13 + i] = chr(ord('n') + i)
# Clubs: classes 26-38 -> A-M
for i in range(13):
    CLASS_TO_ALPHA[26 + i] = chr(ord('A') + i)
# Diamonds: classes 39-51 -> N-Z
for i in range(13):
    CLASS_TO_ALPHA[39 + i] = chr(ord('N') + i)

CLASS_TO_INFO = {}
suits = ['hearts', 'spades', 'clubs', 'diamonds']
ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
for suit_idx, suit in enumerate(suits):
    for rank_idx, rank in enumerate(ranks):
        class_id = suit_idx * 13 + rank_idx
        CLASS_TO_INFO[class_id] = {
            'suit': suit,
            'rank': rank_idx + 1,
            'rank_name': rank
        }


# FastAPI app
app = FastAPI(
    title="Card Recognition API",
    description="YOLOv11-powered playing card detection service",
    version="2.0.0"
)

# CORS middleware for cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model instance (loaded at startup)
model = None


@app.on_event("startup")
async def load_model():
    """Load YOLOv11 model at startup."""
    global model

    if not DEFAULT_MODEL.exists():
        print(f"WARNING: Model not found at {DEFAULT_MODEL}")
        print("Server will start but /recognize endpoint will fail.")
        print("Train a model first using: python scripts/train.py")
        return

    try:
        from ultralytics import YOLO
        print(f"Loading model from: {DEFAULT_MODEL}")
        model = YOLO(str(DEFAULT_MODEL))
        print("Model loaded successfully!")
    except Exception as e:
        print(f"ERROR loading model: {e}")


@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "service": "Card Recognition API",
        "version": "1.0.0",
        "endpoints": {
            "POST /recognize": "Recognize cards in an uploaded image",
            "POST /recognize-video": "Sample a video and stream per-frame detections (NDJSON)",
            "GET /health": "Health check endpoint"
        }
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok" if model is not None else "model_not_loaded",
        "model_loaded": model is not None,
        "model_path": str(DEFAULT_MODEL) if DEFAULT_MODEL.exists() else None
    }


@app.post("/recognize")
async def recognize_cards(
    image: UploadFile = File(...),
    confidence: Optional[float] = 0.5
):
    """
    Recognize playing cards in an uploaded image.

    Args:
        image: Image file (JPEG, PNG, etc.)
        confidence: Minimum confidence threshold (0.0-1.0)

    Returns:
        JSON with hand (alpha string), cards (detailed list), and timing info
    """
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Train a model first using: python scripts/train.py"
        )

    # Validate confidence
    confidence = max(0.1, min(0.99, confidence))

    start_time = time.time()

    try:
        # Read and validate image
        contents = await image.read()
        img = Image.open(io.BytesIO(contents))

        # Apply EXIF orientation: iPhone portrait photos carry a rotation
        # tag that PIL/Ultralytics do NOT auto-apply — without this the
        # model sees the hand sideways (measured: 6 detections -> 2 on a
        # real portrait photo).
        img = ImageOps.exif_transpose(img)

        # Convert to RGB if necessary (handle PNG with alpha, etc.)
        if img.mode != 'RGB':
            img = img.convert('RGB')

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {str(e)}")

    # Run inference
    try:
        results = model(img, conf=confidence, verbose=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference failed: {str(e)}")

    # Process results
    detected_cards = []

    for result in results:
        boxes = result.boxes
        for i in range(len(boxes)):
            class_id = int(boxes.cls[i].item())
            conf = float(boxes.conf[i].item())
            bbox = boxes.xyxy[i].tolist()

            if class_id in CLASS_TO_ALPHA:
                alpha = CLASS_TO_ALPHA[class_id]
                info = CLASS_TO_INFO[class_id]

                detected_cards.append({
                    'alpha': alpha,
                    'suit': info['suit'],
                    'rank': info['rank'],
                    'rank_name': info['rank_name'],
                    'confidence': round(conf, 3),
                    'bbox': [round(x, 1) for x in bbox]
                })

    # Sort by confidence descending, then deduplicate (keep highest confidence per card)
    detected_cards.sort(key=lambda x: x['confidence'], reverse=True)

    seen_alphas = set()
    unique_cards = []
    for card in detected_cards:
        if card['alpha'] not in seen_alphas:
            seen_alphas.add(card['alpha'])
            unique_cards.append(card)

    # Sort by suit order (hearts, spades, clubs, diamonds) then rank
    suit_order = {'hearts': 0, 'spades': 1, 'clubs': 2, 'diamonds': 3}
    unique_cards.sort(key=lambda x: (suit_order[x['suit']], x['rank']))

    # Build alpha string
    alpha_string = ''.join(card['alpha'] for card in unique_cards)

    processing_time = int((time.time() - start_time) * 1000)

    return {
        'success': True,
        'hand': alpha_string,
        'cards': unique_cards,
        'totalDetections': len(detected_cards),
        'uniqueCards': len(unique_cards),
        'processingTimeMs': processing_time,
        # Every box, both corners of a card included, plus the image size
        # the boxes are measured in (the table tracker places cards by them).
        'detections': _frame_detections(results, confidence),
        'imageWidth': img.width,
        'imageHeight': img.height,
    }


def _frame_detections(results, confidence):
    """Raw per-box detections (no per-card dedup: the table tracker wants
    both index corners of a card so it can find the card's centre)."""
    out = []
    for result in results:
        boxes = result.boxes
        for i in range(len(boxes)):
            class_id = int(boxes.cls[i].item())
            conf = float(boxes.conf[i].item())
            if class_id not in CLASS_TO_ALPHA or conf < confidence:
                continue
            out.append({
                'alpha': CLASS_TO_ALPHA[class_id],
                'confidence': round(conf, 3),
                'bbox': [round(x, 1) for x in boxes.xyxy[i].tolist()],
            })
    return out


@app.post("/recognize-video")
async def recognize_video(
    video: UploadFile = File(...),
    fps: Optional[float] = 3.0,
    confidence: Optional[float] = 0.4,
    max_side: Optional[int] = 1280,
):
    """
    Sample a recorded table video at `fps` frames per second and stream one
    JSON line per sampled frame:
        {"t": seconds, "width": w, "height": h, "detections": [...]}
    preceded by {"type": "meta", "duration": s, "frames": n} and followed by
    {"type": "done"} (or {"type": "error", "error": ...}). Streaming keeps
    long videos from tripping HTTP timeouts and lets the caller show progress.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded.")
    try:
        import cv2
    except ImportError:
        raise HTTPException(status_code=503, detail="opencv-python is required for video (pip install opencv-python)")

    fps = max(0.25, min(15.0, fps or 3.0))
    confidence = max(0.05, min(0.99, confidence or 0.4))
    max_side = max(320, min(3840, max_side or 1280))

    suffix = os.path.splitext(video.filename or '')[1] or '.mp4'
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        shutil.copyfileobj(video.file, tmp)
    finally:
        tmp.close()

    cap = cv2.VideoCapture(tmp.name)
    if not cap.isOpened():
        os.unlink(tmp.name)
        raise HTTPException(status_code=400, detail="Could not open video (try H.264: iPhone Settings > Camera > Formats > Most Compatible)")

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if src_fps <= 0 or src_fps > 240:
        src_fps = 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = total / src_fps if total > 0 else 0

    def generate():
        try:
            yield json.dumps({'type': 'meta', 'duration': round(duration, 2),
                              'frames': int(duration * fps) if duration else 0}) + "\n"
            step = 1.0 / fps
            next_t = 0.0
            index = 0
            while True:
                ok = cap.grab()
                if not ok:
                    break
                # Prefer the container's timestamp (variable frame rate is
                # normal for phone recordings); fall back to frame count.
                pos_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
                t = pos_ms / 1000.0 if pos_ms and pos_ms > 0 else index / src_fps
                index += 1
                if t + 1e-6 < next_t:
                    continue
                next_t = t + step
                ok, frame = cap.retrieve()
                if not ok or frame is None:
                    continue
                h, w = frame.shape[:2]
                scale = min(1.0, max_side / float(max(h, w)))
                if scale < 1.0:
                    frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                    h, w = frame.shape[:2]
                results = model(frame, conf=confidence, verbose=False)
                yield json.dumps({'t': round(t, 2), 'width': w, 'height': h,
                                  'detections': _frame_detections(results, confidence)}) + "\n"
            yield json.dumps({'type': 'done'}) + "\n"
        except Exception as e:  # noqa: BLE001 - reported to the caller in-band
            yield json.dumps({'type': 'error', 'error': str(e)}) + "\n"
        finally:
            cap.release()
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    return StreamingResponse(generate(), media_type="application/x-ndjson")


def main():
    """Run the inference server."""
    print("=" * 60)
    print("Card Recognition Inference Server")
    print("=" * 60)
    print(f"Model path: {DEFAULT_MODEL}")
    print(f"Model exists: {DEFAULT_MODEL.exists()}")
    print()

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=3002,
        log_level="info"
    )


if __name__ == "__main__":
    main()
