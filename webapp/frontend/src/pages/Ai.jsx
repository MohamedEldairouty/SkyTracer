import { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import "chart.js/auto";
import { io } from "socket.io-client";
import { getAiPredict, getAiStatus, downloadRecentCsv } from "../services/aiService";

const API_BASE = import.meta.env.VITE_API_BASE || "http://172.20.10.9:4000";

function fmtNum(x, d = 2) {
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}

function fmtEta(sec) {
  if (sec == null) return "Not expected soon ✅";
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return "—";
  if (s < 60) return `${Math.round(s)} sec`;
  return `${Math.round(s / 60)} min`;
}

function cx(...c) {
  return c.filter(Boolean).join(" ");
}

function trendBadge(label) {
  if (label === "RISING")
    return "bg-amber-500/15 text-amber-900 dark:text-amber-100 border-amber-400/25";
  if (label === "FALLING")
    return "bg-sky-500/15 text-sky-900 dark:text-sky-100 border-sky-400/25";
  return "bg-emerald-500/10 text-emerald-900 dark:text-emerald-100 border-emerald-400/20";
}

export default function Ai() {
  const [status, setStatus] = useState(null);
  const [pred, setPred] = useState(null);
  const [err, setErr] = useState("");

  // Detect theme from <html class="dark"> (Tailwind standard)
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // socket polling only (mobile-safe)
  const socket = useMemo(
    () => io(API_BASE, { transports: ["polling"], upgrade: false }),
    []
  );

  async function refresh() {
    const [s, p] = await Promise.all([getAiStatus(), getAiPredict()]);
    setStatus(s || null);
    setPred(p || null);
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e.message || "Failed to load AI"));
    const id = setInterval(() => refresh().catch(() => {}), 7000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    socket.on("telemetry:new", () => refresh().catch(() => {}));
    return () => {
      socket.off("telemetry:new");
      socket.disconnect();
    };
  }, []);

  const ready = Boolean(status?.ready);

  const metrics = status?.metrics || {};
  const brief = status?.modelBrief || {};

  const forecast = pred?.predict?.forecast || [];
  const horizonSteps = pred?.predict?.horizonSteps ?? forecast.length;
  const sampleIntervalSec = pred?.predict?.sampleIntervalSec ?? 3;
  const hazardThreshold = pred?.predict?.hazardThreshold ?? 200;

  const nowIaq = pred?.now?.iaq;
  const nowValid = Number.isFinite(Number(nowIaq)) ? Number(nowIaq) : null;

  const labels = [
    "now",
    ...Array.from({ length: forecast.length }, (_, i) => `+${(i + 1) * sampleIntervalSec}s`),
  ];

  // --- Chart colors depending on theme ---
  const legendColor = isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)";
  const tickColor   = isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)";
  const gridColor   = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";

  const chartData = {
    labels,
    datasets: [
      {
        label: "IAQ (Now)",
        data: [nowValid, ...Array(forecast.length).fill(null)],
        borderWidth: 3,
        tension: 0.25,
        pointRadius: 4,
      },
      {
        label: "IAQ Forecast",
        data: [nowValid, ...forecast.map((v) => (Number.isFinite(Number(v)) ? Number(v) : null))],
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 0,
        borderDash: [6, 6],
      },
      {
        label: `Hazard Threshold (${hazardThreshold})`,
        data: Array(labels.length).fill(hazardThreshold),
        borderWidth: 1,
        pointRadius: 0,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: legendColor } },
      tooltip: { enabled: true },
    },
    scales: {
      x: { ticks: { color: tickColor }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor }, grid: { color: gridColor } },
    },
  };

  const etaSec = pred?.predict?.hazardEtaSec ?? null;
  const hazardNow = Boolean(pred?.predict?.hazard);

  const forecastExplain =
    "Forecast = predicted IAQ values for the next few seconds/minutes based on recent sensor behavior. " +
    "Dashed line = future, solid point = ‘now’.";

  async function exportAiSummary() {
    const payload = {
      exportedAt: new Date().toISOString(),
      status,
      pred,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "skytracer_ai_summary.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen text-black dark:text-white">
      {/* Light + Dark backgrounds */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" />
      <div
        className="fixed inset-0 -z-10 opacity-60 dark:opacity-40
        [background:radial-gradient(1100px_circle_at_15%_10%,rgba(56,189,248,0.30),transparent_60%),radial-gradient(900px_circle_at_85%_20%,rgba(168,85,247,0.22),transparent_55%),radial-gradient(900px_circle_at_40%_95%,rgba(34,197,94,0.20),transparent_55%)]"
      />

      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="text-3xl font-extrabold tracking-tight">AI Insights</div>
            <div className="text-sm text-black/60 dark:text-white/60">
              Predict IAQ trend + hazard timing
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => refresh().catch((e) => setErr(e.message))}
              className="px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 border border-black/10 dark:border-white/10 text-sm font-semibold"
            >
              ⟳ Refresh
            </button>
            <button
              onClick={() => downloadRecentCsv(60)}
              className="px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 border border-black/10 dark:border-white/10 text-sm font-semibold"
            >
              ⬇ Export CSV (60m)
            </button>
            <button
              onClick={exportAiSummary}
              className="px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 border border-black/10 dark:border-white/10 text-sm font-semibold"
            >
              ⬇ Export AI Summary
            </button>
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-red-800 dark:text-red-100">
            <div className="font-semibold">❌ {err}</div>
          </div>
        ) : null}

        {!ready ? (
          <div className="mt-6 rounded-3xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] p-5 backdrop-blur">
            <div className="text-lg font-bold">AI not ready</div>
            <div className="text-black/60 dark:text-white/60 mt-1">
              Train the model first, then refresh.
            </div>
          </div>
        ) : (
          <>
            {/* top cards */}
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded-3xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] p-5 backdrop-blur">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-black/60 dark:text-white/60">
                    IAQ Forecast Chart
                  </div>
                  <div className="text-xs text-black/60 dark:text-white/60">
                    Horizon: {horizonSteps} steps (~
                    {Math.round((horizonSteps * sampleIntervalSec) / 60)} min)
                  </div>
                </div>

                <div className="mt-2 text-xs text-black/60 dark:text-white/60">
                  {forecastExplain}
                </div>

                <div className="mt-4 h-[360px]">
                  <Line data={chartData} options={chartOptions} />
                </div>
              </div>

              <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] p-5 backdrop-blur">
                <div className="text-sm text-black/60 dark:text-white/60">Hazard</div>

                <div className="mt-2 text-3xl font-extrabold">
                  {hazardNow ? "🚨 YES" : "✅ NO"}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="text-sm text-black/60 dark:text-white/60">Next Hazard ETA</div>
                  <div className="text-sm font-bold">{fmtEta(etaSec)}</div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="text-sm text-black/60 dark:text-white/60">Now IAQ</div>
                  <div className="text-sm font-bold">{fmtNum(nowIaq, 1)}</div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="text-sm text-black/60 dark:text-white/60">Forecast IAQ</div>
                  <div className="text-sm font-bold">{fmtNum(pred?.predict?.iaqFuture, 1)}</div>
                </div>

                <div className="mt-3 text-xs text-black/60 dark:text-white/60">
                  Hazard is defined as IAQ ≥{" "}
                  <span className="font-semibold">{hazardThreshold}</span>.
                </div>
              </div>
            </div>

            {/* model + trend */}
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded-3xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] p-5 backdrop-blur">
                <div className="text-sm text-black/60 dark:text-white/60">Model Summary</div>

                <div className="mt-2 text-lg font-extrabold">
                  {brief?.name || "SkyTracer AI Model"}
                </div>
                <div className="mt-1 text-black/70 dark:text-white/70 text-sm">
                  <span className="font-semibold">Input:</span>{" "}
                  {brief?.input || "Recent telemetry window (IAQ + BME signals)"}
                </div>
                <div className="mt-1 text-black/70 dark:text-white/70 text-sm">
                  <span className="font-semibold">Output:</span>{" "}
                  {brief?.output || "Future IAQ + hazard probability"}
                </div>

                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Metric label="Train samples" value={metrics?.train_samples ?? "—"} />
                  <Metric label="Test samples" value={metrics?.test_samples ?? "—"} />
                  <Metric
                    label="Forecast MAE"
                    value={metrics?.iaq_mae != null ? fmtNum(metrics.iaq_mae, 2) : "—"}
                  />
                  <Metric
                    label="Hazard AUC"
                    value={metrics?.hazard_auc != null ? fmtNum(metrics.hazard_auc, 3) : "—"}
                  />
                </div>

                <div className="mt-4 text-xs text-black/50 dark:text-white/50">
                  Trained at: {status?.meta?.trained_at || "—"}
                </div>
              </div>

              <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] p-5 backdrop-blur">
                <div className="text-sm text-black/60 dark:text-white/60">Trend</div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="text-sm text-black/70 dark:text-white/70">IAQ direction</div>
                  <span
                    className={cx(
                      "px-3 py-1.5 rounded-full border text-xs font-semibold",
                      trendBadge(pred?.trend?.trendLabel)
                    )}
                  >
                    {pred?.trend?.trendLabel || "—"}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="text-sm text-black/70 dark:text-white/70">Slope</div>
                  <div className="text-sm font-bold">{fmtNum(pred?.trend?.trendPerStep, 3)} / step</div>
                </div>

                <div className="mt-4 text-xs text-black/60 dark:text-white/60">
                  Trend = “is IAQ moving up or down right now?” Helpful during flight decisions.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-3">
      <div className="text-xs text-black/60 dark:text-white/60">{label}</div>
      <div className="text-lg font-extrabold mt-1">{value}</div>
    </div>
  );
}
