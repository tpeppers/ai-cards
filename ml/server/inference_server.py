#!/usr/bin/env python3
"""FastAPI inference server for playing-card recognition."""

import io
from pathlib import Path
from typing import List, Optional

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps

from card_detection import detect_image, detect_images


SCRIPT_DIR = Path(__file__).parent.absolute()
MODELS_DIR = SCRIPT_DIR.parent / "models"
DEFAULT_MODEL = MODELS_DIR / "card_detector_best.pt"

app = FastAPI(
    title="Card Recognition API",
    description="YOLO11-powered playing card detection service",
    version="2.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Loaded once at process startup and shared by single-frame and burst routes.
model = None


@app.on_event("startup")
async def load_model():
    """Load the promoted detector at startup."""
    global model

    if not DEFAULT_MODEL.exists():
        print(f"WARNING: Model not found at {DEFAULT_MODEL}")
        print("Server will start but recognition endpoints will fail.")
        print("Train a model first using: python scripts/train.py")
        return

    try:
        from ultralytics import YOLO

        print(f"Loading model from: {DEFAULT_MODEL}")
        model = YOLO(str(DEFAULT_MODEL))
        print("Model loaded successfully!")
    except Exception as error:
        print(f"ERROR loading model: {error}")


@app.get("/")
async def root():
    return {
        "service": "Card Recognition API",
        "version": "2.1.0",
        "endpoints": {
            "POST /recognize": "Recognize cards in one uploaded image",
            "POST /recognize-burst": "Recognize cards across 1-7 burst frames",
            "GET /health": "Health check endpoint",
        },
    }


@app.get("/health")
async def health_check():
    return {
        "status": "ok" if model is not None else "model_not_loaded",
        "model_loaded": model is not None,
        "model_path": str(DEFAULT_MODEL) if DEFAULT_MODEL.exists() else None,
    }


def decode_uploaded_image(contents: bytes) -> Image.Image:
    """Decode, orient, and normalize a browser-uploaded image."""
    image = Image.open(io.BytesIO(contents))

    # iPhone portrait images commonly carry orientation only in EXIF.
    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        image = image.convert("RGB")
    return image


def clamp_confidence(confidence: Optional[float]) -> float:
    value = 0.5 if confidence is None else confidence
    return max(0.1, min(0.99, value))


def require_model():
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Train a model first using: python scripts/train.py",
        )
    return model


@app.post("/recognize")
async def recognize_cards(
    image: UploadFile = File(...),
    confidence: Optional[float] = 0.5,
):
    """Recognize playing cards in one uploaded image."""
    loaded_model = require_model()
    confidence = clamp_confidence(confidence)

    try:
        decoded_image = decode_uploaded_image(await image.read())
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Invalid image: {error}")

    try:
        result = detect_image(loaded_model, decoded_image, confidence)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Inference failed: {error}")

    return {"success": True, **result}


@app.post("/recognize-burst")
async def recognize_card_burst(
    images: List[UploadFile] = File(...),
    confidence: Optional[float] = 0.35,
):
    """Run one batched inference call over frames around a shutter press."""
    loaded_model = require_model()
    confidence = clamp_confidence(confidence)

    if not images or len(images) > 7:
        raise HTTPException(status_code=400, detail="Provide between 1 and 7 images")

    decoded_images = []
    for index, upload in enumerate(images):
        try:
            decoded_images.append(decode_uploaded_image(await upload.read()))
        except Exception as error:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid image at frame {index}: {error}",
            )

    try:
        result = detect_images(loaded_model, decoded_images, confidence)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Inference failed: {error}")

    return {"success": True, **result}


def main():
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
        log_level="info",
    )


if __name__ == "__main__":
    main()
