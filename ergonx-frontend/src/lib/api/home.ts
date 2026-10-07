import { apiGet } from "./client";
import type { HomePayload } from "@/types/home";
import type { InsightsPayload } from "@/types/dashboards";

/** Fetches the active user's server-authorised workspace home content. */
export async function getHome(): Promise<HomePayload> {
  return apiGet<HomePayload>("/home/");
}

/** Cross-module Insights for the last `months` months, limited to what the caller may see. */
export async function getInsights(months: number): Promise<InsightsPayload> {
  return apiGet<InsightsPayload>(`/home/insights/?months=${months}`);
}
