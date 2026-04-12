from __future__ import annotations

from typing import Any, Dict

from backend.app.schemas.common import MaskSegmentationRequest, ScenarioDescriptor, ScenarioRunResponse
from backend.app.scenarios.base import Scenario


class MaskSegmentationScenario(Scenario):
    scenario_id = "mask_segmentation"
    request_model = MaskSegmentationRequest

    @property
    def descriptor(self) -> ScenarioDescriptor:
        return ScenarioDescriptor(
            scenario_id=self.scenario_id,
            name="分割 Mask",
            description="预留给后续栅格或矢量 Mask 生成流程的场景。",
            status="planned",
            supported_inputs=["geometry", "year", "model_id", "threshold", "postprocess"],
            supported_outputs=["raster_tile", "vector_geojson"],
        )

    def run(self, payload: Dict[str, Any]) -> ScenarioRunResponse:
        self.request_model.model_validate(payload)
        raise NotImplementedError("mask_segmentation is planned but not implemented in v1.")
