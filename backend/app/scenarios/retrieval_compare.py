from __future__ import annotations

from typing import Any, Dict

from backend.app.schemas.common import RetrievalCompareRequest, ScenarioDescriptor, ScenarioRunResponse
from backend.app.scenarios.base import Scenario


class RetrievalCompareScenario(Scenario):
    scenario_id = "retrieval_compare"
    request_model = RetrievalCompareRequest

    @property
    def descriptor(self) -> ScenarioDescriptor:
        return ScenarioDescriptor(
            scenario_id=self.scenario_id,
            name="检索与对比",
            description="预留给后续相似区域检索和区域对比流程的场景。",
            status="planned",
            supported_inputs=["geometry|point", "year", "top_k", "compare_year", "search_region"],
            supported_outputs=["point_collection", "vector_geojson", "summary_only"],
        )

    def run(self, payload: Dict[str, Any]) -> ScenarioRunResponse:
        self.request_model.model_validate(payload)
        raise NotImplementedError("retrieval_compare is planned but not implemented in v1.")
