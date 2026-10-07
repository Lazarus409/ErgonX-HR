/**
 * Personal display preferences (Stitch S050). They change only how values are
 * shown to this member: stored per browser for first paint and saved to the
 * member's UserPreference ("display") so they follow them across devices.
 */

export type DateStyle = "medium" | "numeric" | "iso";
export type NumberStyle = "comma" | "space";

export interface DisplayPreferences {
  dateStyle: DateStyle;
  hour12: boolean;
  numberStyle: NumberStyle;
  reduceMotion: boolean;
}

export const DEFAULT_DISPLAY: DisplayPreferences = { dateStyle: "medium", hour12: false, numberStyle: "comma", reduceMotion: false };
export const DISPLAY_PREFERENCE_KEY = "display";
const STORAGE_KEY = "ergonx-display";

let cached: DisplayPreferences | null = null;

export function normalizeDisplay(value: unknown): DisplayPreferences {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<DisplayPreferences>;
  return {
    dateStyle: raw.dateStyle === "numeric" || raw.dateStyle === "iso" ? raw.dateStyle : "medium",
    hour12: raw.hour12 === true,
    numberStyle: raw.numberStyle === "space" ? "space" : "comma",
    reduceMotion: raw.reduceMotion === true,
  };
}

export function getDisplayPreferences(): DisplayPreferences {
  if (cached) return cached;
  if (typeof window === "undefined") return DEFAULT_DISPLAY;
  try {
    cached = normalizeDisplay(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    cached = DEFAULT_DISPLAY;
  }
  return cached;
}

/** Apply settings that live on the document (reduced motion). */
export function applyDisplayPreferences(preferences: DisplayPreferences = getDisplayPreferences()): void {
  if (typeof document === "undefined") return;
  if (preferences.reduceMotion) document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
}

export function rememberDisplayPreferences(preferences: DisplayPreferences): void {
  cached = preferences;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* storage unavailable: preferences still apply for this page view */
  }
  applyDisplayPreferences(preferences);
}

/** Locale whose grouping matches the chosen number style; English text either way. */
export function numberLocale(): string {
  return getDisplayPreferences().numberStyle === "space" ? "fr-FR" : "en-GB";
}
