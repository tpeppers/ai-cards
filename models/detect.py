#!/usr/bin/env python3
"""Run card detection on an image."""

import sys
from pathlib import Path
from ultralytics import YOLO

def main():
    if len(sys.argv) < 2:
        print("Usage: python detect.py <image_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    if not Path(image_path).exists():
        print(f"Error: File not found: {image_path}")
        sys.exit(1)

    model_path = Path(__file__).parent / "card_detector_best.pt"
    model = YOLO(str(model_path))

    results = model.predict(image_path, save=True, conf=0.25)

    for result in results:
        cards = []
        for box in result.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            name = result.names[cls_id]
            cards.append((name, conf))

        # Sort by confidence descending
        cards.sort(key=lambda x: -x[1])

        # Print summary
        card_names = [c[0] for c in cards]
        print(f"Cards: {', '.join(card_names)}")
        print(f"Count: {len(cards)}")

        # Print details
        print("\nDetections:")
        for name, conf in cards:
            print(f"  {name} ({conf:.0%})")

        print(f"\nAnnotated image saved to: {result.save_dir}")

if __name__ == "__main__":
    main()
