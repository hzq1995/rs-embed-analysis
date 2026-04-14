from __future__ import annotations

from typing import Any, Dict

from backend.app.schemas.common import (
    LayerModel,
    ScenarioDefaultView,
    ScenarioDescriptor,
    ScenarioRunResponse,
    SpartinaChangeRequest,
)
from backend.app.scenarios.base import Scenario
from backend.app.services.spartina_scene_service import (
    SPARTINA_CHANGE_YEAR_PAIR,
    SPARTINA_YEARS,
    get_region_mean_change,
    get_spartina_bounds,
    get_spartina_change_tile,
    get_spartina_default_view,
    get_spartina_rgb_tile,
)


class SpartinaChangeDetectionScenario(Scenario):
    scenario_id = "spartina_change_detection"
    request_model = SpartinaChangeRequest

    @property
    def descriptor(self) -> ScenarioDescriptor:
        return ScenarioDescriptor(
            scenario_id=self.scenario_id,
            name="互花米草变化检测",
            description="定位到互花米草区域，对比 embedding 可视化与变化强度。",
            status="ready",
            supported_inputs=["rgb_bands", "rgb_min", "rgb_max", "scale"],
            supported_outputs=["raster_tile", "summary_only"],
            default_view=ScenarioDefaultView.model_validate(get_spartina_default_view()),
        )

    def run(self, payload: Dict[str, Any]) -> ScenarioRunResponse:
        request_model = self.request_model.model_validate(payload)
        bounds = get_spartina_bounds()
        layers = []

        for year in SPARTINA_YEARS:
            tile_url, _ = get_spartina_rgb_tile(
                year=year,
                bands=request_model.rgb_bands,
                min_value=request_model.rgb_min,
                max_value=request_model.rgb_max,
            )
            layers.append(
                LayerModel(
                    layer_id=f"spartina-rgb-{year}",
                    layer_type="raster_tile",
                    name=f"{year} Embedding RGB",
                    tile_url=tile_url,
                    opacity=0.85,
                    bounds=bounds,
                    metadata={
                        "year": year,
                        "bands": request_model.rgb_bands,
                        "min": request_model.rgb_min,
                        "max": request_model.rgb_max,
                    },
                )
            )

        layers.append(
            LayerModel(
                layer_id="spartina-change-2023-2025",
                layer_type="raster_tile",
                name="2023-2025 Change",
                tile_url=get_spartina_change_tile(),
                opacity=0.92,
                bounds=bounds,
                metadata={
                    "metric": "1-cosine_similarity",
                    "year_pair": list(SPARTINA_CHANGE_YEAR_PAIR),
                },
            )
        )

        return ScenarioRunResponse(
            request_echo=request_model.model_dump(),
            layers=layers,
            summaries={
                "years": list(SPARTINA_YEARS),
                "change_metric": "1-cosine_similarity",
                "bounds": bounds,
                "mean_change_2023_2024": get_region_mean_change(2023, 2024, request_model.scale),
                "mean_change_2024_2025": get_region_mean_change(2024, 2025, request_model.scale),
                "mean_change_2023_2025": get_region_mean_change(2023, 2025, request_model.scale),
            },
            artifacts={},
        )
