import AppShell from "@/components/layout/AppShell";

/** A performance review is opened by its employee, reviewer or HR; the API decides who sees which part. */
export default function ReviewsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
