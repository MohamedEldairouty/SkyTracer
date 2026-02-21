const styles = {
    "GOOD": "bg-green-500/15 text-green-300 border-green-500/30",
    "MODERATE": "bg-yellow-500/15 text-yellow-200 border-yellow-500/30",
    "UNHEALTHY-SENS.": "bg-orange-500/15 text-orange-200 border-orange-500/30",
    "UNHEALTHY": "bg-red-500/15 text-red-200 border-red-500/30",
    "VERY UNHEALTHY": "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/30",
    "DANGEROUS": "bg-rose-600/20 text-rose-200 border-rose-500/40",
  };
  
  export default function IAQBadge({ level = "N/A" }) {
    const cls = styles[level] || "bg-white/10 text-white/70 border-white/20";
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold ${cls}`}>
        {level}
      </span>
    );
  }
  