import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { getImages, deleteImage, clearAllImages } from "../services/cameraService";

const API_BASE = import.meta.env.VITE_API_BASE || "http://172.20.10.9:4000";

// change if your cam ip changes
const CAM_IP = "172.20.10.3";
const CAM_BASE = `http://${CAM_IP}`;
const STREAM_URL = `${CAM_BASE}:81/stream`;

function isNew(iso, minutes = 30) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) < minutes * 60 * 1000;
}

export default function Camera() {
  const [images, setImages] = useState([]);
  const [streamOk, setStreamOk] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const socket = useMemo(() => io(API_BASE, { transports: ["polling"], upgrade: false }), []);

  async function refresh() {
    const list = await getImages();
    setImages(list);
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e.message));

    socket.on("camera:new", (img) => {
      setImages((prev) => [img, ...prev]);
    });

    socket.on("camera:deleted", ({ filename }) => {
      setImages((prev) => prev.filter((x) => x.filename !== filename));
    });

    socket.on("camera:cleared", () => setImages([]));

    return () => {
      socket.disconnect();
    };
  }, []);

  // stream reachability check
  useEffect(() => {
    const img = new Image();
    img.onload = () => setStreamOk(true);
    img.onerror = () => setStreamOk(false);
    img.src = STREAM_URL + "?t=" + Date.now();
  }, [images.length]);

  const newOnes = images.filter((x) => isNew(x.createdAt));
  const oldOnes = images.filter((x) => !isNew(x.createdAt));

  async function onDelete(filename) {
    try {
      setBusy(true);
      setErr("");
      await deleteImage(filename);
      // socket will also remove, but we can be instant:
      setImages((prev) => prev.filter((x) => x.filename !== filename));
    } catch (e) {
      setErr(e.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function onClearAll() {
    try {
      setBusy(true);
      setErr("");
      await clearAllImages();
      setImages([]);
    } catch (e) {
      setErr(e.message || "Clear failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen text-black dark:text-white">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-3xl font-extrabold tracking-tight">Camera</div>
            <div className="text-sm text-black/60 dark:text-white/60">
              Live stream + SD uploads
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={CAM_BASE}
              target="_blank"
              className="px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 border border-black/10 dark:border-white/10 text-sm font-semibold"
            >
              Open ESP32-CAM →
            </a>

            <button
              onClick={() => refresh().catch((e) => setErr(e.message))}
              className="px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 border border-black/10 dark:border-white/10 text-sm font-semibold"
            >
              Refresh
            </button>

            <button
              disabled={busy}
              onClick={onClearAll}
              className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/15 border border-red-400/20 text-sm font-semibold text-red-700 dark:text-red-200"
            >
              Clear All
            </button>
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-red-800 dark:text-red-100">
            <div className="font-semibold">❌ {err}</div>
          </div>
        ) : null}

        <div className="mt-6 grid md:grid-cols-2 gap-6">
          {/* STREAM */}
          <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] p-5 backdrop-blur">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-extrabold">Live Stream</h2>
              <span className={`text-xs px-3 py-1.5 rounded-full border font-semibold ${
                streamOk ? "bg-green-500/15 text-green-700 dark:text-green-200 border-green-400/25"
                         : "bg-amber-500/10 text-amber-900 dark:text-amber-100 border-amber-400/20"
              }`}>
                {streamOk ? "Online" : "Offline"}
              </span>
            </div>

            {streamOk ? (
              <img src={STREAM_URL} className="w-full rounded-2xl border border-black/10 dark:border-white/10" alt="stream" />
            ) : (
              <div className="h-64 flex items-center justify-center rounded-2xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-black/30 text-black/60 dark:text-white/60">
                Stream not reachable — gallery still works.
              </div>
            )}

            <div className="mt-3 text-xs text-black/60 dark:text-white/60">
              Stream URL: <span className="font-semibold">{STREAM_URL}</span>
            </div>
          </div>

          {/* GALLERY */}
          <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] p-5 backdrop-blur">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-extrabold">Gallery</h2>
              <div className="text-xs text-black/60 dark:text-white/60">
                Total: <span className="font-semibold">{images.length}</span>
              </div>
            </div>

            {images.length === 0 ? (
              <p className="text-black/60 dark:text-white/60">No images yet…</p>
            ) : (
              <>
                {newOnes.length > 0 && (
                  <Section title={`New flight images (${newOnes.length})`} items={newOnes} onDelete={onDelete} busy={busy} />
                )}
                <Section title={`Previous images (${oldOnes.length})`} items={oldOnes} onDelete={onDelete} busy={busy} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, items, onDelete, busy }) {
  const API_BASE = import.meta.env.VITE_API_BASE || "http://172.20.10.9:4000";

  return (
    <div className="mt-4">
      <div className="text-sm font-extrabold mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-3 max-h-[420px] overflow-auto pr-1">
        {items.map((img) => (
          <div key={img.filename} className="relative group">
            <a href={`${API_BASE}${img.url}`} target="_blank" className="block">
              <img
                src={`${API_BASE}${img.url}`}
                className="w-full rounded-2xl border border-black/10 dark:border-white/10 hover:scale-[1.01] transition"
                alt={img.filename}
              />
            </a>

            <button
              disabled={busy}
              onClick={() => onDelete(img.filename)}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition
                rounded-full px-2 py-1 text-xs font-bold
                bg-red-500/90 text-white"
              title="Delete"
            >
              🗑
            </button>

            <div className="text-[11px] text-black/60 dark:text-white/50 mt-1 truncate">
              {img.filename}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
