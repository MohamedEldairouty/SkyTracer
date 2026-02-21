const API_BASE = import.meta.env.VITE_API_BASE || "http://172.20.10.9:4000";

export async function getAiStatus() {
  const res = await fetch(`${API_BASE}/api/ai/status`);
  if (!res.ok) throw new Error(`AI status failed: ${res.status}`);
  return res.json();
}

export async function getAiPredict() {
  const res = await fetch(`${API_BASE}/api/ai/predict`);
  if (!res.ok) throw new Error(`AI predict failed: ${res.status}`);
  return res.json();
}

export function downloadRecentCsv(minutes = 60) {
  window.open(`${API_BASE}/api/ai/export/recent.csv?minutes=${minutes}`, "_blank");
}
