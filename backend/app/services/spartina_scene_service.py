from __future__ import annotations

import csv
from io import BytesIO
from functools import lru_cache
from pathlib import Path
from typing import Dict, List

import numpy as np
import rasterio
from PIL import Image


SPARTINA_ASSET_DIR = (
    Path(__file__).resolve().parents[3]
    / "react-google-earth-test"
    / "public"
    / "scenarios"
    / "spartina"
)
SPARTINA_CSV_PATH = SPARTINA_ASSET_DIR / "互花米草坐标.csv"
SPARTINA_MASK_PATH = SPARTINA_ASSET_DIR / "spartina_mask_v1.tif"
SPARTINA_MASK_COLOR = (214, 69, 80)
SPARTINA_MASK_ALPHA = 140
SPARTINA_MASK_PREVIEW_PATH = "/api/scenarios/spartina_change_detection/mask-preview"


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
    if not SPARTINA_MASK_PATH.exists():
        raise FileNotFoundError(f"Spartina mask not found: {SPARTINA_MASK_PATH}")

    with rasterio.open(SPARTINA_MASK_PATH) as dataset:
        bounds = dataset.bounds

    return [
        [float(bounds.bottom), float(bounds.left)],
        [float(bounds.top), float(bounds.right)],
    ]


@lru_cache(maxsize=1)
def get_spartina_mask_preview_png() -> bytes:
    if not SPARTINA_MASK_PATH.exists():
        raise FileNotFoundError(f"Spartina mask not found: {SPARTINA_MASK_PATH}")

    with rasterio.open(SPARTINA_MASK_PATH) as dataset:
        mask = dataset.read(1)

    rgba = np.zeros((mask.shape[0], mask.shape[1], 4), dtype=np.uint8)
    rgba[..., 0] = SPARTINA_MASK_COLOR[0]
    rgba[..., 1] = SPARTINA_MASK_COLOR[1]
    rgba[..., 2] = SPARTINA_MASK_COLOR[2]
    rgba[..., 3] = np.where(mask > 0, SPARTINA_MASK_ALPHA, 0).astype(np.uint8)

    buffer = BytesIO()
    Image.fromarray(rgba).save(buffer, format="PNG")
    return buffer.getvalue()


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
