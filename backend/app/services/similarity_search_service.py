from __future__ import annotations

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


def serialize_match_features(
    feature_collection_info: Dict[str, Any],
    top_k: int,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
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
    ranked_features = []
    matches = []

    for rank, feature in enumerate(scored_features[:top_k], start=1):
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
    }, matches


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
        .limit(request.top_k)
    )

    geojson, matches = serialize_match_features(ranked_candidates.getInfo(), request.top_k)
    return {
        "geojson": geojson,
        "matches": matches,
        "summaries": {
            "year": request.year,
            "search_size_km": request.search_size_km,
            "top_k_requested": request.top_k,
            "result_count": len(matches),
            "reference_point_count": len(reference_points),
            "reference_points": reference_points,
            "search_center": request.search_center,
            "candidate_threshold": request.candidate_threshold,
        },
    }
