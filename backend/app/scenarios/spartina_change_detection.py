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
    get_spartina_bounds,
    get_spartina_default_view,
    SPARTINA_MASK_PREVIEW_PATH,
)


class SpartinaChangeDetectionScenario(Scenario):
    scenario_id = "spartina_change_detection"
    request_model = SpartinaChangeRequest
    requires_ee = False

    @property
    def descriptor(self) -> ScenarioDescriptor:
        return ScenarioDescriptor(
            scenario_id=self.scenario_id,
            name="互花米草提取",
            description="定位到互花米草区域，叠加静态提取掩膜结果。",
            status="ready",
            supported_inputs=[],
            supported_outputs=["image_overlay"],
            default_view=ScenarioDefaultView.model_validate(get_spartina_default_view()),
        )

    def run(self, payload: Dict[str, Any]) -> ScenarioRunResponse:
        request_model = self.request_model.model_validate(payload)
        bounds = get_spartina_bounds()

        return ScenarioRunResponse(
            request_echo=request_model.model_dump(),
            layers=[
                LayerModel(
                    layer_id="spartina-mask-overlay",
                    layer_type="image_overlay",
                    name="互花米草提取掩膜",
                    image_url=SPARTINA_MASK_PREVIEW_PATH,
                    opacity=0.55,
                    bounds=bounds,
                    metadata={"source": "spartina_mask_v1.tif"},
                )
            ],
            summaries={},
            artifacts={},
        )
