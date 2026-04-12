let loaderPromise;

function appendScript(apiKey) {
  return new Promise((resolve, reject) => {
    const callbackName = "__initGoogleMapsForReactTest";
    const existing = document.querySelector(
      'script[data-google-maps-loader="standard"]'
    );

    if (existing) {
      if (window.google?.maps?.importLibrary) {
        resolve();
        return;
      }

      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google Maps JavaScript API failed to load.")),
        { once: true }
      );
      return;
    }

    window[callbackName] = () => {
      delete window[callbackName];
      resolve();
    };

    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(apiKey)}` +
      `&callback=${callbackName}` +
      "&loading=async";
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = "standard";
    script.onerror = () => {
      delete window[callbackName];
      reject(new Error("Google Maps JavaScript API failed to load."));
    };
    document.head.appendChild(script);
  });
}

export async function loadGoogleMaps(apiKey) {
  if (!apiKey) {
    throw new Error("Missing VITE_GOOGLE_MAPS_API_KEY. Add it to your .env file.");
  }

  if (!loaderPromise) {
    loaderPromise = appendScript(apiKey);
  }

  await loaderPromise;

  if (!window.google?.maps?.importLibrary) {
    throw new Error("Google Maps API loaded, but importLibrary is unavailable.");
  }

  return window.google.maps;
}
