const API_BASE = import.meta.env.VITE_API_BASE || "http://172.20.10.9:4000";

export async function getLatestTelemetry() {
  const res = await fetch(`${API_BASE}/api/telemetry/latest`);
  if (!res.ok) throw new Error(`Latest telemetry failed: ${res.status}`);
  return res.json();
}

export async function getRecentTelemetry(minutes = 60) {
  const res = await fetch(`${API_BASE}/api/telemetry/recent?minutes=${minutes}`);
  if (!res.ok) throw new Error(`Recent telemetry failed: ${res.status}`);
  return res.json();
}
