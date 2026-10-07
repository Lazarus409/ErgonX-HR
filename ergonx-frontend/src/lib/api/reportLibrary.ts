import { apiGet, apiPatch, apiPost } from "./client";
import type { LibraryActivity, LibraryEntry, LibraryItemInput, LibraryListing, LibraryOptions } from "@/types/reportLibrary";

/** Reports & Analytics library: every dashboard and report the caller may open. */
export function listLibrary(): Promise<LibraryListing> {
  return apiGet<LibraryListing>("/report-library/");
}

export function getLibraryOptions(): Promise<LibraryOptions> {
  return apiGet<LibraryOptions>("/report-library/options/");
}

export function createLibraryItem(payload: LibraryItemInput): Promise<LibraryEntry> {
  return apiPost<LibraryEntry, LibraryItemInput>("/report-library/", payload);
}

export function updateLibraryItem(id: string, payload: LibraryItemInput): Promise<LibraryEntry> {
  return apiPatch<LibraryEntry, LibraryItemInput>(`/report-library/${id}/`, payload);
}

/** Re-runs a report, or records that a live dashboard was opened. */
export function refreshLibraryItem(id: string): Promise<LibraryEntry> {
  return apiPost<LibraryEntry>(`/report-library/${id}/refresh/`, {});
}

export function duplicateLibraryItem(id: string): Promise<LibraryEntry> {
  return apiPost<LibraryEntry>(`/report-library/${id}/duplicate/`, {});
}

export function shareLibraryItem(id: string, payload: { user_id: string; can_edit?: boolean; remove?: boolean }): Promise<LibraryEntry> {
  return apiPost<LibraryEntry, typeof payload>(`/report-library/${id}/share/`, payload);
}

export function getLibraryActivity(id: string): Promise<LibraryActivity[]> {
  return apiGet<LibraryActivity[]>(`/report-library/${id}/activity/`);
}
