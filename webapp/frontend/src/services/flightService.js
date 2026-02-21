const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

export async function getCurrentFlight() {
  const res = await fetch(`${API_BASE}/api/flights/current`);
  if (!res.ok) throw new Error(`Flight current failed: ${res.status}`);
  return res.json();
}

export async function startFlight(name = "") {
  const res = await fetch(`${API_BASE}/api/flights/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Flight start failed: ${res.status}`);
  return res.json();
}

export async function stopFlight() {
  const res = await fetch(`${API_BASE}/api/flights/stop`, { method: "POST" });
  if (!res.ok) throw new Error(`Flight stop failed: ${res.status}`);
  return res.json();
}
