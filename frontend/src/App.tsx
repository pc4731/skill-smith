import { Route, Routes } from "react-router-dom";
import { TopBar } from "./components/TopBar.js";
import { HistoryScreen } from "./screens/HistoryScreen.js";
import { IntakeScreen } from "./screens/IntakeScreen.js";
import { RunScreen } from "./screens/RunScreen.js";
import { SkillLibraryScreen } from "./screens/SkillLibraryScreen.js";

export function App() {
  return (
    <div className="app-shell">
      <TopBar />
      <Routes>
        <Route path="/" element={<IntakeScreen />} />
        <Route path="/job/:id" element={<RunScreen />} />
        <Route path="/skills" element={<SkillLibraryScreen />} />
        <Route path="/history" element={<HistoryScreen />} />
      </Routes>
    </div>
  );
}
