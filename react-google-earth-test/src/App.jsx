import { useEffect, useRef, useState } from "react";
import { fetchScenarios, runScenario } from "./api";
import LeftPanel from "./components/LeftPanel";
import RightPanel from "./components/RightPanel";
import SpartinaTifOverlay from "./components/SpartinaTifOverlay";
import { parseGeoTiffSamplePoints } from "./geotiffUtils";
import { useMapScene } from "./hooks/useMapScene";
import { buildGeoJsonPolygon, buildViewportInsetPolygon } from "./mapUtils";
import {
  defaultParams,
  isSimilarityScenario,
  SPARTINA_SCENARIO_ID
} from "./scenarioConfig";

const PARAMS_STORAGE_KEY = "rs_embed_params";
const SCENARIO_VIEW_STORAGE_KEY = "rs_embed_scenario_views";
const CLICK_QUERY_CATEGORIES_STORAGE_KEY = "rs_embed_click_query_categories";
const HIDDEN_SCENARIO_IDS = new Set(["image_retrieval"]);
const SPARTINA_EXTRACTION_DELAY_MS = 1000;

function sleep(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function loadStoredParams() {
  try {
    const raw = localStorage.getItem(PARAMS_STORAGE_KEY);
    if (!raw) {
      return defaultParams;
    }
    const stored = JSON.parse(raw);
    return {
      ...defaultParams,
      ...stored,
      includeVectorProbe: defaultParams.includeVectorProbe
    };
  } catch {
    return defaultParams;
  }
}

function loadStoredScenarioViews() {
  try {
    const raw = localStorage.getItem(SCENARIO_VIEW_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const stored = JSON.parse(raw);
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function normalizePoint(point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return null;
  }

  return {
    lat: Number(point.lat),
    lng: Number(point.lng)
  };
}

function loadStoredClickPointCategories() {
  try {
    const raw = localStorage.getItem(CLICK_QUERY_CATEGORIES_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return {};
    }

    return Object.entries(stored).reduce((result, [key, value]) => {
      const name =
        typeof value?.name === "string" && value.name.trim().length > 0
          ? value.name.trim()
          : typeof key === "string"
            ? key.trim()
            : "";
      const points = Array.isArray(value?.points)
        ? value.points.map(normalizePoint).filter(Boolean)
        : [];

      if (!name || points.length === 0) {
        return result;
      }

      result[name] = {
        name,
        points
      };
      return result;
    }, {});
  } catch {
    return {};
  }
}

function shouldRememberScenarioView(scenarioId) {
  return Boolean(scenarioId) && scenarioId !== SPARTINA_SCENARIO_ID;
}

function isSameSnapshot(snapshotA, snapshotB) {
  return JSON.stringify(snapshotA) === JSON.stringify(snapshotB);
}

function getLayerDefaults(scenarioId, layer) {
  const isEmbeddingRgbLayer =
    typeof layer.name === "string" && layer.name.includes("Embedding RGB");

  return {
    visible: !isEmbeddingRgbLayer,
    opacity: typeof layer.opacity === "number" ? layer.opacity : 1
  };
}

function getScenarioStatusText(scenarioId) {
  if (scenarioId === SPARTINA_SCENARIO_ID) {
    return "已定位到互花米草区域，可直接叠加提取掩膜。";
  }
  if (scenarioId === "image_retrieval") {
    return "上传 GeoTIFF 后即可运行语义检索。";
  }
  if (scenarioId === "click_query") {
    return "点击地图添加参考点后即可运行选点查询。";
  }
  return "地图已就绪，可直接运行当前场景。";
}

export default function App() {
  const fileInputRef = useRef(null);
  const uploadedTifFileRef = useRef(null);
  const restoredScenarioIdRef = useRef(null);
  const [status, setStatus] = useState("正在加载地图和场景配置...");
  const [error, setError] = useState("");
  const [scenarios, setScenarios] = useState([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("embedding_intro");
  const [params, setParams] = useState(loadStoredParams);
  const [scenarioViews, setScenarioViews] = useState(loadStoredScenarioViews);
  const [savedClickPointCategories, setSavedClickPointCategories] = useState(
    loadStoredClickPointCategories
  );
  const [layers, setLayers] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [artifacts, setArtifacts] = useState({});
  const [referencePoints, setReferencePoints] = useState([]);
  const [activeClickPointCategoryName, setActiveClickPointCategoryName] = useState("");
  const [clickPointCategoryInput, setClickPointCategoryInput] = useState("");
  const [isActiveClickPointCategorySynced, setIsActiveClickPointCategorySynced] =
    useState(false);
  const [uploadedTifMeta, setUploadedTifMeta] = useState(null);
  const [isParsingTif, setIsParsingTif] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(true);
  const [spartinaMaskPreviewToken, setSpartinaMaskPreviewToken] = useState("");

  const isSpartinaScenario = selectedScenarioId === SPARTINA_SCENARIO_ID;
  const similarityMode = isSimilarityScenario(selectedScenarioId);
  const visibleScenarios = scenarios.filter(
    (scenario) => !HIDDEN_SCENARIO_IDS.has(scenario.scenario_id)
  );
  const selectedScenario = scenarios.find(
    (scenario) => scenario.scenario_id === selectedScenarioId
  );
  const spartinaMaskLayerVisible = layers.some(
    (layer) => layer.layer_id === "spartina-mask-overlay" && layer.visible
  );
  const latestReferencePoint =
    referencePoints.length > 0 ? referencePoints[referencePoints.length - 1] : null;

  const {
    applyMapSnapshot,
    fitToBounds,
    mapHostRef,
    mapReady,
    mapSnapshot,
    requestAutoFit
  } = useMapScene({
    layers,
    onError: (bootstrapError) => {
      setError(bootstrapError.message);
      setStatus("地图初始化失败。");
    },
    onMapReady: () => {
      setStatus((current) =>
        current === "正在加载地图和场景配置..."
          ? "地图已加载，正在获取场景配置..."
          : current
      );
    },
    onReferencePointAdd: (point) => {
      setReferencePoints((current) => [...current, point]);
      setActiveClickPointCategoryName("");
      setIsActiveClickPointCategorySynced(false);
      setError("");
      setStatus("已添加参考点，可继续选点或直接运行查询。");
    },
    onReferencePointDelete: (pointIndex) => {
      removeReferencePoint(pointIndex);
    },
    referencePoints,
    selectedScenarioId,
    similarityMode
  });

  useEffect(() => {
    try {
      localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params));
    } catch {
      // ignore storage errors
    }
  }, [params]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SCENARIO_VIEW_STORAGE_KEY,
        JSON.stringify(scenarioViews)
      );
    } catch {
      // ignore storage errors
    }
  }, [scenarioViews]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CLICK_QUERY_CATEGORIES_STORAGE_KEY,
        JSON.stringify(savedClickPointCategories)
      );
    } catch {
      // ignore storage errors
    }
  }, [savedClickPointCategories]);

  useEffect(() => {
    let cancelled = false;

    async function loadScenarioDescriptors() {
      try {
        const scenarioResponse = await fetchScenarios();
        if (cancelled) {
          return;
        }

        setScenarios(scenarioResponse);
        const nextVisibleScenarios = scenarioResponse.filter(
          (scenario) => !HIDDEN_SCENARIO_IDS.has(scenario.scenario_id)
        );
        if (
          !nextVisibleScenarios.some(
            (scenario) => scenario.scenario_id === selectedScenarioId
          )
        ) {
          setSelectedScenarioId(
            nextVisibleScenarios[0]?.scenario_id || "embedding_intro"
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
          setStatus("场景配置加载失败。");
        }
      }
    }

    loadScenarioDescriptors();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mapReady && scenarios.length > 0) {
      setStatus(getScenarioStatusText(selectedScenarioId));
    }
  }, [mapReady, scenarios, selectedScenarioId]);

  useEffect(() => {
    if (!mapReady || !mapSnapshot || !shouldRememberScenarioView(selectedScenarioId)) {
      return;
    }

    setScenarioViews((current) => {
      if (isSameSnapshot(current[selectedScenarioId], mapSnapshot)) {
        return current;
      }

      return {
        ...current,
        [selectedScenarioId]: mapSnapshot
      };
    });
  }, [mapReady, mapSnapshot, selectedScenarioId]);

  useEffect(() => {
    if (!mapReady || !selectedScenario) {
      return;
    }

    if (restoredScenarioIdRef.current === selectedScenarioId) {
      return;
    }

    const rememberedView = shouldRememberScenarioView(selectedScenarioId)
      ? scenarioViews[selectedScenarioId]
      : null;

    if (rememberedView && applyMapSnapshot(rememberedView)) {
      restoredScenarioIdRef.current = selectedScenarioId;
      return;
    }

    if (selectedScenario.default_view?.bounds) {
      fitToBounds(selectedScenario.default_view.bounds, 60);
    }
    restoredScenarioIdRef.current = selectedScenarioId;
  }, [
    applyMapSnapshot,
    fitToBounds,
    mapReady,
    scenarioViews,
    selectedScenario,
    selectedScenarioId
  ]);

  useEffect(() => {
    setLayers([]);
    setSummaries({});
    setArtifacts({});
    setError("");
    setReferencePoints([]);
    setActiveClickPointCategoryName("");
    setClickPointCategoryInput("");
    setIsActiveClickPointCategorySynced(false);
    setUploadedTifMeta(null);
    uploadedTifFileRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (mapReady) {
      setStatus(getScenarioStatusText(selectedScenarioId));
    }
  }, [mapReady, selectedScenarioId]);

  useEffect(() => {
    if (selectedScenarioId !== "image_retrieval" || !uploadedTifFileRef.current) {
      return;
    }

    parseUploadedTif(
      uploadedTifFileRef.current,
      params.imageSampleCount,
      params.imageMaxSpacingMeters
    );
  }, [params.imageMaxSpacingMeters, params.imageSampleCount, selectedScenarioId]);

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
      setActiveClickPointCategoryName("");
      setClickPointCategoryInput("");
      setIsActiveClickPointCategorySynced(false);
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
      setActiveClickPointCategoryName("");
      setClickPointCategoryInput("");
      setIsActiveClickPointCategorySynced(false);
      setError(parseError.message);
      setStatus("GeoTIFF 解析失败。");
    } finally {
      setIsParsingTif(false);
    }
  }

  function clearScene() {
    setLayers([]);
    setSummaries({});
    setArtifacts({});
    setReferencePoints([]);
    setActiveClickPointCategoryName("");
    setClickPointCategoryInput("");
    setIsActiveClickPointCategorySynced(false);
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
    setActiveClickPointCategoryName("");
    setIsActiveClickPointCategorySynced(false);
    setError("");
    setStatus("已清空点击参考点。");
  }

  function handleClickPointCategoryInputChange(event) {
    setClickPointCategoryInput(event.target.value);
  }

  function saveClickPointCategory() {
    const trimmedName = clickPointCategoryInput.trim();
    if (!trimmedName) {
      setError("请输入类别名称。");
      return;
    }

    if (referencePoints.length === 0) {
      setError("当前没有可保存的选点。");
      return;
    }

    const nextCategory = {
      name: trimmedName,
      points: referencePoints.map((point) => ({
        lat: point.lat,
        lng: point.lng
      }))
    };

    setSavedClickPointCategories((current) => ({
      ...current,
      [trimmedName]: nextCategory
    }));
    setActiveClickPointCategoryName(trimmedName);
    setClickPointCategoryInput(trimmedName);
    setIsActiveClickPointCategorySynced(true);
    setError("");
    setStatus(`已保存类别“${trimmedName}”。`);
  }

  function deleteActiveClickPointCategory() {
    if (!activeClickPointCategoryName) {
      setError("请先选择要删除的类别。");
      return;
    }

    const categoryName = activeClickPointCategoryName;
    setSavedClickPointCategories((current) => {
      if (!current[categoryName]) {
        return current;
      }

      const nextCategories = { ...current };
      delete nextCategories[categoryName];
      return nextCategories;
    });
    setReferencePoints([]);
    setActiveClickPointCategoryName("");
    setClickPointCategoryInput("");
    setIsActiveClickPointCategorySynced(false);
    setError("");
    setStatus(`已删除类别“${categoryName}”。`);
  }

  function restoreClickPointCategory(categoryName) {
    if (!categoryName) {
      setActiveClickPointCategoryName("");
      setClickPointCategoryInput("");
      setIsActiveClickPointCategorySynced(false);
      setReferencePoints([]);
      setError("");
      setStatus("已清空当前选点，可重新点击地图或选择已保存类别。");
      return;
    }

    const category = savedClickPointCategories[categoryName];
    if (!category || !Array.isArray(category.points) || category.points.length === 0) {
      setError(`未找到类别“${categoryName}”。`);
      return;
    }

    setReferencePoints(
      category.points.map((point) => ({
        lat: point.lat,
        lng: point.lng
      }))
    );
    setActiveClickPointCategoryName(category.name);
    setClickPointCategoryInput(category.name);
    setIsActiveClickPointCategorySynced(true);
    setError("");
    setStatus(`已恢复类别“${category.name}”的选点。`);
  }

  function handleClickPointCategorySelect(event) {
    restoreClickPointCategory(event.target.value);
  }

  function removeReferencePoint(pointIndex) {
    let removed = false;

    setReferencePoints((current) => {
      if (pointIndex < 0 || pointIndex >= current.length) {
        return current;
      }

      removed = true;
      const nextPoints = current.filter((_, index) => index !== pointIndex);

      if (activeClickPointCategoryName && isActiveClickPointCategorySynced) {
        if (nextPoints.length === 0) {
          setSavedClickPointCategories((categories) => {
            const nextCategories = { ...categories };
            delete nextCategories[activeClickPointCategoryName];
            return nextCategories;
          });
          setActiveClickPointCategoryName("");
          setClickPointCategoryInput("");
          setIsActiveClickPointCategorySynced(false);
        } else {
          const nextCategory = {
            name: activeClickPointCategoryName,
            points: nextPoints.map((point) => ({
              lat: point.lat,
              lng: point.lng
            }))
          };

          setSavedClickPointCategories((categories) => ({
            ...categories,
            [activeClickPointCategoryName]: nextCategory
          }));
        }
      }

      return nextPoints;
    });

    if (!removed) {
      return;
    }

    setError("");
    setStatus(
      activeClickPointCategoryName && isActiveClickPointCategorySynced
        ? "已删除参考点，并同步更新已保存类别。"
        : "已删除参考点。"
    );
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
                "topK",
                "minResultSpacingMeters"
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
      setActiveClickPointCategoryName("");
      setClickPointCategoryInput("");
      setIsActiveClickPointCategorySynced(false);
      return;
    }

    uploadedTifFileRef.current = file;
    await parseUploadedTif(
      file,
      params.imageSampleCount,
      params.imageMaxSpacingMeters
    );
  }

  function handleScenarioChange(nextScenarioId) {
    if (
      mapSnapshot &&
      shouldRememberScenarioView(selectedScenarioId) &&
      nextScenarioId !== selectedScenarioId
    ) {
      setScenarioViews((current) => {
        if (isSameSnapshot(current[selectedScenarioId], mapSnapshot)) {
          return current;
        }

        return {
          ...current,
          [selectedScenarioId]: mapSnapshot
        };
      });
    }

    setSelectedScenarioId(nextScenarioId);
  }

  async function runCurrentScenario() {
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
      } else if (selectedScenarioId === SPARTINA_SCENARIO_ID) {
        payload = {};
      } else {
        if (referencePoints.length === 0) {
          throw new Error("请先设置参考点。");
        }

        if (!mapSnapshot?.center) {
          throw new Error("当前地图中心尚未稳定，无法生成搜索区域。");
        }

        payload = {
          reference_points: referencePoints.map((point) => [point.lng, point.lat]),
          search_center: [mapSnapshot.center.lng, mapSnapshot.center.lat],
          search_size_km: params.searchSizeKm,
          top_k: params.topK,
          year: params.year,
          scale: params.scale,
          candidate_threshold: params.candidateThreshold,
          min_result_spacing_m: params.minResultSpacingMeters
        };
      }

      if (selectedScenarioId === SPARTINA_SCENARIO_ID) {
        setStatus("正在提取互花米草掩膜...");
        await sleep(SPARTINA_EXTRACTION_DELAY_MS);
      }

      const response = await runScenario(selectedScenarioId, payload);
      const spartinaMaskToken =
        selectedScenarioId === SPARTINA_SCENARIO_ID ? String(Date.now()) : "";
      if (similarityMode) {
        requestAutoFit();
      }

      setLayers(
        Array.isArray(response.layers)
          ? response.layers.map((layer) => ({
              ...layer,
              ...(
                selectedScenarioId === SPARTINA_SCENARIO_ID &&
                layer.layer_id === "spartina-mask-overlay" &&
                typeof layer.image_url === "string"
                  ? {
                      image_url: `${layer.image_url}?v=${encodeURIComponent(spartinaMaskToken)}`
                    }
                  : {}
              ),
              ...getLayerDefaults(selectedScenarioId, layer)
            }))
          : []
      );
      if (selectedScenarioId === SPARTINA_SCENARIO_ID) {
        setSpartinaMaskPreviewToken(spartinaMaskToken);
      }
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

  const runDisabled =
    !mapReady ||
    isRunning ||
    isParsingTif ||
    (similarityMode && referencePoints.length === 0);
  const clickPointCategoryNames = Object.keys(savedClickPointCategories).sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );
  const saveClickPointCategoryDisabled =
    selectedScenarioId !== "click_query" ||
    referencePoints.length === 0 ||
    clickPointCategoryInput.trim().length === 0;
  const deleteClickPointCategoryDisabled =
    selectedScenarioId !== "click_query" || !activeClickPointCategoryName;

  return (
    <div className={`appShell${isRightPanelCollapsed ? " panelCollapsed" : ""}`}>
      <LeftPanel
        activeClickPointCategoryName={activeClickPointCategoryName}
        clickPointCategoryInput={clickPointCategoryInput}
        error={error}
        fileInputRef={fileInputRef}
        isParsingTif={isParsingTif}
        isRunning={isRunning}
        latestReferencePoint={latestReferencePoint}
        mapSnapshot={mapSnapshot}
        onClickPointCategoryInputChange={handleClickPointCategoryInputChange}
        onClickPointCategorySelect={handleClickPointCategorySelect}
        onClearClickReferencePoints={clearClickReferencePoints}
        onClearScene={clearScene}
        onDeleteClickPointCategory={deleteActiveClickPointCategory}
        onParamChange={handleParamChange}
        onRunScenario={runCurrentScenario}
        onScenarioChange={handleScenarioChange}
        onSaveClickPointCategory={saveClickPointCategory}
        onTifUpload={handleTifUpload}
        params={params}
        referencePoints={referencePoints}
        deleteClickPointCategoryDisabled={deleteClickPointCategoryDisabled}
        runDisabled={runDisabled}
        saveClickPointCategoryDisabled={saveClickPointCategoryDisabled}
        savedClickPointCategoryNames={clickPointCategoryNames}
        scenarios={visibleScenarios}
        selectedScenario={selectedScenario}
        selectedScenarioId={selectedScenarioId}
        similarityMode={similarityMode}
        status={status}
        uploadedTifMeta={uploadedTifMeta}
      />

      <main className="mapPane">
        <div className="mapViewport" ref={mapHostRef} />
        <SpartinaTifOverlay
          isRightPanelCollapsed={isRightPanelCollapsed}
          maskPreviewToken={spartinaMaskPreviewToken}
          showMaskPreview={spartinaMaskLayerVisible}
          visible={selectedScenarioId === SPARTINA_SCENARIO_ID}
        />
      </main>

      <RightPanel
        artifacts={artifacts}
        isCollapsed={isRightPanelCollapsed}
        layers={layers}
        onOpacityChange={updateLayerOpacity}
        onToggleCollapse={() =>
          setIsRightPanelCollapsed((current) => !current)
        }
        onToggleLayer={updateLayerVisibility}
        showArtifacts={!isSpartinaScenario}
        showSummaries={!isSpartinaScenario}
        summaries={summaries}
      />
    </div>
  );
}
