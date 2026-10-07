"use client";

import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { formatAmount, formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import { buttonClasses } from "@/components/ui/Button";

export default function BankingPage() {
  const [creating, setCreating] = useState<"payment" | "receipt" | null>(null);
  const [bankFormOpen, setBankFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [voiding, setVoiding] = useState<{
    kind: "payment" | "receipt";
    id: string;
    number: string;
  } | null>(null);
  const [voidDate, setVoidDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [voidError, setVoidError] = useState("");
  const [voidSaving, setVoidSaving] = useState(false);
  const load = useCallback(
    () =>
      Promise.all([
        accountingApi.listBankAccounts({
          page_size: MAX_PAGE_SIZE,
          ordering: "name",
        }),
        accountingApi.listPayments({
          page_size: MAX_PAGE_SIZE,
          ordering: "-payment_date",
        }),
        accountingApi.listReceipts({
          page_size: MAX_PAGE_SIZE,
          ordering: "-receipt_date",
        }),
        accountingApi.listVendorBills({
          page_size: MAX_PAGE_SIZE,
          status: "POSTED",
        }),
        accountingApi.listInvoices({
          page_size: MAX_PAGE_SIZE,
          status: "ISSUED",
        }),
      ]),
    [],
  );
  const { data, loading, error, reload } = useApiResource(load);
  const accounts = useMemo(() => data?.[0].results ?? [], [data]);
  const payments = useMemo(() => data?.[1].results ?? [], [data]);
  const receipts = useMemo(() => data?.[2].results ?? [], [data]);
  const bills = useMemo(() => data?.[3].results ?? [], [data]);
  const invoices = useMemo(() => data?.[4].results ?? [], [data]);
  const bankNames = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );
  const save = async (value: CashForm) => {
    if (!creating) return;
    if (
      !value.date ||
      !value.amount ||
      !value.currency ||
      !value.reference ||
      (value.method !== "CASH" && !value.bank_account)
    ) {
      setFormError(
        "Complete the transaction and select a bank account for non-cash methods.",
      );
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (creating === "payment")
        await accountingApi.createPayment({
          payment_number: value.number.trim(),
          payment_date: value.date,
          amount: value.amount,
          currency: value.currency.toUpperCase(),
          payment_method: value.method,
          bank_account: value.bank_account || null,
          vendor_bill: value.reference,
        });
      else
        await accountingApi.createReceipt({
          receipt_number: value.number.trim(),
          receipt_date: value.date,
          amount: value.amount,
          currency: value.currency.toUpperCase(),
          payment_method: value.method,
          bank_account: value.bank_account || null,
          invoice: value.reference,
        });
      setCreating(null);
      reload();
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };
  const voidTransaction = async () => {
    if (!voiding || !voidDate) return;
    setVoidSaving(true);
    setVoidError("");
    try {
      if (voiding.kind === "payment")
        await accountingApi.voidPayment(voiding.id, voidDate);
      else await accountingApi.voidReceipt(voiding.id, voidDate);
      setVoiding(null);
      reload();
    } catch (caught) {
      setVoiding(null);
      setVoidError(getApiErrorMessage(caught));
    } finally {
      setVoidSaving(false);
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments & Receipts"
        description="Bank accounts, vendor payments and customer receipts."
        actions={
          <div className="flex gap-2">
            <button type="button" onClick={() => setBankFormOpen(true)} className={buttonClasses({ variant: "secondary" })}>New Bank Account</button>
            <button
              type="button"
              onClick={() => {
                setFormError("");
                setCreating("payment");
              }}
              className={buttonClasses({ variant: "secondary" })}
            >
              Record Payment
            </button>
            <button
              type="button"
              onClick={() => {
                setFormError("");
                setCreating("receipt");
              }}
              className={buttonClasses({ variant: "primary" })}
            >
              <Plus className="h-4 w-4" />
              Record Receipt
            </button>
          </div>
        }
      />
      {error && <ErrorState message={error} onRetry={reload} />}
      {voidError && (
        <p className="rounded border border-danger/25 bg-danger-soft p-3 text-sm text-danger-ink">
          {voidError}
        </p>
      )}
      {bankFormOpen && <BankAccountForm onClose={() => setBankFormOpen(false)} onSaved={() => { setBankFormOpen(false); reload(); }} />}
      <section className="rounded-2xl border bg-surface p-5">
        <h2 className="font-semibold">Bank Accounts</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[650px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-ink-muted">
                <th className="pb-3">Account</th>
                <th className="pb-3">Bank</th>
                <th className="pb-3">Account Number</th>
                <th className="pb-3">Currency</th>
                <th className="pb-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b last:border-0">
                  <td className="py-4 font-medium">{account.name}</td>
                  <td className="py-4">{account.bank_name}</td>
                  <td className="py-4">{account.masked_account_number}</td>
                  <td className="py-4">{account.currency}</td>
                  <td className="py-4">
                    <StatusBadge
                      status={account.is_active ? "ACTIVE" : "INACTIVE"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Transactions
        title="Recent Payments"
        loading={loading}
        empty="No payments found."
        rows={payments.map((payment) => ({
          id: payment.id,
          number: payment.payment_number,
          date: payment.payment_date,
          amount: formatAmount(payment.amount, payment.currency),
          account: payment.bank_account
            ? (bankNames.get(payment.bank_account) ?? payment.bank_account)
            : "Cash",
          status: payment.status,
          canVoid: payment.status === "POSTED",
        }))}
        onVoid={(row) => {
          setVoidDate(new Date().toISOString().slice(0, 10));
          setVoidError("");
          setVoiding({ kind: "payment", id: row.id, number: row.number });
        }}
      />
      <Transactions
        title="Recent Receipts"
        loading={loading}
        empty="No receipts found."
        rows={receipts.map((receipt) => ({
          id: receipt.id,
          number: receipt.receipt_number,
          date: receipt.receipt_date,
          amount: formatAmount(receipt.amount, receipt.currency),
          account: receipt.bank_account
            ? (bankNames.get(receipt.bank_account) ?? receipt.bank_account)
            : "Cash",
          status: receipt.status,
          canVoid: receipt.status === "POSTED",
        }))}
        onVoid={(row) => {
          setVoidDate(new Date().toISOString().slice(0, 10));
          setVoidError("");
          setVoiding({ kind: "receipt", id: row.id, number: row.number });
        }}
      />
      <Reconciliation />
      <p className="text-xs text-ink-muted">
        Balances and allocations are not shown because the available backend
        resources do not expose them. Payment and receipt state is derived by
        the backend.
      </p>
      {creating && (
        <CashModal
          kind={creating}
          accounts={accounts}
          references={
            creating === "payment"
              ? bills.map((bill) => ({
                  id: bill.id,
                  label: `${bill.bill_number} — ${formatAmount(bill.amount_payable, bill.currency)}`,
                }))
              : invoices.map((invoice) => ({
                  id: invoice.id,
                  label: `${invoice.invoice_number} — ${formatAmount(invoice.total_amount, invoice.currency)}`,
                }))
          }
          error={formError}
          saving={saving}
          onClose={() => setCreating(null)}
          onSave={save}
        />
      )}
      {voiding && (
        <div className="rounded-2xl border bg-surface p-5">
          <label className="block max-w-sm text-sm font-medium">
            Void date
            <input
              type="date"
              value={voidDate}
              onChange={(event) => setVoidDate(event.target.value)}
              className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 mt-2 block w-full"
            />
          </label>
        </div>
      )}
      {voiding && (
        <ConfirmDialog
          open
          title={`Void ${voiding.kind} ${voiding.number}`}
          description="The backend will create and post a reversal journal in the selected period."
          confirmLabel="Void transaction"
          destructive
          loading={voidSaving}
          onCancel={() => setVoiding(null)}
          onConfirm={() => void voidTransaction()}
        />
      )}
    </div>
  );
}
type CashForm = {
  number: string;
  date: string;
  amount: string;
  currency: string;
  method: string;
  bank_account: string;
  reference: string;
};
function CashModal({
  kind,
  accounts,
  references,
  error,
  saving,
  onClose,
  onSave,
}: {
  kind: "payment" | "receipt";
  accounts: Array<{
    id: string;
    name: string;
    currency: string;
    is_active: boolean;
  }>;
  references: Array<{ id: string; label: string }>;
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (form: CashForm) => void;
}) {
  const [form, setForm] = useState<CashForm>({
    number: "",
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    currency: "",
    method: "BANK_TRANSFER",
    bank_account: "",
    reference: "",
  });
  const update = (change: Partial<CashForm>) => setForm({ ...form, ...change });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div className="w-full max-w-lg rounded-2xl bg-surface shadow-xl">
        <div className="border-b p-5">
          <h2 className="text-lg font-bold">
            Record {kind === "payment" ? "Payment" : "Receipt"}
          </h2>
          <p className="text-sm text-ink-muted">
            The backend immediately posts the controlled cash journal.
          </p>
        </div>
        {error && (
          <p className="mx-5 mt-4 rounded border border-danger/25 bg-danger-soft p-3 text-sm text-danger-ink">
            {error}
          </p>
        )}
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Input
            label="Reference number (optional)"
            value={form.number}
            placeholder="Auto-generated if left blank"
            onChange={(number) => update({ number })}
          />
          <Input
            label="Date"
            type="date"
            value={form.date}
            onChange={(date) => update({ date })}
          />
          <Input
            label="Amount"
            type="number"
            value={form.amount}
            onChange={(amount) => update({ amount })}
          />
          <Input
            label="Currency"
            value={form.currency}
            onChange={(currency) =>
              update({ currency: currency.toUpperCase() })
            }
          />
          <label className="space-y-1">
            <span className="text-sm font-medium">Method</span>
            <select
              value={form.method}
              onChange={(event) =>
                update({
                  method: event.target.value,
                  bank_account:
                    event.target.value === "CASH" ? "" : form.bank_account,
                })
              }
              className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full"
            >
              {[
                "CASH",
                "BANK_TRANSFER",
                "CHEQUE",
                "CARD",
                "MOBILE_MONEY",
                "OTHER",
              ].map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Bank account</span>
            <select
              value={form.bank_account}
              disabled={form.method === "CASH"}
              onChange={(event) => update({ bank_account: event.target.value })}
              className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full disabled:bg-surface-muted"
            >
              <option value="">
                {form.method === "CASH"
                  ? "Cash transaction"
                  : "Select bank account"}
              </option>
              {accounts
                .filter((account) => account.is_active)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.currency})
                  </option>
                ))}
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-sm font-medium">
              {kind === "payment" ? "Posted vendor bill" : "Issued invoice"}
            </span>
            <select
              value={form.reference}
              onChange={(event) => update({ reference: event.target.value })}
              className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full"
            >
              <option value="">Select reference</option>
              {references.map((reference) => (
                <option key={reference.id} value={reference.id}>
                  {reference.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={buttonClasses({ variant: "secondary" })}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(form)}
            disabled={saving}
            className={buttonClasses({ variant: "primary" })}
          >
            {saving
              ? "Saving..."
              : `Record ${kind === "payment" ? "Payment" : "Receipt"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full"
      />
    </label>
  );
}

function BankAccountForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) { const [form, setForm] = useState({ name: "", bank_name: "", masked_account_number: "", currency: "", ledger_account: "", is_active: true }); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const { data } = useApiResource(() => accountingApi.listAccounts({ page_size: MAX_PAGE_SIZE, is_active: true, is_postable: true })); const save = async () => { if (!form.name.trim() || !form.bank_name.trim() || !form.masked_account_number.trim() || !form.currency || !form.ledger_account) { setError("Complete every bank account field."); return; } setSaving(true); try { await accountingApi.createBankAccount({ ...form, name: form.name.trim(), bank_name: form.bank_name.trim(), masked_account_number: form.masked_account_number.trim(), currency: form.currency.toUpperCase() }); onSaved(); } catch (caught) { setError(getApiErrorMessage(caught)); } finally { setSaving(false); } }; return <div className="rounded-2xl border bg-surface p-5"><h2 className="font-semibold">New Bank Account</h2>{error && <p className="mt-3 text-sm text-danger-ink">{error}</p>}<div className="mt-4 grid gap-3 sm:grid-cols-2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Account name" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><input value={form.bank_name} onChange={(event) => setForm({ ...form, bank_name: event.target.value })} placeholder="Bank name" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><input value={form.masked_account_number} onChange={(event) => setForm({ ...form, masked_account_number: event.target.value })} placeholder="Masked account number" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><input value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} placeholder="Currency" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><select value={form.ledger_account} onChange={(event) => setForm({ ...form, ledger_account: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 sm:col-span-2"><option value="">Cash/bank ledger account</option>{(data?.results ?? []).map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} className={buttonClasses({ variant: "secondary", size: "sm" })}>Cancel</button><button type="button" disabled={saving} onClick={() => void save()} className={buttonClasses({ variant: "primary", size: "sm" })}>{saving ? "Saving..." : "Create Account"}</button></div></div>; }
function Transactions({
  title,
  rows,
  loading,
  empty,
  onVoid,
}: {
  title: string;
  rows: Array<{
    id: string;
    number: string;
    date: string;
    amount: string;
    account: string;
    status: string;
    canVoid: boolean;
  }>;
  loading: boolean;
  empty: string;
  onVoid: (row: { id: string; number: string }) => void;
}) {
  return (
    <section className="rounded-2xl border bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="pb-3">Reference</th>
              <th className="pb-3">Date</th>
              <th className="pb-3">Bank Account</th>
              <th className="pb-3">Amount</th>
              <th className="pb-3">Status</th>
              <th className="pb-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="py-4 font-medium">{row.number}</td>
                <td className="py-4">{formatDate(row.date)}</td>
                <td className="py-4">{row.account}</td>
                <td className="py-4 font-semibold">{row.amount}</td>
                <td className="py-4">
                  <StatusBadge status={row.status} />
                </td>
                <td className="py-4">
                  {row.canVoid && (
                    <button
                      type="button"
                      onClick={() => onVoid(row)}
                      className={buttonClasses({ variant: "secondary", size: "sm" })}
                    >
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && (
          <p className="py-8 text-center text-sm text-ink-muted">
            Loading transactions...
          </p>
        )}
        {!loading && !rows.length && (
          <p className="py-8 text-center text-sm text-ink-muted">{empty}</p>
        )}
      </div>
    </section>
  );
}

function Reconciliation() {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState("");
  const [importing, setImporting] = useState(false);
  const load = useCallback(
    () =>
      Promise.all([
        accountingApi.listBankStatementLines({
          page_size: MAX_PAGE_SIZE,
          ordering: "-statement_date",
        }),
        accountingApi.listJournalEntries({
          page_size: MAX_PAGE_SIZE,
          status: "POSTED",
          ordering: "-entry_date",
        }),
      ]),
    [],
  );
  const { data, loading, error, reload } = useApiResource(load);
  const lines = data?.[0].results ?? [];
  const journals = data?.[1].results ?? [];
  const act = async (lineId: string, match: boolean) => {
    try {
      if (match) {
        const journal = selected[lineId];
        if (!journal) {
          setActionError("Select a posted journal before matching.");
          return;
        }
        await accountingApi.matchBankStatementLine(lineId, journal);
      } else await accountingApi.unmatchBankStatementLine(lineId);
      setActionError("");
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    }
  };
  return (
    <section className="rounded-2xl border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
        <h2 className="font-semibold">Bank Reconciliation</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Match each imported statement movement to one posted journal with the
          same bank-ledger amount.
        </p>
        </div>
        <button type="button" onClick={() => setImporting(true)} className={buttonClasses({ variant: "secondary", size: "sm" })}>Import statement line</button>
      </div>
      {importing && <StatementImport onClose={() => setImporting(false)} onSaved={() => { setImporting(false); reload(); }} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {actionError && (
        <p className="mt-4 rounded border border-danger/25 bg-danger-soft p-3 text-sm text-danger-ink">
          {actionError}
        </p>
      )}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="pb-3">Date</th>
              <th className="pb-3">External ID</th>
              <th className="pb-3">Amount</th>
              <th className="pb-3">Status</th>
              <th className="pb-3">Journal / action</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b last:border-0">
                <td className="py-4">{formatDate(line.statement_date)}</td>
                <td className="py-4">
                  <p className="font-medium">{line.external_id}</p>
                  <p className="text-xs text-ink-muted">
                    {line.reference || line.description}
                  </p>
                </td>
                <td className="py-4 font-semibold">
                  {formatAmount(line.amount, line.currency)}
                </td>
                <td className="py-4">
                  <StatusBadge status={line.status} />
                </td>
                <td className="py-4">
                  {line.status === "MATCHED" ? (
                    <button
                      type="button"
                      onClick={() => void act(line.id, false)}
                      className={buttonClasses({ variant: "secondary", size: "sm" })}
                    >
                      Unmatch
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <select
                        value={selected[line.id] ?? ""}
                        onChange={(event) =>
                          setSelected({
                            ...selected,
                            [line.id]: event.target.value,
                          })
                        }
                        className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 max-w-xs"
                      >
                        <option value="">Select posted journal</option>
                        {journals.map((journal) => (
                          <option key={journal.id} value={journal.id}>
                            {journal.journal_number} —{" "}
                            {formatDate(journal.entry_date)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void act(line.id, true)}
                        className={buttonClasses({ variant: "secondary", size: "sm" })}
                      >
                        Match
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && (
          <p className="py-8 text-center text-sm text-ink-muted">
            Loading statement lines...
          </p>
        )}
        {!loading && !lines.length && (
          <p className="py-8 text-center text-sm text-ink-muted">
            No imported statement lines found.
          </p>
        )}
      </div>
    </section>
  );
}

function StatementImport({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ bank_account: "", statement_date: new Date().toISOString().slice(0, 10), external_id: "", reference: "", description: "", amount: "", currency: "" });
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const { data } = useApiResource(() => accountingApi.listBankAccounts({ page_size: MAX_PAGE_SIZE, is_active: true }));
  const save = async () => { if (!form.bank_account || !form.external_id.trim() || !form.amount || !form.currency.trim()) { setError("Bank account, external ID, amount, and currency are required."); return; } setSaving(true); try { await accountingApi.createBankStatementLine({ ...form, external_id: form.external_id.trim(), currency: form.currency.trim().toUpperCase() }); onSaved(); } catch (caught) { setError(getApiErrorMessage(caught)); } finally { setSaving(false); } };
  return <div className="mt-4 rounded-xl border bg-surface-muted p-4"><p className="font-medium">Import statement line</p>{error && <p className="mt-2 text-sm text-danger-ink">{error}</p>}<div className="mt-3 grid gap-3 sm:grid-cols-2"><select value={form.bank_account} onChange={(event) => setForm({ ...form, bank_account: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"><option value="">Bank account</option>{(data?.results ?? []).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><input type="date" value={form.statement_date} onChange={(event) => setForm({ ...form, statement_date: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><input value={form.external_id} onChange={(event) => setForm({ ...form, external_id: event.target.value })} placeholder="Bank external ID" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><input type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="Amount (+/-)" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><input value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} placeholder="Currency" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} placeholder="Reference (optional)" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Description (optional)" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 sm:col-span-2" /></div><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onClose} className={buttonClasses({ variant: "secondary", size: "sm" })}>Cancel</button><button type="button" onClick={() => void save()} disabled={saving} className={buttonClasses({ variant: "primary" })}>{saving ? "Importing..." : "Import"}</button></div></div>;
}
