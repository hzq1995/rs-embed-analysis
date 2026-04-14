import { SPARTINA_POINTS_CSV } from "./scenarioConfig";

function parseDmsCoordinate(value) {
  const parts = String(value)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length !== 3) {
    throw new Error(`Invalid DMS coordinate: ${value}`);
  }

  const [degrees, minutes, seconds] = parts.map(Number);
  const sign = degrees < 0 ? -1 : 1;
  const safeDegrees = Math.abs(degrees);
  return sign * (safeDegrees + minutes / 60 + seconds / 3600);
}

export async function loadSpartinaPoints() {
  const response = await fetch(SPARTINA_POINTS_CSV);
  if (!response.ok) {
    throw new Error("互花米草坐标文件加载失败。");
  }

  const text = await response.text();
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  return lines.slice(1).map((line, index) => {
    const [longitude, latitude] = line.split(",");
    const lng = parseDmsCoordinate(longitude);
    const lat = parseDmsCoordinate(latitude);

    return {
      id: `spartina-${index + 1}`,
      index: index + 1,
      lng,
      lat
    };
  });
}
