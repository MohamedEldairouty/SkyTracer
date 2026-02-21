import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { getLatestTelemetry } from "../services/telemetryService";
import {
  getControlState,
  setLogging,
  buzzerAuto,
  buzzerManualOn,
  buzzerManualOff,
} from "../services/controlService";

const API_BASE = import.meta.env.VITE_API_BASE || "http://172.20.10.9:4000";

function iaqMeta(iaq) {
  const v = Number(iaq);
  if (!Number.isFinite(v)) {
    return { label: "UNKNOWN", range: "—", tone: "bg-slate-500/15 text-slate-200 border-slate-400/20", bar: 0 };
  }
  if (v <= 50)  return { label: "GOOD",               range: "0–50",   tone: "bg-green-500/15 text-green-200 border-green-400/25",  bar: v / 500 };
  if (v <= 100) return { label: "MODERATE",           range: "51–100", tone: "bg-yellow-500/15 text-yellow-100 border-yellow-400/25", bar: v / 500 };
  if (v <= 150) return { label: "UNHEALTHY (SENS.)",  range: "101–150",tone: "bg-orange-500/15 text-orange-100 border-orange-400/25", bar: v / 500 };
  if (v <= 200) return { label: "UNHEALTHY",          range: "151–200",tone: "bg-red-500/15 text-red-100 border-red-400/25",         bar: v / 500 };
  if (v <= 300) return { label: "VERY UNHEALTHY",     range: "201–300",tone: "bg-purple-500/15 text-purple-100 border-purple-400/25", bar: v / 500 };
  return         { label: "DANGEROUS",                range: "301–500",tone: "bg-rose-800/25 text-rose-100 border-rose-300/20",        bar: Math.min(1, v / 500) };
}

function fmtNum(x, digits = 2) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}
function gpsIsLive(data) {
  const lat = Number(data?.lat);
  const lon = Number(data?.lon);

  // must be valid numbers
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  // reject the classic "no fix" coordinate
  if (lat === 0 && lon === 0) return false;

  // reject out-of-range junk
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;

  // optional: require that telemetry itself is fresh
  const iso = data?.createdAt;
  if (iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return false;
    if (Date.now() - t > 15000) return false; // 15s
  }

  return true;
}

function safeIsoTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function cx(...c) { return c.filter(Boolean).join(" "); }

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [control, setControl] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // polling is the most reliable on hotspot/mobile
  const socket = useMemo(
    () => io(API_BASE, { transports: ["polling"], upgrade: false }),
    []
  );

  async function refresh() {
    const [t, c] = await Promise.all([getLatestTelemetry(), getControlState()]);
    setData(t && t._id ? t : null);
    setControl(c || null);
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e.message || "Failed to load"));
    const id = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    socket.on("telemetry:new", (doc) => {
      setData(doc);
      setErr("");
    });

    // ✅ backend emits "control:changed"
    socket.on("control:changed", async () => {
      // just re-fetch to keep state consistent
      try { setControl(await getControlState()); } catch {}
    });

    return () => {
      socket.off("telemetry:new");
      socket.off("control:changed");
      socket.disconnect();
    };
  }, []);

  const lastSeenIso = data?.createdAt || null;
  const isLive = lastSeenIso ? (Date.now() - new Date(lastSeenIso).getTime() < 15000) : false;

  const aq = iaqMeta(data?.iaq);

  const gpsLive = gpsIsLive(data);

  async function doAction(fn) {
    try {
      setBusy(true);
      setErr("");
      await fn();
      await refresh();
    } catch (e) {
      setErr(e.message || "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const buzzerText =
    control?.buzzerMode === "MANUAL"
      ? `MANUAL (${control?.buzzerManualOn ? "ON" : "OFF"})`
      : (control?.buzzerMode || "…");

  return (
    <div className="min-h-screen text-black dark:text-white">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" />
      <div className="fixed inset-0 -z-10 opacity-60 dark:opacity-40
        [background:radial-gradient(1100px_circle_at_15%_10%,rgba(56,189,248,0.30),transparent_60%),radial-gradient(900px_circle_at_85%_20%,rgba(168,85,247,0.22),transparent_55%),radial-gradient(900px_circle_at_40%_95%,rgba(34,197,94,0.20),transparent_55%)]" />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-3xl font-extrabold tracking-tight">Dashboard</div>
            <div className="text-sm text-black/60 dark:text-white/60">Live telemetry + quick controls</div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className={cx(
              "px-3 py-1.5 rounded-full border text-xs font-semibold",
              isLive
                ? "bg-green-500/15 text-green-700 dark:text-green-200 border-green-400/25"
                : "bg-amber-500/10 text-amber-800 dark:text-amber-100 border-amber-400/20"
            )}>
              {isLive ? "LIVE ✅" : "STALE 🫠"}
            </div>

            <button
              onClick={() => refresh().catch((e) => setErr(e.message))}
              className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 border border-black/10 dark:border-white/10 text-sm"
            >
              ⟳ Refresh
            </button>
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-red-800 dark:text-red-100">
            <div className="font-semibold">❌ {err}</div>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-3xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] p-5 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs tracking-widest text-black/50 dark:text-white/50">AIR QUALITY INDEX</div>
                <div className="text-4xl font-extrabold mt-1">
                  {fmtNum(data?.iaq, 1)} <span className="text-black/40 dark:text-white/40 text-base font-semibold">/ 500</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${aq.tone}`}>
                    {aq.label} • {aq.range}
                  </span>
                  <span className="px-3 py-1.5 rounded-full border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-xs text-black/70 dark:text-white/70">
                    Last update: {lastSeenIso ? safeIsoTime(lastSeenIso) : "—"}
                  </span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs text-black/50 dark:text-white/60">Backend</div>
                <div className="text-xs text-black/70 dark:text-white/80 break-all max-w-[220px]">{API_BASE}</div>
              </div>
            </div>

            <div className="mt-5">
              <div className="h-3 w-full rounded-full bg-black/10 dark:bg-black/30 border border-black/10 dark:border-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-black/60 dark:bg-white/70" style={{ width: `${Math.round((aq.bar || 0) * 100)}%` }} />
              </div>
              <div className="mt-2 text-xs text-black/60 dark:text-white/60">
                Tip: ground treats IAQ ≥ <span className="font-semibold">200</span> as hazard (buzzer auto).
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] p-5 backdrop-blur">
            <div className="text-xs tracking-widest text-black/50 dark:text-white/50">STATUS</div>

            <div className="mt-3 space-y-3">
              <Row label="Logging" value={data?.loggingEnabled ? "ON ✅" : "OFF ⛔"} tone={data?.loggingEnabled ? "good" : "bad"} />
              <Row label="Hazard alarm" value={data?.hazardAlarm ? "ON 🚨" : "OFF ✅"} tone={data?.hazardAlarm ? "bad" : "good"} />
              <Row label="GPS"value={gpsLive ? "LIVE ✅" : "NOT LIVE ❌"}tone={gpsLive ? "good" : "warn"}/>
              <Row label="Alt" value={`${fmtNum(data?.alt, 1)} m`} tone="neutral" />
            </div>

            <div className="mt-5">
              <div className="text-sm font-extrabold mb-2">Quick Controls</div>

              <div className="grid grid-cols-2 gap-2">
                <button disabled={busy} onClick={() => doAction(() => setLogging(true))}
                  className="rounded-xl border border-black/10 dark:border-white/10 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 px-3 py-2 text-sm font-semibold">
                  🟦 Logging ON
                </button>

                <button disabled={busy} onClick={() => doAction(() => setLogging(false))}
                  className="rounded-xl border border-black/10 dark:border-white/10 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 px-3 py-2 text-sm font-semibold">
                  ⛔ Logging OFF
                </button>

                <button disabled={busy} onClick={() => doAction(() => buzzerManualOn())}
                  className="rounded-xl border border-black/10 dark:border-white/10 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 px-3 py-2 text-sm font-semibold">
                  🔔 Buzzer ON
                </button>

                <button disabled={busy} onClick={() => doAction(() => buzzerManualOff())}
                  className="rounded-xl border border-black/10 dark:border-white/10 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 px-3 py-2 text-sm font-semibold">
                  🤫 Buzzer OFF
                </button>

                <button disabled={busy} onClick={() => doAction(() => buzzerAuto())}
                  className="col-span-2 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 px-3 py-2 text-sm font-semibold">
                  🤖 Buzzer AUTO (hazard)
                </button>
              </div>

              <div className="mt-3 text-xs text-black/60 dark:text-white/60">
                Current:{" "}
                <span className="font-semibold">
                  logging={String(control?.loggingEnabled ?? "…")} • buzzer={buzzerText}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MiniCard title="Temperature" icon="🌡️" value={`${fmtNum(data?.temp, 2)} °C`} sub="BME680" />
          <MiniCard title="Humidity" icon="💧" value={`${fmtNum(data?.hum, 1)} %`} sub="Relative humidity" />
          <MiniCard title="Pressure" icon="🧭" value={`${fmtNum(data?.pres, 1)} hPa`} sub="Atmospheric" />
          <MiniCard title="Gas" icon="🧪" value={`${fmtNum(data?.gasK, 2)} kΩ`} sub="VOC proxy" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "good"
      ? "bg-green-500/10 border-green-400/20 text-green-800 dark:text-green-100"
      : tone === "bad"
      ? "bg-red-500/10 border-red-400/20 text-red-800 dark:text-red-100"
      : tone === "warn"
      ? "bg-amber-500/10 border-amber-400/20 text-amber-900 dark:text-amber-100"
      : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-black/80 dark:text-white/80";

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-black/60 dark:text-white/60">{label}</div>
      <div className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function MiniCard({ title, icon, value, sub }) {
  return (
    <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="text-sm text-black/60 dark:text-white/60">{title}</div>
        <div className="text-xl">{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-extrabold">{value}</div>
      <div className="mt-1 text-xs text-black/50 dark:text-white/50">{sub}</div>
    </div>
  );
}
