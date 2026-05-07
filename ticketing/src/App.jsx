import { Routes, Route, Navigate } from "react-router-dom";
import Display from "./pages/display.jsx";
import Admin from "./pages/admin.jsx";

export default function App() {
  return (
    <Routes>
      {/* Public display pages */}
      <Route path="/mumbo" element={<Display dashboard="mumbo" />} />
      <Route path="/prata" element={<Display dashboard="prata" />} />

      {/* Single admin panel — manages both dashboards */}
      <Route path="/admin" element={<Admin />} />

      {/* Catch-all → redirect to mumbo (or pick a default) */}
      <Route path="*" element={<Navigate to="/mumbo" replace />} />
    </Routes>
  );
}
