import { fromArrayBuffer } from "geotiff";
import geokeysToProj4 from "geotiff-geokeys-to-proj4";
import proj4 from "proj4";

function isValidLngLat(lng, lat) {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function normalizeProjectedPoint(point) {
  if (Array.isArray(point)) {
    return { lng: point[0], lat: point[1] };
  }

  return { lng: point.x, lat: point.y };
}

function projectCenterToWgs84(geoKeys, centerX, centerY) {
  const projObj = geokeysToProj4.toProj4(geoKeys);
  if (!projObj?.proj4) {
    throw new Error("GeoTIFF 缺少可识别的坐标参考信息。");
  }

  const sourcePoint = projObj.shouldConvertCoordinates
    ? geokeysToProj4.convertCoordinates(
        centerX,
        centerY,
        0,
        projObj.coordinatesConversionParameters
      )
    : { x: centerX, y: centerY, z: 0 };

  const projected = proj4(projObj.proj4, "WGS84").forward(sourcePoint);
  const { lng, lat } = normalizeProjectedPoint(projected);

  if (!isValidLngLat(lng, lat)) {
    throw new Error("GeoTIFF 中心点无法转换为有效的经纬度坐标。");
  }

  return {
    lng,
    lat,
    sourceCrs: projObj.proj4
  };
}

export async function parseGeoTiffCenter(file) {
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

  if (isValidLngLat(centerX, centerY)) {
    return {
      lng: centerX,
      lat: centerY,
      sourceCrs: "EPSG:4326"
    };
  }

  return projectCenterToWgs84(geoKeys, centerX, centerY);
}
