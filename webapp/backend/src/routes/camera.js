const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// RAW JPEG upload endpoint
router.post("/uploadRaw", (req, res) => {
  const filenameHeader = req.header("X-Filename");
  const filename = (filenameHeader || `cam_${Date.now()}.jpg`)
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  const outPath = path.join(uploadDir, filename);

  const ws = fs.createWriteStream(outPath);
  req.pipe(ws);

  ws.on("finish", () => {
    // emit live update
    const io = req.app.get("io");
    io.emit("camera:new", {
      filename,
      url: `/api/camera/files/${filename}`,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ ok: true, file: filename });
  });

  ws.on("error", (e) => res.status(500).json({ ok: false, error: e.message }));
});

// list -> returns objects with timestamps
router.get("/list", (req, res) => {
  const files = fs.readdirSync(uploadDir)
    .filter(f => f.toLowerCase().endsWith(".jpg"))
    .map((f) => {
      const fp = path.join(uploadDir, f);
      const stat = fs.statSync(fp);
      return {
        filename: f,
        url: `/api/camera/files/${f}`,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(files);
});

// serve files
router.use("/files", express.static(uploadDir));

// delete one
router.delete("/:filename", (req, res) => {
  const safe = String(req.params.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const fp = path.join(uploadDir, safe);

  if (!fs.existsSync(fp)) return res.status(404).json({ ok: false, error: "Not found" });

  fs.unlinkSync(fp);

  const io = req.app.get("io");
  io.emit("camera:deleted", { filename: safe });

  res.json({ ok: true, filename: safe });
});

// clear all
router.delete("/clear/all", (req, res) => {
  const files = fs.readdirSync(uploadDir).filter(f => f.toLowerCase().endsWith(".jpg"));
  for (const f of files) fs.unlinkSync(path.join(uploadDir, f));

  const io = req.app.get("io");
  io.emit("camera:cleared");

  res.json({ ok: true, deleted: files.length });
});

module.exports = router;
