"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Download, FileSearch, FileText, Maximize2, Minus, PauseCircle, PlayCircle, Plus, Printer, RotateCcw, Send, Undo2, UsersRound, XCircle } from "lucide-react";

import { AttachmentsPanel, AuditPanel, Empty, Panel } from "@/components/accounting/RecordPanels";
import { Button } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog, Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

type Tab = "document" | "details" | "route" | "related";
type Pending = "submit" | "approve" | "post" | "void" | "revise" | "release" | null;
const PAYMENT_METHODS: Array<[string, string]> = [["BANK_TRANSFER", "Bank transfer"], ["CHEQUE", "Cheque"], ["MOBILE_MONEY", "Mobile money"], ["CASH", "Cash"], ["CARD", "Card"], ["OTHER", "Other"]];
const AUDIT_LABELS: Record<string, string> = {
  "accounting.vendor_bill.created": "Bill created",
  "accounting.vendor_bill.submitted": "Submitted for approval",
  "accounting.vendor_bill.approved": "Approved",
  "accounting.vendor_bill.rejected": "Rejected",
  "accounting.vendor_bill.revised": "Returned to draft",
  "accounting.vendor_bill.held": "Placed on hold",
  "accounting.vendor_bill.released": "Hold released",
  "accounting.vendor_bill.posted": "Posted to the ledger",
  "accounting.vendor_bill.voided": "Voided",
  "accounting.vendor_bill.payment_scheduled": "Payment scheduled",
  "accounting.vendor_bill.settlement_updated": "Payment recorded",
  "accounting.vendorbill.attachment_added": "Attachment added",
};
const COPY: Record<Exclude<Pending, null>, { title: string; description: string; label: string; destructive?: boolean }> = {
  submit: { title: "Submit bill for approval?", description: "The bill is validated and sent to approvers.", label: "Submit" },
  approve: { title: "Approve this bill?", description: "Approved bills can be posted to the ledger.", label: "Approve" },
  post: { title: "Post this bill?", description: "Creates and posts the AP journal. Posted bills are immutable.", label: "Post to ledger" },
  void: { title: "Void this bill?", description: "Voided bills cannot be restored.", label: "Void", destructive: true },
  revise: { title: "Return to draft?", description: "The rejected bill becomes editable so it can be corrected and resubmitted.", label: "Return to draft" },
  release: { title: "Release the hold?", description: "The bill can be approved, posted and paid again.", label: "Release hold" },
};

/** Concept "Vendor bill detail". */
export default function VendorBillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAccess();
  const load = useCallback(async () => {
    const [bill, context, accounts] = await Promise.all([
      accountingApi.getVendorBill(id),
      accountingApi.getVendorBillContext(id),
      accountingApi.listAccounts({ page_size: 100, account_type: "EXPENSE", ordering: "code" }).then((page) => page.results).catch(() => []),
    ]);
    return { bill, context, accounts };
  }, [id]);
  const { data, loading, error, reload } = useApiResource(load);
  const [tab, setTab] = useState<Tab>("document");
  const [pending, setPending] = useState<Pending>(null);
  const [dialog, setDialog] = useState<"reject" | "hold" | "schedule" | null>(null);
  const [reason, setReason] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState("BANK_TRANSFER");
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Bill not found."} onRetry={reload} />;
  const { bill, context, accounts } = data;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try { await work(); setPending(null); setDialog(null); setReason(""); reload(); } catch (caught) { setProblem(getApiErrorMessage(caught)); setPending(null); setDialog(null); } finally { setBusy(false); }
  };
  const confirm = () => {
    if (!pending) return;
    const calls = { submit: accountingApi.submitVendorBill, approve: accountingApi.approveVendorBill, post: accountingApi.postVendorBill, void: accountingApi.voidVendorBill, revise: accountingApi.reviseVendorBill, release: accountingApi.releaseVendorBill };
    void run(() => calls[pending](bill.id));
  };
  const primary: Pending = bill.status === "DRAFT" && can("vendor_bill.create") ? "submit" : bill.status === "PENDING" && !bill.on_hold && can("vendor_bill.approve") ? "approve" : bill.status === "APPROVED" && !bill.on_hold && can("vendor_bill.post") ? "post" : bill.status === "REJECTED" && can("vendor_bill.create") ? "revise" : null;
  const accountName = (accountId: string) => { const row = accounts.find((item) => item.id === accountId); return row ? `${row.code} ${row.name}` : EM_DASH; };
  const unpaid = ["POSTED", "PART_PAID"].includes(bill.status);
  const statusNote = bill.on_hold ? `On hold: ${bill.hold_reason}` : bill.status === "DRAFT" ? "Ready for submission" : bill.status === "PENDING" ? "Awaiting approval" : bill.status === "REJECTED" ? `Rejected: ${bill.rejection_reason}` : bill.status === "APPROVED" ? "Ready to post" : unpaid ? "Posted, awaiting payment" : bill.status === "PAID" ? "Fully paid" : "";
  const printDocument = () => window.print();
  const downloadCsv = () => {
    const rows = [["#", "Description", "Qty", "Unit price", "Amount"], ...bill.lines.map((line, index) => [String(index + 1), line.description, line.quantity, line.unit_price, line.line_total]), ["", "Subtotal", "", "", bill.subtotal], ["", "Tax", "", "", bill.tax_total], ["", "Total", "", "", bill.total_amount]];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `bill-${bill.bill_number}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted print:hidden"><Link href="/accounting/dashboard" className="hover:underline">Accounting</Link><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><Link href="/accounting/payables" className="hover:underline">Accounts Payable</Link><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><span className="font-medium text-ink-strong">Vendor Bill Detail</span></nav>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between print:hidden">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Vendor Bill Detail</h1>
          <p className="mt-1.5 text-[1.0625rem] text-heading-support">View vendor bill details, document, and approval status.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/accounting/payables" className="inline-flex h-12 items-center gap-2 rounded-lg border border-primary px-4 font-semibold text-primary-ink hover:bg-primary-soft/50"><ChevronLeft className="h-5 w-5" aria-hidden="true" />Back to Vendor Bills</Link>
          <Menu label="Actions" trigger={(props) => <Button {...props} variant="secondary" size="lg" trailingIcon={<ChevronDown className="h-4 w-4" />}>Actions</Button>}>
            {(close) => (
              <div className="p-1.5">
                {bill.status === "PENDING" && can("vendor_bill.approve") && <MenuItem icon={<XCircle className="h-4 w-4" />} onSelect={() => { close(); setDialog("reject"); }}>Reject bill</MenuItem>}
                {!bill.on_hold && !["PAID", "VOID"].includes(bill.status) && can("vendor_bill.approve") && <MenuItem icon={<PauseCircle className="h-4 w-4" />} onSelect={() => { close(); setDialog("hold"); }}>Place on hold</MenuItem>}
                {bill.on_hold && can("vendor_bill.approve") && <MenuItem icon={<PlayCircle className="h-4 w-4" />} onSelect={() => { close(); setPending("release"); }}>Release hold</MenuItem>}
                {unpaid && can("payment.create") && <MenuItem icon={<CalendarDays className="h-4 w-4" />} onSelect={() => { close(); setDialog("schedule"); }}>Schedule payment</MenuItem>}
                <MenuItem icon={<Printer className="h-4 w-4" />} onSelect={() => { close(); printDocument(); }}>Print bill</MenuItem>
                {["DRAFT", "PENDING", "APPROVED", "REJECTED"].includes(bill.status) && can("vendor_bill.void") && <MenuItem tone="danger" icon={<XCircle className="h-4 w-4" />} onSelect={() => { close(); setPending("void"); }}>Void bill</MenuItem>}
              </div>
            )}
          </Menu>
          {primary && <Button size="lg" leadingIcon={primary === "revise" ? <RotateCcw className="h-5 w-5" /> : <Send className="h-5 w-5" />} onClick={() => setPending(primary)}>{COPY[primary].label}</Button>}
        </div>
      </header>

      {problem && <ErrorState variant="inline" title="Action not completed" message={problem} />}

      <section className="grid gap-5 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_minmax(0,1fr)] lg:divide-x lg:divide-line-soft print:hidden">
        <div className="flex items-start gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><Building2 className="h-7 w-7" aria-hidden="true" /></span>
          <div className="min-w-0"><p className="text-[1.25rem] font-bold text-ink-strong">{context.vendor.name}</p><p className="text-sm text-ink-muted">{context.vendor.code}</p><p className="truncate text-sm text-heading-support" title={context.vendor.address}>{context.vendor.address || context.vendor.email || "No address recorded"}</p></div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4 lg:pl-5">
          {([["Bill Number", bill.bill_number], ["Invoice Date", formatDate(bill.bill_date)], ["Due Date", formatDate(bill.due_date)], ["Total Amount", formatAmount(bill.total_amount, bill.currency)]] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-caption text-ink-muted">{label}</dt><dd className="break-words font-bold text-ink-strong">{value}</dd></div>)}
        </dl>
        <div className="lg:pl-5"><p className="text-sm font-semibold text-ink-strong">Status</p><div className="mt-2 flex flex-wrap gap-1"><StatusBadge status={bill.status} />{bill.on_hold && <StatusBadge status="ON_HOLD" />}</div><p className="mt-2 text-caption text-ink-muted">{statusNote}</p></div>
      </section>

      <div className="print:hidden"><Tabs label="Bill sections" value={tab} onChange={(value) => setTab(value as Tab)} items={[{ value: "document", label: "Document" }, { value: "details", label: "Details" }, { value: "route", label: "Approval Route" }, { value: "related", label: "Related Records", count: context.related.length }]} /></div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {tab === "document" && (
            <section className="overflow-hidden rounded-2xl border border-line bg-surface-muted shadow-elevation-1">
              <div className="flex items-center gap-2 bg-[#2b2f36] px-3 py-2 text-white print:hidden">
                <FileText className="h-5 w-5" aria-hidden="true" /><span className="mx-2 rounded border border-white/30 px-2 text-sm">1</span><span className="text-sm">/ 1</span>
                <span className="mx-2 h-5 w-px bg-white/30" aria-hidden="true" />
                <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(60, value - 10))} className="rounded p-1 hover:bg-white/10"><Minus className="h-4 w-4" /></button>
                <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(160, value + 10))} className="rounded p-1 hover:bg-white/10"><Plus className="h-4 w-4" /></button>
                <span className="rounded border border-white/30 px-2 text-sm tabular-nums">{zoom}%</span>
                <button type="button" aria-label="Reset zoom" onClick={() => setZoom(100)} className="rounded p-1 hover:bg-white/10"><RotateCcw className="h-4 w-4" /></button>
                <span className="flex-1" />
                <button type="button" aria-label="Download lines as CSV" onClick={downloadCsv} className="rounded p-1 hover:bg-white/10"><Download className="h-4 w-4" /></button>
                <button type="button" aria-label="Print" onClick={printDocument} className="rounded p-1 hover:bg-white/10"><Maximize2 className="h-4 w-4" /></button>
              </div>
              <div className="overflow-auto p-4">
                <article className="mx-auto bg-surface p-8 text-sm text-ink shadow-elevation-1 print:shadow-none" style={{ width: `${zoom}%`, minWidth: zoom > 100 ? `${zoom}%` : undefined, fontSize: `${(zoom / 100) * 0.875}rem` }}>
                  <div className="flex justify-between gap-6">
                    <div><p className="font-bold text-ink-strong">{context.vendor.name}</p><p className="whitespace-pre-line text-ink-muted">{context.vendor.address || EM_DASH}</p>{context.vendor.phone && <p className="text-ink-muted">{context.vendor.phone}</p>}{context.vendor.tax_identification_number && <p className="text-ink-muted">TIN {context.vendor.tax_identification_number}</p>}</div>
                    <div className="text-right"><p className="text-[1.5em] font-bold tracking-wide text-ink-strong">INVOICE</p>
                      <dl className="mt-3 grid grid-cols-[auto_auto] gap-x-3 text-left"><dt className="font-semibold">Invoice #:</dt><dd>{bill.bill_number}</dd><dt className="font-semibold">Invoice Date:</dt><dd>{formatDate(bill.bill_date)}</dd><dt className="font-semibold">Due Date:</dt><dd>{formatDate(bill.due_date)}</dd><dt className="font-semibold">Currency:</dt><dd>{bill.currency}</dd></dl>
                    </div>
                  </div>
                  <div className="mt-6"><p className="font-semibold">Bill To:</p><p>{context.institution.name}</p><p className="text-ink-muted">Accounts Payable</p></div>
                  <table className="mt-6 w-full">
                    <thead className="bg-surface-muted text-left"><tr><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Description</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Unit Price</th><th className="px-2 py-1.5 text-right">Amount</th></tr></thead>
                    <tbody className="divide-y divide-line-soft">{bill.lines.map((line, index) => <tr key={line.id}><td className="px-2 py-1.5">{index + 1}</td><td className="px-2 py-1.5">{line.description}</td><td className="px-2 py-1.5 text-right tabular-nums">{Number(line.quantity)}</td><td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(line.unit_price)}</td><td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(line.line_total)}</td></tr>)}</tbody>
                  </table>
                  {!bill.lines.length && <p className="py-6 text-center text-ink-muted">No line items to display.</p>}
                  <dl className="ml-auto mt-4 w-64 space-y-1">
                    <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{formatAmount(bill.subtotal)}</dd></div>
                    <div className="flex justify-between"><dt>Tax</dt><dd className="tabular-nums">{formatAmount(bill.tax_total)}</dd></div>
                    {Number(bill.withholding_total) > 0 && <div className="flex justify-between text-ink-muted"><dt>Withholding</dt><dd className="tabular-nums">−{formatAmount(bill.withholding_total)}</dd></div>}
                    <div className="flex justify-between bg-surface-muted px-2 py-1.5 font-bold text-ink-strong"><dt>Total</dt><dd className="tabular-nums">{formatAmount(bill.total_amount, bill.currency)}</dd></div>
                  </dl>
                  <p className="mt-6 text-caption text-ink-muted">Rendered from the bill recorded in ErgonX. The vendor&apos;s original document, if uploaded, is under Attachments.</p>
                </article>
              </div>
            </section>
          )}

          {tab === "details" && (
            <Panel icon={FileText} title="Bill details" description="Amounts, accounts and tax treatment.">
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                {([["Subtotal", formatAmount(bill.subtotal, bill.currency)], ["Tax", formatAmount(bill.tax_total, bill.currency)], ["Withholding", formatAmount(bill.withholding_total, bill.currency)], ["Total", formatAmount(bill.total_amount, bill.currency)], ["Payable to vendor", formatAmount(bill.amount_payable, bill.currency)], ["Paid", formatAmount(bill.amount_paid ?? 0, bill.currency)]] as const).map(([label, value]) => <div key={label} className="rounded-xl bg-surface-muted p-3"><dt className="text-caption text-ink-muted">{label}</dt><dd className="font-bold tabular-nums">{value}</dd></div>)}
              </dl>
              <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[36rem] text-sm"><thead className="bg-surface-muted text-left text-caption font-semibold"><tr><th className="px-3 py-2">Description</th><th className="px-3 py-2">Expense account</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit price</th><th className="px-3 py-2 text-right">Line total</th></tr></thead>
                <tbody className="divide-y divide-line-soft">{bill.lines.map((line) => <tr key={line.id}><td className="px-3 py-2">{line.description}</td><td className="px-3 py-2 text-ink-muted">{accountName(line.expense_account)}</td><td className="px-3 py-2 text-right tabular-nums">{Number(line.quantity)}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(line.unit_price)}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(line.line_total)}</td></tr>)}</tbody></table></div>
            </Panel>
          )}

          {tab === "route" && (
            <Panel icon={UsersRound} title="Approval route" description="Submission, approval and posting for this bill.">
              <RouteSteps bill={bill} />
            </Panel>
          )}

          {tab === "related" && (
            <Panel icon={FileSearch} title="Related records" description="Journal, payments and certificates linked to this bill.">
              {context.related.length ? <ul className="divide-y divide-line-soft">{context.related.map((row, index) => <li key={`${row.type}-${index}`} className="flex items-center gap-3 py-2.5 text-sm"><span className="w-48 shrink-0 text-ink-muted">{row.type}</span><span className="flex-1 font-semibold">{row.href ? <Link href={row.href} className="text-primary-ink hover:underline">{row.reference}</Link> : row.reference}</span>{row.status && <StatusBadge status={row.status} size="sm" />}</li>)}</ul> : <Empty icon={FileSearch} title="No related records yet" text="The AP journal and payments appear here once the bill is posted and paid." />}
            </Panel>
          )}
        </div>

        <aside className="space-y-5 print:hidden">
          <Panel icon={CircleDollarSign} title="Payment Status" action={<StatusBadge status={bill.status === "PAID" ? "PAID" : bill.status === "PART_PAID" ? "PART_PAID" : bill.scheduled_payment_date ? "SCHEDULED" : "NOT_SCHEDULED"} size="sm" />}>
            {bill.status === "PAID" || bill.status === "PART_PAID" ? (
              <p className="text-sm text-ink">{formatAmount(bill.amount_paid ?? 0, bill.currency)} paid of {formatAmount(bill.amount_payable, bill.currency)} payable.</p>
            ) : bill.scheduled_payment_date ? (
              <p className="text-sm text-ink">Scheduled for {formatDate(bill.scheduled_payment_date)} by {humanizeEnum(bill.scheduled_payment_method)}.</p>
            ) : <p className="text-sm text-ink-muted">This bill has not been scheduled for payment.</p>}
            {context.payments.length > 0 && <ul className="mt-3 divide-y divide-line-soft text-sm">{context.payments.map((payment) => <li key={payment.id} className="flex justify-between py-1.5"><span>{payment.payment_number} · {formatDate(payment.payment_date)}</span><span className="tabular-nums">{formatAmount(payment.amount, payment.currency)}</span></li>)}</ul>}
            {unpaid && can("payment.create") && <Button className="mt-3" block variant="secondary" leadingIcon={<CalendarDays className="h-4 w-4" />} onClick={() => setDialog("schedule")}>{bill.scheduled_payment_date ? "Reschedule payment" : "Schedule payment"}</Button>}
            {!unpaid && !["PAID", "PART_PAID"].includes(bill.status) && <p className="mt-2 text-caption text-ink-muted">Payment can be scheduled once the bill is posted.</p>}
          </Panel>
          <Panel icon={UsersRound} title="Approval Workflow" action={<StatusBadge status={bill.status === "DRAFT" ? "NOT_STARTED" : bill.status === "PENDING" ? "IN_PROGRESS" : bill.status === "REJECTED" ? "REJECTED" : "COMPLETED"} size="sm" />}>
            <RouteSteps bill={bill} compact />
          </Panel>
          <AttachmentsPanel resource="vendor-bills" recordId={bill.id} attachments={context.attachments} canUpload={can("vendor_bill.create")} onChanged={reload} />
          <AuditPanel entries={context.audit} labels={AUDIT_LABELS} historyHref={`/records/vendor_bill/${bill.id}`} />
        </aside>
      </div>

      <ConfirmDialog open={pending !== null} title={pending ? COPY[pending].title : ""} description={pending ? COPY[pending].description : ""} confirmLabel={pending ? COPY[pending].label : ""} tone={pending === "void" ? "destructive" : pending === "approve" ? "approval" : "neutral"} record={pending === "void" || pending === "approve" ? { name: `${bill.bill_number} · ${context.vendor.name}`, detail: `${formatAmount(bill.total_amount, bill.currency)} due ${formatDate(bill.due_date)}` } : undefined} consequence={pending === "void" ? "The bill is kept for audit but can no longer be approved, posted or paid." : undefined} typeToConfirm={pending === "void" ? "VOID" : undefined} loading={busy} onConfirm={confirm} onCancel={() => setPending(null)} />
      <Dialog open={dialog === "reject" || dialog === "hold"} onClose={() => setDialog(null)} title={dialog === "reject" ? "Reject bill" : "Place bill on hold"} description={dialog === "reject" ? "The preparer can revise and resubmit a rejected bill." : "Held bills cannot be approved, posted or scheduled for payment until released."}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button variant={dialog === "reject" ? "danger" : "primary"} loading={busy} disabled={!reason.trim()} leadingIcon={dialog === "reject" ? <Undo2 className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />} onClick={() => void run(() => dialog === "reject" ? accountingApi.rejectVendorBill(bill.id, reason.trim()) : accountingApi.holdVendorBill(bill.id, reason.trim()))}>{dialog === "reject" ? "Reject bill" : "Place on hold"}</Button></>}>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Reason</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
      </Dialog>
      <Dialog open={dialog === "schedule"} onClose={() => setDialog(null)} title="Schedule payment" description={`Plan when ${formatAmount(bill.amount_payable, bill.currency)} will be paid to ${context.vendor.name}.`}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} onClick={() => void run(() => accountingApi.scheduleVendorBillPayment(bill.id, payDate, payMethod))}>Schedule</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="mb-1.5 block text-sm font-semibold">Payment date</span><input type="date" value={payDate} onChange={(event) => setPayDate(event.target.value)} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Method</span><select value={payMethod} onChange={(event) => setPayMethod(event.target.value)} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm">{PAYMENT_METHODS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        </div>
      </Dialog>
    </div>
  );
}

function RouteSteps({ bill, compact }: { bill: Awaited<ReturnType<typeof accountingApi.getVendorBill>>; compact?: boolean }) {
  const steps = [
    { title: "Submitted", done: Boolean(bill.submitted_at), detail: bill.submitted_by_name ? `${bill.submitted_by_name} · ${formatDateTime(bill.submitted_at)}` : "Not yet submitted" },
    bill.status === "REJECTED"
      ? { title: "Rejected", done: true, danger: true, detail: `${bill.rejected_by_name ?? EM_DASH} · ${bill.rejection_reason}` }
      : { title: "Approved", done: Boolean(bill.approved_at), detail: bill.approved_by_name ? `${bill.approved_by_name} · ${formatDateTime(bill.approved_at)}` : bill.status === "PENDING" ? "Awaiting approver" : "Not started" },
    { title: "Posted to ledger", done: ["POSTED", "PART_PAID", "PAID"].includes(bill.status), detail: bill.journal_entry ? "AP journal posted" : "Not posted" },
    { title: "Paid", done: bill.status === "PAID", detail: bill.status === "PAID" ? "Fully paid" : bill.status === "PART_PAID" ? "Partly paid" : "Not paid" },
  ];
  if (compact && bill.status === "DRAFT") return <div className="text-sm"><p className="font-semibold text-ink-strong">Approval not started</p><p className="text-ink-muted">Submit the bill to route it to an approver with vendor-bill approval rights.</p></div>;
  return (
    <ol className="space-y-3 text-sm">
      {steps.map((step) => (
        <li key={step.title} className="flex gap-3">
          <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", "danger" in step && step.danger ? "bg-danger text-white" : step.done ? "bg-success text-white" : "border-2 border-line-strong")}>{step.done && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}</span>
          <span><span className="block font-semibold text-ink-strong">{step.title}</span><span className="text-caption text-ink-muted">{step.detail}</span></span>
        </li>
      ))}
    </ol>
  );
}
