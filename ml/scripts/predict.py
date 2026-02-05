#!/usr/bin/env python3
"""
Test inference script for card recognition model (YOLOv11).
Loads a trained model and runs inference on test images.
"""

import argparse
from pathlib import Path
from ultralytics import YOLO


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


def predict(image_path: str, model_path: str = None, confidence: float = 0.5):
    """
    Run inference on an image and return detected cards.

    Args:
        image_path: Path to input image
        model_path: Path to trained model weights
        confidence: Minimum confidence threshold

    Returns:
        dict with 'hand' (alpha string) and 'cards' (list of card details)
    """
    if model_path is None:
        model_path = DEFAULT_MODEL

    model_path = Path(model_path)
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    # Load model
    model = YOLO(str(model_path))

    # Run inference
    results = model(str(image_path), conf=confidence, verbose=False)

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

    return {
        'hand': alpha_string,
        'cards': unique_cards,
        'total_detections': len(detected_cards),
        'unique_cards': len(unique_cards)
    }


def main():
    parser = argparse.ArgumentParser(description="Test card recognition model")
    parser.add_argument("image", type=str, help="Path to image file")
    parser.add_argument("--model", type=str, default=None, help="Path to model weights")
    parser.add_argument("--conf", type=float, default=0.5, help="Confidence threshold")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    try:
        result = predict(args.image, args.model, args.conf)

        if args.json:
            import json
            print(json.dumps(result, indent=2))
        else:
            print(f"\nDetected hand: {result['hand']}")
            print(f"Cards found: {result['unique_cards']} (total detections: {result['total_detections']})")
            print("\nCard details:")
            for card in result['cards']:
                print(f"  {card['rank_name']} of {card['suit']} ({card['alpha']}) - {card['confidence']:.1%}")

    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
