const mongoose = require("mongoose");

const CameraImageSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    sizeBytes: { type: Number, default: 0 },
    source: { type: String, default: "esp32cam" }, // optional
    flightId: { type: mongoose.Schema.Types.ObjectId, ref: "Flight", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CameraImage", CameraImageSchema);
