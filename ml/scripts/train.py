#!/usr/bin/env python3
"""
Training script for YOLOv11 card recognition model.
Updated from YOLOv8 to YOLOv11.
"""

import argparse
from pathlib import Path
from ultralytics import YOLO


# Paths relative to this script
SCRIPT_DIR = Path(__file__).parent.absolute()
DATA_DIR = SCRIPT_DIR.parent / "data"
MODELS_DIR = SCRIPT_DIR.parent / "models"
DATASET_YAML = DATA_DIR / "dataset.yaml"


def train(
    epochs: int = 100,
    imgsz: int = 1280,
    batch: int = 8,
    model_size: str = "m",
    resume: bool = False,
    device: str = "0"
):
    """
    Train YOLOv11 model for card detection.

    Args:
        epochs: Number of training epochs
        imgsz: Image size for training
        batch: Batch size
        model_size: YOLOv11 model size (n, s, m, l, x)
        resume: Resume from last checkpoint
        device: CUDA device (0 for first GPU, 'cpu' for CPU)
    """
    # Ensure models directory exists
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Check dataset config exists
    if not DATASET_YAML.exists():
        print(f"ERROR: Dataset config not found: {DATASET_YAML}")
        print("Run prepare_dataset.py first and ensure labels are created.")
        return

    # Load pretrained YOLOv11 model
    model_name = f"yolo11{model_size}.pt"
    print(f"Loading pretrained model: {model_name}")
    model = YOLO(model_name)

    # Training configuration
    print(f"\nStarting training with:")
    print(f"  Dataset: {DATASET_YAML}")
    print(f"  Epochs: {epochs}")
    print(f"  Image size: {imgsz}")
    print(f"  Batch size: {batch}")
    print(f"  Device: {device}")
    print()

    # Train the model
    results = model.train(
        data=str(DATASET_YAML),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=device,
        project=str(MODELS_DIR),
        name="card_detector",
        exist_ok=True,
        resume=resume,
        # Augmentation settings good for card detection
        flipud=0.0,  # Cards shouldn't be flipped vertically
        fliplr=0.5,  # Horizontal flip is okay
        mosaic=0.5,  # Reduced mosaic for clearer card boundaries
        mixup=0.0,   # No mixup for distinct card detection
        # Performance settings
        workers=4,
        patience=20,  # Early stopping patience
        save=True,
        save_period=10,  # Save checkpoint every 10 epochs
        verbose=True,
    )

    # Copy best model to models directory root for easy access
    best_model = MODELS_DIR / "card_detector" / "weights" / "best.pt"
    if best_model.exists():
        final_model = MODELS_DIR / "card_detector_best.pt"
        import shutil
        shutil.copy2(best_model, final_model)
        print(f"\nBest model saved to: {final_model}")

    print("\nTraining complete!")
    return results


def main():
    parser = argparse.ArgumentParser(description="Train YOLOv11 card detection model")
    parser.add_argument("--epochs", type=int, default=100, help="Number of epochs")
    parser.add_argument("--imgsz", type=int, default=1280, help="Image size")
    parser.add_argument("--batch", type=int, default=8, help="Batch size")
    parser.add_argument("--model", type=str, default="m", choices=["n", "s", "m", "l", "x"],
                        help="YOLOv11 model size")
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    parser.add_argument("--device", type=str, default="0", help="CUDA device or 'cpu'")

    args = parser.parse_args()

    train(
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        model_size=args.model,
        resume=args.resume,
        device=args.device
    )


if __name__ == "__main__":
    main()
