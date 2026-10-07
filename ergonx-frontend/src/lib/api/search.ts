import { apiDelete, apiGet, apiPost } from "./client";
import type {
  SearchEntries,
  UniversalSearchParams,
  UniversalSearchResponse,
} from "@/types/search";

/**
 * Searches only records visible to the active membership. Queries shorter
 * than two characters are intentionally not sent because the backend rejects
 * them with `search_query_invalid`.
 */
export async function universalSearch({
  query,
  types,
  module,
  limit = 12,
  full,
  since,
  department,
  location,
  sort,
}: UniversalSearchParams): Promise<UniversalSearchResponse> {
  return apiGet<UniversalSearchResponse>(
    "/search/",
    { params: { q: query, types: types?.join(","), module, limit, full: full ? "1" : undefined, since, department, location, sort } },
  );
}

export function getSearchEntries(): Promise<SearchEntries> { return apiGet<SearchEntries>("/search/entries/"); }
export function saveSearch(query: string, name: string, filters: Record<string, string>): Promise<SearchEntries> { return apiPost<SearchEntries, { query: string; name: string; filters: Record<string, string> }>("/search/entries/", { query, name, filters }); }
export async function deleteSearchEntry(params: { id?: string; kind?: "RECENT" }): Promise<SearchEntries> {
  await apiDelete(`/search/entries/?${params.id ? `id=${params.id}` : "kind=RECENT"}`);
  return getSearchEntries();
}
