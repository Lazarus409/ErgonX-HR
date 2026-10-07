import InsightsBoard from "@/components/insights/InsightsBoard";

/** Concept "Executive dashboard": the organization-wide board, gated by dashboard.executive.view in the layout. */
export default function DashboardPage() {
  return <InsightsBoard variant="executive" />;
}
