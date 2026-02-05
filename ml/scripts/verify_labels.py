#!/usr/bin/env python3
"""
Label Verification Script
=========================

!! RUN THIS PERIODICALLY TO CATCH LABELING MISTAKES !!

This script verifies that YOLO label files are consistent with the expected
class mappings. Since YOLO uses numeric class IDs, it's easy to accidentally
mix datasets with different class orderings, resulting in mislabeled data.

Usage:
    python verify_labels.py                    # Interactive spot-check
    python verify_labels.py --compare          # Compare two dataset yamls
    python verify_labels.py --decode <file>    # Decode a specific label file

Run this after:
    - Merging datasets from different sources
    - Exporting from Label Studio
    - Any bulk label operations
"""

import argparse
import random
import sys
from pathlib import Path

import yaml


def load_class_names(yaml_path: Path) -> list[str]:
    """Load class names from a YOLO data.yaml file."""
    with open(yaml_path) as f:
        data = yaml.safe_load(f)

    names = data.get('names', [])
    if isinstance(names, dict):
        # Handle dict format: {0: 'class0', 1: 'class1', ...}
        max_id = max(names.keys())
        return [names.get(i, f'UNKNOWN_{i}') for i in range(max_id + 1)]
    return names


def decode_label_file(label_path: Path, class_names: list[str]) -> list[dict]:
    """Decode a YOLO label file to human-readable format."""
    labels = []
    with open(label_path) as f:
        for line_num, line in enumerate(f, 1):
            parts = line.strip().split()
            if len(parts) >= 5:
                class_id = int(parts[0])
                x_center, y_center, width, height = map(float, parts[1:5])

                if class_id < len(class_names):
                    class_name = class_names[class_id]
                else:
                    class_name = f'INVALID_ID_{class_id}'

                labels.append({
                    'line': line_num,
                    'class_id': class_id,
                    'class_name': class_name,
                    'bbox': (x_center, y_center, width, height)
                })
    return labels


def find_label_files(data_yaml: Path) -> list[Path]:
    """Find all label files for a dataset."""
    with open(data_yaml) as f:
        data = yaml.safe_load(f)

    base_path = Path(data.get('path', data_yaml.parent))
    label_files = []

    for split in ['train', 'val', 'test']:
        if split in data:
            # Images path -> labels path
            images_path = base_path / data[split]
            labels_path = Path(str(images_path).replace('/images', '/labels').replace('\\images', '\\labels'))
            if labels_path.exists():
                label_files.extend(labels_path.glob('*.txt'))

    return label_files


def spot_check(data_yaml: Path, num_samples: int = 5):
    """Randomly sample and display decoded labels for manual verification."""
    print(f"\n{'='*60}")
    print(f"SPOT CHECK: {data_yaml}")
    print(f"{'='*60}\n")

    class_names = load_class_names(data_yaml)
    print(f"Class mapping ({len(class_names)} classes):")
    print(f"  ID 0  -> {class_names[0]}")
    print(f"  ID 1  -> {class_names[1]}")
    print(f"  ...")
    print(f"  ID {len(class_names)-1} -> {class_names[-1]}")
    print()

    label_files = find_label_files(data_yaml)
    if not label_files:
        print("ERROR: No label files found!")
        return False

    print(f"Found {len(label_files)} label files")

    # Random sample
    samples = random.sample(label_files, min(num_samples, len(label_files)))

    print(f"\nRandom sample of {len(samples)} files:\n")

    for label_path in samples:
        print(f"--- {label_path.name} ---")
        labels = decode_label_file(label_path, class_names)

        if not labels:
            print("  (empty file)")
        else:
            for lbl in labels[:10]:  # Show max 10 per file
                print(f"  Class {lbl['class_id']:2d} = {lbl['class_name']:4s}  "
                      f"@ ({lbl['bbox'][0]:.2f}, {lbl['bbox'][1]:.2f})")
            if len(labels) > 10:
                print(f"  ... and {len(labels) - 10} more")
        print()

    return True


def compare_datasets(yaml1: Path, yaml2: Path):
    """Compare class mappings between two datasets."""
    print(f"\n{'='*60}")
    print("DATASET COMPARISON")
    print(f"{'='*60}\n")

    names1 = load_class_names(yaml1)
    names2 = load_class_names(yaml2)

    print(f"Dataset 1: {yaml1}")
    print(f"  Classes: {len(names1)}")

    print(f"\nDataset 2: {yaml2}")
    print(f"  Classes: {len(names2)}")

    if names1 == names2:
        print("\n[OK] MATCH: Class mappings are identical!")
        return True
    else:
        print("\n[!!] MISMATCH: Class mappings differ!")
        print("\nDifferences:")

        max_len = max(len(names1), len(names2))
        mismatches = 0

        for i in range(max_len):
            n1 = names1[i] if i < len(names1) else "(missing)"
            n2 = names2[i] if i < len(names2) else "(missing)"

            if n1 != n2:
                print(f"  ID {i:2d}: '{n1}' vs '{n2}'")
                mismatches += 1
                if mismatches > 10:
                    print(f"  ... and more differences")
                    break

        return False


def decode_single_file(label_path: Path, yaml_path: Path):
    """Decode and display a single label file."""
    class_names = load_class_names(yaml_path)
    labels = decode_label_file(label_path, class_names)

    print(f"\nFile: {label_path}")
    print(f"Using class mapping from: {yaml_path}\n")

    if not labels:
        print("(empty file)")
    else:
        for lbl in labels:
            print(f"Line {lbl['line']:3d}: Class {lbl['class_id']:2d} = {lbl['class_name']:4s}  "
                  f"bbox=({lbl['bbox'][0]:.3f}, {lbl['bbox'][1]:.3f}, "
                  f"{lbl['bbox'][2]:.3f}, {lbl['bbox'][3]:.3f})")


def main():
    parser = argparse.ArgumentParser(
        description='Verify YOLO label consistency',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    parser.add_argument('--yaml', '-y', type=Path,
                        default=Path(__file__).parent.parent / 'data' / 'dataset.yaml',
                        help='Path to data.yaml file')
    parser.add_argument('--compare', '-c', type=Path,
                        help='Compare with another data.yaml')
    parser.add_argument('--decode', '-d', type=Path,
                        help='Decode a specific label file')
    parser.add_argument('--samples', '-n', type=int, default=5,
                        help='Number of files to sample (default: 5)')

    args = parser.parse_args()

    if args.compare:
        success = compare_datasets(args.yaml, args.compare)
    elif args.decode:
        decode_single_file(args.decode, args.yaml)
        success = True
    else:
        success = spot_check(args.yaml, args.samples)

    if not success:
        sys.exit(1)


if __name__ == '__main__':
    # Quick sanity check when run directly
    print("=" * 60)
    print("  LABEL VERIFICATION SCRIPT")
    print("  Run periodically to catch labeling mistakes!")
    print("=" * 60)
    main()
