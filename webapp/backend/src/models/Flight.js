const mongoose = require("mongoose");

const FlightSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    status: { type: String, enum: ["ACTIVE", "ENDED"], default: "ACTIVE" },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Flight", FlightSchema);
