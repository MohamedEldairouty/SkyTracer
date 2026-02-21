// backend/src/routes/ai.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const Telemetry = require("../models/Telemetry");

const router = express.Router();

const MODEL_PATH = path.join(process.cwd(), "ai", "model.json");

// helper: number check + ignore 0,0 GPS style junk if needed later
function isFiniteNum(x) {
  const n = Number(x);
  return Number.isFinite(n);
}

// --- very simple linear forecast using trend (or fallback) ---
// If your python model already computes a forecast array, replace this logic
function makeForecast(nowIaq, trendPerStep, steps) {
  const out = [];
  let v = Number(nowIaq);
  if (!Number.isFinite(v)) v = 0;

  for (let i = 1; i <= steps; i++) {
    v = v + trendPerStep;
    out.push(Number(v.toFixed(2)));
  }
  return out;
}

// GET /api/ai/status  -> model meta + metrics
router.get("/status", (req, res) => {
  if (!fs.existsSync(MODEL_PATH)) {
    return res.json({ ok: true, ready: false });
  }
  const model = JSON.parse(fs.readFileSync(MODEL_PATH, "utf-8"));
  res.json({
    ok: true,
    ready: true,
    meta: model.meta || {},
    metrics: model.metrics || {},
    modelBrief: model.modelBrief || {
      name: "Time-series regression + hazard classifier",
      input: "Recent telemetry window (iaq, gas, temp, humidity, pressure + trends)",
      output: "IAQ forecast + hazard probability (IAQ ≥ 200)",
    },
  });
});

// GET /api/ai/predict  -> now + forecast + eta
router.get("/predict", async (req, res) => {
  if (!fs.existsSync(MODEL_PATH)) {
    return res.status(404).json({ ok: false, error: "AI model not trained yet" });
  }

  const model = JSON.parse(fs.readFileSync(MODEL_PATH, "utf-8"));
  const horizonSteps = model?.meta?.horizon_steps ?? 40;
  const hazardThreshold = model?.meta?.hazard_threshold ?? 200;
  const sampleIntervalSec = model?.meta?.sample_interval_sec ?? 3;

  const latest = await Telemetry.findOne().sort({ createdAt: -1 });
  const nowIaq = latest?.iaq;

  // If you already store trend in model inference output, use it.
  // Otherwise estimate a tiny trend from last 10 points:
  const recent = await Telemetry.find().sort({ createdAt: -1 }).limit(10);
  let trendPerStep = 0;

  if (recent.length >= 2) {
    const a = Number(recent[0].iaq);
    const b = Number(recent[recent.length - 1].iaq);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      // slope across 10 samples -> per step
      trendPerStep = (a - b) / (recent.length - 1);
      // tiny smoothing so it doesn't go crazy
      trendPerStep = Math.max(-3, Math.min(3, trendPerStep));
    }
  }

  // forecast series
  const forecast = makeForecast(nowIaq, trendPerStep, horizonSteps);

  // hazard prob / hazard flag (if you already compute hazardProb in python, return it here instead)
  const iaqFuture = forecast[forecast.length - 1];
  const hazard = iaqFuture >= hazardThreshold;

  // hazard ETA = first step where forecast crosses threshold
  let hazardEtaSec = null;
  const idx = forecast.findIndex((v) => v >= hazardThreshold);
  if (idx !== -1) {
    hazardEtaSec = (idx + 1) * sampleIntervalSec;
  }

  res.json({
    ok: true,
    now: {
      createdAt: latest?.createdAt || null,
      iaq: isFiniteNum(nowIaq) ? Number(nowIaq) : null,
    },
    predict: {
      forecast,                 // ✅ array for chart
      iaqFuture,
      hazardThreshold,
      horizonSteps,
      sampleIntervalSec,
      hazard,
      hazardEtaSec,             // ✅ ETA for UI
    },
    trend: {
      trendPerStep: Number(trendPerStep.toFixed(3)),
      trendLabel:
        trendPerStep > 0.5 ? "RISING" :
        trendPerStep < -0.5 ? "FALLING" :
        "STABLE",
    },
  });
});

// GET /api/ai/export/recent.csv?minutes=60
router.get("/export/recent.csv", async (req, res) => {
  const minutes = Math.max(1, Math.min(parseInt(req.query.minutes || "60", 10), 24 * 60));
  const since = new Date(Date.now() - minutes * 60 * 1000);

  const rows = await Telemetry.find({ createdAt: { $gte: since } })
    .sort({ createdAt: 1 })
    .limit(5000);

  const header = ["createdAt","iaq","gasK","temp","hum","pres","hazardAlarm","loggingEnabled"];
  const lines = [header.join(",")];

  for (const r of rows) {
    lines.push([
      r.createdAt?.toISOString?.() || "",
      r.iaq ?? "",
      r.gasK ?? "",
      r.temp ?? "",
      r.hum ?? "",
      r.pres ?? "",
      r.hazardAlarm ?? "",
      r.loggingEnabled ?? "",
    ].join(","));
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="skytracer_recent_${minutes}min.csv"`);
  res.send(lines.join("\n"));
});

module.exports = router;
