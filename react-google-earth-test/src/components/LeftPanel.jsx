import { formatCoordinate } from "../formatters";
import {
  BAND_OPTIONS,
  SPARTINA_PREVIEW_IMAGE,
  SPARTINA_SCENARIO_ID
} from "../scenarioConfig";

export default function LeftPanel({
  error,
  fileInputRef,
  isParsingTif,
  isRunning,
  latestReferencePoint,
  mapSnapshot,
  onClearClickReferencePoints,
  onClearScene,
  onParamChange,
  onRunScenario,
  onScenarioChange,
  onTifUpload,
  params,
  referencePoints,
  runDisabled,
  scenarios,
  selectedScenario,
  selectedScenarioId,
  similarityMode,
  status,
  uploadedTifMeta
}) {
  const isImageRetrieval = selectedScenarioId === "image_retrieval";
  const isClickQuery = selectedScenarioId === "click_query";
  const isSpartinaScenario = selectedScenarioId === SPARTINA_SCENARIO_ID;

  return (
    <aside className="leftPanel">
      <p className="eyebrow">自然资源部</p>
      <h1>影像嵌入分析平台</h1>

      <label className="field">
        <span></span>
        <select
          className="select"
          value={selectedScenarioId}
          onChange={(event) => onScenarioChange(event.target.value)}
        >
          {scenarios.map((scenario) => (
            <option key={scenario.scenario_id} value={scenario.scenario_id}>
              {scenario.name}
            </option>
          ))}
        </select>
      </label>

      <button
        className="runBtn"
        disabled={runDisabled}
        onClick={onRunScenario}
        type="button"
      >
        {isRunning ? "运行中..." : "运行当前场景"}
      </button>

      <div className="controlRow">
        <button className="ghostBtn" onClick={onClearScene} type="button">
          清空结果
        </button>
        {isClickQuery ? (
          <button
            className="ghostBtn"
            onClick={onClearClickReferencePoints}
            type="button"
          >
            清空选点
          </button>
        ) : (
          <button className="ghostBtn" disabled type="button">
            场景工具
          </button>
        )}
      </div>

      {isSpartinaScenario ? (
        <div className="scenarioBox">
          <strong>互花米草区域示意</strong>
          <p>运行后会将互花米草提取掩膜以半透明方式叠加到地图上。</p>
          <div className="scenarioPreview">
            <img alt="互花米草提取示意图" src={SPARTINA_PREVIEW_IMAGE} />
          </div>
        </div>
      ) : null}

      {isImageRetrieval ? (
        <div className="scenarioBox">
          <label className="field">
            <span>GeoTIFF 文件</span>
            <input
              ref={fileInputRef}
              accept=".tif,.tiff"
              type="file"
              onChange={onTifUpload}
            />
          </label>
          <div className="metaBlock">
            <div>
              <span className="metaLabel">文件</span>
              <strong title={uploadedTifMeta?.fileName}>{uploadedTifMeta?.fileName || "-"}</strong>
            </div>
            <div>
              <span className="metaLabel">源坐标系</span>
              <strong title={uploadedTifMeta?.sourceCrs}>{uploadedTifMeta?.sourceCrs || "-"}</strong>
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
            <div>
              <span className="metaLabel">解析状态</span>
              <strong>{isParsingTif ? "解析中" : "已就绪"}</strong>
            </div>
          </div>
        </div>
      ) : null}

      {isClickQuery ? (
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

      {isSpartinaScenario ? null : (
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
              onChange={onParamChange}
            />
          </label>

          {similarityMode ? (
            <>
              {isImageRetrieval ? (
                <>
                  <label className="field">
                    <span>取点数量 <span className="paramValueBadge">{params.imageSampleCount}</span></span>
                    <input
                      name="imageSampleCount"
                      type="range"
                      min="1"
                      max="100"
                      step="1"
                      value={params.imageSampleCount}
                      onChange={onParamChange}
                    />
                  </label>

                  <label className="field">
                    <span>最大相邻间距 m <span className="paramValueBadge">{params.imageMaxSpacingMeters}</span></span>
                    <input
                      name="imageMaxSpacingMeters"
                      type="range"
                      min="1"
                      max="200"
                      step="1"
                      value={params.imageMaxSpacingMeters}
                      onChange={onParamChange}
                    />
                  </label>
                </>
              ) : null}

              <label className="field">
                <span>搜索边长 km <span className="paramValueBadge">{params.searchSizeKm}</span></span>
                <input
                  name="searchSizeKm"
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={params.searchSizeKm}
                  onChange={onParamChange}
                />
              </label>

              <label className="field">
                <span>结果数量 <span className="paramValueBadge">{params.topK}</span></span>
                <input
                  name="topK"
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={params.topK}
                  onChange={onParamChange}
                />
              </label>

              <label className="field">
                <span>最小结果间距 m <span className="paramValueBadge">{params.minResultSpacingMeters}</span></span>
                <input
                  name="minResultSpacingMeters"
                  type="range"
                  min="0"
                  max="500"
                  step="5"
                  value={params.minResultSpacingMeters}
                  onChange={onParamChange}
                />
              </label>

              <label className="field">
                <span>Scale <span className="paramValueBadge">{params.scale}</span></span>
                <input
                  name="scale"
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={params.scale}
                  onChange={onParamChange}
                />
              </label>

              <label className="field">
                <span>候选阈值 <span className="paramValueBadge">{params.candidateThreshold}</span></span>
                <input
                  name="candidateThreshold"
                  type="range"
                  step="0.01"
                  min="0.5"
                  max="1"
                  value={params.candidateThreshold}
                  onChange={onParamChange}
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
                  onChange={onParamChange}
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
                  onChange={onParamChange}
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
                  onChange={onParamChange}
                >
                  {BAND_OPTIONS.map((band) => (
                    <option key={band} value={band}>
                      {band}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>RGB Min <span className="paramValueBadge">{params.rgbMin}</span></span>
                <input
                  name="rgbMin"
                  type="range"
                  min="-1"
                  max="1"
                  step="0.05"
                  value={params.rgbMin}
                  onChange={onParamChange}
                />
              </label>

              <label className="field">
                <span>RGB Max <span className="paramValueBadge">{params.rgbMax}</span></span>
                <input
                  name="rgbMax"
                  type="range"
                  min="-1"
                  max="1"
                  step="0.05"
                  value={params.rgbMax}
                  onChange={onParamChange}
                />
              </label>

              <label className="field">
                <span>Scale <span className="paramValueBadge">{params.scale}</span></span>
                <input
                  name="scale"
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={params.scale}
                  onChange={onParamChange}
                />
              </label>

              {isSpartinaScenario ? null : (
                <>
                  <label className="field">
                    <span>聚类数 <span className="paramValueBadge">{params.clusterCount}</span></span>
                    <input
                      name="clusterCount"
                      type="range"
                      min="2"
                      max="20"
                      step="1"
                      value={params.clusterCount}
                      onChange={onParamChange}
                    />
                  </label>

                  <label className="field">
                    <span>采样数 <span className="paramValueBadge">{params.sampleCount}</span></span>
                    <input
                      name="sampleCount"
                      type="range"
                      min="10"
                      max="1000"
                      step="10"
                      value={params.sampleCount}
                      onChange={onParamChange}
                    />
                  </label>

                  <label className="field">
                    <span>Seed</span>
                    <input
                      name="seed"
                      type="number"
                      value={params.seed}
                      onChange={onParamChange}
                    />
                  </label>

                  <label className="checkboxRow">
                    <input
                      checked={params.includeVectorProbe}
                      name="includeVectorProbe"
                      onChange={onParamChange}
                      type="checkbox"
                    />
                    <span>返回 ROI 质心 embedding 调试向量</span>
                  </label>
                </>
              )}
            </>
          )}
        </div>
        </details>
      )}

      <p className="statusLine">{status}</p>
      {error ? <p className="errorText">{error}</p> : null}

      <div className="scenarioBox">
        <strong>{selectedScenario?.name || "Loading..."}</strong>
        <p>{selectedScenario?.description || "正在加载场景说明..."}</p>
        <span className={`statusPill ${selectedScenario?.status || "planned"}`}>
          {selectedScenario?.status || "planned"}
        </span>
      </div>
    </aside>
  );
}
