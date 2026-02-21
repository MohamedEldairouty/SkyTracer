const API_BASE = import.meta.env.VITE_API_BASE || "http://172.20.10.9:4000";

export async function getImages() {
  const res = await fetch(`${API_BASE}/api/camera/list`);
  if (!res.ok) throw new Error(`Camera list failed: ${res.status}`);
  return res.json();
}

export async function deleteImage(filename) {
  const res = await fetch(`${API_BASE}/api/camera/${filename}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  return res.json();
}

export async function clearAllImages() {
  const res = await fetch(`${API_BASE}/api/camera/clear/all`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Clear failed: ${res.status}`);
  return res.json();
}
