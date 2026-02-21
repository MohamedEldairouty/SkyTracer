// backend/ai/dump_telemetry.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const connectDB = require("../src/config/db");
const Telemetry = require("../src/models/Telemetry");

(async () => {
  try {
    await connectDB();

    const items = await Telemetry.find({})
      .sort({ createdAt: 1 })
      .limit(200000)
      .lean();

    const outDir = __dirname;
    const outPath = path.join(outDir, "telemetry_dump.json");

    fs.writeFileSync(outPath, JSON.stringify(items, null, 2));
    console.log(`✅ Dumped ${items.length} rows -> ${outPath}`);
    process.exit(0);
  } catch (e) {
    console.error("❌ dump failed:", e);
    process.exit(1);
  }
})();
