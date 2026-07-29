"""Shared model-name-aware card detection helpers.

The detector's embedded class names are the source of truth. In particular,
the deployed model uses lexicographic names (0 == ``10c``), not a suit-major
0..51 class layout.
"""

import re
import time
from typing import Any, Dict, Iterable, List, Sequence


CARD_NAME_RE = re.compile(r"^(10|[2-9AJQKT])([HSCD])$", re.IGNORECASE)
SUIT_NAMES = {
    "h": "hearts",
    "s": "spades",
    "c": "clubs",
    "d": "diamonds",
}
SUIT_ORDER = {
    "hearts": 0,
    "spades": 1,
    "clubs": 2,
    "diamonds": 3,
}


def _rank_number(rank_name: str) -> int:
    rank = rank_name.upper()
    if rank == "A":
        return 1
    if rank in ("10", "T"):
        return 10
    if rank == "J":
        return 11
    if rank == "Q":
        return 12
    if rank == "K":
        return 13
    return int(rank)


def _alpha_for_card(suit_char: str, rank: int) -> str:
    if suit_char == "h":
        return chr(ord("a") + rank - 1)
    if suit_char == "s":
        return chr(ord("n") + rank - 1)
    if suit_char == "c":
        return chr(ord("A") + rank - 1)
    if suit_char == "d":
        return chr(ord("N") + rank - 1)
    raise ValueError(f"Unsupported suit: {suit_char}")


def parse_model_class_name(name: Any) -> Dict[str, Any]:
    """Parse a YOLO class name such as ``10c`` or ``Ah``."""
    match = CARD_NAME_RE.fullmatch(str(name).strip())
    if not match:
        raise ValueError(f"Unsupported card model class name: {name}")

    rank_name = match.group(1).upper()
    if rank_name == "T":
        rank_name = "10"
    suit_char = match.group(2).lower()
    rank = _rank_number(rank_name)
    return {
        "name": f"{rank_name}{suit_char}",
        "alpha": _alpha_for_card(suit_char, rank),
        "suit": SUIT_NAMES[suit_char],
        "rank": rank,
        "rank_name": rank_name,
    }


def card_info_from_class_id(class_id: int, names: Any) -> Dict[str, Any]:
    """Resolve a class through the names embedded in the loaded model."""
    if isinstance(names, dict):
        name = names.get(class_id)
    else:
        try:
            name = names[class_id]
        except (IndexError, KeyError, TypeError):
            name = None
    if name is None:
        raise ValueError(f"Model has no name for class {class_id}")
    return parse_model_class_name(name)


def result_to_card_payload(result: Any) -> Dict[str, Any]:
    """Convert one Ultralytics result to a deduplicated card payload."""
    detected_cards: List[Dict[str, Any]] = []
    boxes = result.boxes

    for index in range(len(boxes)):
        class_id = int(boxes.cls[index].item())
        try:
            info = card_info_from_class_id(class_id, result.names)
        except ValueError:
            # A non-card class in a future mixed-purpose model should not
            # corrupt the whole response.
            continue

        confidence = float(boxes.conf[index].item())
        bbox = boxes.xyxy[index].tolist()
        detected_cards.append({
            **info,
            "confidence": round(confidence, 3),
            "bbox": [round(float(value), 1) for value in bbox],
        })

    detected_cards.sort(key=lambda card: card["confidence"], reverse=True)
    total_detections = len(detected_cards)

    seen_alphas = set()
    unique_cards = []
    for card in detected_cards:
        if card["alpha"] in seen_alphas:
            continue
        seen_alphas.add(card["alpha"])
        unique_cards.append(card)

    unique_cards.sort(key=lambda card: (SUIT_ORDER[card["suit"]], card["rank"]))
    return {
        "cards": unique_cards,
        "hand": "".join(card["alpha"] for card in unique_cards),
        "totalDetections": total_detections,
        "uniqueCards": len(unique_cards),
    }


def detect_images(model: Any, images: Sequence[Any], confidence: float) -> Dict[str, Any]:
    """Run one batched model call for one or more already-decoded images."""
    if not images:
        raise ValueError("At least one image is required")

    started_at = time.time()
    results: Iterable[Any] = model(list(images), conf=confidence, verbose=False)
    frames = []
    for index, result in enumerate(results):
        frames.append({"index": index, **result_to_card_payload(result)})

    return {
        "frames": frames,
        "processingTimeMs": int((time.time() - started_at) * 1000),
    }


def detect_image(model: Any, image: Any, confidence: float) -> Dict[str, Any]:
    """Single-image convenience wrapper preserving the original API shape."""
    burst = detect_images(model, [image], confidence)
    frame = burst["frames"][0]
    return {
        "hand": frame["hand"],
        "cards": frame["cards"],
        "totalDetections": frame["totalDetections"],
        "uniqueCards": frame["uniqueCards"],
        "processingTimeMs": burst["processingTimeMs"],
    }
