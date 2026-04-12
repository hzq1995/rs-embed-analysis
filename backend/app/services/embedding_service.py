from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import ee

from backend.app.services.tile_service import get_tile_url


DATASET_ID = "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL"
AVAILABLE_YEARS = tuple(range(2017, 2101))


def validate_year(year: int) -> None:
    if year not in AVAILABLE_YEARS:
        raise ValueError(f"Year {year} is outside the supported dataset range.")


def build_polygon_geometry(geometry_payload: Dict[str, object]) -> ee.Geometry:
    ring = geometry_payload["coordinates"][0]
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    return ee.Geometry.Polygon([ring])


def get_point_geometry(lon: float, lat: float) -> ee.Geometry:
    return ee.Geometry.Point([lon, lat])


def get_image_collection_for_year(year: int) -> ee.ImageCollection:
    validate_year(year)
    start = ee.Date.fromYMD(year, 1, 1)
    end = start.advance(1, "year")
    return ee.ImageCollection(DATASET_ID).filterDate(start, end)


def get_image_for_year(year: int, lon: float, lat: float) -> ee.Image:
    point = get_point_geometry(lon, lat)
    image = get_image_collection_for_year(year).filterBounds(point).first()
    return ee.Image(image)


def get_embeddings_image_for_geometry(year: int, geometry_payload: Dict[str, object]) -> Tuple[ee.Image, ee.Geometry]:
    geometry = build_polygon_geometry(geometry_payload)
    filtered = get_image_collection_for_year(year).filterBounds(geometry)
    count = filtered.size().getInfo()
    if count == 0:
        raise RuntimeError("No embedding tiles were found for the selected geometry/year.")
    return ee.Image(filtered.mosaic()), geometry


def fetch_embedding(
    lon: float,
    lat: float,
    year: int,
    scale: float,
    buffer_m: float,
) -> Dict[str, object]:
    image = get_image_for_year(year, lon, lat)
    point = get_point_geometry(lon, lat)

    if buffer_m > 0:
        region = point.buffer(buffer_m)
        values = image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=region,
            scale=scale,
            bestEffort=True,
            maxPixels=1_000_000,
        ).getInfo()
    else:
        sampled_fc = image.sample(
            region=point,
            scale=scale,
            numPixels=1,
            geometries=False,
        )
        sample_count = sampled_fc.size().getInfo()
        if sample_count == 0:
            values = None
        else:
            sampled = sampled_fc.first()
            values = ee.Feature(sampled).toDictionary().getInfo()

    if not values:
        raise RuntimeError(
            "No embedding was returned for this location/year. "
            "The point may be outside valid coverage or masked. "
            "Try a nearby land point or rerun with --buffer-m 30."
        )

    bands = [f"A{i:02d}" for i in range(64)]
    vector: List[Optional[float]] = []
    missing = []
    for band in bands:
        value = values.get(band)
        if value is None:
            missing.append(band)
            vector.append(None)
        else:
            vector.append(float(value))

    return {
        "dataset_id": DATASET_ID,
        "year": year,
        "location": {"lon": lon, "lat": lat},
        "scale_m": scale,
        "buffer_m": buffer_m,
        "missing_bands": missing,
        "embedding_dimension": 64,
        "embedding": vector,
    }


def create_rgb_tile(
    geometry_payload: Dict[str, object],
    year: int,
    bands: Sequence[str],
    min_value: float,
    max_value: float,
) -> str:
    image, geometry = get_embeddings_image_for_geometry(year, geometry_payload)
    clipped = image.clip(geometry)
    vis_params = {
        "bands": list(bands),
        "min": min_value,
        "max": max_value,
    }
    return get_tile_url(clipped, vis_params)


def create_cluster_tile(
    geometry_payload: Dict[str, object],
    year: int,
    cluster_count: int,
    sample_count: int,
    scale: float,
    seed: int,
) -> str:
    image, geometry = get_embeddings_image_for_geometry(year, geometry_payload)
    training = image.sample(
        region=geometry,
        scale=scale,
        numPixels=sample_count,
        seed=seed,
    )
    clusterer = ee.Clusterer.wekaKMeans(nClusters=cluster_count).train(training)
    clustered = image.cluster(clusterer).randomVisualizer().clip(geometry)
    return get_tile_url(clustered, {})


def get_geometry_bounds(geometry_payload: Dict[str, object]) -> List[List[float]]:
    ring = geometry_payload["coordinates"][0]
    lons = [point[0] for point in ring]
    lats = [point[1] for point in ring]
    return [[min(lats), min(lons)], [max(lats), max(lons)]]


def get_geometry_area_sq_m(geometry_payload: Dict[str, object]) -> float:
    geometry = build_polygon_geometry(geometry_payload)
    return float(geometry.area(maxError=1).getInfo())


def get_geometry_centroid(geometry_payload: Dict[str, object]) -> Tuple[float, float]:
    geometry = build_polygon_geometry(geometry_payload)
    lon, lat = geometry.centroid(maxError=1).coordinates().getInfo()
    return float(lon), float(lat)
