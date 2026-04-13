from __future__ import annotations

from typing import Any, Dict

from backend.app.schemas.common import (
    LayerModel,
    ScenarioDescriptor,
    ScenarioRunResponse,
    SimilaritySearchRequest,
)
from backend.app.scenarios.base import Scenario
from backend.app.services.similarity_search_service import run_similarity_search


class ImageRetrievalScenario(Scenario):
    scenario_id = "image_retrieval"
    request_model = SimilaritySearchRequest

    @property
    def descriptor(self) -> ScenarioDescriptor:
        return ScenarioDescriptor(
            scenario_id=self.scenario_id,
            name="图像检索",
            description="对上传的 GeoTIFF 均匀取点，并用平均 embedding 在当前地图中心周围执行相似度搜索。",
            status="ready",
            supported_inputs=[
                "tif_sample_points",
                "search_center",
                "search_size_km",
                "top_k",
                "year",
                "scale",
                "candidate_threshold",
            ],
            supported_outputs=["point_collection", "summary_only"],
        )

    def run(self, payload: Dict[str, Any]) -> ScenarioRunResponse:
        request_model = self.request_model.model_validate(payload)
        result = run_similarity_search(request_model)
        return ScenarioRunResponse(
            request_echo=request_model.model_dump(),
            layers=[
                LayerModel(
                    layer_id="image-retrieval-matches",
                    layer_type="point_collection",
                    name="Similarity Matches",
                    geojson=result["geojson"],
                    metadata={
                        "source_mode": "tif_sample_points",
                        "result_count": len(result["matches"]),
                    },
                )
            ],
            summaries=result["summaries"],
            artifacts={"matches": result["matches"]},
        )
