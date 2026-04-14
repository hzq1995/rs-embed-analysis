from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Tuple

import ee

from backend.app.services.embedding_service import (
    get_embeddings_image_for_geometry,
    get_geometry_bounds,
)
from backend.app.services.tile_service import get_tile_url


SPARTINA_YEARS = (2023, 2024, 2025)
SPARTINA_CHANGE_YEAR_PAIR = (2023, 2025)
SPARTINA_ASSET_DIR = (
    Path(__file__).resolve().parents[3]
    / "react-google-earth-test"
    / "public"
    / "scenarios"
    / "spartina"
)
SPARTINA_CSV_PATH = SPARTINA_ASSET_DIR / "互花米草坐标.csv"
CHANGE_PALETTE = ["001f3f", "0f7fe4", "39d0d4", "f3d04f", "f25f5c"]


def parse_dms_coordinate(value: str) -> float:
    parts = [part.strip() for part in value.split(";") if part.strip()]
    if len(parts) != 3:
        raise ValueError(f"Invalid DMS coordinate value: {value}")

    degrees, minutes, seconds = [float(part) for part in parts]
    sign = -1 if degrees < 0 else 1
    degrees = abs(degrees)
    return sign * (degrees + minutes / 60 + seconds / 3600)


@lru_cache(maxsize=1)
def load_spartina_points() -> List[List[float]]:
    if not SPARTINA_CSV_PATH.exists():
        raise FileNotFoundError(f"Spartina CSV not found: {SPARTINA_CSV_PATH}")

    with SPARTINA_CSV_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        points = [
            [
                parse_dms_coordinate(row["Longitude"]),
                parse_dms_coordinate(row["Latitude"]),
            ]
            for row in reader
        ]

    if not points:
        raise RuntimeError("Spartina CSV does not contain any coordinates.")
    return points


@lru_cache(maxsize=1)
def get_spartina_bounds() -> List[List[float]]:
    points = load_spartina_points()
    longitudes = [point[0] for point in points]
    latitudes = [point[1] for point in points]
    return [
        [min(latitudes), min(longitudes)],
        [max(latitudes), max(longitudes)],
    ]


@lru_cache(maxsize=1)
def get_spartina_geometry_payload() -> Dict[str, object]:
    bounds = get_spartina_bounds()
    south, west = bounds[0]
    north, east = bounds[1]
    return {
        "type": "Polygon",
        "coordinates": [[
            [west, north],
            [east, north],
            [east, south],
            [west, south],
            [west, north],
        ]],
    }


@lru_cache(maxsize=1)
def get_spartina_default_view() -> Dict[str, object]:
    bounds = get_spartina_bounds()
    south, west = bounds[0]
    north, east = bounds[1]
    return {
        "bounds": bounds,
        "center": {
            "lat": (south + north) / 2,
            "lng": (west + east) / 2,
        },
    }


def get_spartina_rgb_tile(
    year: int,
    bands: List[str],
    min_value: float,
    max_value: float,
) -> Tuple[str, List[List[float]]]:
    geometry_payload = get_spartina_geometry_payload()
    image, geometry = get_embeddings_image_for_geometry(year, geometry_payload)
    clipped = image.clip(geometry)
    tile_url = get_tile_url(
        clipped,
        {
            "bands": bands,
            "min": min_value,
            "max": max_value,
        },
    )
    return tile_url, get_geometry_bounds(geometry_payload)


def build_cosine_difference_image(year_a: int, year_b: int) -> Tuple[ee.Image, ee.Geometry]:
    geometry_payload = get_spartina_geometry_payload()
    image_a, geometry = get_embeddings_image_for_geometry(year_a, geometry_payload)
    image_b, _ = get_embeddings_image_for_geometry(year_b, geometry_payload)
    image_a = image_a.clip(geometry)
    image_b = image_b.clip(geometry)

    dot_product = image_a.multiply(image_b).reduce(ee.Reducer.sum())
    norm_a = image_a.pow(2).reduce(ee.Reducer.sum()).sqrt()
    norm_b = image_b.pow(2).reduce(ee.Reducer.sum()).sqrt()
    denominator = norm_a.multiply(norm_b).max(ee.Image.constant(1e-6))
    cosine_similarity = dot_product.divide(denominator)
    change_image = ee.Image.constant(1).subtract(cosine_similarity).rename("change")
    return change_image.clip(geometry), geometry


def get_spartina_change_tile() -> str:
    change_image, _ = build_cosine_difference_image(*SPARTINA_CHANGE_YEAR_PAIR)
    return get_tile_url(
        change_image,
        {
            "min": 0,
            "max": 1,
            "palette": CHANGE_PALETTE,
        },
    )


def get_region_mean_change(year_a: int, year_b: int, scale: float) -> float:
    change_image, geometry = build_cosine_difference_image(year_a, year_b)
    value = (
        change_image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geometry,
            scale=scale,
            bestEffort=True,
            maxPixels=1_000_000,
        )
        .get("change")
        .getInfo()
    )
    return round(float(value), 6)
