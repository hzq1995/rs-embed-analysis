from __future__ import annotations

from math import atan2, cos, radians, sin, sqrt
from typing import Any, Dict, List, Tuple

import ee

from backend.app.schemas.common import SimilaritySearchRequest
from backend.app.services.embedding_service import (
    get_image_collection_for_year,
    get_point_geometry,
)


def build_search_geometry(search_center: List[float], search_size_km: float) -> ee.Geometry:
    lon, lat = search_center
    half_size_m = float(search_size_km) * 500.0
    return get_point_geometry(lon, lat).buffer(half_size_m).bounds(maxError=1)


def get_embeddings_mosaic_for_region(year: int, geometry: ee.Geometry) -> ee.Image:
    collection = get_image_collection_for_year(year).filterBounds(geometry)
    if collection.size().getInfo() == 0:
        raise RuntimeError("No embedding tiles were found for the selected search region/year.")
    return ee.Image(collection.mosaic())


def build_similarity_image(
    mosaic: ee.Image,
    reference_points: List[List[float]],
    scale: float,
) -> ee.Image:
    samples = ee.FeatureCollection(
        [ee.Feature(get_point_geometry(*reference_point)) for reference_point in reference_points]
    )
    sample_embeddings = mosaic.sampleRegions(collection=samples, scale=scale)

    if sample_embeddings.size().getInfo() == 0:
        raise RuntimeError(
            "No embedding was returned for the selected reference points. "
            "Try nearby land points or upload a different GeoTIFF."
        )

    band_names = mosaic.bandNames()

    def compute_dot_product(feature: ee.Feature) -> ee.Image:
        array_image = ee.Image(ee.Feature(feature).toArray(band_names)).arrayFlatten([band_names])
        return array_image.multiply(mosaic).reduce(ee.Reducer.sum()).rename("similarity")

    return ee.ImageCollection(sample_embeddings.map(compute_dot_product)).mean()


def get_reference_points(request: SimilaritySearchRequest) -> List[List[float]]:
    if request.reference_points:
        return request.reference_points
    if request.reference_point:
        return [request.reference_point]
    raise RuntimeError("Similarity search request is missing reference points.")


def haversine_distance_meters(point_a: List[float], point_b: List[float]) -> float:
    lon1, lat1 = point_a
    lon2, lat2 = point_b
    earth_radius_m = 6_371_000

    lat1_rad = radians(lat1)
    lat2_rad = radians(lat2)
    delta_lat = radians(lat2 - lat1)
    delta_lon = radians(lon2 - lon1)
    a = (
        sin(delta_lat / 2) ** 2
        + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon / 2) ** 2
    )
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return earth_radius_m * c


def apply_result_spacing(
    scored_features: List[Dict[str, Any]],
    min_result_spacing_m: float,
    top_k: int,
) -> List[Dict[str, Any]]:
    if min_result_spacing_m <= 0:
        return scored_features[:top_k]

    filtered_features: List[Dict[str, Any]] = []
    for feature in scored_features:
        candidate_point = feature["geometry"]["coordinates"]
        if any(
            haversine_distance_meters(candidate_point, kept["geometry"]["coordinates"])
            < min_result_spacing_m
            for kept in filtered_features
        ):
            continue

        filtered_features.append(feature)
        if len(filtered_features) >= top_k:
            break

    return filtered_features


def serialize_match_features(
    feature_collection_info: Dict[str, Any],
    top_k: int,
    min_result_spacing_m: float = 0,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], int]:
    raw_features = feature_collection_info.get("features", [])
    scored_features = []

    for feature in raw_features:
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") != "Point" or len(coordinates) != 2:
            continue

        properties = dict(feature.get("properties") or {})
        score = properties.get("score")
        if score is None:
            continue

        scored_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(coordinates[0]), float(coordinates[1])],
                },
                "properties": {
                    **properties,
                    "score": float(score),
                },
            }
        )

    scored_features.sort(key=lambda item: item["properties"]["score"], reverse=True)
    filtered_features = apply_result_spacing(scored_features, min_result_spacing_m, top_k)
    ranked_features = []
    matches = []

    for rank, feature in enumerate(filtered_features, start=1):
        lon, lat = feature["geometry"]["coordinates"]
        score = round(feature["properties"]["score"], 6)
        ranked_feature = {
            **feature,
            "properties": {
                **feature["properties"],
                "rank": rank,
                "score": score,
            },
        }
        ranked_features.append(ranked_feature)
        matches.append(
            {
                "rank": rank,
                "score": score,
                "lon": lon,
                "lat": lat,
            }
        )

    return {
        "type": "FeatureCollection",
        "features": ranked_features,
    }, matches, len(scored_features)


def run_similarity_search(request: SimilaritySearchRequest) -> Dict[str, Any]:
    reference_points = get_reference_points(request)
    search_geometry = build_search_geometry(request.search_center, request.search_size_km)
    mosaic = get_embeddings_mosaic_for_region(request.year, search_geometry)
    similarity_image = build_similarity_image(
        mosaic=mosaic,
        reference_points=reference_points,
        scale=request.scale,
    )

    candidate_polygons = similarity_image.gt(request.candidate_threshold).selfMask().reduceToVectors(
        geometry=search_geometry,
        scale=request.scale,
        eightConnected=False,
        maxPixels=1e10,
    )

    def score_candidate(feature: ee.Feature) -> ee.Feature:
        geometry = ee.Feature(feature).geometry()
        score = similarity_image.reduceRegion(
            reducer=ee.Reducer.max(),
            geometry=geometry,
            scale=request.scale,
            bestEffort=True,
            maxPixels=1_000_000,
        ).get("similarity")
        centroid = geometry.centroid(maxError=1)
        return ee.Feature(centroid, {"score": score})

    ranked_candidates = (
        ee.FeatureCollection(candidate_polygons.map(score_candidate))
        .filter(ee.Filter.notNull(["score"]))
        .sort("score", False)
        .limit(min(max(request.top_k * 10, request.top_k), 1000))
    )

    geojson, matches, raw_result_count = serialize_match_features(
        ranked_candidates.getInfo(),
        request.top_k,
        request.min_result_spacing_m,
    )
    return {
        "geojson": geojson,
        "matches": matches,
        "summaries": {
            "year": request.year,
            "search_size_km": request.search_size_km,
            "top_k_requested": request.top_k,
            "result_count": len(matches),
            "raw_result_count": raw_result_count,
            "reference_point_count": len(reference_points),
            "reference_points": reference_points,
            "search_center": request.search_center,
            "candidate_threshold": request.candidate_threshold,
            "min_result_spacing_m": request.min_result_spacing_m,
        },
    }
