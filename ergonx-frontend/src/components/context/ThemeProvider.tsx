"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * The single canonical ErgonX theme architecture.
 *
 * The preference ("light" | "dark" | "system") is persisted per browser under
 * `ergonx-theme`; the resolved theme toggles the `.dark` class on <html>,
 * which swaps every semantic token in globals.css. `THEME_INIT_SCRIPT` runs
 * before first paint so a saved dark preference never flashes light.
 */

export type ThemePreference = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const STORAGE_KEY = "ergonx-theme";
const CHANGE_EVENT = "ergonx-theme-change";
const LEGACY_PLATFORM_KEY = "ergonx-platform-color-mode";

export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${STORAGE_KEY}");if(!p){var l=localStorage.getItem("${LEGACY_PLATFORM_KEY}");if(l==="dark"||l==="light")p=l;}var d=p==="dark"||((!p||p==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})()`;

type ThemeContextValue = {
  theme: Theme;
  preference: ThemePreference;
  setTheme: (preference: ThemePreference) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    // One-time adoption of the retired Platform-only colour mode.
    const legacy = window.localStorage.getItem(LEGACY_PLATFORM_KEY);
    if (legacy === "dark" || legacy === "light") return legacy;
  } catch {
    /* storage unavailable: fall through to system */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    media.removeEventListener("change", onChange);
  };
}

function snapshot(): string {
  const preference = readPreference();
  const dark = preference === "dark" || (preference === "system" && systemPrefersDark());
  return `${preference}:${dark ? "dark" : "light"}`;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(subscribe, snapshot, () => "system:light");
  const [preference, theme] = state.split(":") as [ThemePreference, Theme];

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      window.localStorage.removeItem(LEGACY_PLATFORM_KEY);
    } catch {
      /* preference simply will not persist */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, preference, setTheme, toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark") }),
    [theme, preference, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider.");
  return value;
}
