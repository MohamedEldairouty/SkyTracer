const express = require("express");
const ControlState = require("../models/ControlState");

const router = express.Router();

async function getOrCreate() {
  let doc = await ControlState.findOne({ key: "main" });
  if (!doc) doc = await ControlState.create({ key: "main" });
  return doc;
}

// GET /api/control/state  (Ground ESP polls this)
router.get("/state", async (req, res) => {
  const doc = await getOrCreate();
  res.json(doc);
});

// POST /api/control/logging { enabled: true/false }
router.post("/logging", async (req, res) => {
  const enabled = !!req.body.enabled;
  const doc = await getOrCreate();
  doc.loggingEnabled = enabled;
  await doc.save();

  const io = req.app.get("io");
  io.emit("control:changed", { loggingEnabled: doc.loggingEnabled });

  res.json({ ok: true, state: doc });
});

// POST /api/control/buzzer/mode { mode: "AUTO" | "MANUAL" }
router.post("/buzzer/mode", async (req, res) => {
  const mode = (req.body.mode || "").toUpperCase();
  if (!["AUTO", "MANUAL"].includes(mode)) {
    return res.status(400).json({ ok: false, error: "mode must be AUTO or MANUAL" });
  }

  const doc = await getOrCreate();
  doc.buzzerMode = mode;
  await doc.save();

  const io = req.app.get("io");
  io.emit("control:changed", { buzzerMode: doc.buzzerMode });

  res.json({ ok: true, state: doc });
});

// POST /api/control/buzzer/manual { on: true/false }  (only used when mode=MANUAL)
router.post("/buzzer/manual", async (req, res) => {
  const on = !!req.body.on;

  const doc = await getOrCreate();
  doc.buzzerManualOn = on;
  await doc.save();

  const io = req.app.get("io");
  io.emit("control:changed", { buzzerManualOn: doc.buzzerManualOn });

  res.json({ ok: true, state: doc });
});

module.exports = router;
