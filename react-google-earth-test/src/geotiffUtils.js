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

function clampByte(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(255, Math.round(value)));
}

function computeRasterStats(samples) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    if (!Number.isFinite(value)) {
      continue;
    }

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error("GeoTIFF 预览数据为空。");
  }

  return { min, max };
}

function normalizeSample(value, min, max) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (max <= min) {
    return 255;
  }

  return clampByte(((value - min) / (max - min)) * 255);
}

function buildGrayRgba(samples) {
  const { min, max } = computeRasterStats(samples);
  const rgbaData = new Uint8ClampedArray(samples.length * 4);

  for (let index = 0; index < samples.length; index += 1) {
    const normalizedValue = normalizeSample(samples[index], min, max);
    const rgbaIndex = index * 4;
    rgbaData[rgbaIndex] = normalizedValue;
    rgbaData[rgbaIndex + 1] = normalizedValue;
    rgbaData[rgbaIndex + 2] = normalizedValue;
    rgbaData[rgbaIndex + 3] = 255;
  }

  return {
    rgbaData,
    stats: { min, max }
  };
}

function buildRgbRgba(rasters) {
  const channels = rasters.slice(0, 3).map((channel) => {
    const stats = computeRasterStats(channel);
    return { channel, stats };
  });
  const pixelCount = channels[0].channel.length;
  const rgbaData = new Uint8ClampedArray(pixelCount * 4);

  for (let index = 0; index < pixelCount; index += 1) {
    const rgbaIndex = index * 4;
    rgbaData[rgbaIndex] = normalizeSample(
      channels[0].channel[index],
      channels[0].stats.min,
      channels[0].stats.max
    );
    rgbaData[rgbaIndex + 1] = normalizeSample(
      channels[1].channel[index],
      channels[1].stats.min,
      channels[1].stats.max
    );
    rgbaData[rgbaIndex + 2] = normalizeSample(
      channels[2].channel[index],
      channels[2].stats.min,
      channels[2].stats.max
    );
    rgbaData[rgbaIndex + 3] = 255;
  }

  return {
    rgbaData,
    stats: {
      min: channels.map(({ stats }) => stats.min),
      max: channels.map(({ stats }) => stats.max)
    }
  };
}

async function loadGeoTiffImage(source) {
  const buffer =
    typeof source === "string"
      ? await fetch(source).then(async (response) => {
          if (!response.ok) {
            throw new Error(`无法加载 GeoTIFF: ${response.status} ${response.statusText}`);
          }

          return response.arrayBuffer();
        })
      : await source.arrayBuffer();

  const tiff = await fromArrayBuffer(buffer);
  return tiff.getImage();
}

export async function loadGeoTiffPreview(source) {
  const image = await loadGeoTiffImage(source);
  const width = image.getWidth();
  const height = image.getHeight();
  const samplesPerPixel = image.getSamplesPerPixel();

  if (!width || !height) {
    throw new Error("GeoTIFF 缺少可用的图像尺寸。");
  }

  const rasters = await image.readRasters({ interleave: false });
  if (!Array.isArray(rasters) || rasters.length === 0) {
    throw new Error("GeoTIFF 未返回可显示的像素数据。");
  }

  if (samplesPerPixel === 1 || rasters.length === 1) {
    const { rgbaData, stats } = buildGrayRgba(rasters[0]);
    return {
      width,
      height,
      rgbaData,
      renderMode: "grayscale",
      stats
    };
  }

  if (samplesPerPixel >= 3 || rasters.length >= 3) {
    const { rgbaData, stats } = buildRgbRgba(rasters);
    return {
      width,
      height,
      rgbaData,
      renderMode: "rgb",
      stats
    };
  }

  throw new Error(`暂不支持 ${samplesPerPixel} 波段 GeoTIFF 预览。`);
}

export async function parseGeoTiffSamplePoints(file, sampleCount, maxSpacingMeters) {
  const image = await loadGeoTiffImage(file);
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
