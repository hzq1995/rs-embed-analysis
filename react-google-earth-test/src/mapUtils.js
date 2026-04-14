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

  if (!center || !northEast || !southWest || !Number.isFinite(zoom)) {
    return null;
  }

  return {
    center: {
      lat: center.lat(),
      lng: center.lng()
    },
    zoom,
    bounds: {
      north: northEast.lat(),
      east: northEast.lng(),
      south: southWest.lat(),
      west: southWest.lng()
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
