from __future__ import annotations

from typing import Optional

import ee


_initialized = False


def authenticate_and_initialize(project: str, auth_mode: Optional[str] = None) -> None:
    global _initialized
    if _initialized:
        return

    if not project:
        raise ValueError("Missing project ID. Pass project parameter or set EE_PROJECT.")

    try:
        ee.Initialize(project=project)
    except Exception:
        if auth_mode:
            ee.Authenticate(auth_mode=auth_mode)
        else:
            ee.Authenticate()
        ee.Initialize(project=project)

    _initialized = True
