import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { resolveApiUrl } from "../api";
import { extractMapSnapshot, extractPointFeatures } from "../mapUtils";

const DEFAULT_CENTER = [29.8683, 121.544];
const DEFAULT_ZOOM = 17;
const TIANDITU_IMAGERY_URL =
  "http://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=fd7d577a54bb54358f1f243e3c0646e0";
const RASTER_PANE = "analysis-raster-pane";
const IMAGE_PANE = "analysis-image-pane";
const LABEL_PANE = "analysis-label-pane";

function isValidBounds(bounds) {
  return (
    Array.isArray(bounds) &&
    bounds.length === 2 &&
    Array.isArray(bounds[0]) &&
    Array.isArray(bounds[1]) &&
    bounds[0].length === 2 &&
    bounds[1].length === 2
  );
}

function toLeafletBounds(bounds) {
  if (!isValidBounds(bounds)) {
    return null;
  }

  const [southWest, northEast] = bounds;
  return L.latLngBounds(
    [southWest[0], southWest[1]],
    [northEast[0], northEast[1]]
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createLabelMarker(latlng, text, variant) {
  return L.marker(latlng, {
    interactive: false,
    keyboard: false,
    pane: LABEL_PANE,
    icon: L.divIcon({
      className: `mapPointLabel mapPointLabel${variant}`,
      html: `<span>${escapeHtml(text)}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    })
  });
}

function createReferenceMarker(point, index, selectedScenarioId) {
  const latlng = [point.lat, point.lng];
  const isMultiClick = selectedScenarioId === "click_query";
  const labelText = isMultiClick ? String(index + 1) : "R";
  const circle = L.circleMarker(latlng, {
    radius: 10,
    color: "#ffffff",
    weight: 2,
    fillColor: "#dc2626",
    fillOpacity: 1,
    pane: "markerPane"
  });
  const label = createLabelMarker(latlng, labelText, "Reference");
  return L.layerGroup([circle, label]);
}

function createResultMarker(layerName, feature) {
  const [lng, lat] = feature.geometry.coordinates || [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  const rank = feature.properties?.rank;
  const score = feature.properties?.score;
  const latlng = [lat, lng];
  const circle = L.circleMarker(latlng, {
    radius: 11,
    color: "#ffffff",
    weight: 2,
    fillColor: "#2563eb",
    fillOpacity: 1,
    pane: "markerPane"
  });

  if (rank !== undefined && rank !== null) {
    const label = createLabelMarker(latlng, rank, "Result");
    const markerGroup = L.featureGroup([circle, label]);
    markerGroup.bindPopup(
      `<div class="mapInfoWindow"><strong>${escapeHtml(layerName)}</strong><br/>Rank: ${escapeHtml(rank)}<br/>Score: ${escapeHtml(score ?? "-")}</div>`
    );
    return markerGroup;
  }

  circle.bindPopup(
    `<div class="mapInfoWindow"><strong>${escapeHtml(layerName)}</strong><br/>Rank: -<br/>Score: ${escapeHtml(score ?? "-")}</div>`
  );
  return circle;
}

export function useMapScene({
  layers,
  onError,
  onMapReady,
  onReferencePointAdd,
  referencePoints,
  selectedScenarioId,
  similarityMode
}) {
  const mapHostRef = useRef(null);
  const mapRef = useRef(null);
  const baseLayerRef = useRef(null);
  const referenceMarkersRef = useRef([]);
  const resultMarkersRef = useRef([]);
  const tileLayersRef = useRef([]);
  const imageOverlaysRef = useRef([]);
  const pendingAutoFitRef = useRef(false);
  const selectedScenarioIdRef = useRef(selectedScenarioId);
  const onErrorRef = useRef(onError);
  const onMapReadyRef = useRef(onMapReady);
  const onReferencePointAddRef = useRef(onReferencePointAdd);
  const [mapReady, setMapReady] = useState(false);
  const [mapSnapshot, setMapSnapshot] = useState(null);

  useEffect(() => {
    selectedScenarioIdRef.current = selectedScenarioId;
  }, [selectedScenarioId]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);

  useEffect(() => {
    onReferencePointAddRef.current = onReferencePointAdd;
  }, [onReferencePointAdd]);

  useEffect(() => {
    if (!mapHostRef.current) {
      return undefined;
    }

    try {
      const map = L.map(mapHostRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false
      });

      map.createPane(RASTER_PANE);
      map.createPane(IMAGE_PANE);
      map.createPane(LABEL_PANE);
      map.getPane(RASTER_PANE).style.zIndex = "250";
      map.getPane(IMAGE_PANE).style.zIndex = "420";
      map.getPane(LABEL_PANE).style.zIndex = "625";
      map.getPane(LABEL_PANE).style.pointerEvents = "none";

      L.control.zoom({ position: "topright" }).addTo(map);

      const baseLayer = L.tileLayer(TIANDITU_IMAGERY_URL, {
        attribution: "Tianditu",
        maxZoom: 18
      });
      baseLayer.addTo(map);

      const updateSnapshot = () => {
        const snapshot = extractMapSnapshot(map);
        if (snapshot) {
          setMapSnapshot(snapshot);
        }
      };

      map.on("moveend zoomend", updateSnapshot);
      map.on("click", (event) => {
        if (selectedScenarioIdRef.current !== "click_query") {
          return;
        }

        onReferencePointAddRef.current?.({
          lat: event.latlng.lat,
          lng: event.latlng.lng
        });
      });

      mapRef.current = map;
      baseLayerRef.current = baseLayer;
      setMapReady(true);
      updateSnapshot();
      onMapReadyRef.current?.();

      return () => {
        referenceMarkersRef.current.forEach((layer) => layer.remove());
        resultMarkersRef.current.forEach((layer) => layer.remove());
        tileLayersRef.current.forEach((layer) => layer.remove());
        imageOverlaysRef.current.forEach((layer) => layer.remove());
        referenceMarkersRef.current = [];
        resultMarkersRef.current = [];
        tileLayersRef.current = [];
        imageOverlaysRef.current = [];
        baseLayerRef.current = null;
        map.off();
        map.remove();
        mapRef.current = null;
      };
    } catch (bootstrapError) {
      onErrorRef.current?.(bootstrapError);
      return undefined;
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    referenceMarkersRef.current.forEach((marker) => marker.remove());
    referenceMarkersRef.current = [];

    if (referencePoints.length === 0 || !similarityMode) {
      return;
    }

    referenceMarkersRef.current = referencePoints.map((point, index) => {
      const marker = createReferenceMarker(point, index, selectedScenarioId);
      marker.addTo(map);
      return marker;
    });
  }, [referencePoints, selectedScenarioId, similarityMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    tileLayersRef.current.forEach((layer) => layer.remove());
    tileLayersRef.current = [];

    layers
      .filter(
        (layer) =>
          layer.visible &&
          layer.layer_type === "raster_tile" &&
          typeof layer.tile_url === "string" &&
          layer.tile_url.length > 0
      )
      .forEach((layer) => {
        const tileLayer = L.tileLayer(resolveApiUrl(layer.tile_url), {
          opacity: layer.opacity ?? 1,
          pane: RASTER_PANE
        });
        tileLayer.addTo(map);
        tileLayersRef.current.push(tileLayer);
      });
  }, [layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    imageOverlaysRef.current.forEach((overlay) => overlay.remove());
    imageOverlaysRef.current = [];

    layers
      .filter(
        (layer) =>
          layer.visible &&
          layer.layer_type === "image_overlay" &&
          typeof layer.image_url === "string" &&
          layer.image_url.length > 0 &&
          isValidBounds(layer.bounds)
      )
      .forEach((layer) => {
        const bounds = toLeafletBounds(layer.bounds);
        if (!bounds) {
          return;
        }

        const overlay = L.imageOverlay(resolveApiUrl(layer.image_url), bounds, {
          opacity: layer.opacity ?? 1,
          pane: IMAGE_PANE
        });
        overlay.addTo(map);
        imageOverlaysRef.current.push(overlay);
      });
  }, [layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    resultMarkersRef.current.forEach((marker) => marker.remove());
    resultMarkersRef.current = [];

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

          const marker = createResultMarker(layer.name, feature);
          if (!marker) {
            return;
          }

          marker.addTo(map);
          resultMarkersRef.current.push(marker);
        });
      });
  }, [layers]);

  useEffect(() => {
    if (!pendingAutoFitRef.current || !similarityMode) {
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }

    const resultPoints = layers.flatMap(extractPointFeatures);
    const allPoints = [...referencePoints, ...resultPoints];

    if (allPoints.length === 0) {
      pendingAutoFitRef.current = false;
      return;
    }

    if (allPoints.length === 1) {
      map.setView([allPoints[0].lat, allPoints[0].lng], 17, {
        animate: false
      });
      pendingAutoFitRef.current = false;
      return;
    }

    const bounds = L.latLngBounds(
      allPoints.map((point) => [point.lat, point.lng])
    );
    map.fitBounds(bounds, {
      padding: [80, 80]
    });
    pendingAutoFitRef.current = false;
  }, [layers, referencePoints, similarityMode]);

  function fitToBounds(bounds, padding = 80) {
    const map = mapRef.current;
    const leafletBounds = toLeafletBounds(bounds);
    if (!map || !leafletBounds) {
      return false;
    }

    map.fitBounds(leafletBounds, {
      padding: [padding, padding]
    });
    return true;
  }

  function applyMapSnapshot(snapshot) {
    const map = mapRef.current;
    if (!map || !snapshot?.center) {
      return false;
    }

    const { lat, lng } = snapshot.center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return false;
    }

    map.setView(
      [lat, lng],
      Number.isFinite(snapshot.zoom) ? snapshot.zoom : map.getZoom(),
      { animate: false }
    );
    return true;
  }

  function requestAutoFit() {
    pendingAutoFitRef.current = true;
  }

  return {
    applyMapSnapshot,
    fitToBounds,
    mapHostRef,
    mapReady,
    mapSnapshot,
    requestAutoFit
  };
}
