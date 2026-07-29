import unittest

from card_detection import (
    card_info_from_class_id,
    parse_model_class_name,
    result_to_card_payload,
)


class FakeScalar:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class FakeCoordinates:
    def __init__(self, value):
        self.value = value

    def tolist(self):
        return list(self.value)


class FakeBoxes:
    def __init__(self, classes, confidences, coordinates):
        self.cls = [FakeScalar(value) for value in classes]
        self.conf = [FakeScalar(value) for value in confidences]
        self.xyxy = [FakeCoordinates(value) for value in coordinates]

    def __len__(self):
        return len(self.cls)


class FakeResult:
    def __init__(self):
        # Matches the important positions in the deployed model's embedded
        # lexicographic name table.
        self.names = {
            0: "10c",
            38: "Ah",
        }
        self.boxes = FakeBoxes(
            classes=[0, 38, 0],
            confidences=[0.91, 0.82, 0.50],
            coordinates=[
                [1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12],
            ],
        )


class CardDetectionTests(unittest.TestCase):
    def test_parses_model_name_into_card_and_alpha(self):
        self.assertEqual(
            parse_model_class_name("10c"),
            {
                "name": "10c",
                "alpha": "J",
                "suit": "clubs",
                "rank": 10,
                "rank_name": "10",
            },
        )
        self.assertEqual(parse_model_class_name("Th")["name"], "10h")
        self.assertEqual(parse_model_class_name("Ah")["alpha"], "a")

    def test_class_id_uses_embedded_names_not_numeric_layout(self):
        names = {0: "10c", 38: "Ah"}
        self.assertEqual(card_info_from_class_id(0, names)["name"], "10c")
        self.assertEqual(card_info_from_class_id(38, names)["name"], "Ah")

    def test_result_conversion_deduplicates_by_resolved_card(self):
        payload = result_to_card_payload(FakeResult())
        self.assertEqual(payload["totalDetections"], 3)
        self.assertEqual(payload["uniqueCards"], 2)
        self.assertEqual([card["name"] for card in payload["cards"]], ["Ah", "10c"])
        ten_clubs = next(card for card in payload["cards"] if card["name"] == "10c")
        self.assertEqual(ten_clubs["confidence"], 0.91)
        self.assertEqual(ten_clubs["bbox"], [1.0, 2.0, 3.0, 4.0])

    def test_rejects_non_card_class_names(self):
        with self.assertRaisesRegex(ValueError, "Unsupported card model class name"):
            parse_model_class_name("joker")


if __name__ == "__main__":
    unittest.main()
