export const SPARTINA_SCENARIO_ID = "spartina_change_detection";
export const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
export const ROI_INSET_RATIO = 0;
export const BAND_OPTIONS = Array.from({ length: 64 }, (_, index) =>
  `A${String(index).padStart(2, "0")}`
);
export const SIMILARITY_SCENARIOS = new Set(["image_retrieval", "click_query"]);
export const SPARTINA_PREVIEW_IMAGE = "/scenarios/spartina/互花米草-v3.png";
export const SPARTINA_BASE_TIF_PATH = "/scenarios/spartina/spartina_v1.tif";
export const SPARTINA_MASK_PREVIEW_PATH =
  "/api/scenarios/spartina_change_detection/mask-preview";

export const defaultParams = {
  year: 2024,
  bandR: "A01",
  bandG: "A16",
  bandB: "A09",
  rgbMin: -0.3,
  rgbMax: 0.3,
  clusterCount: 5,
  sampleCount: 300,
  scale: 10,
  seed: 100,
  includeVectorProbe: false,
  searchSizeKm: 3,
  topK: 10,
  candidateThreshold: 0.9,
  imageSampleCount: 9,
  imageMaxSpacingMeters: 10,
  minResultSpacingMeters: 0
};

export function isSimilarityScenario(scenarioId) {
  return SIMILARITY_SCENARIOS.has(scenarioId);
}
