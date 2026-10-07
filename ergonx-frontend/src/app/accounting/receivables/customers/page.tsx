"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ChevronLeft, Pencil, Plus, Search, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import ErrorState from "@/components/ui/ErrorState";
import { Dialog } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { useApiResource } from "@/lib/useApiResource";
import type { Customer } from "@/types/accounting";
import { MAX_PAGE_SIZE } from "@/types/api";

const EMPTY = { name: "", email: "", phone: "", address: "", country_code: "GH", tax_identification_number: "", is_active: true };
const inputClass = "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm";

/** Customer accounts for receivables (linked from the AR controls panel). */
export default function CustomersPage() {
  const { can } = useAccess();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(() => accountingApi.listCustomers({ page_size: MAX_PAGE_SIZE, search: search.trim() || undefined, ordering: "name" } as Parameters<typeof accountingApi.listCustomers>[0]), [search]);
  const { data, loading, error, reload } = useApiResource(load);
  const open = (customer: Customer | "new") => {
    setProblem(null);
    setEditing(customer);
    setForm(customer === "new" ? EMPTY : { name: customer.name, email: customer.email, phone: customer.phone, address: customer.address, country_code: customer.country_code, tax_identification_number: customer.tax_identification_number, is_active: customer.is_active });
  };
  const save = async () => {
    if (!form.name.trim()) { setProblem("Customer name is required."); return; }
    setSaving(true);
    setProblem(null);
    try {
      const payload = { ...form, name: form.name.trim(), country_code: form.country_code.trim().toUpperCase() };
      if (editing === "new") await accountingApi.createCustomer(payload);
      else if (editing) await accountingApi.updateCustomer(editing.id, payload);
      setEditing(null);
      reload();
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };
  const canEdit = editing === "new" ? can("customer.create") : can("customer.update");

  return (
    <div className="space-y-5">
      <Link href="/accounting/receivables" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Back to Accounts Receivable</Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-[1.75rem] font-bold leading-9 text-headline sm:text-title">Customers</h1><p className="mt-1.5 text-heading-support">Add and manage the customer accounts you invoice.</p></div>
        {can("customer.create") && <Button size="lg" leadingIcon={<Plus className="h-5 w-5" />} onClick={() => open("new")}>Add customer</Button>}
      </header>
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
        <label className="relative block max-w-md"><span className="sr-only">Search customers</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or code" className="h-11 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm" /></label>
        {error && <div className="mt-3"><ErrorState variant="inline" title="Unable to load customers" message={error} onRetry={reload} /></div>}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong"><tr><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">TIN</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y divide-line-soft">
              {(data?.results ?? []).map((customer) => (
                <tr key={customer.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2.5"><span className="flex items-center gap-2"><Avatar name={customer.name} size="sm" /><span className="font-medium text-ink-strong">{customer.name}</span></span></td>
                  <td className="px-3 py-2.5 text-ink-muted">{customer.customer_code}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{customer.email || "—"}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{customer.phone || "—"}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{customer.tax_identification_number || "—"}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={customer.is_active ? "ACTIVE" : "INACTIVE"} size="sm" /></td>
                  <td className="px-3 py-2.5 text-right">{can("customer.update") && <Button variant="ghost" size="sm" aria-label={`Edit ${customer.name}`} onClick={() => open(customer)}><Pencil className="h-4 w-4" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !data?.results.length && <div className="flex flex-col items-center py-10 text-center"><UsersRound className="h-10 w-10 text-ink-subtle" aria-hidden="true" /><p className="mt-2 font-bold text-headline">No customers yet</p><p className="text-support text-ink-muted">Add a customer to start invoicing.</p></div>}
        </div>
      </section>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add customer" : "Edit customer"} description="A customer code is generated automatically."
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={saving} disabled={!canEdit} onClick={() => void save()}>Save customer</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {problem && <div className="sm:col-span-2"><ErrorState variant="inline" title="Not saved" message={problem} /></div>}
          <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Name <span className="text-danger-ink">*</span></span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Billing email</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={inputClass} /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Phone</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={inputClass} /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Country code</span><input maxLength={2} value={form.country_code} onChange={(event) => setForm({ ...form, country_code: event.target.value })} className={inputClass} /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Tax identification number</span><input value={form.tax_identification_number} onChange={(event) => setForm({ ...form, tax_identification_number: event.target.value })} className={inputClass} /></label>
          <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Address</span><textarea rows={3} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
          {editing !== "new" && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} className="h-4 w-4" />Active (inactive customers cannot be invoiced)</label>}
        </div>
      </Dialog>
    </div>
  );
}
