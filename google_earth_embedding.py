import json
from typing import Dict, Optional

from backend.app.services.ee_auth_service import authenticate_and_initialize
from backend.app.services.embedding_service import fetch_embedding


def query_embedding(
    lon: float,
    lat: float,
    year: int = 2024,
    scale: float = 10,
    buffer_m: float = 0,
    project: str = "kaggle-350509",
    auth_mode: Optional[str] = None,
) -> Dict[str, object]:
    """
    Query Google Earth Engine satellite embedding for a point.
    """
    authenticate_and_initialize(project=project, auth_mode=auth_mode)
    return fetch_embedding(
        lon=lon,
        lat=lat,
        year=year,
        scale=scale,
        buffer_m=buffer_m,
    )


if __name__ == "__main__":
    test_cases = [
        {"lon": 0.0, "lat": 0.0, "year": 2024, "desc": "Equator test"},
        {"lon": 114.2, "lat": 29.5, "year": 2023, "desc": "Wuhan area"},
        {"lon": -74.0, "lat": 40.7, "year": 2022, "desc": "New York"},
    ]

    for test in test_cases:
        desc = test.pop("desc")
        try:
            print(f"\n{'=' * 60}")
            print(f"Test: {desc}")
            print(f"Params: {test}")
            print(f"{'=' * 60}")
            result = query_embedding(**test)
            print(json.dumps(result, indent=2, ensure_ascii=False))
        except Exception as exc:
            print(f"Error: {exc}")
