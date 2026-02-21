export default function ToggleCard({ title, desc, enabled, onToggle, loading }) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold">{title}</div>
            <div className="text-sm text-white/55">{desc}</div>
          </div>
  
          <button
            onClick={onToggle}
            disabled={loading}
            className={`min-w-[110px] px-4 py-2 rounded-xl border transition font-semibold text-sm
              ${enabled ? "bg-cyan-500/20 border-cyan-400/30 text-cyan-200 hover:bg-cyan-500/25"
                        : "bg-white/10 border-white/15 text-white/70 hover:bg-white/15"}
              ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            {loading ? "..." : enabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>
    );
  }
  