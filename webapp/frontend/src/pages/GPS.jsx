import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { getLatestTelemetry } from "../services/telemetryService";
import { io } from "socket.io-client";

// Fix Leaflet marker icon in Vite
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const API_BASE = import.meta.env.VITE_API_BASE || "http://172.20.10.9:4000";

// ✅ Default indoor/demo location when GPS isn't live
const DEMO_POINT = { lat: 31.3099971, lon: 30.0707934, label: "Indoor Demo Location (Pinned)" };

function isFiniteNum(x) {
  const n = Number(x);
  return Number.isFinite(n);
}

// ✅ Real GPS validity check (rejects 0,0 and out-of-range values)
function isValidGps(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);

  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;

  // valid ranges
  if (la < -90 || la > 90) return false;
  if (lo < -180 || lo > 180) return false;

  // reject 0,0 (your "NaN becomes 0" case)
  if (Math.abs(la) < 1e-7 && Math.abs(lo) < 1e-7) return false;

  return true;
}

// Optional: auto recenter map when point changes
function Recenter({ lat, lon }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.setView([lat, lon], map.getZoom(), { animate: true });
  }, [lat, lon]);
  return null;
}

export default function Gps() {
  const [data, setData] = useState(null);

  // hotspot/mobile friendly: polling transport
  const socket = useMemo(() => io(API_BASE, { transports: ["polling"], upgrade: false }), []);

  async function refresh() {
    const t = await getLatestTelemetry();
    setData(t && t._id ? t : null);
  }

  useEffect(() => {
    refresh().catch(console.error);
    const id = setInterval(() => refresh().catch(() => {}), 6000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    socket.on("telemetry:new", (doc) => setData(doc));
    return () => {
      socket.off("telemetry:new");
      socket.disconnect();
    };
  }, []);

  const gpsLive = isValidGps(data?.lat, data?.lon);

  const point = gpsLive
    ? { lat: Number(data.lat), lon: Number(data.lon), label: "Live GPS Fix ✅" }
    : DEMO_POINT;

  const altText = Number.isFinite(Number(data?.alt)) ? `${Number(data.alt).toFixed(1)} m` : "—";

  return (
    <div className="min-h-screen text-black dark:text-white">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-3xl font-extrabold tracking-tight">GPS</div>
            <div className="text-sm text-black/60 dark:text-white/60">
              {gpsLive ? "Live fix ✅" : "GPS not live — showing pinned location 📍"}
            </div>
          </div>

          <div
            className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
              gpsLive
                ? "bg-green-500/15 text-green-700 dark:text-green-200 border-green-400/25"
                : "bg-amber-500/10 text-amber-900 dark:text-amber-100 border-amber-400/20"
            }`}
          >
            {gpsLive ? "GPS LIVE" : "GPS NOT LIVE"}
          </div>
        </div>

        <div className="mt-5 rounded-3xl overflow-hidden border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] backdrop-blur">
          <div className="p-4 flex items-center justify-between">
            <div className="text-sm font-semibold">
              📍 {point.lat.toFixed(6)}, {point.lon.toFixed(6)}
            </div>
            <div className="text-xs text-black/60 dark:text-white/60">Alt: {altText}</div>
          </div>

          <div className="h-[520px]">
            <MapContainer center={[point.lat, point.lon]} zoom={15} style={{ height: "100%", width: "100%" }}>
              <Recenter lat={point.lat} lon={point.lon} />

              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <Marker position={[point.lat, point.lon]}>
                <Popup>
                  <div className="font-semibold">{point.label}</div>
                  <div>Lat: {point.lat.toFixed(6)}</div>
                  <div>Lon: {point.lon.toFixed(6)}</div>
                  {!gpsLive ? <div className="mt-1 text-xs">GPS fix missing → using demo pin</div> : null}
                </Popup>
              </Marker>
            </MapContainer>
          </div>
        </div>
      </div>
    </div>
  );
}