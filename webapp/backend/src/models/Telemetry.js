const mongoose = require("mongoose");

const TelemetrySchema = new mongoose.Schema(
  {
    t_ms: Number,
    date: String,
    time: String,

    lat: Number,
    lon: Number,
    alt: Number,

    temp: Number,
    hum: Number,
    pres: Number,
    gasK: Number,
    iaq: Number,
    level: String,

    // ground-side status (optional later)
    loggingEnabled: Boolean,
    hazardAlarm: Boolean,
    flightId: { type: mongoose.Schema.Types.ObjectId, ref: "Flight", default: null },

  },
  { timestamps: true }
);

module.exports = mongoose.model("Telemetry", TelemetrySchema);