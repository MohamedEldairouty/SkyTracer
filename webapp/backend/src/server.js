const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();
const connectDB = require("./config/db");

const telemetryRoutes = require("./routes/telemetry");
const cameraRoutes = require("./routes/camera");
const controlRoutes = require("./routes/control");
const flightRoutes = require("./routes/flights");

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://172.20.10.9:5173",
];

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Filename"],
}));

app.use(express.json({ limit: "2mb" }));

connectDB();

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST", "DELETE", "PUT"] },
  transports: ["polling", "websocket"],
});
app.set("io", io);

// Routes
app.use("/api/telemetry", telemetryRoutes);
app.use("/api/camera", cameraRoutes);
app.use("/api/control", controlRoutes);
app.use("/api/flights", flightRoutes);
const aiRoutes = require("./routes/ai");
app.use("/api/ai", aiRoutes);

// Health
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "SkyTracer backend alive 🚀" });
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.on("disconnect", () => console.log("Client disconnected:", socket.id));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`);
});