import { fromArrayBuffer } from "geotiff";
import geokeysToProj4 from "geotiff-geokeys-to-proj4";
import proj4 from "proj4";

const DEFAULT_MAX_SPACING_METERS = 10;
const MAX_SAMPLE_POINTS = 2500;
const METERS_PER_DEGREE_LAT = 111320;

function isValidLngLat(lng, lat) {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function normalizeProjectedPoint(point) {
  if (Array.isArray(point)) {
    return { lng: point[0], lat: point[1] };
  }

  return { lng: point.x, lat: point.y };
}

function resolveProjection(geoKeys) {
  const projObj = geokeysToProj4.toProj4(geoKeys);
  if (!projObj?.proj4) {
    throw new Error("GeoTIFF 缺少可识别的坐标参考信息。");
  }

  return projObj;
}

function projectPointToWgs84(projObj, x, y) {
  const sourcePoint = projObj.shouldConvertCoordinates
    ? geokeysToProj4.convertCoordinates(
        x,
        y,
        0,
        projObj.coordinatesConversionParameters
      )
    : { x, y, z: 0 };

  const projected = proj4(projObj.proj4, "WGS84").forward(sourcePoint);
  const { lng, lat } = normalizeProjectedPoint(projected);

  if (!isValidLngLat(lng, lat)) {
    throw new Error("GeoTIFF 采样点无法转换为有效的经纬度坐标。");
  }

  return { lng, lat };
}

function haversineDistanceMeters(pointA, pointB) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const lat1 = toRadians(pointA.lat);
  const lat2 = toRadians(pointB.lat);
  const deltaLat = toRadians(pointB.lat - pointA.lat);
  const deltaLng = toRadians(pointB.lng - pointA.lng);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
}

function toLocalLngDegrees(meters, latitude) {
  const cosLatitude = Math.cos((latitude * Math.PI) / 180);
  const safeCosLatitude = Math.max(Math.abs(cosLatitude), 1e-6);
  return meters / (METERS_PER_DEGREE_LAT * safeCosLatitude);
}

function offsetPointMeters(centerPoint, offsetXMeters, offsetYMeters) {
  return {
    lng: centerPoint.lng + toLocalLngDegrees(offsetXMeters, centerPoint.lat),
    lat: centerPoint.lat + offsetYMeters / METERS_PER_DEGREE_LAT
  };
}

function projectBoundsToWgs84(bbox, projection) {
  const [minX, minY, maxX, maxY] = bbox;
  if (!projection) {
    return {
      center: {
        lng: (minX + maxX) / 2,
        lat: (minY + maxY) / 2
      },
      corners: [
        { lng: minX, lat: minY },
        { lng: minX, lat: maxY },
        { lng: maxX, lat: minY },
        { lng: maxX, lat: maxY }
      ]
    };
  }

  return {
    center: projectPointToWgs84(projection, (minX + maxX) / 2, (minY + maxY) / 2),
    corners: [
      projectPointToWgs84(projection, minX, minY),
      projectPointToWgs84(projection, minX, maxY),
      projectPointToWgs84(projection, maxX, minY),
      projectPointToWgs84(projection, maxX, maxY)
    ]
  };
}

function buildGridDimensions(widthMeters, heightMeters, sampleCount) {
  const normalizedSampleCount = Math.max(1, Math.floor(sampleCount));
  const safeHeight = heightMeters > 0 ? heightMeters : 1;
  const aspectRatio = widthMeters > 0 ? widthMeters / safeHeight : 1;

  let columns = Math.max(
    1,
    Math.round(Math.sqrt(normalizedSampleCount * aspectRatio))
  );
  let rows = Math.max(1, Math.ceil(normalizedSampleCount / columns));

  while (columns * rows < normalizedSampleCount) {
    const nextColumnSpacing =
      columns > 1 ? widthMeters / Math.max(columns - 1, 1) : widthMeters;
    const nextRowSpacing =
      rows > 1 ? heightMeters / Math.max(rows - 1, 1) : heightMeters;
    if (nextColumnSpacing >= nextRowSpacing) {
      columns += 1;
    } else {
      rows += 1;
    }
  }

  if (columns * rows > MAX_SAMPLE_POINTS) {
    throw new Error(
      `采样点数量将达到 ${columns * rows}，超过前端安全上限 ${MAX_SAMPLE_POINTS}。请增大“最大相邻间距”或缩小影像范围。`
    );
  }

  return { columns, rows };
}

function buildCenterFirstSamplePoints(bbox, sampleCount, maxSpacingMeters, projection) {
  const normalizedSampleCount = Math.max(1, Math.floor(sampleCount));
  const normalizedSpacingMeters = Math.max(
    0.1,
    Number(maxSpacingMeters) || DEFAULT_MAX_SPACING_METERS
  );
  const { center, corners } = projectBoundsToWgs84(bbox, projection);
  const longitudes = corners.map((point) => point.lng);
  const latitudes = corners.map((point) => point.lat);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const widthMeters = haversineDistanceMeters(
    { lng: minLng, lat: center.lat },
    { lng: maxLng, lat: center.lat }
  );
  const heightMeters = haversineDistanceMeters(
    { lng: center.lng, lat: minLat },
    { lng: center.lng, lat: maxLat }
  );
  const { columns, rows } = buildGridDimensions(widthMeters, heightMeters, sampleCount);

  const spacingXMeters =
    columns > 1
      ? Math.min(normalizedSpacingMeters, widthMeters / Math.max(columns - 1, 1))
      : 0;
  const spacingYMeters =
    rows > 1
      ? Math.min(normalizedSpacingMeters, heightMeters / Math.max(rows - 1, 1))
      : 0;

  const candidates = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const offsetXMeters = (column - (columns - 1) / 2) * spacingXMeters;
      const offsetYMeters = ((rows - 1) / 2 - row) * spacingYMeters;
      const point = offsetPointMeters(center, offsetXMeters, offsetYMeters);
      if (
        point.lng < minLng ||
        point.lng > maxLng ||
        point.lat < minLat ||
        point.lat > maxLat
      ) {
        continue;
      }

      candidates.push({
        point,
        distanceSquared: offsetXMeters * offsetXMeters + offsetYMeters * offsetYMeters
      });
    }
  }

  if (candidates.length === 0) {
    return [center];
  }

  candidates.sort((left, right) => left.distanceSquared - right.distanceSquared);

  return candidates
    .slice(0, normalizedSampleCount)
    .map((candidate) => candidate.point);
}

export async function parseGeoTiffSamplePoints(file, sampleCount, maxSpacingMeters) {
  const buffer = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const geoKeys = image.getGeoKeys() || {};
  const bbox = image.getBoundingBox();

  if (!Array.isArray(bbox) || bbox.length !== 4) {
    throw new Error("GeoTIFF 缺少可用的边界框信息。");
  }

  const centerX = (bbox[0] + bbox[2]) / 2;
  const centerY = (bbox[1] + bbox[3]) / 2;
  const projection = isValidLngLat(centerX, centerY) ? null : resolveProjection(geoKeys);
  const samplePoints = buildCenterFirstSamplePoints(
    bbox,
    sampleCount,
    maxSpacingMeters,
    projection
  );

  return {
    samplePoints,
    sourceCrs: projection?.proj4 || "EPSG:4326"
  };
}
