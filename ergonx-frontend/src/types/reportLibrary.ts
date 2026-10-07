export type LibraryKind = "DASHBOARD" | "REPORT";
export type LibraryStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type LibraryVisibility = "PRIVATE" | "SHARED" | "INSTITUTION";
export type LibraryCategory = "FINANCE" | "HR" | "OPERATIONS" | "RECRUITMENT" | "CUSTOM";
export type LibrarySchedule = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export interface LibraryPerson {
  id: string;
  name: string;
  initials: string;
}

/** One `/report-library/` entry: a saved or built-in item, or a saved financial report (read-only here). */
export interface LibraryEntry {
  id: string;
  origin: "library" | "financial_report";
  code: string;
  name: string;
  description: string;
  kind: LibraryKind;
  source: string;
  source_label: string;
  module: string;
  module_label: string;
  category: LibraryCategory;
  category_label: string;
  filters: Record<string, string>;
  owner: LibraryPerson | null;
  is_system: boolean;
  status: LibraryStatus;
  visibility: LibraryVisibility;
  schedule: LibrarySchedule;
  next_run_on: string | null;
  last_refreshed_at: string | null;
  last_refreshed_by: LibraryPerson | null;
  last_row_count: number | null;
  freshness: { state: "UP_TO_DATE" | "STALE" | "NEVER"; days: number | null; label: string };
  href: string;
  shared_with: Array<LibraryPerson & { can_edit: boolean }>;
  shared_with_me: boolean;
  can_edit: boolean;
  can_share: boolean;
  can_publish: boolean;
  created_at: string;
  updated_at: string;
}

export interface LibraryCounts {
  all: number;
  dashboards: { mine: number; shared: number; institution: number };
  reports: { mine: number; shared: number; institution: number; scheduled: number };
  categories: Partial<Record<LibraryCategory, number>>;
}

export interface LibraryListing {
  results: LibraryEntry[];
  counts: LibraryCounts;
  can_publish: boolean;
}

export interface LibraryOptions {
  sources: Array<{ kind: LibraryKind; source: string; label: string; module: string; module_label: string; category: LibraryCategory; description: string }>;
  members: Array<LibraryPerson & { email: string; role: string }>;
  can_publish: boolean;
}

export interface LibraryActivity {
  id: string;
  action: string;
  actor: LibraryPerson | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface LibraryItemInput {
  name?: string;
  description?: string;
  kind?: LibraryKind;
  source?: string;
  category?: LibraryCategory;
  filters?: Record<string, string>;
  status?: LibraryStatus;
  visibility?: LibraryVisibility;
  schedule?: LibrarySchedule;
}
