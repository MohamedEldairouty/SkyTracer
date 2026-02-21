export default function StatCard({ title, value, sub, icon, accent = "from-white/10 to-white/5" }) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-white/60">{title}</div>
            <div className="text-2xl font-bold mt-1">{value}</div>
            {sub ? <div className="text-xs text-white/45 mt-1">{sub}</div> : null}
          </div>
  
          <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${accent} border border-white/10 flex items-center justify-center`}>
            <span className="text-lg">{icon}</span>
          </div>
        </div>
      </div>
    );
  }
  