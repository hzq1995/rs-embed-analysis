from __future__ import annotations

from typing import Any, Dict

from backend.app.schemas.common import (
    EmbeddingIntroRequest,
    LayerModel,
    ScenarioDescriptor,
    ScenarioRunResponse,
)
from backend.app.scenarios.base import Scenario
from backend.app.services.embedding_service import (
    create_cluster_tile,
    create_rgb_tile,
    fetch_embedding,
    get_geometry_area_sq_m,
    get_geometry_bounds,
    get_geometry_centroid,
)


class EmbeddingIntroScenario(Scenario):
    scenario_id = "embedding_intro"
    request_model = EmbeddingIntroRequest

    @property
    def descriptor(self) -> ScenarioDescriptor:
        return ScenarioDescriptor(
            scenario_id=self.scenario_id,
            name="卫星嵌入可视化",
            description="对多边形 ROI 生成卫星嵌入 RGB 图层和 KMeans 聚类图层。",
            status="ready",
            supported_inputs=[
                "geometry",
                "year",
                "rgb_bands",
                "rgb_min",
                "rgb_max",
                "cluster_count",
                "sample_count",
                "scale",
                "seed",
                "include_vector_probe",
            ],
            supported_outputs=["raster_tile", "summary_only"],
        )

    def run(self, payload: Dict[str, Any]) -> ScenarioRunResponse:
        request_model = self.request_model.model_validate(payload)
        geometry_payload = request_model.geometry.model_dump()
        bounds = get_geometry_bounds(geometry_payload)

        rgb_tile_url = create_rgb_tile(
            geometry_payload=geometry_payload,
            year=request_model.year,
            bands=request_model.rgb_bands,
            min_value=request_model.rgb_min,
            max_value=request_model.rgb_max,
        )
        cluster_tile_url = create_cluster_tile(
            geometry_payload=geometry_payload,
            year=request_model.year,
            cluster_count=request_model.cluster_count,
            sample_count=request_model.sample_count,
            scale=request_model.scale,
            seed=request_model.seed,
        )

        artifacts: Dict[str, Any] = {}
        if request_model.include_vector_probe:
            lon, lat = get_geometry_centroid(geometry_payload)
            artifacts["vector_probe"] = fetch_embedding(
                lon=lon,
                lat=lat,
                year=request_model.year,
                scale=request_model.scale,
                buffer_m=0,
            )

        return ScenarioRunResponse(
            request_echo=request_model.model_dump(),
            layers=[
                LayerModel(
                    layer_id="embedding-rgb",
                    layer_type="raster_tile",
                    name="Embedding RGB",
                    tile_url=rgb_tile_url,
                    opacity=0.8,
                    bounds=bounds,
                    metadata={
                        "bands": request_model.rgb_bands,
                        "min": request_model.rgb_min,
                        "max": request_model.rgb_max,
                    },
                ),
                LayerModel(
                    layer_id="embedding-clusters",
                    layer_type="raster_tile",
                    name="Clusters",
                    tile_url=cluster_tile_url,
                    opacity=0.7,
                    bounds=bounds,
                    metadata={
                        "cluster_count": request_model.cluster_count,
                        "sample_count": request_model.sample_count,
                        "scale": request_model.scale,
                        "seed": request_model.seed,
                    },
                ),
            ],
            summaries={
                "year": request_model.year,
                "bands": request_model.rgb_bands,
                "cluster_count": request_model.cluster_count,
                "sample_count": request_model.sample_count,
                "roi_area_sq_m": round(get_geometry_area_sq_m(geometry_payload), 2),
            },
            artifacts=artifacts,
        )
