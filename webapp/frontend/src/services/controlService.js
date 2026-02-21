const API_BASE = import.meta.env.VITE_API_BASE || "http://172.20.10.9:4000";

async function jfetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} ${txt}`);
  }
  return res.json();
}

export function getControlState() {
  return jfetch(`${API_BASE}/api/control/state`);
}

export function setLogging(enabled) {
  return jfetch(`${API_BASE}/api/control/logging`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export function setBuzzerMode(mode) {
  return jfetch(`${API_BASE}/api/control/buzzer/mode`, {
    method: "POST",
    body: JSON.stringify({ mode }), // "AUTO" | "MANUAL"
  });
}

export function setBuzzerManual(on) {
  return jfetch(`${API_BASE}/api/control/buzzer/manual`, {
    method: "POST",
    body: JSON.stringify({ on }), // true/false
  });
}

// convenience combos
export async function buzzerAuto() {
  await setBuzzerMode("AUTO");
}

export async function buzzerManualOn() {
  await setBuzzerMode("MANUAL");
  await setBuzzerManual(true);
}

export async function buzzerManualOff() {
  await setBuzzerMode("MANUAL");
  await setBuzzerManual(false);
}
