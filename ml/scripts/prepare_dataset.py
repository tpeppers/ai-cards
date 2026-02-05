#!/usr/bin/env python3
"""
Dataset preparation script for card recognition model.
Copies images from pix/ to ml/data/images/ with train/val split.
"""

import os
import shutil
import random
from pathlib import Path

# Paths relative to this script's location
SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_ROOT = SCRIPT_DIR.parent.parent
PIX_DIR = PROJECT_ROOT / "pix"
DATA_DIR = SCRIPT_DIR.parent / "data"
TRAIN_IMAGES = DATA_DIR / "images" / "train"
VAL_IMAGES = DATA_DIR / "images" / "val"
TRAIN_LABELS = DATA_DIR / "labels" / "train"
VAL_LABELS = DATA_DIR / "labels" / "val"

# Train/val split ratio
TRAIN_RATIO = 0.8

# Supported image extensions
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}


def ensure_directories():
    """Create necessary directories if they don't exist."""
    for dir_path in [TRAIN_IMAGES, VAL_IMAGES, TRAIN_LABELS, VAL_LABELS]:
        dir_path.mkdir(parents=True, exist_ok=True)
        print(f"Ensured directory exists: {dir_path}")


def get_image_files(source_dir: Path) -> list:
    """Get all image files from a directory."""
    images = []
    for file in source_dir.iterdir():
        if file.suffix.lower() in IMAGE_EXTENSIONS:
            images.append(file)
    return sorted(images)


def split_dataset(images: list, train_ratio: float = 0.8) -> tuple:
    """Split images into train and validation sets."""
    random.seed(42)  # For reproducibility
    shuffled = images.copy()
    random.shuffle(shuffled)

    split_idx = int(len(shuffled) * train_ratio)
    train_images = shuffled[:split_idx]
    val_images = shuffled[split_idx:]

    return train_images, val_images


def copy_images(images: list, dest_dir: Path, labels_dir: Path):
    """Copy images to destination and create placeholder label files."""
    for img_path in images:
        # Copy image
        dest_path = dest_dir / img_path.name
        shutil.copy2(img_path, dest_path)

        # Create empty label file (to be filled during annotation)
        label_name = img_path.stem + ".txt"
        label_path = labels_dir / label_name
        if not label_path.exists():
            label_path.touch()

        print(f"  Copied: {img_path.name}")


def main():
    print("=" * 60)
    print("Card Recognition Dataset Preparation")
    print("=" * 60)

    # Check source directory
    if not PIX_DIR.exists():
        print(f"ERROR: Source directory not found: {PIX_DIR}")
        return

    # Ensure output directories exist
    ensure_directories()

    # Get all image files
    images = get_image_files(PIX_DIR)
    print(f"\nFound {len(images)} images in {PIX_DIR}")

    if len(images) == 0:
        print("No images found. Add images to pix/ directory first.")
        return

    # Split into train/val
    train_images, val_images = split_dataset(images, TRAIN_RATIO)
    print(f"\nSplit: {len(train_images)} training, {len(val_images)} validation")

    # Copy images
    print("\nCopying training images...")
    copy_images(train_images, TRAIN_IMAGES, TRAIN_LABELS)

    print("\nCopying validation images...")
    copy_images(val_images, VAL_IMAGES, VAL_LABELS)

    print("\n" + "=" * 60)
    print("Dataset preparation complete!")
    print(f"Training images: {TRAIN_IMAGES}")
    print(f"Validation images: {VAL_IMAGES}")
    print(f"Training labels: {TRAIN_LABELS}")
    print(f"Validation labels: {VAL_LABELS}")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Use Label Studio to annotate the images")
    print("2. Export annotations in YOLO format")
    print("3. Run train.py to train the model")


if __name__ == "__main__":
    main()
