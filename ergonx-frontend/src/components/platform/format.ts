export function formatDateTime(value: string | null | undefined, fallback = "—") {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatDate(value: string | null | undefined, fallback = "—") {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

/** "3 days ago" style relative time for recency columns. */
export function formatRelative(value: string | null | undefined, fallback = "Never") {
  if (!value) return fallback;
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const onboardingLabel: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "Setting up",
  BLOCKED: "Blocked",
  READY: "Ready",
};
