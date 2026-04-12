from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from backend.app.config import get_settings
from backend.app.schemas.common import (
    EmbeddingVectorResponse,
    HealthResponse,
    ScenarioDescriptor,
    ScenarioRunResponse,
    VectorRequest,
)
from backend.app.scenarios.registry import registry
from backend.app.services.ee_auth_service import authenticate_and_initialize
from backend.app.services.embedding_service import fetch_embedding


router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        ee_project=settings.ee_project or None,
        scenario_count=len(registry.list()),
    )


@router.get("/scenarios", response_model=list[ScenarioDescriptor])
def list_scenarios() -> list[ScenarioDescriptor]:
    return [scenario.descriptor for scenario in registry.list()]


@router.post("/embedding/vector", response_model=EmbeddingVectorResponse)
def embedding_vector(request: VectorRequest) -> EmbeddingVectorResponse:
    settings = get_settings()
    try:
        authenticate_and_initialize(settings.ee_project, settings.ee_auth_mode)
        result = fetch_embedding(
            lon=request.lon,
            lat=request.lat,
            year=request.year,
            scale=request.scale,
            buffer_m=request.buffer_m,
        )
        return EmbeddingVectorResponse.model_validate(result)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=json.loads(exc.json())) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/scenarios/{scenario_id}/run", response_model=ScenarioRunResponse)
def run_scenario(scenario_id: str, payload: dict) -> ScenarioRunResponse:
    settings = get_settings()
    scenario = registry.get(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {scenario_id}")

    try:
        scenario.request_model.model_validate(payload)
        authenticate_and_initialize(settings.ee_project, settings.ee_auth_mode)
        return scenario.run(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=json.loads(exc.json())) from exc
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
