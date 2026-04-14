export default function TileOverlay({ layer, onToggle, onOpacityChange }) {
  const supportsOpacity =
    layer.layer_type === "raster_tile" || layer.layer_type === "image_overlay";

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
