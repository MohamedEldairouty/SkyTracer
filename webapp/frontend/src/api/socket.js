import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE || "http://172.20.10.9:4000";

export const socket = io(API_BASE, {
  path: "/socket.io",
  transports: ["polling"],   // ✅ NO websocket upgrade attempt
  upgrade: false,
  reconnection: true,
  timeout: 10000,
});
