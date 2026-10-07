"use client";

import { useCallback, useMemo, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { AccountingPeriod } from "@/types/accounting";
import { buttonClasses } from "@/components/ui/Button";
import { useAccess } from "@/lib/access";

type Action = "close" | "lock" | "reopen";
const copy: Record<Action, { title: string; description: string; label: string; destructive?: boolean }> = { close: { title: "Close accounting period", description: "Close this period after its journals are resolved. Posting will be prevented.", label: "Close", destructive: true }, lock: { title: "Lock accounting period", description: "Lock this period after its journals are resolved.", label: "Lock", destructive: true }, reopen: { title: "Reopen accounting period", description: "Reopen this closed or locked period for permitted accounting work.", label: "Reopen" } };

export default function AccountingPeriodsPage() {
  const { can } = useAccess();
  const [pending, setPending] = useState<{ period: AccountingPeriod; action: Action } | null>(null); const [acting, setActing] = useState(false); const [actionError, setActionError] = useState("");
  const load = useCallback(() => accountingApi.listAccountingPeriods({ page_size: MAX_PAGE_SIZE, ordering: "-start_date" }), []); const { data, loading, error, reload } = useApiResource(load); const periods = useMemo(() => data?.results ?? [], [data]); const current = periods.find((period) => period.status === "OPEN") ?? null;
  const act = async () => { if (!pending) return; setActing(true); setActionError(""); try { const actions: Record<Action, (id: string) => Promise<AccountingPeriod>> = { close: accountingApi.closeAccountingPeriod, lock: accountingApi.lockAccountingPeriod, reopen: accountingApi.reopenAccountingPeriod }; await actions[pending.action](pending.period.id); setPending(null); reload(); } catch (caught) { setPending(null); setActionError(getApiErrorMessage(caught)); } finally { setActing(false); } };
  return <div className="space-y-6"><PageHeader title="Accounting Periods" description="Manage fiscal periods and control when accounting entries can be posted." />{error && <ErrorState message={error} onRetry={reload} />}{actionError && <p className="rounded border border-danger/25 bg-danger-soft p-3 text-sm text-danger-ink">{actionError}</p>}<section className="rounded-2xl border bg-surface p-5">{current && <div className="mb-5 rounded-xl bg-surface-muted p-4"><p className="text-sm font-semibold">Current Open Period</p><p className="mt-1 text-lg font-bold">{current.name}</p><p className="text-sm text-ink-muted">{formatDate(current.start_date)} – {formatDate(current.end_date)}</p></div>}<div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b text-left text-xs uppercase text-ink-muted"><th className="pb-3">Period</th><th className="pb-3">Start</th><th className="pb-3">End</th><th className="pb-3">Status</th><th className="pb-3">Actions</th></tr></thead><tbody>{periods.map((period) => { const candidates: Action[] = period.status === "OPEN" ? ["close", "lock"] : ["reopen"]; const actions = candidates.filter((action) => can(action === "reopen" ? "accounting_period.reopen" : "accounting_period.close")); return <tr key={period.id} className="border-b last:border-0"><td className="py-4 font-medium">{period.name}</td><td className="py-4">{formatDate(period.start_date)}</td><td className="py-4">{formatDate(period.end_date)}</td><td className="py-4"><StatusBadge status={period.status} /></td><td className="py-4"><div className="flex gap-2">{actions.map((action) => <button type="button" key={action} onClick={() => { setActionError(""); setPending({ period, action }); }} className={buttonClasses({ variant: "secondary", size: "sm" })}>{copy[action].label}</button>)}</div></td></tr>; })}</tbody></table>{loading && <p className="py-10 text-center text-sm text-ink-muted">Loading accounting periods...</p>}{!loading && !periods.length && <p className="py-10 text-center text-sm text-ink-muted">No accounting periods found.</p>}</div><p className="mt-5 text-xs text-ink-muted">Period transitions are validated by the backend; closed or locked periods prevent posting.</p></section>{pending && <ConfirmDialog open title={copy[pending.action].title} description={copy[pending.action].description} confirmLabel={copy[pending.action].label} destructive={copy[pending.action].destructive} loading={acting} onCancel={() => setPending(null)} onConfirm={() => void act()} />}</div>;
}
