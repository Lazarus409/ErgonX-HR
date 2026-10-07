"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Building2, BriefcaseBusiness, ChevronRight, GraduationCap, MapPin, Pencil, Plus, Power, UserRoundCheck } from "lucide-react";

import OrganizationForm, { saveOrganizationRecord } from "@/components/organization/OrganizationForm";
import BackNavigation from "@/components/ui/BackNavigation";
import { Card, IconTile } from "@/components/ui/Card";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import ErrorState from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/ToastProvider";
import { useAccess } from "@/lib/access";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { employeesApi, getApiErrorMessage, organizationApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE, type PaginatedData } from "@/types/api";
import type { Department, Grade, Location, Position } from "@/types/hr";

export type OrganizationResourceKind = "departments" | "positions" | "grades" | "locations";
type Resource = Department | Position | Grade | Location;

const metadata: Record<OrganizationResourceKind, { singular: string; title: string; description: string; icon: typeof Building2 }> = {
  departments: { singular: "Department / Functional Area", title: "Departments / Functional Areas", description: "The departments / functional areas your people, positions and approvals are organized by.", icon: Building2 },
  positions: { singular: "Position", title: "Positions", description: "Job positions and the department / functional area each one sits in.", icon: BriefcaseBusiness },
  grades: { singular: "Grade", title: "Grades", description: "Grade levels used for employees and pay structures.", icon: GraduationCap },
  locations: { singular: "Location", title: "Locations", description: "Offices, sites and remote arrangements people work from.", icon: MapPin },
};

function list(kind: OrganizationResourceKind): Promise<PaginatedData<Resource>> { switch (kind) { case "departments": return organizationApi.listDepartments({ page_size: 100 }) as Promise<PaginatedData<Resource>>; case "positions": return organizationApi.listPositions({ page_size: 100 }) as Promise<PaginatedData<Resource>>; case "grades": return organizationApi.listGrades({ page_size: 100 }) as Promise<PaginatedData<Resource>>; case "locations": return organizationApi.listLocations({ page_size: 100 }) as Promise<PaginatedData<Resource>>; } }
function get(kind: OrganizationResourceKind, id: string): Promise<Resource> { switch (kind) { case "departments": return organizationApi.getDepartment(id) as Promise<Resource>; case "positions": return organizationApi.getPosition(id) as Promise<Resource>; case "grades": return organizationApi.getGrade(id) as Promise<Resource>; case "locations": return organizationApi.getLocation(id) as Promise<Resource>; } }
function nameOf(item: Resource) { return "title" in item ? item.title : item.name; }
function countryLabel(code: string) { if (!code) return "Not provided"; try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; } }
function details(kind: OrganizationResourceKind, item: Resource): Array<[string, string]> { if (kind === "departments") { const value = item as Department; return [["Code", value.code], ["Department / Functional Area head", value.head_name ?? "Not assigned"], ["Part of", value.parent_name ?? "None (top level)"], ["Description", value.description || "Not provided"]]; } if (kind === "positions") { const value = item as Position; return [["Code", value.code], ["Department / Functional Area", value.department_name ?? "Not assigned"], ["Description", value.description || "Not provided"]]; } if (kind === "grades") { const value = item as Grade; return [["Code", value.code], ["Level", String(value.level ?? "Not set")], ["Description", value.description || "Not provided"]]; } const value = item as Location; return [["Code", value.code], ["Address", value.address || "Not provided"], ["City", value.city || "Not provided"], ["Country", countryLabel(value.country)], ["Time zone", value.timezone || "Same as the institution"], ["Work arrangement", value.is_remote ? "Remote or hybrid" : "On site"]]; }

export function OrganizationResourceList({ kind }: { kind: OrganizationResourceKind }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const { can, readOnly } = useAccess();
  const { showToast } = useToast();
  const canCreate = can("organization.create") && !readOnly;
  const meta = metadata[kind];
  const Icon = meta.icon;
  const load = useCallback(() => list(kind), [kind]);
  const { data, loading, error, reload } = useApiResource(load);
  const items = useMemo(() => (data?.results ?? []).filter((item) => { const record = item as Resource; const queryMatch = `${nameOf(record)} ${record.code} ${"description" in record ? record.description : ""}`.toLowerCase().includes(query.toLowerCase()); return queryMatch && (status === "ALL" || (record.is_active ? "ACTIVE" : "INACTIVE") === status); }), [data, query, status]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Organization" title={meta.title} description={meta.description} icon={Icon} accent="hr" actions={canCreate ? <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New {meta.singular.toLowerCase()}</Button> : undefined} />
      {creating && (
        <OrganizationForm
          kind={kind}
          record={null}
          open
          onClose={() => setCreating(false)}
          onSaved={(saved) => { setCreating(false); showToast({ tone: "success", message: `${nameOf(saved)} added.` }); reload(); }}
        />
      )}
      <DataTable<Resource>
        caption={meta.title}
        rows={items}
        rowKey={(record) => record.id}
        loading={loading && !data}
        error={error && !data ? error : null}
        onRetry={reload}
        minWidth={560}
        toolbar={
          <DataToolbar
            search={query}
            onSearchChange={setQuery}
            searchPlaceholder={`Search ${meta.title.toLowerCase()}…`}
            filters={<Select size="sm" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select>}
            onClear={query || status !== "ALL" ? () => { setQuery(""); setStatus("ALL"); } : undefined}
          />
        }
        empty={{ title: `No ${meta.title.toLowerCase()} found`, description: query || status !== "ALL" ? "Try a broader search or status." : canCreate ? `Add the first ${meta.singular.toLowerCase()} to get started.` : `No ${meta.title.toLowerCase()} have been set up yet.`, icon: Icon, action: canCreate && !query && status === "ALL" ? <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New {meta.singular.toLowerCase()}</Button> : undefined }}
        columns={[
          {
            key: "name",
            header: meta.singular,
            sortValue: (record) => nameOf(record),
            cell: (record) => (
              <Link href={`/hr/${kind}/${record.id}`} className="group flex items-center gap-3">
                <IconTile icon={Icon} accent="hr" size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink-strong group-hover:text-primary-ink">{nameOf(record)}</span>
                  {kind === "positions" && (record as Position).department_name && <span className="block truncate text-caption text-ink-muted">{(record as Position).department_name}</span>}
                  {kind === "departments" && (record as Department).parent_name && <span className="block truncate text-caption text-ink-muted">Part of {(record as Department).parent_name}</span>}
                  {kind === "locations" && (record as Location).city && <span className="block truncate text-caption text-ink-muted">{[(record as Location).city, (record as Location).is_remote ? "Remote or hybrid" : null].filter(Boolean).join(" · ")}</span>}
                </span>
              </Link>
            ),
          },
          { key: "code", header: "Code", sortValue: (record) => record.code, cell: (record) => <span className="font-mono text-support">{record.code}</span> },
          ...(kind === "departments" ? [{ key: "head", header: "Head", hideBelow: "md" as const, sortValue: (record: Resource) => (record as Department).head_name ?? "", cell: (record: Resource) => (record as Department).head_name ?? <span className="text-ink-muted">Not assigned</span> }] : []),
          { key: "status", header: "Status", cell: (record) => <StatusBadge status={record.is_active ? "ACTIVE" : "INACTIVE"} size="sm" /> },
          { key: "open", header: <span className="sr-only">Open</span>, cell: (record) => <Link href={`/hr/${kind}/${record.id}`} aria-label={`Open ${nameOf(record)}`} className="flex justify-end text-ink-subtle hover:text-ink-strong"><ChevronRight className="h-4 w-4" /></Link> },
        ]}
      />
    </div>
  );
}

export function OrganizationResourceDetail({ kind, id }: { kind: OrganizationResourceKind; id: string }) {
  const meta = metadata[kind];
  const Icon = meta.icon;
  const load = useCallback(() => get(kind, id), [kind, id]);
  const { data, loading, error, reload } = useApiResource(load);
  const { can, readOnly } = useAccess();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const canEdit = can("organization.update") && !readOnly;
  if (loading && !data) return <LoadingState variant="detail" />;
  if (error || !data) return <ErrorState title={`Unable to load ${meta.singular.toLowerCase()}`} message={error ?? "The requested record was not found."} onRetry={reload} />;
  const item = data as Resource;
  const toggleActive = async () => {
    setToggling(true);
    try {
      const saved = await saveOrganizationRecord(kind, item.id, { is_active: !item.is_active });
      showToast({ tone: "success", message: `${nameOf(saved)} ${saved.is_active ? "reactivated" : "deactivated"}.` });
      reload();
    } catch (caught) {
      showToast({ tone: "error", message: getApiErrorMessage(caught) });
    } finally {
      setToggling(false);
    }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        back={<BackNavigation fallback={`/hr/${kind}`} label={`Back to ${meta.title}`} />}
        eyebrow={meta.singular}
        title={nameOf(item)}
        description={`${meta.singular} code: ${item.code}`}
        icon={Icon}
        accent="hr"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={item.is_active ? "ACTIVE" : "INACTIVE"} />
            {canEdit && <Button variant="secondary" leadingIcon={<Power className="h-4 w-4" />} loading={toggling} onClick={() => void toggleActive()}>{item.is_active ? "Deactivate" : "Reactivate"}</Button>}
            {canEdit && <Button leadingIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          </div>
        }
      />
      {editing && (
        <OrganizationForm
          kind={kind}
          record={item}
          open
          onClose={() => setEditing(false)}
          onSaved={(saved) => { setEditing(false); showToast({ tone: "success", message: `${nameOf(saved)} saved.` }); reload(); }}
        />
      )}
      <Card title={`${meta.singular} details`} accent="hr" accentLine>
        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {details(kind, item).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-caption font-medium text-ink-muted">{label}</dt>
              <dd className="mt-1 break-words text-sm font-semibold text-ink-strong">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {kind === "departments" && <DepartmentHeadCard department={item as Department} onSaved={reload} />}
    </div>
  );
}

/** HR picks the Department Head: they approve the team's leave first and see its people. */
function DepartmentHeadCard({ department, onSaved }: { department: Department; onSaved: () => void }) {
  const { can } = useAccess();
  const { showToast } = useToast();
  const canEdit = can("organization.update");
  const loadCandidates = useCallback(() => (canEdit ? employeesApi.listEmployees({ department: department.id, status: "ACTIVE", page_size: MAX_PAGE_SIZE, ordering: "last_name" }) : Promise.resolve(null)), [canEdit, department.id]);
  const { data: candidates, loading } = useApiResource(loadCandidates);
  const [headId, setHeadId] = useState(department.head ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = candidates?.results ?? [];
  const currentMissing = department.head && !options.some((employee) => employee.id === department.head);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await organizationApi.updateDepartment(department.id, { head: headId || null });
      showToast({ tone: "success", message: headId ? "Department / Functional Area head updated." : "Department / Functional Area head removed." });
      onSaved();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Department / Functional Area head" description="Approves the team's leave before HR and sees this department / functional area's people, attendance and leave. Sub-departments / functional areas are included." icon={UserRoundCheck} accent="hr">
      {!canEdit ? (
        <p className="text-sm font-semibold text-ink-strong">{department.head_name ?? "Not assigned"}</p>
      ) : (
        <div className="space-y-3">
          <Field label="Head" helper="Choose from this department / functional area's active employees. Give them the Department / Functional Area Head role in Users & Access so they get the department / functional area workspace.">
            <Select value={headId} disabled={loading || saving} onChange={(event) => setHeadId(event.target.value)}>
              <option value="">Not assigned</option>
              {currentMissing && <option value={department.head ?? ""}>{department.head_name} (outside this department)</option>}
              {options.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.employee_number}</option>)}
            </Select>
          </Field>
          {error && <p className="text-support text-danger-ink">{error}</p>}
          <Button onClick={() => void save()} loading={saving} disabled={headId === (department.head ?? "")}>Save head</Button>
        </div>
      )}
    </Card>
  );
}
