"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Bell, Building2, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, CreditCard, Download, FileSearch, FileText, Maximize2, Minus, PauseCircle, PlayCircle, Plus, Printer, RotateCcw, Send, X, XCircle } from "lucide-react";

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
import { EM_DASH, formatAmount, formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";

type Tab = "document" | "details" | "payments" | "reminders" | "related";
const METHODS: Array<[string, string]> = [["BANK_TRANSFER", "Bank transfer"], ["MOBILE_MONEY", "Mobile money"], ["CHEQUE", "Cheque"], ["CASH", "Cash"], ["CARD", "Card"], ["OTHER", "Other"]];
const CHANNELS: Array<[string, string]> = [["EMAIL", "Email"], ["PHONE", "Phone call"], ["LETTER", "Letter"], ["VISIT", "Visit"]];
const AUDIT_LABELS: Record<string, string> = {
  "accounting.invoice.created": "Invoice created",
  "accounting.invoice.issued": "Issued and posted",
  "accounting.invoice.sent": "Sent to customer",
  "accounting.invoice.voided": "Voided",
  "accounting.invoice.held": "Placed on hold",
  "accounting.invoice.released": "Hold released",
  "accounting.invoice.reminder_added": "Reminder scheduled",
  "accounting.invoice.reminder_done": "Reminder completed",
  "accounting.invoice.reminder_cancelled": "Reminder cancelled",
  "accounting.invoice.settlement_updated": "Payment recorded",
  "accounting.invoice.attachment_added": "Document added",
};

/** Concept "Customer invoice detail". */
export default function CustomerInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAccess();
  const load = useCallback(async () => {
    const [invoice, context, banks] = await Promise.all([
      accountingApi.getInvoice(id),
      accountingApi.getInvoiceContext(id),
      accountingApi.listBankAccounts({ page_size: MAX_PAGE_SIZE, is_active: true }).then((page) => page.results).catch(() => []),
    ]);
    return { invoice, context, banks };
  }, [id]);
  const { data, loading, error, reload } = useApiResource(load);
  const [tab, setTab] = useState<Tab>("document");
  const [dialog, setDialog] = useState<"send" | "hold" | "payment" | "reminder" | "void" | "release" | "issue" | null>(null);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [payment, setPayment] = useState({ date: new Date().toISOString().slice(0, 10), amount: "", method: "BANK_TRANSFER", bank: "" });
  const [reminder, setReminder] = useState({ date: new Date().toISOString().slice(0, 10), channel: "EMAIL", note: "" });
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Invoice not found."} onRetry={reload} />;
  const { invoice, context, banks } = data;
  const open = invoice.status === "ISSUED" || invoice.status === "PART_PAID";
  const overdue = open && context.collection.days_overdue > 0;
  const collection = invoice.status === "PAID" ? "PAID" : invoice.status === "VOID" ? "VOID" : overdue ? "OVERDUE" : open ? "DUE" : "NOT_SENT";
  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try { await work(); setDialog(null); setText(""); if (done) setNotice(done); reload(); } catch (caught) { setProblem(getApiErrorMessage(caught)); setDialog(null); } finally { setBusy(false); }
  };
  const send = () => run(async () => {
    const result = await accountingApi.sendInvoice(invoice.id, email.trim());
    if (result.delivery !== "SENT") throw new Error(result.delivery === "NOT_CONFIGURED" ? "The invoice was issued, but email delivery is not configured for this environment. Share it with the customer directly." : "The invoice was issued, but the email could not be delivered.");
  }, "Invoice sent to the customer.");
  const recordPayment = () => run(() => accountingApi.createReceipt({ receipt_number: "", receipt_date: payment.date, amount: payment.amount, currency: invoice.currency, payment_method: payment.method, bank_account: payment.bank || null, invoice: invoice.id }), "Payment recorded.");
  const downloadCsv = () => {
    const rows = [["#", "Description", "Qty", "Unit price", "Amount"], ...invoice.lines.map((line, index) => [String(index + 1), line.description, line.quantity, line.unit_price, line.line_total]), ["", "Total", "", "", invoice.total_amount]];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `invoice-${invoice.invoice_number}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const scheduled = context.reminders.filter((row) => row.status === "SCHEDULED");

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted print:hidden"><Link href="/accounting/dashboard" className="hover:underline">Accounting</Link><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><Link href="/accounting/receivables" className="hover:underline">Accounts Receivable</Link><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><span className="font-medium text-ink-strong">Invoice {invoice.invoice_number}</span></nav>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between print:hidden">
        <div><h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Customer Invoice Detail</h1><p className="mt-1.5 text-[1.0625rem] text-heading-support">View customer invoice, payment status, and related activities.</p></div>
        <div className="flex flex-wrap gap-2">
          <Link href="/accounting/receivables" className="inline-flex h-12 items-center gap-2 rounded-lg border border-primary px-4 font-semibold text-primary-ink hover:bg-primary-soft/50"><ChevronLeft className="h-5 w-5" aria-hidden="true" />Back to Customer Invoices</Link>
          <Menu label="Actions" trigger={(props) => <Button {...props} variant="secondary" size="lg" trailingIcon={<ChevronDown className="h-4 w-4" />}>Actions</Button>}>
            {(close) => (
              <div className="p-1.5">
                {invoice.status === "DRAFT" && can("invoice.issue") && <MenuItem icon={<Check className="h-4 w-4" />} description="Post without emailing" onSelect={() => { close(); setDialog("issue"); }}>Issue invoice</MenuItem>}
                {!invoice.on_hold && open && can("invoice.issue") && <MenuItem icon={<PauseCircle className="h-4 w-4" />} onSelect={() => { close(); setDialog("hold"); }}>Place on hold</MenuItem>}
                {invoice.on_hold && can("invoice.issue") && <MenuItem icon={<PlayCircle className="h-4 w-4" />} onSelect={() => { close(); setDialog("release"); }}>Release hold</MenuItem>}
                <MenuItem icon={<Printer className="h-4 w-4" />} onSelect={() => { close(); window.print(); }}>Print invoice</MenuItem>
                {invoice.status === "DRAFT" && can("invoice.void") && <MenuItem tone="danger" icon={<XCircle className="h-4 w-4" />} onSelect={() => { close(); setDialog("void"); }}>Void invoice</MenuItem>}
              </div>
            )}
          </Menu>
          {(invoice.status === "DRAFT" || open) && can("invoice.issue") && <Button size="lg" leadingIcon={<Send className="h-5 w-5" />} onClick={() => { setEmail(context.customer.email); setDialog("send"); }}>{invoice.sent_at ? "Resend invoice" : "Send invoice"}</Button>}
        </div>
      </header>

      {problem && <ErrorState variant="inline" title="Action not completed" message={problem} />}
      {notice && <p className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success-ink">{notice}</p>}

      <section className="grid gap-5 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_minmax(0,1fr)] lg:divide-x lg:divide-line-soft print:hidden">
        <div className="flex items-start gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><Building2 className="h-7 w-7" aria-hidden="true" /></span>
          <div className="min-w-0"><p className="text-[1.25rem] font-bold text-ink-strong">{context.customer.name}</p><p className="text-sm text-ink-muted">{context.customer.code}</p><p className="text-sm text-heading-support">{[context.customer.address, context.customer.phone].filter(Boolean).join(" | ") || context.customer.email || "No contact details"}</p></div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4 lg:pl-5">
          {([["Invoice Number", invoice.invoice_number], ["Invoice Date", formatDate(invoice.invoice_date)], ["Due Date", formatDate(invoice.due_date)], ["Total Amount", formatAmount(invoice.total_amount, invoice.currency)]] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-caption text-ink-muted">{label}</dt><dd className="break-words font-bold text-ink-strong">{value}</dd></div>)}
        </dl>
        <div className="lg:pl-5"><p className="text-sm font-semibold text-ink-strong">Status</p><div className="mt-2 flex flex-wrap gap-1"><StatusBadge status={invoice.status === "DRAFT" ? "NOT_SENT" : overdue ? "OVERDUE" : invoice.status} />{invoice.on_hold && <StatusBadge status="ON_HOLD" />}</div><p className="mt-2 text-caption text-ink-muted">{invoice.on_hold ? `On hold: ${invoice.hold_reason}` : invoice.sent_at ? `Sent to ${invoice.sent_to} · ${formatDate(invoice.sent_at)}` : invoice.status === "DRAFT" ? "Ready to send" : "Issued, not emailed"}</p></div>
      </section>

      <div className="print:hidden"><Tabs label="Invoice sections" value={tab} onChange={(value) => setTab(value as Tab)} items={[{ value: "document", label: "Document" }, { value: "details", label: "Details" }, { value: "payments", label: "Payment History", count: context.receipts.length }, { value: "reminders", label: "Reminders", count: context.reminders.length }, { value: "related", label: "Related Records", count: context.related.length }]} /></div>

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
                <button type="button" aria-label="Print" onClick={() => window.print()} className="rounded p-1 hover:bg-white/10"><Maximize2 className="h-4 w-4" /></button>
              </div>
              <div className="overflow-auto p-4">
                <article className="mx-auto bg-surface p-8 text-ink shadow-elevation-1 print:shadow-none" style={{ width: `${zoom}%`, minWidth: zoom > 100 ? `${zoom}%` : undefined, fontSize: `${(zoom / 100) * 0.875}rem` }}>
                  <div className="flex justify-between gap-6">
                    <div><p className="font-bold text-ink-strong">{context.institution.name}</p><p className="mt-4 font-semibold">Bill To</p><p>{context.customer.name}</p><p className="whitespace-pre-line text-ink-muted">{context.customer.address}</p>{context.customer.tax_identification_number && <p className="text-ink-muted">TIN {context.customer.tax_identification_number}</p>}</div>
                    <div className="text-right"><p className="text-[1.5em] font-bold tracking-wide text-ink-strong">INVOICE</p>
                      <dl className="mt-3 grid grid-cols-[auto_auto] gap-x-3 text-left"><dt className="font-semibold">Invoice #:</dt><dd>{invoice.invoice_number}</dd><dt className="font-semibold">Invoice Date:</dt><dd>{formatDate(invoice.invoice_date)}</dd><dt className="font-semibold">Due Date:</dt><dd>{formatDate(invoice.due_date)}</dd><dt className="font-semibold">Currency:</dt><dd>{invoice.currency}</dd>{invoice.external_tax_reference && <><dt className="font-semibold">Tax ref:</dt><dd>{invoice.external_tax_reference}</dd></>}</dl>
                    </div>
                  </div>
                  <table className="mt-6 w-full">
                    <thead className="bg-surface-muted text-left"><tr><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Description</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Unit Price</th><th className="px-2 py-1.5 text-right">Amount</th></tr></thead>
                    <tbody className="divide-y divide-line-soft">{invoice.lines.map((line, index) => <tr key={line.id}><td className="px-2 py-1.5">{index + 1}</td><td className="px-2 py-1.5">{line.description}</td><td className="px-2 py-1.5 text-right tabular-nums">{Number(line.quantity)}</td><td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(line.unit_price)}</td><td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(line.line_total)}</td></tr>)}</tbody>
                  </table>
                  <dl className="ml-auto mt-4 w-64 space-y-1">
                    <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{formatAmount(invoice.subtotal)}</dd></div>
                    <div className="flex justify-between"><dt>Tax</dt><dd className="tabular-nums">{formatAmount(invoice.tax_total)}</dd></div>
                    <div className="flex justify-between bg-surface-muted px-2 py-1.5 font-bold text-ink-strong"><dt>Total</dt><dd className="tabular-nums">{formatAmount(invoice.total_amount, invoice.currency)}</dd></div>
                  </dl>
                  <div className="mt-6"><p className="font-semibold">Notes</p><p className="text-ink-muted">{invoice.notes || EM_DASH}</p></div>
                </article>
              </div>
            </section>
          )}

          {tab === "details" && (
            <Panel icon={FileText} title="Invoice details" description="Amounts and collection position.">
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                {([["Subtotal", invoice.subtotal], ["Tax", invoice.tax_total], ["Total", invoice.total_amount], ["Received", invoice.amount_received ?? "0"], ["Amount due", invoice.amount_due ?? "0"]] as const).map(([label, value]) => <div key={label} className="rounded-xl bg-surface-muted p-3"><dt className="text-caption text-ink-muted">{label}</dt><dd className="font-bold tabular-nums">{formatAmount(value, invoice.currency)}</dd></div>)}
                <div className="rounded-xl bg-surface-muted p-3"><dt className="text-caption text-ink-muted">Days outstanding</dt><dd className="font-bold">{context.collection.days_outstanding ?? EM_DASH}</dd></div>
              </dl>
            </Panel>
          )}

          {tab === "payments" && <PaymentHistory receipts={context.receipts} />}
          {tab === "reminders" && <Reminders invoiceId={invoice.id} reminders={context.reminders} canManage={can("invoice.issue") && open} onAdd={() => setDialog("reminder")} onChanged={reload} onError={setProblem} />}
          {tab === "related" && (
            <Panel icon={FileSearch} title="Related records" description="Journal and receipts linked to this invoice.">
              {context.related.length ? <ul className="divide-y divide-line-soft">{context.related.map((row, index) => <li key={`${row.type}-${index}`} className="flex items-center gap-3 py-2.5 text-sm"><span className="w-40 shrink-0 text-ink-muted">{row.type}</span><span className="flex-1 font-semibold">{row.href ? <Link href={row.href} className="text-primary-ink hover:underline">{row.reference}</Link> : row.reference}</span>{row.status && <StatusBadge status={row.status} size="sm" />}</li>)}</ul> : <Empty icon={FileSearch} title="No related records yet" text="The AR journal and receipts appear here once the invoice is issued and paid." />}
            </Panel>
          )}
        </div>

        <aside className="space-y-4 print:hidden">
          <Panel icon={CircleDollarSign} title="Collection Status" action={<StatusBadge status={collection === "DUE" ? "PENDING" : collection} size="sm" />}>
            <p className="text-sm text-ink-muted">{collection === "NOT_SENT" ? "This invoice has not been sent to the customer." : collection === "OVERDUE" ? `${context.collection.days_overdue} days past due.` : collection === "PAID" ? "Paid in full." : collection === "VOID" ? "This invoice was voided." : `Due ${formatDate(invoice.due_date)}.`}</p>
            <dl className="mt-2 space-y-1 text-sm"><div className="flex justify-between"><dt>Amount Due</dt><dd className="font-semibold tabular-nums">{open ? formatAmount(invoice.amount_due ?? 0, invoice.currency) : EM_DASH}</dd></div><div className="flex justify-between"><dt>Days Outstanding</dt><dd className="font-semibold">{context.collection.days_outstanding ?? EM_DASH}</dd></div></dl>
          </Panel>
          <Panel icon={CreditCard} title="Payment Actions">
            <div className="flex flex-wrap gap-2">
              <Button disabled={!open || !can("receipt.create")} onClick={() => { setPayment((current) => ({ ...current, amount: invoice.amount_due ?? "" })); setDialog("payment"); }}>Record payment</Button>
              {invoice.status === "DRAFT" && can("invoice.void") && <Button variant="danger" onClick={() => setDialog("void")}>Void invoice</Button>}
            </div>
            {!open && invoice.status === "DRAFT" && <p className="mt-2 text-caption text-ink-muted">Send or issue the invoice before recording payments.</p>}
            {open && <p className="mt-2 text-caption text-ink-muted">Issued invoices are corrected through receipts, not voids.</p>}
          </Panel>
          <PaymentHistory receipts={context.receipts} compact onViewAll={() => setTab("payments")} />
          <Panel icon={Bell} title={`Reminders (${scheduled.length})`} action={can("invoice.issue") && open ? <button type="button" onClick={() => setDialog("reminder")} className="text-sm font-semibold text-primary-ink hover:underline">Add reminder</button> : undefined}>
            {scheduled.length ? <ul className="space-y-2 text-sm">{scheduled.slice(0, 3).map((row) => <li key={row.id} className="rounded-lg bg-surface-muted px-3 py-2"><span className="font-semibold">{formatDate(row.remind_on)}</span> · {humanizeEnum(row.channel)}{row.note && <span className="block text-caption text-ink-muted">{row.note}</span>}</li>)}</ul> : <Empty icon={Bell} title="No reminders scheduled" text="Set up payment reminders for this invoice." />}
          </Panel>
          <AttachmentsPanel resource="invoices" recordId={invoice.id} attachments={context.attachments} canUpload={can("invoice.create")} onChanged={reload} />
          <AuditPanel entries={context.audit} labels={AUDIT_LABELS} historyHref={`/records/invoice/${invoice.id}`} />
        </aside>
      </div>

      <Dialog open={dialog === "send"} onClose={() => setDialog(null)} title={invoice.status === "DRAFT" ? "Send invoice" : "Resend invoice"} description={invoice.status === "DRAFT" ? "Sending issues the invoice (posting its AR journal) and emails it to the customer." : "Emails the invoice to the customer again."}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} disabled={!email.trim()} leadingIcon={<Send className="h-4 w-4" />} onClick={() => void send()}>Send invoice</Button></>}>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Customer email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" /></label>
      </Dialog>
      <Dialog open={dialog === "hold"} onClose={() => setDialog(null)} title="Place invoice on hold" description="Use for disputes or queries. The invoice stays issued; it is flagged as an exception until released."
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} disabled={!text.trim()} onClick={() => void run(() => accountingApi.holdInvoice(invoice.id, text.trim()))}>Place on hold</Button></>}>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Reason</span><textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
      </Dialog>
      <Dialog open={dialog === "payment"} onClose={() => setDialog(null)} title="Record payment" description={`Records a receipt against ${invoice.invoice_number} and posts its cash journal.`}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} disabled={!payment.amount || (payment.method !== "CASH" && !payment.bank)} onClick={() => void recordPayment()}>Record payment</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="mb-1.5 block text-sm font-semibold">Receipt date</span><input type="date" value={payment.date} onChange={(event) => setPayment({ ...payment, date: event.target.value })} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Amount ({invoice.currency})</span><input type="number" min={0} step="0.01" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Method</span><select value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm">{METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Bank account{payment.method === "CASH" ? " (optional)" : ""}</span><select value={payment.bank} onChange={(event) => setPayment({ ...payment, bank: event.target.value })} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm"><option value="">Select account</option>{banks.filter((bank) => bank.currency === invoice.currency).map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
        </div>
      </Dialog>
      <Dialog open={dialog === "reminder"} onClose={() => setDialog(null)} title="Add reminder" description="Plan a collection follow-up for this invoice."
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} onClick={() => void run(() => accountingApi.addInvoiceReminder(invoice.id, { remind_on: reminder.date, channel: reminder.channel, note: reminder.note.trim() }), "Reminder scheduled.")}>Add reminder</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="mb-1.5 block text-sm font-semibold">Remind on</span><input type="date" value={reminder.date} onChange={(event) => setReminder({ ...reminder, date: event.target.value })} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Channel</span><select value={reminder.channel} onChange={(event) => setReminder({ ...reminder, channel: event.target.value })} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm">{CHANNELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Note</span><textarea rows={3} value={reminder.note} onChange={(event) => setReminder({ ...reminder, note: event.target.value })} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
        </div>
      </Dialog>
      <ConfirmDialog open={dialog === "void" || dialog === "release" || dialog === "issue"} title={dialog === "void" ? "Void invoice?" : dialog === "issue" ? "Issue invoice?" : "Release hold?"} description={dialog === "void" ? "Voided drafts cannot be restored." : dialog === "issue" ? "Posts the AR journal without emailing the customer." : "The invoice returns to normal collection."} confirmLabel={dialog === "void" ? "Void invoice" : dialog === "issue" ? "Issue" : "Release"} tone={dialog === "void" ? "destructive" : "neutral"} record={dialog === "void" ? { name: `${invoice.invoice_number} · ${context.customer.name}`, detail: formatAmount(invoice.total_amount, invoice.currency) } : undefined} typeToConfirm={dialog === "void" ? "VOID" : undefined} loading={busy}
        onConfirm={() => void run(() => dialog === "void" ? accountingApi.voidInvoice(invoice.id) : dialog === "issue" ? accountingApi.issueInvoice(invoice.id) : accountingApi.releaseInvoice(invoice.id))} onCancel={() => setDialog(null)} />
    </div>
  );
}

function PaymentHistory({ receipts, compact, onViewAll }: { receipts: Array<{ id: string; receipt_number: string; receipt_date: string; amount: string; currency: string; payment_method: string; status: string }>; compact?: boolean; onViewAll?: () => void }) {
  return (
    <Panel icon={Clock3} title={`Payment History (${receipts.length})`} action={compact && receipts.length > 3 && onViewAll ? <button type="button" onClick={onViewAll} className="text-sm font-semibold text-primary-ink hover:underline">View all</button> : undefined}>
      {receipts.length ? (
        <ul className="divide-y divide-line-soft text-sm">{(compact ? receipts.slice(0, 3) : receipts).map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-2"><span><span className="block font-semibold">{row.receipt_number}</span><span className="text-caption text-ink-muted">{formatDate(row.receipt_date)} · {humanizeEnum(row.payment_method)}</span></span><span className="flex items-center gap-2"><span className="tabular-nums">{formatAmount(row.amount, row.currency)}</span><StatusBadge status={row.status} size="sm" /></span></li>)}</ul>
      ) : <Empty icon={FileText} title="No payment history available" text="Payments will appear here when recorded." />}
    </Panel>
  );
}

function Reminders({ invoiceId, reminders, canManage, onAdd, onChanged, onError }: { invoiceId: string; reminders: Array<{ id: string; remind_on: string; channel: string; note: string; status: string; created_by: string; completed_at: string | null }>; canManage: boolean; onAdd: () => void; onChanged: () => void; onError: (message: string) => void }) {
  const update = async (reminderId: string, status: "DONE" | "CANCELLED") => {
    try { await accountingApi.updateInvoiceReminder(invoiceId, reminderId, status); onChanged(); } catch (caught) { onError(getApiErrorMessage(caught)); }
  };
  return (
    <Panel icon={Bell} title="Reminders" description="Collection follow-ups planned or completed for this invoice." action={canManage ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={onAdd}>Add reminder</Button> : undefined}>
      {reminders.length ? (
        <ul className="divide-y divide-line-soft text-sm">
          {reminders.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="flex-1"><span className="block font-semibold">{formatDate(row.remind_on)} · {humanizeEnum(row.channel)}</span><span className="text-caption text-ink-muted">{row.note || "No note"} · by {row.created_by}{row.completed_at ? ` · closed ${formatDateTime(row.completed_at)}` : ""}</span></span>
              <StatusBadge status={row.status === "DONE" ? "COMPLETED" : row.status} size="sm" />
              {row.status === "SCHEDULED" && canManage && <span className="flex gap-1"><Button size="sm" variant="secondary" leadingIcon={<Check className="h-4 w-4" />} onClick={() => void update(row.id, "DONE")}>Done</Button><Button size="sm" variant="ghost" aria-label="Cancel reminder" onClick={() => void update(row.id, "CANCELLED")}><X className="h-4 w-4" /></Button></span>}
            </li>
          ))}
        </ul>
      ) : <Empty icon={Bell} title="No reminders scheduled" text="Set up payment reminders for this invoice." />}
    </Panel>
  );
}

