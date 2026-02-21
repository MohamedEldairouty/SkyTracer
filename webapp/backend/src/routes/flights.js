const express = require("express");
const Flight = require("../models/Flight");

const router = express.Router();

// current active flight
router.get("/current", async (req, res) => {
  const current = await Flight.findOne({ status: "ACTIVE" }).sort({ createdAt: -1 });
  res.json(current || {});
});

// list all flights
router.get("/", async (req, res) => {
  const flights = await Flight.find().sort({ createdAt: -1 }).limit(100);
  res.json(flights);
});

// start flight (ends any previous active flight automatically)
router.post("/start", async (req, res) => {
  const name = req.body?.name || "";

  await Flight.updateMany(
    { status: "ACTIVE" },
    { $set: { status: "ENDED", endedAt: new Date() } }
  );

  const flight = await Flight.create({ name, status: "ACTIVE" });
  const io = req.app.get("io");
  io.emit("flight:changed", flight);

  res.json({ ok: true, flight });
});

// stop flight
router.post("/stop", async (req, res) => {
  const current = await Flight.findOne({ status: "ACTIVE" }).sort({ createdAt: -1 });
  if (!current) return res.json({ ok: true, message: "No active flight." });

  current.status = "ENDED";
  current.endedAt = new Date();
  await current.save();

  const io = req.app.get("io");
  io.emit("flight:changed", {}); // no active
  res.json({ ok: true, flight: current });
});

module.exports = router;
