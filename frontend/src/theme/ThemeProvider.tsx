import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { applyTokens, resolveInitialMode, type Mode } from "./applyTokens.js";

interface ThemeCtx {
  mode: Mode;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ mode: "dark", toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => resolveInitialMode());

  useEffect(() => {
    applyTokens(mode);
    try {
      localStorage.setItem("skill-smith-theme", mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const value = useMemo<ThemeCtx>(
    () => ({ mode, toggle: () => setMode((m) => (m === "dark" ? "light" : "dark")) }),
    [mode],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
