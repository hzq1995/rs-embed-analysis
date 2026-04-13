import { useEffect, useRef, useState } from "react";
import { fetchScenarios, runScenario } from "./api";
import { parseGeoTiffSamplePoints } from "./geotiffUtils";
import { loadGoogleMaps } from "./googleMaps";

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const ROI_INSET_RATIO = 0.1;
const BAND_OPTIONS = Array.from({ length: 64 }, (_, index) =>
  `A${String(index).padStart(2, "0")}`
);
const SIMILARITY_SCENARIOS = new Set(["image_retrieval", "click_query"]);

const defaultParams = {
  year: 2024,
  bandR: "A01",
  bandG: "A16",
  bandB: "A09",
  rgbMin: -0.3,
  rgbMax: 0.3,
  clusterCount: 5,
  sampleCount: 300,
  scale: 10,
  seed: 100,
  includeVectorProbe: false,
  searchSizeKm: 3,
  topK: 10,
  candidateThreshold: 0.9,
  imageSampleCount: 9,
  imageMaxSpacingMeters: 10
};

function isSimilarityScenario(scenarioId) {
  return SIMILARITY_SCENARIOS.has(scenarioId);
}

function buildGeoJsonPolygon(points) {
  const coordinates = points.map((point) => [point.lng, point.lat]);
  if (coordinates.length === 0) {
    return null;
  }

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (!last || first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push(first);
  }

  return {
    type: "Polygon",
    coordinates: [coordinates]
  };
}

function buildViewportInsetPolygon(bounds, insetRatio = ROI_INSET_RATIO) {
  if (!bounds) {
    return [];
  }

  const { north, east, south, west } = bounds;
  const latPadding = (north - south) * insetRatio;
  const lngPadding = (east - west) * insetRatio;

  return [
    { lat: north - latPadding, lng: west + lngPadding },
    { lat: north - latPadding, lng: east - lngPadding },
    { lat: south + latPadding, lng: east - lngPadding },
    { lat: south + latPadding, lng: west + lngPadding }
  ];
}

function extractMapSnapshot(map) {
  const center = map.getCenter();
  const bounds = map.getBounds();
  const northEast = bounds?.getNorthEast();
  const southWest = bounds?.getSouthWest();

  if (!center || !northEast || !southWest) {
    return null;
  }

  return {
    center: {
      lat: center.lat(),
      lng: center.lng()
    },
    bounds: {
      north: northEast.lat(),
      east: northEast.lng(),
      south: southWest.lat(),
      west: southWest.lng()
    }
  };
}

function formatValue(value) {
  if (value == null) {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(6);
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function formatCoordinate(point) {
  if (!point) {
    return "-";
  }
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

function extractPointFeatures(layer) {
  if (
    layer?.layer_type !== "point_collection" ||
    layer?.geojson?.type !== "FeatureCollection"
  ) {
    return [];
  }

  const features = Array.isArray(layer.geojson.features) ? layer.geojson.features : [];
  return features
    .map((feature) => {
      if (feature?.geometry?.type !== "Point") {
        return null;
      }

      const [lng, lat] = feature.geometry.coordinates || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      return { lat, lng };
    })
    .filter(Boolean);
}

function getScenarioHint(scenarioId) {
  if (scenarioId === "image_retrieval") {
    return "上传 GeoTIFF，均匀取点后用平均 embedding 运行相似检索，参考点最大相邻间距默认 10 米。";
  }
  if (scenarioId === "click_query") {
    return "点击地图可连续添加多个参考点，系统会用平均 embedding 做检索。";
  }
  return "当前视野会生成一个内缩 ROI，并叠加嵌入分析图层。";
}

function TileOverlay({ layer, onToggle, onOpacityChange }) {
  const supportsOpacity = layer.layer_type === "raster_tile";

  return (
    <div className="layerCard">
      <label className="layerHeader">
        <input
          checked={layer.visible}
          onChange={(event) => onToggle(layer.layer_id, event.target.checked)}
          type="checkbox"
        />
        <span>{layer.name}</span>
      </label>
      <div className="layerMeta">{layer.layer_type}</div>
      {supportsOpacity ? (
        <label className="sliderRow">
          <span>透明度</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={layer.opacity}
            onChange={(event) =>
              onOpacityChange(layer.layer_id, Number(event.target.value))
            }
          />
        </label>
      ) : null}
    </div>
  );
}

export default function App() {
  const mapHostRef = useRef(null);
  const mapRef = useRef(null);
  const mapsRef = useRef(null);
  const listenersRef = useRef([]);
  const referenceMarkersRef = useRef([]);
  const resultMarkersRef = useRef([]);
  const infoWindowRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadedTifFileRef = useRef(null);
  const selectedScenarioIdRef = useRef("embedding_intro");
  const pendingAutoFitRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [status, setStatus] = useState("正在加载地图和场景配置...");
  const [error, setError] = useState("");
  const [scenarios, setScenarios] = useState([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("embedding_intro");
  const [params, setParams] = useState(defaultParams);
  const [mapSnapshot, setMapSnapshot] = useState(null);
  const [layers, setLayers] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [artifacts, setArtifacts] = useState({});
  const [referencePoints, setReferencePoints] = useState([]);
  const [uploadedTifMeta, setUploadedTifMeta] = useState(null);
  const [isParsingTif, setIsParsingTif] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const similarityMode = isSimilarityScenario(selectedScenarioId);
  const latestReferencePoint =
    referencePoints.length > 0 ? referencePoints[referencePoints.length - 1] : null;

  async function parseUploadedTif(file, sampleCount, maxSpacingMeters) {
    setIsParsingTif(true);
    setError("");
    setStatus("正在解析 GeoTIFF 采样点...");

    try {
      const tifData = await parseGeoTiffSamplePoints(
        file,
        sampleCount,
        maxSpacingMeters
      );
      const samplePoints = tifData.samplePoints || [];

      setReferencePoints(samplePoints);
      setUploadedTifMeta({
        fileName: file.name,
        sourceCrs: tifData.sourceCrs,
        samplePointCount: samplePoints.length,
        firstPoint: samplePoints[0] || null,
        maxSpacingMeters
      });
      setStatus("GeoTIFF 解析完成，可运行图片检索。");
    } catch (parseError) {
      setUploadedTifMeta(null);
      setReferencePoints([]);
      setError(parseError.message);
      setStatus("GeoTIFF 解析失败。");
    } finally {
      setIsParsingTif(false);
    }
  }

  useEffect(() => {
    selectedScenarioIdRef.current = selectedScenarioId;
  }, [selectedScenarioId]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [scenarioResponse, maps] = await Promise.all([
          fetchScenarios(),
          loadGoogleMaps(MAPS_API_KEY)
        ]);
        const mapsLib = await maps.importLibrary("maps");

        if (cancelled || !mapHostRef.current) {
          return;
        }

        mapsRef.current = {
          maps,
          Map: mapsLib.Map,
          Marker: google.maps.Marker,
          InfoWindow: google.maps.InfoWindow,
          Size: google.maps.Size
        };

        const map = new mapsRef.current.Map(mapHostRef.current, {
          center: { lat: 29.8683, lng: 121.544 },
          zoom: 17,
          mapTypeId: "satellite",
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeControl: false
        });

        mapRef.current = map;
        infoWindowRef.current = new mapsRef.current.InfoWindow();

        const updateSnapshot = () => {
          const snapshot = extractMapSnapshot(map);
          if (snapshot) {
            setMapSnapshot(snapshot);
          }
        };

        listenersRef.current = [
          map.addListener("idle", updateSnapshot),
          map.addListener("click", (event) => {
            if (selectedScenarioIdRef.current !== "click_query") {
              return;
            }

            const latLng = event.latLng;
            if (!latLng) {
              return;
            }

            setReferencePoints((current) => [
              ...current,
              {
                lat: latLng.lat(),
                lng: latLng.lng()
              }
            ]);
            setError("");
            setStatus("已添加参考点，可继续选点或直接运行查询。");
          })
        ];

        setScenarios(scenarioResponse);
        if (
          !scenarioResponse.some(
            (scenario) => scenario.scenario_id === selectedScenarioIdRef.current
          )
        ) {
          setSelectedScenarioId(scenarioResponse[0]?.scenario_id || "embedding_intro");
        }
        setMapReady(true);
        updateSnapshot();
        setStatus("地图已就绪，可直接运行当前场景。");
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(bootstrapError.message);
          setStatus("初始化失败。");
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      listenersRef.current.forEach((listener) => listener?.remove?.());
      listenersRef.current = [];
      resultMarkersRef.current.forEach((marker) => marker.setMap(null));
      resultMarkersRef.current = [];
      referenceMarkersRef.current.forEach((marker) => marker.setMap(null));
      referenceMarkersRef.current = [];
      mapRef.current = null;
      mapsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const mapClasses = mapsRef.current;
    if (!map || !mapClasses) {
      return;
    }

    referenceMarkersRef.current.forEach((marker) => marker.setMap(null));
    referenceMarkersRef.current = [];

    if (referencePoints.length === 0 || !similarityMode) {
      return;
    }

    referenceMarkersRef.current = referencePoints.map((point, index) => {
      const isMultiClick = selectedScenarioId === "click_query";
      return new mapClasses.Marker({
        map,
        position: point,
        title: "Reference Point",
        label: {
          text: isMultiClick ? String(index + 1) : "R",
          color: "#ffffff",
          fontSize: "12px",
          fontWeight: "700"
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: "#dc2626",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
          scale: 10
        }
      });
    });
  }, [referencePoints, selectedScenarioId, similarityMode]);

  useEffect(() => {
    const map = mapRef.current;
    const mapClasses = mapsRef.current;
    if (!map || !mapClasses) {
      return;
    }

    const overlays = map.overlayMapTypes;
    while (overlays.getLength() > 0) {
      overlays.removeAt(0);
    }

    layers
      .filter(
        (layer) =>
          layer.visible &&
          layer.layer_type === "raster_tile" &&
          typeof layer.tile_url === "string" &&
          layer.tile_url.length > 0
      )
      .forEach((layer) => {
        const mapType = {
          name: layer.name,
          tileSize: new mapClasses.Size(256, 256),
          getTile(coord, zoom, ownerDocument) {
            const image = ownerDocument.createElement("img");
            image.src = layer.tile_url
              .replace("{x}", String(coord.x))
              .replace("{y}", String(coord.y))
              .replace("{z}", String(zoom));
            image.alt = layer.name;
            image.draggable = false;
            image.style.width = "256px";
            image.style.height = "256px";
            image.style.display = "block";
            image.style.opacity = String(layer.opacity ?? 1);
            image.style.pointerEvents = "none";
            return image;
          },
          releaseTile(tile) {
            if (tile?.remove) {
              tile.remove();
            }
          }
        };
        overlays.insertAt(overlays.getLength(), mapType);
      });
  }, [layers]);

  useEffect(() => {
    const map = mapRef.current;
    const mapClasses = mapsRef.current;
    if (!map || !mapClasses) {
      return;
    }

    resultMarkersRef.current.forEach((marker) => marker.setMap(null));
    resultMarkersRef.current = [];

    const infoWindow = infoWindowRef.current;
    infoWindow?.close();

    layers
      .filter(
        (layer) =>
          layer.visible &&
          layer.layer_type === "point_collection" &&
          layer.geojson?.type === "FeatureCollection"
      )
      .forEach((layer) => {
        const features = Array.isArray(layer.geojson.features)
          ? layer.geojson.features
          : [];

        features.forEach((feature) => {
          if (feature?.geometry?.type !== "Point") {
            return;
          }

          const [lng, lat] = feature.geometry.coordinates || [];
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return;
          }

          const rank = feature.properties?.rank;
          const score = feature.properties?.score;
          const marker = new mapClasses.Marker({
            map,
            position: { lat, lng },
            title: layer.name,
            label: rank
              ? {
                  text: String(rank),
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: "700"
                }
              : undefined,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: "#2563eb",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
              scale: 11
            }
          });

          marker.addListener("click", () => {
            infoWindow?.setContent(
              `<div class="mapInfoWindow"><strong>${layer.name}</strong><br/>Rank: ${rank ?? "-"}<br/>Score: ${score ?? "-"}</div>`
            );
            infoWindow?.open({
              map,
              anchor: marker
            });
          });

          resultMarkersRef.current.push(marker);
        });
      });
  }, [layers]);

  useEffect(() => {
    if (!pendingAutoFitRef.current || !similarityMode) {
      return;
    }

    const map = mapRef.current;
    const mapsApi = mapsRef.current?.maps;
    if (!map || !mapsApi) {
      return;
    }

    const resultPoints = layers.flatMap(extractPointFeatures);
    const allPoints = [...referencePoints, ...resultPoints];

    if (allPoints.length === 0) {
      pendingAutoFitRef.current = false;
      return;
    }

    if (allPoints.length === 1) {
      map.panTo(allPoints[0]);
      map.setZoom(17);
      pendingAutoFitRef.current = false;
      return;
    }

    const bounds = new mapsApi.LatLngBounds();
    allPoints.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 80);
    pendingAutoFitRef.current = false;
  }, [layers, referencePoints, similarityMode]);

  useEffect(() => {
    pendingAutoFitRef.current = false;
    setLayers([]);
    setSummaries({});
    setArtifacts({});
    setError("");
    setReferencePoints([]);
    setUploadedTifMeta(null);
    uploadedTifFileRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setStatus(getScenarioHint(selectedScenarioId));
  }, [selectedScenarioId]);

  useEffect(() => {
    if (selectedScenarioId !== "image_retrieval" || !uploadedTifFileRef.current) {
      return;
    }

    parseUploadedTif(
      uploadedTifFileRef.current,
      params.imageSampleCount,
      params.imageMaxSpacingMeters
    );
  }, [params.imageSampleCount, params.imageMaxSpacingMeters, selectedScenarioId]);

  function clearScene() {
    pendingAutoFitRef.current = false;
    setLayers([]);
    setSummaries({});
    setArtifacts({});
    setReferencePoints([]);
    setUploadedTifMeta(null);
    uploadedTifFileRef.current = null;
    setError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setStatus("已清空当前场景结果。");
  }

  function clearClickReferencePoints() {
    setReferencePoints([]);
    setError("");
    setStatus("已清空点击参考点。");
  }

  function handleParamChange(event) {
    const { name, value, type, checked } = event.target;
    setParams((current) => ({
      ...current,
      [name]:
        type === "checkbox"
          ? checked
          : [
                "year",
                "clusterCount",
                "sampleCount",
                "imageSampleCount",
                "imageMaxSpacingMeters",
                "scale",
                "seed",
                "searchSizeKm",
                "topK"
              ].includes(name)
            ? Number(value)
            : ["rgbMin", "rgbMax", "candidateThreshold"].includes(name)
              ? Number(value)
              : value
    }));
  }

  async function handleTifUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      uploadedTifFileRef.current = null;
      setUploadedTifMeta(null);
      setReferencePoints([]);
      return;
    }

    uploadedTifFileRef.current = file;
    await parseUploadedTif(
      file,
      params.imageSampleCount,
      params.imageMaxSpacingMeters
    );
  }

  async function runCurrentScenario() {
    const selectedScenario = scenarios.find(
      (scenario) => scenario.scenario_id === selectedScenarioId
    );

    if (!selectedScenario) {
      setError("场景配置尚未加载完成。");
      return;
    }

    if (selectedScenario.status !== "ready") {
      setError("当前场景尚未实现。");
      return;
    }

    setIsRunning(true);
    setError("");
    setStatus("正在请求引擎分析...");

    try {
      let payload;

      if (selectedScenarioId === "embedding_intro") {
        const geometryPoints = buildViewportInsetPolygon(mapSnapshot?.bounds);
        if (geometryPoints.length < 3) {
          throw new Error("当前地图范围尚未稳定，无法生成分析区域。");
        }

        const geometry = buildGeoJsonPolygon(geometryPoints);
        if (!geometry) {
          throw new Error("ROI 几何无效。");
        }

        payload = {
          geometry,
          year: params.year,
          rgb_bands: [params.bandR, params.bandG, params.bandB],
          rgb_min: params.rgbMin,
          rgb_max: params.rgbMax,
          cluster_count: params.clusterCount,
          sample_count: params.sampleCount,
          scale: params.scale,
          seed: params.seed,
          include_vector_probe: params.includeVectorProbe
        };
      } else {
        if (referencePoints.length === 0) {
          throw new Error("请先设置参考点。");
        }

        if (!mapSnapshot?.center) {
          throw new Error("当前地图中心尚未稳定，无法生成搜索区域。");
        }

        payload = {
          reference_points: referencePoints.map((point) => [
            point.lng,
            point.lat
          ]),
          search_center: [mapSnapshot.center.lng, mapSnapshot.center.lat],
          search_size_km: params.searchSizeKm,
          top_k: params.topK,
          year: params.year,
          scale: params.scale,
          candidate_threshold: params.candidateThreshold
        };
      }

      const response = await runScenario(selectedScenarioId, payload);
      pendingAutoFitRef.current = isSimilarityScenario(selectedScenarioId);
      setLayers(
        Array.isArray(response.layers)
          ? response.layers.map((layer) => ({
              ...layer,
              visible: true,
              opacity: typeof layer.opacity === "number" ? layer.opacity : 1
            }))
          : []
      );
      setSummaries(response.summaries || {});
      setArtifacts(response.artifacts || {});
      setStatus("分析完成，结果已叠加到地图上。");
    } catch (runError) {
      setError(runError.message);
      setStatus("分析失败。");
    } finally {
      setIsRunning(false);
    }
  }

  function updateLayerVisibility(layerId, visible) {
    setLayers((current) =>
      current.map((layer) =>
        layer.layer_id === layerId ? { ...layer, visible } : layer
      )
    );
  }

  function updateLayerOpacity(layerId, opacity) {
    setLayers((current) =>
      current.map((layer) =>
        layer.layer_id === layerId ? { ...layer, opacity } : layer
      )
    );
  }

  const selectedScenario = scenarios.find(
    (scenario) => scenario.scenario_id === selectedScenarioId
  );
  const runDisabled =
    !mapReady ||
    isRunning ||
    isParsingTif ||
    (similarityMode && referencePoints.length === 0);

  return (
    <div className="appShell">
      <aside className="leftPanel">
        <p className="eyebrow">Geo Intelligence Platform</p>
        <h1>遥感智能分析平台</h1>
        <p className="intro">{getScenarioHint(selectedScenarioId)}</p>

        <label className="field">
          <span>场景</span>
          <select
            className="select"
            value={selectedScenarioId}
            onChange={(event) => setSelectedScenarioId(event.target.value)}
          >
            {scenarios.map((scenario) => (
              <option key={scenario.scenario_id} value={scenario.scenario_id}>
                {scenario.name}
              </option>
            ))}
          </select>
        </label>

        <div className="scenarioBox">
          <strong>{selectedScenario?.name || "Loading..."}</strong>
          <p>{selectedScenario?.description || "正在加载场景说明..."}</p>
          <span className={`statusPill ${selectedScenario?.status || "planned"}`}>
            {selectedScenario?.status || "planned"}
          </span>
        </div>

        <div className="controlRow">
          <button className="ghostBtn" onClick={clearScene} type="button">
            清空结果
          </button>
          {selectedScenarioId === "click_query" ? (
            <button
              className="ghostBtn"
              onClick={clearClickReferencePoints}
              type="button"
            >
              清空选点
            </button>
          ) : null}
        </div>

        {selectedScenarioId === "image_retrieval" ? (
          <div className="scenarioBox">
            <label className="field">
              <span>GeoTIFF 文件</span>
              <input
                ref={fileInputRef}
                accept=".tif,.tiff"
                type="file"
                onChange={handleTifUpload}
              />
            </label>
            <div className="metaBlock">
              <div>
                <span className="metaLabel">文件</span>
                <strong>{uploadedTifMeta?.fileName || "-"}</strong>
              </div>
              <div>
                <span className="metaLabel">源坐标系</span>
                <strong>{uploadedTifMeta?.sourceCrs || "-"}</strong>
              </div>
              <div>
                <span className="metaLabel">取点数量</span>
                <strong>{uploadedTifMeta?.samplePointCount || 0}</strong>
              </div>
              <div>
                <span className="metaLabel">最大相邻间距</span>
                <strong>
                  {uploadedTifMeta?.maxSpacingMeters != null
                    ? `${uploadedTifMeta.maxSpacingMeters} m`
                    : "-"}
                </strong>
              </div>
              <div>
                <span className="metaLabel">首个采样点</span>
                <strong>{formatCoordinate(uploadedTifMeta?.firstPoint)}</strong>
              </div>
            </div>
          </div>
        ) : null}

        {selectedScenarioId === "click_query" ? (
          <div className="scenarioBox">
            <div className="metaBlock">
              <div>
                <span className="metaLabel">已选点数</span>
                <strong>{referencePoints.length}</strong>
              </div>
              <div>
                <span className="metaLabel">最新参考点</span>
                <strong>{formatCoordinate(latestReferencePoint)}</strong>
              </div>
              <div>
                <span className="metaLabel">搜索中心</span>
                <strong>{formatCoordinate(mapSnapshot?.center)}</strong>
              </div>
            </div>
          </div>
        ) : null}

        <details className="paramsPanel">
          <summary className="paramsSummary">参数设置</summary>
          <div className="fieldGrid">
            <label className="field">
              <span>年份</span>
              <input
                name="year"
                type="number"
                min="2017"
                value={params.year}
                onChange={handleParamChange}
              />
            </label>

            {similarityMode ? (
              <>
                {selectedScenarioId === "image_retrieval" ? (
                  <>
                    <label className="field">
                      <span>取点数量</span>
                      <input
                        name="imageSampleCount"
                        type="number"
                        min="1"
                        max="100"
                        value={params.imageSampleCount}
                        onChange={handleParamChange}
                      />
                    </label>

                    <label className="field">
                      <span>最大相邻间距 m</span>
                      <input
                        name="imageMaxSpacingMeters"
                        type="number"
                        min="1"
                        value={params.imageMaxSpacingMeters}
                        onChange={handleParamChange}
                      />
                    </label>
                  </>
                ) : null}

                <label className="field">
                  <span>搜索边长 km</span>
                  <input
                    name="searchSizeKm"
                    type="number"
                    min="1"
                    value={params.searchSizeKm}
                    onChange={handleParamChange}
                  />
                </label>

                <label className="field">
                  <span>结果数量</span>
                  <input
                    name="topK"
                    type="number"
                    min="1"
                    max="100"
                    value={params.topK}
                    onChange={handleParamChange}
                  />
                </label>

                <label className="field">
                  <span>Scale</span>
                  <input
                    name="scale"
                    type="number"
                    min="1"
                    value={params.scale}
                    onChange={handleParamChange}
                  />
                </label>

                <label className="field">
                  <span>候选阈值</span>
                  <input
                    name="candidateThreshold"
                    type="number"
                    step="0.01"
                    min="-1"
                    max="1"
                    value={params.candidateThreshold}
                    onChange={handleParamChange}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>RGB Band R</span>
                  <select
                    className="select"
                    name="bandR"
                    value={params.bandR}
                    onChange={handleParamChange}
                  >
                    {BAND_OPTIONS.map((band) => (
                      <option key={band} value={band}>
                        {band}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>RGB Band G</span>
                  <select
                    className="select"
                    name="bandG"
                    value={params.bandG}
                    onChange={handleParamChange}
                  >
                    {BAND_OPTIONS.map((band) => (
                      <option key={band} value={band}>
                        {band}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>RGB Band B</span>
                  <select
                    className="select"
                    name="bandB"
                    value={params.bandB}
                    onChange={handleParamChange}
                  >
                    {BAND_OPTIONS.map((band) => (
                      <option key={band} value={band}>
                        {band}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>RGB Min</span>
                  <input
                    name="rgbMin"
                    type="number"
                    step="0.1"
                    value={params.rgbMin}
                    onChange={handleParamChange}
                  />
                </label>

                <label className="field">
                  <span>RGB Max</span>
                  <input
                    name="rgbMax"
                    type="number"
                    step="0.1"
                    value={params.rgbMax}
                    onChange={handleParamChange}
                  />
                </label>

                <label className="field">
                  <span>聚类数</span>
                  <input
                    name="clusterCount"
                    type="number"
                    min="2"
                    value={params.clusterCount}
                    onChange={handleParamChange}
                  />
                </label>

                <label className="field">
                  <span>采样数</span>
                  <input
                    name="sampleCount"
                    type="number"
                    min="10"
                    value={params.sampleCount}
                    onChange={handleParamChange}
                  />
                </label>

                <label className="field">
                  <span>Scale</span>
                  <input
                    name="scale"
                    type="number"
                    min="1"
                    value={params.scale}
                    onChange={handleParamChange}
                  />
                </label>

                <label className="field">
                  <span>Seed</span>
                  <input
                    name="seed"
                    type="number"
                    value={params.seed}
                    onChange={handleParamChange}
                  />
                </label>

                <label className="checkboxRow">
                  <input
                    checked={params.includeVectorProbe}
                    name="includeVectorProbe"
                    onChange={handleParamChange}
                    type="checkbox"
                  />
                  <span>返回 ROI 质心 embedding 调试向量</span>
                </label>
              </>
            )}
          </div>
        </details>

        <button
          className="runBtn"
          disabled={runDisabled}
          onClick={runCurrentScenario}
          type="button"
        >
          {isRunning ? "运行中..." : "运行当前场景"}
        </button>

        <p className="statusLine">{status}</p>
        {error ? <p className="errorText">{error}</p> : null}
      </aside>

      <main className="mapPane">
        <div className="mapViewport" ref={mapHostRef} />
      </main>

      <aside className="rightPanel">
        <section className="sideSection">
          <h2>图层</h2>
          {layers.length === 0 ? (
            <p className="placeholder">运行场景后，这里会显示可切换图层。</p>
          ) : (
            layers.map((layer) => (
              <TileOverlay
                key={layer.layer_id}
                layer={layer}
                onToggle={updateLayerVisibility}
                onOpacityChange={updateLayerOpacity}
              />
            ))
          )}
        </section>

        <section className="sideSection">
          <h2>摘要</h2>
          {Object.keys(summaries).length === 0 ? (
            <p className="placeholder">暂无摘要结果。</p>
          ) : (
            <div className="summaryList">
              {Object.entries(summaries).map(([key, value]) => (
                <div className="summaryRow" key={key}>
                  <span>{key}</span>
                  <strong>{formatValue(value)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="sideSection">
          <h2>Artifacts</h2>
          {Object.keys(artifacts).length === 0 ? (
            <p className="placeholder">当前没有额外 artifacts。</p>
          ) : (
            <pre className="artifactBox">{JSON.stringify(artifacts, null, 2)}</pre>
          )}
        </section>
      </aside>
    </div>
  );
}
