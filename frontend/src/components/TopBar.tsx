import { Link } from "react-router-dom";
import { useTheme } from "../theme/ThemeProvider.js";

export function TopBar() {
  const { mode, toggle } = useTheme();
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Skill Smith home">
        <span className="brand-mark" aria-hidden="true">⚒</span>
        <span className="brand-name">Skill Smith</span>
      </Link>
      <nav className="topbar-nav">
        <Link to="/history" className="nav-link">History</Link>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggle}
          aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} theme`}
        >
          {mode === "dark" ? "☾ Dark" : "☀ Light"}
        </button>
      </nav>
    </header>
  );
}
