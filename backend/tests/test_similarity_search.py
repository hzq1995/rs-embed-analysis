from __future__ import annotations

import unittest

from pydantic import ValidationError

from backend.app.schemas.common import SimilaritySearchRequest
from backend.app.services.similarity_search_service import (
    haversine_distance_meters,
    serialize_match_features,
)
from backend.app.services.spartina_scene_service import (
    get_spartina_bounds,
    parse_dms_coordinate,
)


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

    def test_accepts_min_result_spacing(self) -> None:
        request = SimilaritySearchRequest.model_validate(
            {
                "reference_point": [121.5, 29.8],
                "search_center": [121.6, 29.9],
                "min_result_spacing_m": 25,
            }
        )

        self.assertEqual(request.min_result_spacing_m, 25)

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
        geojson, matches, raw_result_count = serialize_match_features(
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
        self.assertEqual(raw_result_count, 2)

    def test_applies_result_spacing(self) -> None:
        geojson, matches, raw_result_count = serialize_match_features(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [121.0000, 29.0000]},
                        "properties": {"score": 0.99},
                    },
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [121.00002, 29.00002]},
                        "properties": {"score": 0.98},
                    },
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [121.0020, 29.0020]},
                        "properties": {"score": 0.97},
                    },
                ],
            },
            top_k=3,
            min_result_spacing_m=20,
        )

        self.assertEqual(raw_result_count, 3)
        self.assertEqual(len(geojson["features"]), 2)
        self.assertEqual(len(matches), 2)
        self.assertGreater(
            haversine_distance_meters(
                geojson["features"][0]["geometry"]["coordinates"],
                geojson["features"][1]["geometry"]["coordinates"],
            ),
            20,
        )


class SpartinaSceneServiceTests(unittest.TestCase):
    def test_parse_dms_coordinate(self) -> None:
        self.assertAlmostEqual(
            parse_dms_coordinate("121;27;3.12709999998332933"),
            121.45086863888889,
        )

    def test_loads_spartina_bounds(self) -> None:
        bounds = get_spartina_bounds()

        self.assertEqual(len(bounds), 2)
        self.assertLess(bounds[0][0], bounds[1][0])
        self.assertLess(bounds[0][1], bounds[1][1])


if __name__ == "__main__":
    unittest.main()
