const express = require("express");
const Telemetry = require("../models/Telemetry");
const Flight = require("../models/Flight");

const router = express.Router();

// POST /api/telemetry  (Ground ESP32 sends here)
router.post("/", async (req, res) => {
  try {
    const active = await Flight.findOne({ status: "ACTIVE" }).sort({ createdAt: -1 });
    const payload = { ...req.body, flightId: active?._id || null };
    const doc = await Telemetry.create(payload);

    // push to live clients
    const io = req.app.get("io");
    io.emit("telemetry:new", doc);

    res.json({ ok: true, saved: doc });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /api/telemetry/latest
router.get("/latest", async (req, res) => {
  const latest = await Telemetry.findOne().sort({ createdAt: -1 });
  res.json(latest || {});
});
// GET /api/telemetry/recent?minutes=60
router.get("/recent", async (req, res) => {
  const minutes = Math.max(1, Math.min(parseInt(req.query.minutes || "60", 10), 24 * 60));
  const since = new Date(Date.now() - minutes * 60 * 1000);

  const items = await Telemetry.find({ createdAt: { $gte: since } })
    .sort({ createdAt: 1 })
    .limit(5000);

  res.json(items);
});


module.exports = router;