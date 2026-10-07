import { cx } from "@/lib/cx";

/** Shimmer placeholder block. Decorative: hidden from assistive technology. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("skeleton block", !className?.includes("rounded") && "rounded-lg", className)} />;
}

function Frame({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cx("animate-fade-in", className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div className="space-y-3 pb-2">
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="h-8 w-72 max-w-full" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

export function CardSkeleton({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cx("rounded-2xl border border-line bg-surface p-5 shadow-elevation-1", className)}>
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }, (_, index) => <Skeleton key={index} className={cx("h-3.5", index === lines - 1 ? "w-2/3" : "w-full")} />)}
      </div>
    </div>
  );
}

export function MetricSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="flex justify-between"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-9 w-9 rounded-lg" /></div>
      <Skeleton className="mt-4 h-8 w-28" />
      <Skeleton className="mt-2 h-3 w-36" />
    </div>
  );
}

export function ChartSkeleton({ height = 240, className }: { height?: number; className?: string }) {
  return (
    <div className={cx("flex items-end gap-2 px-1", className)} style={{ height }} aria-hidden="true">
      {[42, 64, 50, 78, 58, 88, 70, 60, 82, 54].map((value, index) => <span key={index} className="skeleton block flex-1 rounded-t-md" style={{ height: `${value}%` }} />)}
    </div>
  );
}

export function DashboardSkeleton({ label = "Loading dashboard" }: { label?: string }) {
  return (
    <Frame label={label} className="space-y-6">
      <Skeleton className="h-36 w-full rounded-3xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <MetricSkeleton key={index} />)}</div>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 xl:col-span-2"><Skeleton className="h-4 w-40" /><ChartSkeleton className="mt-6" /></div>
        <CardSkeleton lines={6} />
      </div>
    </Frame>
  );
}

export function TableSkeleton({ rows = 6, columns = 5, label = "Loading records" }: { rows?: number; columns?: number; label?: string }) {
  return (
    <Frame label={label} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-elevation-1">
      <div className="flex gap-3 border-b border-line-soft p-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-10 w-36" /></div>
      <div className="divide-y divide-line-soft">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="grid gap-4 px-5 py-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }, (_, column) => <Skeleton key={column} className={cx("h-4", column === 0 ? "w-4/5" : "w-3/5")} />)}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Concept "Loading state": a named list load with avatar rows. */
export function ListSkeleton({ rows = 4, label = "Loading records", hint = "Please wait while we fetch the latest data." }: { rows?: number; label?: string; hint?: string }) {
  return (
    <Frame label={label} className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="flex items-center gap-3" aria-hidden="true">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div><p className="font-bold text-headline">{label}…</p><p className="text-support text-ink-muted">{hint}</p></div>
      </div>
      <div className="mt-5 grid grid-cols-[2.5rem_2fr_1fr_1fr_1fr] gap-x-4 gap-y-3" aria-hidden="true">
        <Skeleton className="col-span-2 h-4" /><Skeleton className="h-4" /><Skeleton className="h-4" /><Skeleton className="h-4" />
        {Array.from({ length: rows }, (_, row) => [<Skeleton key={`a${row}`} className="h-9 w-9 rounded-full" />, <Skeleton key={`b${row}`} className="h-3.5 self-center" />, <Skeleton key={`c${row}`} className="h-3.5 w-4/5 self-center" />, <Skeleton key={`d${row}`} className="h-3.5 w-3/5 self-center" />, <Skeleton key={`e${row}`} className="h-3.5 w-3/5 self-center" />])}
      </div>
    </Frame>
  );
}

export function DetailSkeleton({ label = "Loading details" }: { label?: string }) {
  return (
    <Frame label={label} className="space-y-6">
      <PageHeaderSkeleton />
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-6 shadow-elevation-1"><Skeleton className="h-14 w-14 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-3.5 w-64 max-w-full" /></div></div>
      <div className="grid gap-5 lg:grid-cols-3"><CardSkeleton lines={5} className="lg:col-span-2" /><CardSkeleton lines={4} /></div>
    </Frame>
  );
}

export function FormSkeleton({ fields = 6, label = "Loading form" }: { fields?: number; label?: string }) {
  return (
    <Frame label={label} className="rounded-2xl border border-line bg-surface p-6 shadow-elevation-1">
      <Skeleton className="h-5 w-40" />
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        {Array.from({ length: fields }, (_, index) => <div key={index} className="space-y-2"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-10 w-full rounded-xl" /></div>)}
      </div>
    </Frame>
  );
}

export default Skeleton;
