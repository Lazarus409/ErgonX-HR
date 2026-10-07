import AppShell from "@/components/layout/AppShell";

/** Record history pages live in the authenticated workspace; access is checked per record by the API. */
export default function RecordsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
