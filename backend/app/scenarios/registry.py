from __future__ import annotations

from typing import Dict, List

from backend.app.scenarios.base import Scenario
from backend.app.scenarios.embedding_intro import EmbeddingIntroScenario
from backend.app.scenarios.mask_segmentation import ImageRetrievalScenario
from backend.app.scenarios.retrieval_compare import ClickQueryScenario


class ScenarioRegistry:
    def __init__(self) -> None:
        scenarios: List[Scenario] = [
            EmbeddingIntroScenario(),
            ImageRetrievalScenario(),
            ClickQueryScenario(),
        ]
        self._scenarios: Dict[str, Scenario] = {
            scenario.scenario_id: scenario
            for scenario in scenarios
        }

    def list(self) -> List[Scenario]:
        return list(self._scenarios.values())

    def get(self, scenario_id: str) -> Scenario | None:
        return self._scenarios.get(scenario_id)


registry = ScenarioRegistry()
