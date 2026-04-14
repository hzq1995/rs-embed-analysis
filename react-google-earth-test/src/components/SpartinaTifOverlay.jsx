import { useEffect, useMemo, useRef, useState } from "react";
import { resolveApiUrl } from "../api";
import { loadGeoTiffPreview } from "../geotiffUtils";
import {
  SPARTINA_BASE_TIF_PATH,
  SPARTINA_MASK_PREVIEW_PATH
} from "../scenarioConfig";

function drawPreviewToCanvas(canvas, preview) {
  if (!canvas || !preview) {
    return;
  }

  canvas.width = preview.width;
  canvas.height = preview.height;

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const imageData = new ImageData(preview.rgbaData, preview.width, preview.height);
  context.putImageData(imageData, 0, 0);
}

export default function SpartinaTifOverlay({
  isRightPanelCollapsed,
  maskPreviewToken,
  showMaskPreview,
  visible
}) {
  const canvasRef = useRef(null);
  const basePreviewCacheRef = useRef(null);
  const maskPreviewUrl = useMemo(
    () =>
      resolveApiUrl(
        maskPreviewToken
          ? `${SPARTINA_MASK_PREVIEW_PATH}?v=${encodeURIComponent(maskPreviewToken)}`
          : SPARTINA_MASK_PREVIEW_PATH
      ),
    [maskPreviewToken]
  );
  const [basePreview, setBasePreview] = useState(null);
  const [isBaseLoading, setIsBaseLoading] = useState(true);
  const [isMaskLoading, setIsMaskLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) {
      return;
    }

    const cachedPreview = basePreviewCacheRef.current;
    if (cachedPreview) {
      setBasePreview(cachedPreview);
      setIsBaseLoading(false);
      setError("");
      return;
    }

    let cancelled = false;
    setIsBaseLoading(true);
    setError("");

    loadGeoTiffPreview(SPARTINA_BASE_TIF_PATH)
      .then((nextPreview) => {
        if (cancelled) {
          return;
        }

        basePreviewCacheRef.current = nextPreview;
        setBasePreview(nextPreview);
        setIsBaseLoading(false);
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }

        setBasePreview(null);
        setIsBaseLoading(false);
        setError(loadError.message || "互花米草底图加载失败。");
      });

    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !basePreview) {
      return;
    }

    drawPreviewToCanvas(canvasRef.current, basePreview);
  }, [basePreview, visible]);

  useEffect(() => {
    setIsMaskLoading(showMaskPreview);
    if (showMaskPreview) {
      setError("");
    }
  }, [showMaskPreview]);

  if (!visible) {
    return null;
  }

  return (
    <section
      aria-label="互花米草掩膜预览"
      className={`spartinaOverlay${isRightPanelCollapsed ? " rightPanelCollapsed" : ""}`}
    >
      <div className="spartinaOverlayHeader">
        <div>
          <p className="spartinaOverlayEyebrow">Spartina Extraction</p>
          <h2>互花米草提取</h2>
        </div>
      </div>

      <div className="spartinaOverlayCanvasWrap">
        {isBaseLoading ? (
          <div className="spartinaOverlayState">正在加载互花米草底图...</div>
        ) : null}

        {!isBaseLoading && error ? (
          <div className="spartinaOverlayState error">{error}</div>
        ) : null}

        {!error && !isBaseLoading ? (
          <div
            className="spartinaOverlayPreviewStack"
            style={{
              aspectRatio: `${basePreview.width} / ${basePreview.height}`
            }}
          >
            <canvas
              className="spartinaOverlayMedia spartinaOverlayBase"
              ref={canvasRef}
            />
            {showMaskPreview ? (
              <img
                alt="互花米草提取掩膜预览"
                className={`spartinaOverlayMedia spartinaOverlayMask${isMaskLoading ? " hidden" : ""}`}
                key={maskPreviewUrl}
                src={maskPreviewUrl}
                onError={() => {
                  setError("互花米草掩膜预览加载失败。");
                  setIsMaskLoading(false);
                }}
                onLoad={() => {
                  setError("");
                  setIsMaskLoading(false);
                }}
              />
            ) : null}
            {showMaskPreview && isMaskLoading ? (
              <div className="spartinaOverlayMaskState">正在叠加掩膜...</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
