import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";

import logoDark from "../assets/logo-dark.png";
import logoLight from "../assets/logo-light.png";

function cx(...c) { return c.filter(Boolean).join(" "); }

export default function Navbar() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const linkClass = ({ isActive }) =>
    cx(
      "px-3 py-2 rounded-xl text-sm font-semibold transition",
      isActive
        ? "bg-black/10 dark:bg-white/10"
        : "hover:bg-black/5 dark:hover:bg-white/5 text-black/70 dark:text-white/70"
    );

  return (
    <div className="sticky top-0 z-50 border-b border-black/10 dark:border-white/10 backdrop-blur bg-white/60 dark:bg-slate-950/50">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src={theme === "dark" ? logoDark : logoLight}
            alt="SkyTracer"
            className="h-9 w-9 rounded-xl"
          />
          <div className="leading-tight">
            <div className="font-extrabold tracking-tight text-black dark:text-white">
              SkyTracer
            </div>
            <div className="text-xs text-black/60 dark:text-white/50">
              Flight telemetry console
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <nav className="hidden sm:flex items-center gap-1">
            <NavLink to="/" className={linkClass}>Dashboard</NavLink>
            <NavLink to="/gps" className={linkClass}>GPS</NavLink>
            <NavLink to="/camera" className={linkClass}>Camera</NavLink>
            <NavLink to="/charts" className={linkClass}>Charts</NavLink>
          </nav>

          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="px-3 py-2 rounded-xl text-sm font-semibold border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-black dark:text-white"
            title="Toggle theme"
          >
            {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
          </button>
        </div>
      </div>
    </div>
  );
}
