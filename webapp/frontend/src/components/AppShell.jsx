import { NavLink, Outlet } from "react-router-dom";
import useTheme from "../hooks/useTheme";

function cx(...c) { return c.filter(Boolean).join(" "); }

const tabs = [
  { to: "/", label: "Dashboard", icon: "📊" },
  { to: "/gps", label: "GPS", icon: "🗺️" },
  { to: "/camera", label: "Camera", icon: "📷" },
  { to: "/charts", label: "Charts", icon: "📈" },
  { to: "/ai", label: "Ai", icon: "🤖" },
];

function TabLink({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cx(
          "flex flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold",
          isActive ? "bg-black/10 dark:bg-white/10" : "opacity-80 hover:opacity-100"
        )
      }
    >
      <div className="text-lg leading-none">{icon}</div>
      <div className="leading-none">{label}</div>
    </NavLink>
  );
}

function SideLink({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold",
          isActive ? "bg-black/10 dark:bg-white/10" : "opacity-80 hover:opacity-100"
        )
      }
    >
      <div className="text-lg">{icon}</div>
      <div>{label}</div>
    </NavLink>
  );
}

function ThemeButton({ theme, toggleTheme }) {
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggleTheme}
      className="rounded-xl border border-black/10 dark:border-white/10 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 px-3 py-2 text-sm font-semibold"
      title="Toggle theme"
    >
      {isDark ? "☀️ Light" : "🌙 Dark"}
    </button>
  );
}

export default function AppShell() {
  const { theme, toggleTheme } = useTheme();
  const logoSrc = theme === "dark" ? "/logo-dark.png" : "/logo-light.png";

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-black dark:text-white">
      {/* Desktop sidebar */}
<div className="hidden md:fixed md:inset-y-0 md:left-0 md:w-64 md:flex md:flex-col md:border-r md:border-black/10 md:dark:border-white/10 md:bg-white/70 md:dark:bg-white/[0.06] md:backdrop-blur">
  
  {/* ✅ nicer desktop header */}
  <div className="p-4">
    <div className="flex items-center gap-3">
      <img
        src={logoSrc}
        className="h-10 w-10 rounded-2xl object-contain"
        alt="SkyTracer"
      />
      <div className="min-w-0">
        <div className="text-xl font-extrabold truncate">SkyTracer</div>
        <div className="text-xs opacity-60 truncate">Where Sensors Meet the Sky 🌌</div>
      </div>
    </div>

    {/* theme button on its own line */}
    <div className="mt-3 flex justify-end">
      <ThemeButton theme={theme} toggleTheme={toggleTheme} />
    </div>
  </div>

  <div className="px-3 pb-4 space-y-1">
    {tabs.map((t) => <SideLink key={t.to} {...t} />)}
  </div>

</div>

      {/* Mobile top bar (logo + theme switch) */}
      <header className="md:hidden sticky top-0 z-40 border-b border-black/10 dark:border-white/10 bg-white/90 dark:bg-slate-950/85 backdrop-blur">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={logoSrc}
              className="h-9 w-9 rounded-xl object-contain"
              alt="SkyTracer"
            />
            <div className="leading-tight">
              <div className="font-extrabold">SkyTracer</div>
              <div className="text-xs opacity-60">Ground + Payload</div>
            </div>
          </div>

          <ThemeButton theme={theme} toggleTheme={toggleTheme} />
        </div>
      </header>

      {/* Main content area */}
      <main className="md:ml-64 pb-20 md:pb-6">
        <Outlet />
      </main>

      {/* Mobile bottom tabs */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-black/10 dark:border-white/10 bg-white/90 dark:bg-slate-950/85 backdrop-blur">
        <div className="grid grid-cols-4 gap-1 p-2">
          {tabs.map((t) => <TabLink key={t.to} {...t} />)}
        </div>
      </nav>
    </div>
  );
}