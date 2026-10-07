import AppShell from "@/components/layout/AppShell";

/** Design reference pages (no institution data) inside the authenticated shell. */
export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
