"use client";

import { useState } from "react";
import { FilePlus2, Plus } from "lucide-react";

import AccessDenied from "@/components/ui/AccessDenied";
import { Button } from "@/components/ui/Button";
import EmptyState, { NoResultsState } from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { ListSkeleton } from "@/components/ui/Skeleton";
import StateBanner, { type StateBannerKind } from "@/components/ui/StateBanner";

const BANNERS: Array<{ kind: StateBannerKind; primary?: string; secondary?: string; title?: string; message?: string }> = [
  { kind: "empty", primary: "Add record", secondary: "Learn more" },
  { kind: "permission", primary: "Request access", secondary: "Learn more" },
  { kind: "service", primary: "Try again", secondary: "View status" },
  { kind: "validation", primary: "Show errors", secondary: "Review form", message: "There are 2 errors that need your attention before you can continue." },
  { kind: "loading" },
  { kind: "no-results", primary: "Clear search", secondary: "Try a different term", message: "We couldn't find any results matching “research grants”." },
];

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="space-y-3"><div><h2 className="text-heading font-bold text-headline">{title}</h2><p className="text-support text-heading-support">{description}</p></div>{children}</section>;
}

function StateCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <h3 className="text-card-title font-bold text-headline">{title}</h3>
      <p className="text-support text-ink-muted">{description}</p>
      <div className="mt-2">{children}</div>
    </article>
  );
}

/**
 * Concept "Governed empty, error and loading states": the shared state components, shown with example content.
 * Every example is the component that product pages use, so this page stays in step with them.
 */
export default function StatesReferencePage() {
  const [dismissed, setDismissed] = useState<StateBannerKind[]>([]);
  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Empty, Error and Loading States</h1>
        <p className="mt-1.5 text-[1.0625rem] text-heading-support">Reusable patterns for common system states. Use these components to provide clear, consistent guidance.</p>
      </header>

      <Section title="Inline banners" description="Use horizontal banners for contextual messages within a page or section.">
        <div className="space-y-2">
          {BANNERS.filter((item) => !dismissed.includes(item.kind)).map((item) => (
            <StateBanner
              key={item.kind}
              kind={item.kind}
              title={item.title}
              message={item.message}
              actions={item.primary ? <><Button size="sm">{item.primary}</Button>{item.secondary && <Button size="sm" variant="secondary">{item.secondary}</Button>}</> : undefined}
              onDismiss={() => setDismissed((current) => [...current, item.kind])}
            />
          ))}
          {dismissed.length > 0 && <Button size="sm" variant="ghost" onClick={() => setDismissed([])}>Show dismissed banners</Button>}
        </div>
      </Section>

      <Section title="Full-page states" description="Use full-page states when the entire page or primary content area is affected.">
        <div className="grid gap-4 xl:grid-cols-3">
          <StateCard title="No-data empty state" description="Shown when a feature has no data for the current context.">
            <EmptyState size="compact" icon={FilePlus2} title="No records yet" description="Get started by adding the first record." action={<Button leadingIcon={<Plus className="h-4 w-4" />}>Add employee</Button>} details="Scope: current institution · Filters: none" />
          </StateCard>
          <StateCard title="Error state" description="Shown when a backend or service error prevents data from loading.">
            <ErrorState className="border-0 px-0 py-6 shadow-none" title="Something went wrong" message="We couldn't load the data right now. Please try again in a moment." onRetry={() => undefined} details="HTTP 503 · request id shown here when the API returns one" />
          </StateCard>
          <StateCard title="Permission-restricted state" description="Shown when the user doesn't have access to view this resource.">
            <AccessDenied preview className="flex justify-center py-6" permission="payroll.view" />
          </StateCard>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <StateCard title="Loading state" description="Shown while data is being fetched from the server.">
            <ListSkeleton label="Loading employees" />
          </StateCard>
          <StateCard title="Successful zero-result state" description="Shown when a search or filter returns no matches.">
            <NoResultsState size="compact" noun="employees" onClear={() => undefined} />
          </StateCard>
        </div>
      </Section>
    </div>
  );
}
