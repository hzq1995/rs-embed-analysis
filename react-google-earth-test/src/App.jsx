import { useEffect, useRef, useState } from "react";
import { fetchScenarios, runScenario } from "./api";
import { loadGoogleMaps } from "./googleMaps";

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const BAND_OPTIONS = Array.from({ length: 64 }, (_, index) =>
  `A${String(index).padStart(2, "0")}`
);

const defaultParams = {
  year: 2024,
  bandR: "A01",
  bandG: "A16",
  bandB: "A09",
  rgbMin: -0.3,
  rgbMax: 0.3,
  clusterCount: 5,
  sampleCount: 100,
  scale: 10,
  seed: 100,
  includeVectorProbe: false
};

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

function readPath(path) {
  const points = [];
  for (let index = 0; index < path.getLength(); index += 1) {
    const point = path.getAt(index);
    points.push({
      lat: point.lat(),
      lng: point.lng()
    });
  }
  return points;
}

function formatValue(value) {
  if (value == null) {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function TileOverlay({ layer, onToggle, onOpacityChange }) {
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
    </div>
  );
}

export default function App() {
  const mapHostRef = useRef(null);
  const mapRef = useRef(null);
  const mapsRef = useRef(null);
  const drawingRef = useRef(false);
  const roiClosedRef = useRef(false);
  const tempLineRef = useRef(null);
  const polygonRef = useRef(null);
  const markersRef = useRef([]);
  const polygonListenersRef = useRef([]);
  const [mapReady, setMapReady] = useState(false);
  const [status, setStatus] = useState("正在加载地图和场景配置...");
  const [error, setError] = useState("");
  const [scenarios, setScenarios] = useState([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("embedding_intro");
  const [params, setParams] = useState(defaultParams);
  const [roiPoints, setRoiPoints] = useState([]);
  const [roiClosed, setRoiClosed] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [layers, setLayers] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [artifacts, setArtifacts] = useState({});
  const [isRunning, setIsRunning] = useState(false);

  drawingRef.current = isDrawing;
  roiClosedRef.current = roiClosed;

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [scenarioResponse, maps] = await Promise.all([
          fetchScenarios(),
          loadGoogleMaps(MAPS_API_KEY)
        ]);
        const mapsLib = await maps.importLibrary("maps");
        const markerLib = await maps.importLibrary("marker");

        if (cancelled || !mapHostRef.current) {
          return;
        }

        mapsRef.current = {
          maps,
          Map: mapsLib.Map,
          Polyline: google.maps.Polyline,
          Polygon: google.maps.Polygon,
          LatLngBounds: google.maps.LatLngBounds,
          Size: google.maps.Size,
          Marker: markerLib.Marker || google.maps.Marker
        };

        const map = new mapsRef.current.Map(mapHostRef.current, {
          center: { lat: 29.8683, lng: 121.544 },
          zoom: 12,
          mapTypeId: "satellite",
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeControl: false
        });

        map.addListener("click", (event) => {
          if (!drawingRef.current || roiClosedRef.current) {
            return;
          }

          setRoiPoints((current) => [
            ...current,
            { lat: event.latLng.lat(), lng: event.latLng.lng() }
          ]);
        });

        mapRef.current = map;
        setScenarios(scenarioResponse);
        setMapReady(true);
        setStatus("地图已就绪，可以开始框选 ROI。");
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

    if (!tempLineRef.current) {
      tempLineRef.current = new mapClasses.Polyline({
        map,
        path: [],
        strokeColor: "#2563eb",
        strokeOpacity: 1,
        strokeWeight: 2
      });
    }

    if (!polygonRef.current) {
      polygonRef.current = new mapClasses.Polygon({
        map,
        paths: [],
        strokeColor: "#0f766e",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: "#2dd4bf",
        fillOpacity: 0.18,
        editable: false
      });
    }

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = roiPoints.map(
      (point, index) =>
        new mapClasses.Marker({
          map,
          position: point,
          title: `顶点 ${index + 1}`,
          label: {
            text: String(index + 1),
            color: "#ffffff",
            fontSize: "11px",
            fontWeight: "700"
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: "#2563eb",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            scale: 8
          }
        })
    );

    if (!roiClosed) {
      tempLineRef.current.setPath(roiPoints);
      polygonRef.current.setPaths([]);
      polygonRef.current.setEditable(false);
      polygonListenersRef.current.forEach((listener) => listener.remove());
      polygonListenersRef.current = [];
      return;
    }

    tempLineRef.current.setPath([]);
    polygonRef.current.setPaths(roiPoints);
    polygonRef.current.setEditable(true);

    const path = polygonRef.current.getPath();
    polygonListenersRef.current.forEach((listener) => listener.remove());
    polygonListenersRef.current = [
      path.addListener("set_at", () => setRoiPoints(readPath(path))),
      path.addListener("insert_at", () => setRoiPoints(readPath(path))),
      path.addListener("remove_at", () => setRoiPoints(readPath(path)))
    ];
  }, [roiPoints, roiClosed]);

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

    try {
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
    } catch (overlayError) {
      setError(
        overlayError instanceof Error
          ? `图层叠加失败: ${overlayError.message}`
          : "图层叠加失败。"
      );
    }
  }, [layers]);

  function startDrawing() {
    setError("");
    setStatus("绘制模式已开启，点击地图添加多边形顶点。");
    setLayers([]);
    setSummaries({});
    setArtifacts({});
    setRoiPoints([]);
    setRoiClosed(false);
    setIsDrawing(true);
  }

  function finishPolygon() {
    if (roiPoints.length < 3) {
      setError("至少需要 3 个顶点才能闭合多边形。");
      return;
    }

    setError("");
    setIsDrawing(false);
    setRoiClosed(true);
    setStatus("ROI 已闭合，可直接运行分析，也可拖动顶点微调。");

    const mapClasses = mapsRef.current;
    if (!mapClasses) {
      return;
    }

    const bounds = new mapClasses.LatLngBounds();
    roiPoints.forEach((point) => bounds.extend(point));
    mapRef.current?.fitBounds(bounds);
  }

  function clearRoi() {
    setRoiPoints([]);
    setRoiClosed(false);
    setIsDrawing(false);
    setLayers([]);
    setSummaries({});
    setArtifacts({});
    setError("");
    setStatus("ROI 已清空。");
  }

  function handleParamChange(event) {
    const { name, value, type, checked } = event.target;
    setParams((current) => ({
      ...current,
      [name]:
        type === "checkbox"
          ? checked
          : ["year", "clusterCount", "sampleCount", "scale", "seed"].includes(name)
            ? Number(value)
            : ["rgbMin", "rgbMax"].includes(name)
              ? Number(value)
              : value
    }));
  }

  async function runCurrentScenario() {
    const selectedScenario = scenarios.find(
      (scenario) => scenario.scenario_id === selectedScenarioId
    );

    if (!selectedScenario) {
      setError("场景配置还没有加载完成。");
      return;
    }

    if (selectedScenario.status !== "ready") {
      setError("当前场景是预留占位，还没有实现。");
      return;
    }

    if (!roiClosed || roiPoints.length < 3) {
      setError("请先完成 ROI 多边形绘制。");
      return;
    }

    const geometry = buildGeoJsonPolygon(roiPoints);
    if (!geometry) {
      setError("ROI 几何无效。");
      return;
    }

    setIsRunning(true);
    setError("");
    setStatus("正在请求 Earth Engine 分析...");

    try {
      const payload = {
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

      const response = await runScenario(selectedScenarioId, payload);
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
      setStatus("分析完成，图层已叠加到地图上。");
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

  return (
    <div className="appShell">
      <aside className="leftPanel">
        <p className="eyebrow">Geo Intelligence Platform</p>
        <h1>地图智能分析平台</h1>
        <p className="intro">
          当前默认实现的是卫星嵌入教程场景。后续的分割与检索/对比场景已经保留了统一协议和前端入口。
        </p>

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
          <button className="primaryBtn" onClick={startDrawing} type="button">
            开始绘制
          </button>
          <button
            className={isDrawing && !roiClosed ? "successBtn" : "ghostBtn"}
            onClick={finishPolygon}
            type="button"
          >
            完成闭合
          </button>
          <button className="ghostBtn" onClick={clearRoi} type="button">
            清空 ROI
          </button>
        </div>

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
        </div>

        <button
          className="runBtn"
          disabled={!mapReady || isRunning}
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
