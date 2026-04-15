import { ROI_INSET_RATIO } from "./scenarioConfig";

export function buildGeoJsonPolygon(points) {
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

export function buildViewportInsetPolygon(bounds, insetRatio = ROI_INSET_RATIO) {
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

export function extractMapSnapshot(map) {
  const center = map.getCenter();
  const bounds = map.getBounds();
  const zoom = map.getZoom();
  const northEast = bounds?.getNorthEast();
  const southWest = bounds?.getSouthWest();
  const centerLat =
    typeof center?.lat === "function" ? center.lat() : Number(center?.lat);
  const centerLng =
    typeof center?.lng === "function" ? center.lng() : Number(center?.lng);
  const north =
    typeof northEast?.lat === "function" ? northEast.lat() : Number(northEast?.lat);
  const east =
    typeof northEast?.lng === "function" ? northEast.lng() : Number(northEast?.lng);
  const south =
    typeof southWest?.lat === "function" ? southWest.lat() : Number(southWest?.lat);
  const west =
    typeof southWest?.lng === "function" ? southWest.lng() : Number(southWest?.lng);

  if (
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLng) ||
    !Number.isFinite(north) ||
    !Number.isFinite(east) ||
    !Number.isFinite(south) ||
    !Number.isFinite(west) ||
    !Number.isFinite(zoom)
  ) {
    return null;
  }

  return {
    center: {
      lat: centerLat,
      lng: centerLng
    },
    zoom,
    bounds: {
      north,
      east,
      south,
      west
    }
  };
}

export function extractPointFeatures(layer) {
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
