// src/controllers/telemetryController.js
const Telemetry = require("../models/Telemetry");

// This endpoint will be called by the GROUND ESP32 (via WiFi) using HTTP POST
const receiveTelemetry = async (req, res) => {
  try {
    const {
      date,
      time,
      lat,
      lon,
      alt,
      temp,
      hum,
      pres,
      gasK,
      iaq,
      level,
      loggingEnabled,
      buzzerActive,
      rawLine
    } = req.body;

    const doc = await Telemetry.create({
      date,
      time,
      lat,
      lon,
      alt,
      temp,
      humidity: hum,
      pressure: pres,
      gasK,
      iaq,
      level,
      loggingEnabled,
      buzzerActive,
      rawLine
    });

    // Emit via Socket.IO for live dashboard
    const io = req.app.get("io");
    io.emit("telemetry:new", doc);

    return res.status(201).json({ success: true, telemetry: doc });
  } catch (err) {
    console.error("Error saving telemetry:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const getLatestTelemetry = async (req, res) => {
  try {
    const doc = await Telemetry.findOne().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, telemetry: doc });
  } catch (err) {
    console.error("Error fetching latest telemetry:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  receiveTelemetry,
  getLatestTelemetry
};
