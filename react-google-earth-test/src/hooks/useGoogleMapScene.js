import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../googleMaps";
import { extractMapSnapshot, extractPointFeatures } from "../mapUtils";
import { MAPS_API_KEY } from "../scenarioConfig";

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

export function useGoogleMapScene({
  layers,
  onError,
  onMapReady,
  onReferencePointAdd,
  referencePoints,
  scenarioPoints,
  selectedScenarioId,
  similarityMode
}) {
  const mapHostRef = useRef(null);
  const mapRef = useRef(null);
  const mapsRef = useRef(null);
  const listenersRef = useRef([]);
  const referenceMarkersRef = useRef([]);
  const resultMarkersRef = useRef([]);
  const scenarioMarkersRef = useRef([]);
  const infoWindowRef = useRef(null);
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
    let cancelled = false;

    async function bootstrap() {
      try {
        const maps = await loadGoogleMaps(MAPS_API_KEY);
        const mapsLib = await maps.importLibrary("maps");

        if (cancelled || !mapHostRef.current) {
          return;
        }

        mapsRef.current = {
          maps,
          Map: mapsLib.Map,
          Marker: google.maps.Marker,
          InfoWindow: google.maps.InfoWindow,
          Size: google.maps.Size
        };

        const map = new mapsRef.current.Map(mapHostRef.current, {
          center: { lat: 29.8683, lng: 121.544 },
          zoom: 17,
          mapTypeId: "satellite",
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeControl: false
        });

        mapRef.current = map;
        infoWindowRef.current = new mapsRef.current.InfoWindow();

        const updateSnapshot = () => {
          const snapshot = extractMapSnapshot(map);
          if (snapshot) {
            setMapSnapshot(snapshot);
          }
        };

        listenersRef.current = [
          map.addListener("idle", updateSnapshot),
          map.addListener("click", (event) => {
            if (selectedScenarioIdRef.current !== "click_query") {
              return;
            }

            const latLng = event.latLng;
            if (!latLng) {
              return;
            }

            onReferencePointAddRef.current?.({
              lat: latLng.lat(),
              lng: latLng.lng()
            });
          })
        ];

        setMapReady(true);
        updateSnapshot();
        onMapReadyRef.current?.();
      } catch (bootstrapError) {
        onErrorRef.current?.(bootstrapError);
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      listenersRef.current.forEach((listener) => listener?.remove?.());
      listenersRef.current = [];
      resultMarkersRef.current.forEach((marker) => marker.setMap(null));
      resultMarkersRef.current = [];
      scenarioMarkersRef.current.forEach((marker) => marker.setMap(null));
      scenarioMarkersRef.current = [];
      referenceMarkersRef.current.forEach((marker) => marker.setMap(null));
      referenceMarkersRef.current = [];
      mapRef.current = null;
      mapsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const mapClasses = mapsRef.current;
    if (!map || !mapClasses) {
      return;
    }

    referenceMarkersRef.current.forEach((marker) => marker.setMap(null));
    referenceMarkersRef.current = [];

    if (referencePoints.length === 0 || !similarityMode) {
      return;
    }

    referenceMarkersRef.current = referencePoints.map((point, index) => {
      const isMultiClick = selectedScenarioId === "click_query";
      return new mapClasses.Marker({
        map,
        position: point,
        title: "Reference Point",
        label: {
          text: isMultiClick ? String(index + 1) : "R",
          color: "#ffffff",
          fontSize: "12px",
          fontWeight: "700"
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: "#dc2626",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
          scale: 10
        }
      });
    });
  }, [referencePoints, selectedScenarioId, similarityMode]);

  useEffect(() => {
    const map = mapRef.current;
    const mapClasses = mapsRef.current;
    if (!map || !mapClasses) {
      return;
    }

    const overlays = map.overlayMapTypes;
    while (overlays.getLength() > 0) {
      overlays.removeAt(0);
    }

    layers
      .filter(
        (layer) =>
          layer.visible &&
          layer.layer_type === "raster_tile" &&
          typeof layer.tile_url === "string" &&
          layer.tile_url.length > 0
      )
      .forEach((layer) => {
        const mapType = {
          name: layer.name,
          tileSize: new mapClasses.Size(256, 256),
          getTile(coord, zoom, ownerDocument) {
            const image = ownerDocument.createElement("img");
            image.src = layer.tile_url
              .replace("{x}", String(coord.x))
              .replace("{y}", String(coord.y))
              .replace("{z}", String(zoom));
            image.alt = layer.name;
            image.draggable = false;
            image.style.width = "256px";
            image.style.height = "256px";
            image.style.display = "block";
            image.style.opacity = String(layer.opacity ?? 1);
            image.style.pointerEvents = "none";
            return image;
          },
          releaseTile(tile) {
            if (tile?.remove) {
              tile.remove();
            }
          }
        };
        overlays.insertAt(overlays.getLength(), mapType);
      });
  }, [layers]);

  useEffect(() => {
    const map = mapRef.current;
    const mapClasses = mapsRef.current;
    if (!map || !mapClasses) {
      return;
    }

    scenarioMarkersRef.current.forEach((marker) => marker.setMap(null));
    scenarioMarkersRef.current = [];

    if (selectedScenarioId !== "spartina_change_detection" || scenarioPoints.length === 0) {
      return;
    }

    const infoWindow = infoWindowRef.current;
    scenarioMarkersRef.current = scenarioPoints.map((point) => {
      const marker = new mapClasses.Marker({
        map,
        position: { lat: point.lat, lng: point.lng },
        title: `互花米草样点 ${point.index}`,
        label: {
          text: String(point.index),
          color: "#0b1220",
          fontSize: "11px",
          fontWeight: "700"
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: "#facc15",
          fillOpacity: 1,
          strokeColor: "#0f172a",
          strokeWeight: 2,
          scale: 8
        }
      });

      marker.addListener("click", () => {
        infoWindow?.setContent(
          `<div class="mapInfoWindow"><strong>互花米草样点 ${point.index}</strong><br/>Lat: ${point.lat.toFixed(6)}<br/>Lng: ${point.lng.toFixed(6)}</div>`
        );
        infoWindow?.open({
          map,
          anchor: marker
        });
      });

      return marker;
    });
  }, [scenarioPoints, selectedScenarioId]);

  useEffect(() => {
    const map = mapRef.current;
    const mapClasses = mapsRef.current;
    if (!map || !mapClasses) {
      return;
    }

    resultMarkersRef.current.forEach((marker) => marker.setMap(null));
    resultMarkersRef.current = [];

    const infoWindow = infoWindowRef.current;
    infoWindow?.close();

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

          const [lng, lat] = feature.geometry.coordinates || [];
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return;
          }

          const rank = feature.properties?.rank;
          const score = feature.properties?.score;
          const marker = new mapClasses.Marker({
            map,
            position: { lat, lng },
            title: layer.name,
            label: rank
              ? {
                  text: String(rank),
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: "700"
                }
              : undefined,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: "#2563eb",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
              scale: 11
            }
          });

          marker.addListener("click", () => {
            infoWindow?.setContent(
              `<div class="mapInfoWindow"><strong>${layer.name}</strong><br/>Rank: ${rank ?? "-"}<br/>Score: ${score ?? "-"}</div>`
            );
            infoWindow?.open({
              map,
              anchor: marker
            });
          });

          resultMarkersRef.current.push(marker);
        });
      });
  }, [layers]);

  useEffect(() => {
    if (!pendingAutoFitRef.current || !similarityMode) {
      return;
    }

    const map = mapRef.current;
    const mapsApi = mapsRef.current?.maps;
    if (!map || !mapsApi) {
      return;
    }

    const resultPoints = layers.flatMap(extractPointFeatures);
    const allPoints = [...referencePoints, ...resultPoints];

    if (allPoints.length === 0) {
      pendingAutoFitRef.current = false;
      return;
    }

    if (allPoints.length === 1) {
      map.panTo(allPoints[0]);
      map.setZoom(17);
      pendingAutoFitRef.current = false;
      return;
    }

    const bounds = new mapsApi.LatLngBounds();
    allPoints.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 80);
    pendingAutoFitRef.current = false;
  }, [layers, referencePoints, similarityMode]);

  function fitToBounds(bounds, padding = 80) {
    const map = mapRef.current;
    const mapsApi = mapsRef.current?.maps;
    if (!map || !mapsApi || !isValidBounds(bounds)) {
      return false;
    }

    const [southWest, northEast] = bounds;
    const latLngBounds = new mapsApi.LatLngBounds(
      { lat: southWest[0], lng: southWest[1] },
      { lat: northEast[0], lng: northEast[1] }
    );
    map.fitBounds(latLngBounds, padding);
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

    map.setCenter({ lat, lng });
    if (Number.isFinite(snapshot.zoom)) {
      map.setZoom(snapshot.zoom);
    }
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
