import { formatValue } from "../formatters";
import TileOverlay from "./TileOverlay";

export default function RightPanel({
  artifacts,
  isCollapsed,
  layers,
  onOpacityChange,
  onToggleCollapse,
  onToggleLayer,
  summaries
}) {
  return (
    <aside className={`rightPanel${isCollapsed ? " collapsed" : ""}`}>
      <div className="rightPanelHeader">
        <button
          aria-label={isCollapsed ? "展开右侧面板" : "折叠右侧面板"}
          className="panelToggle"
          onClick={onToggleCollapse}
          title={isCollapsed ? "展开右侧面板" : "折叠右侧面板"}
          type="button"
        >
          {isCollapsed ? "<" : ">"}
        </button>
      </div>

      {isCollapsed ? null : (
        <>
          <section className="sideSection">
            <h2>图层</h2>
            {layers.length === 0 ? (
              <p className="placeholder">运行场景后，这里会显示可切换图层。</p>
            ) : (
              layers.map((layer) => (
                <TileOverlay
                  key={layer.layer_id}
                  layer={layer}
                  onToggle={onToggleLayer}
                  onOpacityChange={onOpacityChange}
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
        </>
      )}
    </aside>
  );
}
