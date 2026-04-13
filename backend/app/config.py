from __future__ import annotations

import os
from functools import lru_cache


class Settings:
    def __init__(self) -> None:
        self.ee_project = os.getenv("EE_PROJECT", "promising-booth-469406-h8")  # "kaggle-350509"
        self.ee_auth_mode = os.getenv("EE_AUTH_MODE") or None
        self.allowed_origins = [
            origin.strip()
            for origin in os.getenv(
                "ALLOWED_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if origin.strip()
        ]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
