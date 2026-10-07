/** Server-authorized result returned by `GET /api/v1/search/`. */
export interface SearchResult {
  type: string;
  module: string;
  id: string;
  reference: string;
  title: string;
  subtitle: string;
  status: string;
  updated_at: string;
  route_hint: string;
  group?: string;
  kind?: string;
  meta?: string[];
  snippet?: string;
  score?: number;
}

export interface UniversalSearchResponse {
  query: string;
  results: SearchResult[];
  count: number;
  groups?: Record<string, number>;
}

export interface SearchEntries {
  recent: Array<{ id: string; query: string; updated_at: string }>;
  saved: Array<{ id: string; query: string; name: string; filters: Record<string, string> }>;
}

export interface UniversalSearchParams {
  query: string;
  types?: string[];
  module?: string;
  limit?: number;
  full?: boolean;
  since?: string;
  department?: string;
  location?: string;
  sort?: string;
}
