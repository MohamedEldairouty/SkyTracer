import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { getRecentTelemetry } from "../services/telemetryService";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

const RANGES = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
];

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString(); } catch { return ""; }
}

function safeNum(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export default function Charts() {
  const [minutes, setMinutes] = useState(60);
  const [data, setData] = useState([]);
  const [err, setErr] = useState("");

  const socket = useMemo(() => io(API_BASE), []);

  async function load(m) {
    setErr("");
    try {
      const items = await getRecentTelemetry(m);
      const mapped = items.map(d => ({
        ...d,
        t: fmtTime(d.createdAt),
        temp: safeNum(d.temp),
        hum: safeNum(d.hum),
        gasK: safeNum(d.gasK),
        iaq: safeNum(d.iaq),
        pres: safeNum(d.pres),
      }));
      setData(mapped);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load(minutes);

    socket.on("telemetry:new", (doc) => {
      const now = Date.now();
      const since = now - minutes * 60 * 1000;

      // append only if inside selected window
      const created = new Date(doc.createdAt).getTime();
      if (!Number.isFinite(created) || created < since) return;

      const row = {
        ...doc,
        t: fmtTime(doc.createdAt),
        temp: safeNum(doc.temp),
        hum: safeNum(doc.hum),
        gasK: safeNum(doc.gasK),
        iaq: safeNum(doc.iaq),
        pres: safeNum(doc.pres),
      };

      setData(prev => {
        const next = [...prev, row];
        // keep only data inside window
        return next.filter(x => new Date(x.createdAt).getTime() >= since);
      });
    });

    return () => {
      socket.off("telemetry:new");
      socket.disconnect();
    };
  }, [minutes]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-white/60 text-sm">Analytics</div>
          <div className="text-3xl font-extrabold tracking-tight">Charts</div>
          <div className="text-white/55 text-sm mt-1">
            Select a time window • updates live
          </div>
        </div>

        <div className="flex items-center gap-2">
          {RANGES.map(r => (
            <button
              key={r.minutes}
              onClick={() => setMinutes(r.minutes)}
              className={`px-4 py-2 rounded-xl border transition font-semibold
                ${minutes === r.minutes
                  ? "bg-white/15 border-white/20"
                  : "bg-white/5 border-white/10 hover:bg-white/10"}`}
            >
              {r.label}
            </button>
          ))}

          <button
            onClick={() => load(minutes)}
            className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition font-semibold"
          >
            Refresh
          </button>
        </div>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
          {err}
        </div>
      ) : null}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* IAQ */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="font-semibold mb-3">🫁 IAQ</div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" minTickGap={25} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="iaq" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Temp + Hum */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="font-semibold mb-3">🌡 Temp + 💧 Humidity</div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" minTickGap={25} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="temp" dot={false} />
                <Line type="monotone" dataKey="hum" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gas */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="font-semibold mb-3">🧪 Gas (kΩ)</div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" minTickGap={25} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="gasK" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pressure */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="font-semibold mb-3">📈 Pressure (hPa)</div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" minTickGap={25} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="pres" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
