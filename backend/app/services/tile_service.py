from __future__ import annotations

from typing import Any, Dict


def get_tile_url(image: Any, vis_params: Dict[str, Any]) -> str:
    map_id = image.getMapId(vis_params)
    tile_fetcher = map_id.get("tile_fetcher")
    url_format = getattr(tile_fetcher, "url_format", None)
    if not url_format:
        raise RuntimeError("Earth Engine did not return a tile URL.")
    return url_format
