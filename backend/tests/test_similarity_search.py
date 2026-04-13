from __future__ import annotations

import unittest

from pydantic import ValidationError

from backend.app.schemas.common import SimilaritySearchRequest
from backend.app.services.similarity_search_service import serialize_match_features


class SimilaritySearchRequestTests(unittest.TestCase):
    def test_accepts_valid_payload(self) -> None:
        request = SimilaritySearchRequest.model_validate(
            {
                "reference_point": [121.5, 29.8],
                "search_center": [121.6, 29.9],
                "search_size_km": 10,
                "top_k": 10,
                "year": 2024,
                "scale": 10,
                "candidate_threshold": 0.9,
            }
        )

        self.assertEqual(request.reference_point, [121.5, 29.8])
        self.assertEqual(request.search_center, [121.6, 29.9])

    def test_accepts_multiple_reference_points(self) -> None:
        request = SimilaritySearchRequest.model_validate(
            {
                "reference_points": [[121.5, 29.8], [121.6, 29.9]],
                "search_center": [121.6, 29.9],
            }
        )

        self.assertEqual(len(request.reference_points or []), 2)

    def test_rejects_invalid_reference_point(self) -> None:
        with self.assertRaises(ValidationError):
            SimilaritySearchRequest.model_validate(
                {
                    "reference_point": [200, 29.8],
                    "search_center": [121.6, 29.9],
                }
            )

    def test_rejects_non_positive_search_size(self) -> None:
        with self.assertRaises(ValidationError):
            SimilaritySearchRequest.model_validate(
                {
                    "reference_point": [121.5, 29.8],
                    "search_center": [121.6, 29.9],
                    "search_size_km": 0,
                }
            )

    def test_rejects_missing_reference_inputs(self) -> None:
        with self.assertRaises(ValidationError):
            SimilaritySearchRequest.model_validate(
                {
                    "search_center": [121.6, 29.9],
                }
            )


class SerializeMatchFeaturesTests(unittest.TestCase):
    def test_sorts_by_score_and_limits_top_k(self) -> None:
        geojson, matches = serialize_match_features(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [121.0, 29.0]},
                        "properties": {"score": 0.82},
                    },
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [122.0, 30.0]},
                        "properties": {"score": 0.97},
                    },
                ],
            },
            top_k=1,
        )

        self.assertEqual(len(geojson["features"]), 1)
        self.assertEqual(geojson["features"][0]["properties"]["rank"], 1)
        self.assertEqual(matches[0]["lon"], 122.0)
        self.assertEqual(matches[0]["lat"], 30.0)
        self.assertEqual(matches[0]["score"], 0.97)


if __name__ == "__main__":
    unittest.main()
