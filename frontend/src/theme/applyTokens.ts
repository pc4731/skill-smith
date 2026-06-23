import tokens from "./tokens.json";

type Mode = "dark" | "light";

/**
 * Emit the design tokens as CSS custom properties on :root for the active mode.
 * Called once at startup and whenever the theme toggles. Colors come from
 * tokens.color[mode]; the rest are mode-independent scales.
 */
export function applyTokens(mode: Mode): void {
  const root = document.documentElement;
  const colors = (tokens.color as Record<Mode, Record<string, string>>)[mode];
  for (const [k, v] of Object.entries(colors)) {
    root.style.setProperty(`--color-${kebab(k)}`, v);
  }
  for (const [k, v] of Object.entries(tokens.space)) {
    root.style.setProperty(`--space-${k}`, v as string);
  }
  for (const [k, v] of Object.entries(tokens.radius)) {
    root.style.setProperty(`--radius-${k}`, v as string);
  }
  for (const [k, v] of Object.entries(tokens.typography.scale)) {
    root.style.setProperty(`--text-${k}`, v as string);
  }
  root.style.setProperty("--font-sans", tokens.typography.fontSans);
  root.style.setProperty("--font-mono", tokens.typography.fontMono);
  root.style.setProperty("--shadow-md", tokens.shadow.md);
  root.style.setProperty("--shadow-focus", tokens.shadow.focusRing);
  root.setAttribute("data-theme", mode);
}

export function resolveInitialMode(): Mode {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem("skill-smith-theme") : null;
  if (stored === "dark" || stored === "light") return stored;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark"; // dark is the default per the chosen direction
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export type { Mode };
