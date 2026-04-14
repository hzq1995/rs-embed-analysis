export function formatValue(value) {
  if (value == null) {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(6);
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

export function formatCoordinate(point) {
  if (!point) {
    return "-";
  }
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}
