from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Type

from pydantic import BaseModel

from backend.app.schemas.common import ScenarioDescriptor, ScenarioRunResponse


class Scenario(ABC):
    scenario_id: str
    request_model: Type[BaseModel]
    requires_ee: bool = True

    @property
    @abstractmethod
    def descriptor(self) -> ScenarioDescriptor:
        raise NotImplementedError

    @abstractmethod
    def run(self, payload: Dict[str, Any]) -> ScenarioRunResponse:
        raise NotImplementedError
