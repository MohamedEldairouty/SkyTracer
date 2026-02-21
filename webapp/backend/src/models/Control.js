const mongoose = require("mongoose");

const ControlSchema = new mongoose.Schema(
  {
    loggingEnabled: { type: Boolean, default: false },
    buzzerEnabled: { type: Boolean, default: false }, // manual override from web
  },
  { timestamps: true }
);

module.exports = mongoose.model("Control", ControlSchema);
