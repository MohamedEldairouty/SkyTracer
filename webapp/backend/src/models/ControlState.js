const mongoose = require("mongoose");

const ControlStateSchema = new mongoose.Schema(
  {
    key: { type: String, default: "main", unique: true },

    // logging shared state
    loggingEnabled: { type: Boolean, default: false },

    // buzzer control on GROUND
    // AUTO = follow hazardAlarm (iaq >= threshold)
    // MANUAL = use buzzerManualOn
    buzzerMode: { type: String, enum: ["AUTO", "MANUAL"], default: "AUTO" },
    buzzerManualOn: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ControlState", ControlStateSchema);
