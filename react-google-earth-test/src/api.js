const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      detail = response.statusText;
    }
    throw new Error(detail);
  }

  return response.json();
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function fetchHealth() {
  return request("/api/health");
}

export function fetchScenarios() {
  return request("/api/scenarios");
}

export function runScenario(scenarioId, payload) {
  return request(`/api/scenarios/${scenarioId}/run`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
