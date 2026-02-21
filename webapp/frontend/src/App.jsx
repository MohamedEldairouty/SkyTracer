import { Routes, Route } from "react-router-dom";
import AppShell from "./components/AppShell";

import Dashboard from "./pages/Dashboard";
import Gps from "./pages/Gps";
import Camera from "./pages/Camera";
import Charts from "./pages/Charts";
import Ai from "./pages/Ai";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/gps" element={<Gps />} />
        <Route path="/camera" element={<Camera />} />
        <Route path="/charts" element={<Charts />} />
        <Route path="/ai" element={<Ai />} />
      </Route>
    </Routes>
  );
}