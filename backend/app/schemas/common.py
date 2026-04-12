from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


BandName = Literal[
    "A00", "A01", "A02", "A03", "A04", "A05", "A06", "A07",
    "A08", "A09", "A10", "A11", "A12", "A13", "A14", "A15",
    "A16", "A17", "A18", "A19", "A20", "A21", "A22", "A23",
    "A24", "A25", "A26", "A27", "A28", "A29", "A30", "A31",
    "A32", "A33", "A34", "A35", "A36", "A37", "A38", "A39",
    "A40", "A41", "A42", "A43", "A44", "A45", "A46", "A47",
    "A48", "A49", "A50", "A51", "A52", "A53", "A54", "A55",
    "A56", "A57", "A58", "A59", "A60", "A61", "A62", "A63",
]


class AppBaseModel(BaseModel):
    model_config = ConfigDict(protected_namespaces=())


class GeoJsonPolygon(AppBaseModel):
    type: Literal["Polygon"]
    coordinates: List[List[List[float]]]

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, coordinates: List[List[List[float]]]) -> List[List[List[float]]]:
        if not coordinates or not coordinates[0]:
            raise ValueError("Polygon must include at least one linear ring.")

        ring = coordinates[0]
        if len(ring) < 4:
            raise ValueError("Polygon ring must contain at least 4 coordinates.")

        for coordinate in ring:
            if len(coordinate) != 2:
                raise ValueError("Each coordinate must contain [lng, lat].")
            lng, lat = coordinate
            if not (-180 <= lng <= 180 and -90 <= lat <= 90):
                raise ValueError("Coordinate is outside valid longitude/latitude bounds.")

        unique_vertices = {tuple(point) for point in ring[:-1]}
        if len(unique_vertices) < 3:
            raise ValueError("Polygon must contain at least 3 distinct vertices.")

        return coordinates


class LayerModel(AppBaseModel):
    layer_id: str
    layer_type: Literal["raster_tile", "vector_geojson", "point_collection", "summary_only"]
    name: str
    tile_url: Optional[str] = None
    geojson: Optional[Dict[str, Any]] = None
    legend: Optional[Dict[str, Any]] = None
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    bounds: Optional[List[List[float]]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ScenarioDescriptor(AppBaseModel):
    scenario_id: str
    name: str
    description: str
    status: Literal["ready", "planned", "not_implemented"]
    supported_inputs: List[str]
    supported_outputs: List[str]


class ScenarioRunResponse(AppBaseModel):
    request_echo: Dict[str, Any]
    layers: List[LayerModel] = Field(default_factory=list)
    summaries: Dict[str, Any] = Field(default_factory=dict)
    artifacts: Dict[str, Any] = Field(default_factory=dict)


class HealthResponse(AppBaseModel):
    status: str
    ee_project: Optional[str] = None
    scenario_count: int


class VectorRequest(AppBaseModel):
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    year: int = Field(default=2024, ge=2017, le=2100)
    scale: float = Field(default=10, gt=0)
    buffer_m: float = Field(default=0, ge=0)


class EmbeddingVectorResponse(AppBaseModel):
    dataset_id: str
    year: int
    location: Dict[str, float]
    scale_m: float
    buffer_m: float
    missing_bands: List[str]
    embedding_dimension: int
    embedding: List[Optional[float]]


class EmbeddingIntroRequest(AppBaseModel):
    geometry: GeoJsonPolygon
    year: int = Field(default=2024, ge=2017, le=2100)
    rgb_bands: List[BandName] = Field(default_factory=lambda: ["A01", "A16", "A09"])
    rgb_min: float = -0.3
    rgb_max: float = 0.3
    cluster_count: int = Field(default=5, ge=2, le=50)
    sample_count: int = Field(default=1000, ge=10, le=10000)
    scale: float = Field(default=10, gt=0)
    seed: int = 100
    include_vector_probe: bool = False

    @field_validator("rgb_bands")
    @classmethod
    def validate_band_count(cls, rgb_bands: List[str]) -> List[str]:
        if len(rgb_bands) != 3:
            raise ValueError("rgb_bands must include exactly 3 bands.")
        return rgb_bands


class MaskSegmentationRequest(AppBaseModel):
    geometry: GeoJsonPolygon
    year: int = Field(default=2024, ge=2017, le=2100)
    model_id: str = "planned-mask-model"
    threshold: float = Field(default=0.5, ge=0, le=1)
    postprocess: Optional[Dict[str, Any]] = None


class RetrievalCompareRequest(AppBaseModel):
    geometry: Optional[GeoJsonPolygon] = None
    point: Optional[List[float]] = None
    year: int = Field(default=2024, ge=2017, le=2100)
    top_k: int = Field(default=10, ge=1, le=100)
    compare_year: Optional[int] = Field(default=None, ge=2017, le=2100)
    search_region: Optional[GeoJsonPolygon] = None

    @model_validator(mode="after")
    def validate_input_shape(self) -> "RetrievalCompareRequest":
        if self.geometry is None and self.point is None:
            raise ValueError("Either geometry or point must be provided.")

        if self.point is not None:
            if len(self.point) != 2:
                raise ValueError("point must contain [lng, lat].")
            lng, lat = self.point
            if not (-180 <= lng <= 180 and -90 <= lat <= 90):
                raise ValueError("point is outside valid longitude/latitude bounds.")

        return self
