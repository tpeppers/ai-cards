#!/usr/bin/env python3
"""Train YOLO11 or YOLO26 playing-card detection candidates."""

import argparse
from pathlib import Path
from ultralytics import YOLO


# Paths relative to this script
SCRIPT_DIR = Path(__file__).parent.absolute()
DATA_DIR = SCRIPT_DIR.parent / "data"
MODELS_DIR = SCRIPT_DIR.parent / "models"
WORKSPACE_DATASET_YAML = SCRIPT_DIR.parents[2] / "data" / "dataset.yaml"
DEFAULT_DATASET_YAML = (
    WORKSPACE_DATASET_YAML
    if WORKSPACE_DATASET_YAML.exists()
    else DATA_DIR / "dataset.yaml"
)


def train(
    epochs: int = 100,
    imgsz: int = 640,
    batch: int = 8,
    model_family: str = "yolo11",
    model_size: str = "m",
    data_yaml: Path = DEFAULT_DATASET_YAML,
    resume: bool = False,
    device: str = "0"
):
    """
    Train a YOLO card-detection candidate without replacing the deployed model.

    Args:
        epochs: Number of training epochs
        imgsz: Image size for training
        batch: Batch size
        model_family: Ultralytics model generation (yolo11 or yolo26)
        model_size: Model size (n, s, m, l, x)
        data_yaml: Dataset configuration file
        resume: Resume from last checkpoint
        device: CUDA device (0 for first GPU, 'cpu' for CPU)
    """
    # Ensure models directory exists
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Check dataset config exists
    data_yaml = data_yaml.resolve()
    if not data_yaml.exists():
        print(f"ERROR: Dataset config not found: {data_yaml}")
        print("Run prepare_dataset.py first and ensure labels are created.")
        return

    # Load an official pretrained checkpoint, then fine-tune it for cards.
    model_name = f"{model_family}{model_size}.pt"
    print(f"Loading pretrained model: {model_name}")
    model = YOLO(model_name)
    run_name = f"card_detector_{model_family}_{model_size}"

    # Training configuration
    print(f"\nStarting training with:")
    print(f"  Dataset: {data_yaml}")
    print(f"  Epochs: {epochs}")
    print(f"  Image size: {imgsz}")
    print(f"  Batch size: {batch}")
    print(f"  Device: {device}")
    print()

    # Train the model
    results = model.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=device,
        project=str(MODELS_DIR),
        name=run_name,
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
    best_model = MODELS_DIR / run_name / "weights" / "best.pt"
    if best_model.exists():
        final_model = MODELS_DIR / f"{run_name}_best.pt"
        import shutil
        shutil.copy2(best_model, final_model)
        print(f"\nBest model saved to: {final_model}")

    print("\nTraining complete!")
    return results


def main():
    parser = argparse.ArgumentParser(description="Train a YOLO card detection candidate")
    parser.add_argument("--epochs", type=int, default=100, help="Number of epochs")
    parser.add_argument("--imgsz", type=int, default=640, help="Image size")
    parser.add_argument("--batch", type=int, default=8, help="Batch size")
    parser.add_argument(
        "--family",
        type=str,
        default="yolo11",
        choices=["yolo11", "yolo26"],
        help="Ultralytics model generation",
    )
    parser.add_argument("--model", type=str, default="m", choices=["n", "s", "m", "l", "x"],
                        help="Model size")
    parser.add_argument(
        "--data",
        type=Path,
        default=DEFAULT_DATASET_YAML,
        help=f"Dataset YAML (default: {DEFAULT_DATASET_YAML})",
    )
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    parser.add_argument("--device", type=str, default="0", help="CUDA device or 'cpu'")

    args = parser.parse_args()

    train(
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        model_family=args.family,
        model_size=args.model,
        data_yaml=args.data,
        resume=args.resume,
        device=args.device
    )


if __name__ == "__main__":
    main()
