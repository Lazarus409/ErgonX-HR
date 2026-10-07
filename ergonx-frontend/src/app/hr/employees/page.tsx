"use client";

import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  PauseCircle,
  UserCheck,
  UserX,
  Copy,
  ExternalLink,
  Eye,
  Filter,
  MoreHorizontal,
  Mail,
  Pencil,
  Plus,
  Search,
  Settings2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Alert from "@/components/ui/Alert";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { Avatar, MetricCard } from "@/components/ui/Card";
import { useApiResource } from "@/lib/useApiResource";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { Dialog, Menu, MenuItem } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { employeesApi, getApiErrorMessage, organizationApi } from "@/lib/api";
import type { CurrentEmploymentIndex } from "@/lib/api/employees";
import type { OrganizationLookups } from "@/lib/api/organization";
import { DEFAULT_PAGE_SIZE, emptyPage } from "@/types/api";
import type { PaginatedData } from "@/types/api";
import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  type Employee,
} from "@/types/hr";
import { EM_DASH, formatDate, humanizeEnum } from "@/lib/format";
import { cx } from "@/lib/cx";
import type { Employment } from "@/types/hr";

const ALL = "ALL";
const SEARCH_DEBOUNCE_MS = 350;

const emptyLookups: OrganizationLookups = {
  departments: [],
  positions: [],
  grades: [],
  locations: [],
};

export default function EmployeesPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [employmentType, setEmploymentType] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [location, setLocation] = useState(ALL);
  const [page, setPage] = useState(1);
  const router = useRouter();

  const [data, setData] = useState<PaginatedData<Employee>>(() =>
    emptyPage<Employee>(),
  );
  const [lookups, setLookups] = useState<OrganizationLookups>(emptyLookups);
  const [employments, setEmployments] = useState<CurrentEmploymentIndex | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keeps stale responses from overwriting newer ones while filters change.
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [search]);

  // Reference data for the filter selects and the assignment columns.
  useEffect(() => {
    let active = true;

    async function loadReferenceData() {
      try {
        const [organization, employmentIndex] = await Promise.all([
          organizationApi.loadOrganizationLookups(),
          employeesApi.loadCurrentEmploymentIndex(),
        ]);

        if (!active) {
          return;
        }

        setLookups(organization);
        setEmployments(employmentIndex);
      } catch {
        // Assignment columns and filter labels degrade to placeholders; the
        // employee list itself still renders from its own request.
        if (active) {
          setLookups(emptyLookups);
          setEmployments(null);
        }
      }
    }

    loadReferenceData();

    return () => {
      active = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    let active = true;

    async function loadEmployees() {
      setLoading(true);
      setError(null);

      try {
        const result = await employeesApi.listEmployees({
          page,
          page_size: DEFAULT_PAGE_SIZE,
          ordering: "employee_number",
          search: debouncedSearch || undefined,
          status: status === ALL ? undefined : status,
          department: department === ALL ? undefined : department,
          location: location === ALL ? undefined : location,
          employment_type:
            employmentType === ALL ? undefined : employmentType,
        });

        if (!active || requestRef.current !== requestId) {
          return;
        }

        setData(result);
      } catch (caught) {
        if (!active || requestRef.current !== requestId) {
          return;
        }

        setError(getApiErrorMessage(caught));
        setData(emptyPage<Employee>());
      } finally {
        if (active && requestRef.current === requestId) {
          setLoading(false);
        }
      }
    }

    loadEmployees();

    return () => {
      active = false;
    };
  }, [
    page,
    debouncedSearch,
    status,
    department,
    location,
    employmentType,
    reloadToken,
  ]);

  const departmentNames = useMemo(
    () => new Map(lookups.departments.map((item) => [item.id, item.name])),
    [lookups.departments],
  );

  const positionTitles = useMemo(
    () => new Map(lookups.positions.map((item) => [item.id, item.title])),
    [lookups.positions],
  );

  const locationNames = useMemo(
    () => new Map(lookups.locations.map((item) => [item.id, item.name])),
    [lookups.locations],
  );

  // Changing any filter returns to the first page. Done in the handlers
  // rather than an effect so no cascading render is triggered.
  const changeSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const changeStatus = useCallback((value: string) => {
    setStatus(value);
    setPage(1);
  }, []);

  const changeEmploymentType = useCallback((value: string) => {
    setEmploymentType(value);
    setPage(1);
  }, []);

  const changeDepartment = useCallback((value: string) => {
    setDepartment(value);
    setPage(1);
  }, []);

  const changeLocation = useCallback((value: string) => {
    setLocation(value);
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setStatus(ALL);
    setEmploymentType(ALL);
    setDepartment(ALL);
    setLocation(ALL);
    setPage(1);
  }, []);

  const retry = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const employees = data.results;
  const pageSize = DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(data.count / pageSize));
  const hasFilters =
    search !== "" ||
    status !== ALL ||
    employmentType !== ALL ||
    department !== ALL ||
    location !== ALL;

  /** Assignment fields live on the current Employment, not on Employee. */
  const assignmentFor = useCallback(
    (employeeId: string) => {
      const employment = employments?.byEmployee.get(employeeId);

      if (!employment) {
        return {
          department: EM_DASH,
          position: EM_DASH,
          employmentType: EM_DASH,
          location: EM_DASH,
        };
      }

      return {
        department: employment.department
          ? departmentNames.get(employment.department) ?? EM_DASH
          : EM_DASH,
        position: employment.position
          ? positionTitles.get(employment.position) ?? EM_DASH
          : EM_DASH,
        employmentType: humanizeEnum(employment.employment_type),
        location: locationNames.get(employment.location) ?? EM_DASH,
      };
    },
    [employments, departmentNames, positionTitles, locationNames],
  );

  const selected = employees.find((employee) => employee.id === selectedId) ?? employees[0] ?? null;
  const activeFilterCount = [status, employmentType, department, location].filter((value) => value !== ALL).length;

  // Status tiles (S015): counts straight from the scoped employee list endpoint.
  const loadCounts = useCallback(async () => {
    const count = (params: Record<string, string>) => employeesApi.listEmployees({ ...params, page_size: 1 }).then((page) => page.count);
    const [total, active, suspended, inactive, terminated] = await Promise.all([count({}), count({ status: "ACTIVE" }), count({ status: "SUSPENDED" }), count({ status: "INACTIVE" }), count({ status: "TERMINATED" })]);
    return { total, active, suspended, inactive: inactive + terminated };
  }, []);
  const { data: counts } = useApiResource(loadCounts);

  /** Wide screens preview the row beside the table; smaller screens open the record. */
  const openRow = (employee: Employee) => {
    if (window.matchMedia("(min-width: 1280px)").matches) setSelectedId(employee.id);
    else router.push(`/hr/employees/${employee.id}`);
  };

  const inviteEmployee = async () => {
    setInviting(true);
    setInviteError(null);
    try {
      const invitation = await employeesApi.inviteNewEmployeeToSelfService(inviteEmail.trim());
      setInvitationLink(`${window.location.origin}/accept-invitation/${invitation.acceptance_token}`);
    } catch (caught) {
      setInviteError(getApiErrorMessage(caught));
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Manage your team, their roles and employment records across ErgonX."
        actions={
          <>
            <Button variant="secondary" leadingIcon={<Mail className="h-4 w-4" />} onClick={() => { setInviteOpen(true); setInviteError(null); setInvitationLink(null); }}>Invite employee</Button>
            <ButtonLink href="/hr/employees/new" leadingIcon={<Plus className="h-4 w-4" />}>Add employee</ButtonLink>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Employee status">
        <MetricCard label="Total employees" value={counts ? counts.total.toLocaleString() : EM_DASH} icon={Users} accent="hr" loading={!counts} />
        <MetricCard label="Active" value={counts ? counts.active.toLocaleString() : EM_DASH} description={counts?.total ? `${Math.round((counts.active / counts.total) * 1000) / 10}% of records` : undefined} icon={UserCheck} accent="accounting" loading={!counts} />
        <MetricCard label="Suspended" value={counts ? counts.suspended.toLocaleString() : EM_DASH} icon={PauseCircle} accent="leave" loading={!counts} />
        <MetricCard label="Inactive" value={counts ? counts.inactive.toLocaleString() : EM_DASH} description="Inactive or terminated" icon={UserX} accent="audit" loading={!counts} />
      </section>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        dismissible={!inviting}
        title="Invite to Self-Service"
        description="Invite a new employee by email. They will create their account and complete their Self-Service profile."
        footer={invitationLink ? <Button onClick={() => setInviteOpen(false)}>Done</Button> : (
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)} disabled={inviting}>Cancel</Button>
            <Button disabled={!inviteEmail.trim()} loading={inviting} loadingLabel="Creating…" onClick={() => void inviteEmployee()}>Create invitation</Button>
          </>
        )}
      >
        {invitationLink ? (
          <Alert tone="success" title="Invitation created">
            <p>The email will be delivered when email delivery is enabled. You may also copy the secure link below.</p>
            <div className="mt-3 flex gap-2">
              <Input readOnly value={invitationLink} size="sm" aria-label="Invitation link" className="font-mono text-caption" />
              <Button size="sm" variant="secondary" leadingIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void navigator.clipboard.writeText(invitationLink)}>Copy</Button>
            </div>
          </Alert>
        ) : (
          <div className="space-y-4">
            <Field label="Employee email" helper="The recipient uses this email to create their Employee Self-Service account." required>
              <Input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="employee@example.com" data-autofocus />
            </Field>
            {inviteError && <Alert tone="danger">{inviteError}</Alert>}
          </div>
        )}
      </Dialog>

      <div className={cx("grid items-start gap-5", selected && "xl:grid-cols-[minmax(0,1fr)_23rem] 2xl:grid-cols-[minmax(0,1fr)_25rem]")}>
      <DataTable<Employee>
        onRowClick={openRow}
        isRowSelected={(employee) => employee.id === selected?.id}
        density="compact"
        caption="Employees"
        rows={employees}
        rowKey={(employee) => employee.id}
        loading={loading}
        error={error}
        onRetry={retry}
        minWidth={760}
        toolbar={
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-strong" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => changeSearch(event.target.value)}
                  placeholder="Search employees by name, ID or work email…"
                  aria-label="Search employees"
                  data-ui="input"
                  className="h-11 w-full rounded-lg border border-line-strong bg-surface pl-11 pr-3 text-sm text-ink-strong placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen((open) => !open)}
                aria-expanded={filtersOpen}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold text-ink-strong transition-colors hover:border-primary/50 hover:bg-surface-hover"
              >
                <Filter className="h-4 w-4" aria-hidden="true" />Filters
                {activeFilterCount > 0 && <span className="rounded-full bg-primary px-1.5 text-caption font-bold text-white tabular-nums">{activeFilterCount}</span>}
                {filtersOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
            {filtersOpen && (
              <div className="grid gap-3 rounded-xl bg-surface-muted/60 p-3 sm:grid-cols-2 xl:grid-cols-4">
                <Select size="sm" aria-label="Status" value={status} onChange={(event) => changeStatus(event.target.value)}>
                  <option value={ALL}>Status: All</option>
                  {EMPLOYEE_STATUSES.map((option) => <option key={option} value={option}>Status: {humanizeEnum(option)}</option>)}
                </Select>
                <Select size="sm" aria-label="Employment type" value={employmentType} onChange={(event) => changeEmploymentType(event.target.value)}>
                  <option value={ALL}>Type: All</option>
                  {EMPLOYMENT_TYPES.map((option) => <option key={option} value={option}>Type: {humanizeEnum(option)}</option>)}
                </Select>
                <Select size="sm" aria-label="Department / Functional Area" value={department} onChange={(event) => changeDepartment(event.target.value)}>
                  <option value={ALL}>Department: All</option>
                  {lookups.departments.map((option) => <option key={option.id} value={option.id}>Department: {option.name}</option>)}
                </Select>
                <Select size="sm" aria-label="Location" value={location} onChange={(event) => changeLocation(event.target.value)}>
                  <option value={ALL}>Location: All</option>
                  {lookups.locations.map((option) => <option key={option.id} value={option.id}>Location: {option.name}</option>)}
                </Select>
                {hasFilters && <button type="button" onClick={clearFilters} className="text-left text-support font-semibold text-primary-ink hover:underline sm:col-span-2 xl:col-span-4">Clear filters</button>}
              </div>
            )}
          </div>
        }
        empty={{
          title: "No employees found",
          description: hasFilters ? "Try changing your search or filters to find employee records." : "No employee records exist for this institution yet.",
          icon: Users,
          action: hasFilters ? <Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button> : <ButtonLink href="/hr/employees/new" size="sm" leadingIcon={<Plus className="h-4 w-4" />}>Add employee</ButtonLink>,
        }}
        footer={
          <div className="space-y-2">
            <p className="text-support text-ink-muted">Showing <span className="font-semibold text-ink-strong tabular-nums">{employees.length}</span> of <span className="font-semibold text-ink-strong tabular-nums">{data.count}</span> employees</p>
            <Pagination page={page} pageSize={pageSize} total={data.count} onPageChange={(next) => setPage(Math.min(Math.max(1, next), totalPages))} />
            {employments?.truncated && <p className="text-caption text-ink-muted">Assignment columns are resolved for the most recent employment records only.</p>}
          </div>
        }
        columns={[
          {
            key: "employee",
            header: "Employee",
            className: "max-w-[18rem]",
            cell: (employee) => {
              const name = employeesApi.employeeDisplayName(employee);
              return (
                <Link href={`/hr/employees/${employee.id}`} onClick={(event) => event.stopPropagation()} className="group flex min-w-0 items-center gap-3">
                  <Avatar name={name} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-headline group-hover:text-primary-ink">{name}</span>
                    <span className="block truncate text-caption text-ink-muted">{employee.work_email || employee.employee_number}</span>
                  </span>
                </Link>
              );
            },
          },
          { key: "department", header: "Department / Functional Area", cell: (employee) => assignmentFor(employee.id).department },
          { key: "position", header: "Position", cell: (employee) => assignmentFor(employee.id).position },
          { key: "employment", header: "Employment type", hideBelow: "lg", cell: (employee) => assignmentFor(employee.id).employmentType },
          { key: "location", header: "Location", hideBelow: "2xl", cell: (employee) => assignmentFor(employee.id).location },
          { key: "joined", header: "Joined", className: "whitespace-nowrap", sortValue: (employee) => employee.hire_date, cell: (employee) => formatDate(employee.hire_date) },
          { key: "status", header: "Status", cell: (employee) => <StatusBadge status={employee.status} size="sm" /> },
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            cell: (employee) => {
              const name = employeesApi.employeeDisplayName(employee);
              return (
                <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                  <Menu
                    label={`Actions for ${name}`}
                    trigger={(props) => <IconButton {...props} label={`Actions for ${name}`} size="sm"><MoreHorizontal className="h-4 w-4" /></IconButton>}
                  >
                    {(close) => (
                      <div className="p-1.5">
                        <MenuItem icon={<Eye />} onSelect={() => { close(); router.push(`/hr/employees/${employee.id}`); }}>View</MenuItem>
                        <MenuItem icon={<Pencil />} onSelect={() => { close(); router.push(`/hr/employees/${employee.id}?edit=true`); }}>Edit</MenuItem>
                      </div>
                    )}
                  </Menu>
                </div>
              );
            },
          },
        ]}
      />
      {selected && (
        <EmployeePreview
          employee={selected}
          employment={employments?.byEmployee.get(selected.id) ?? null}
          assignment={assignmentFor(selected.id)}
          managerName={(() => {
            // reports_to references the manager's Employment, not the Employee.
            const managerEmploymentId = employments?.byEmployee.get(selected.id)?.reports_to;
            const managerEmployment = managerEmploymentId ? [...(employments?.byEmployee.values() ?? [])].find((item) => item.id === managerEmploymentId) : undefined;
            const manager = managerEmployment ? employees.find((employee) => employee.id === managerEmployment.employee) : undefined;
            return manager ? employeesApi.employeeDisplayName(manager) : null;
          })()}
          onClose={() => setSelectedId(null)}
          closable={Boolean(selectedId)}
        />
      )}
      </div>
    </div>
  );
}

type PreviewTab = "overview" | "employment" | "contact";

/** Side preview of the selected employee (concept: Employees directory, option 2). */
function EmployeePreview({ employee, employment, assignment, managerName, onClose, closable }: {
  employee: Employee;
  employment: Employment | null;
  assignment: { department: string; position: string; employmentType: string; location: string };
  managerName: string | null;
  onClose: () => void;
  closable: boolean;
}) {
  const [tab, setTab] = useState<PreviewTab>("overview");
  const name = employeesApi.employeeDisplayName(employee);
  const profileHref = `/hr/employees/${employee.id}`;
  const show = (section: PreviewTab) => tab === "overview" || tab === section;
  return (
    <aside className="sticky top-[calc(var(--shell-topbar)+1rem)] hidden max-h-[calc(100vh-var(--shell-topbar)-2rem)] overflow-y-auto rounded-2xl border border-line bg-surface shadow-elevation-1 xl:block" aria-label={`${name} preview`}>
      <div className="relative p-5 pb-0">
        {closable && <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-muted hover:bg-surface-hover hover:text-ink-strong" aria-label="Close preview"><X className="h-5 w-5" /></button>}
        <div className="flex items-start gap-4 pr-6">
          <span className="relative">
            <Avatar name={name} size="lg" className="h-20 w-20 text-heading" />
            <span className={cx("absolute bottom-1 right-1 h-4 w-4 rounded-full ring-2 ring-surface", employee.status === "ACTIVE" ? "bg-success" : "bg-line-strong")} aria-hidden="true" />
          </span>
          <div className="min-w-0 pt-1">
            <div className="flex flex-wrap items-center gap-2"><p className="text-heading font-bold text-headline">{name}</p><StatusBadge status={employee.status} size="sm" /></div>
            <p className="mt-0.5 font-medium text-ink-strong">{assignment.position}</p>
            <p className="mt-1 text-caption text-ink-muted">{assignment.department} · Employee ID: {employee.employee_number}</p>
            <p className="text-caption text-ink-muted">Joined {formatDate(employee.hire_date)}</p>
          </div>
        </div>
        <div role="tablist" aria-label="Employee preview sections" className="mt-5 flex gap-5 border-b border-line">
          {(["overview", "employment", "contact"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={cx("relative h-10 text-sm font-semibold capitalize transition-colors", tab === value ? "text-primary-ink" : "text-ink-muted hover:text-ink-strong")}>
              {value}
              <span aria-hidden="true" className={cx("absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary", tab === value ? "opacity-100" : "opacity-0")} />
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-4 p-5">
        {show("employment") && (
          <PreviewCard title="Employment details" icon={ClipboardList} editHref={`${profileHref}?edit=true`}>
            <PreviewRow label="Department / Functional Area" value={assignment.department} />
            <PreviewRow label="Position" value={assignment.position} />
            <PreviewRow label="Employment type" value={assignment.employmentType} />
            <PreviewRow label="Location" value={assignment.location} />
            {managerName && <PreviewRow label="Manager" value={<span className="inline-flex items-center gap-2"><Avatar name={managerName} size="sm" />{managerName}</span>} />}
            <PreviewRow label="Start date" value={employment ? formatDate(employment.start_date) : formatDate(employee.hire_date)} />
          </PreviewCard>
        )}
        {show("contact") && (
          <PreviewCard title="Contact details" icon={Mail} editHref={`${profileHref}?edit=true`}>
            <PreviewRow label="Work email" value={employee.work_email ? <a href={`mailto:${employee.work_email}`} className="break-all text-primary-ink hover:underline">{employee.work_email}</a> : EM_DASH} />
            <PreviewRow label="Work phone" value={employee.phone || EM_DASH} />
            <PreviewRow label="Mobile" value={employee.mobile_phone || EM_DASH} />
            <PreviewRow label="Office" value={employee.office_location || EM_DASH} />
          </PreviewCard>
        )}
        {tab === "overview" && (
          <PreviewCard title="Status" icon={BadgeCheck} editHref={`${profileHref}?edit=true`}>
            <PreviewRow label="Employment status" value={<StatusBadge status={employee.status} size="sm" />} />
            <PreviewRow label="Last updated" value={formatDate(employee.updated_at)} />
          </PreviewCard>
        )}
        <section className="rounded-xl border border-line p-4">
          <h3 className="mb-3 flex items-center gap-2 font-bold text-headline"><Settings2 className="h-5 w-5 text-section-icon" aria-hidden="true" />Quick actions</h3>
          <div className="grid grid-cols-2 gap-2">
            <ButtonLink href={profileHref} leadingIcon={<ExternalLink className="h-4 w-4" />}>View profile</ButtonLink>
            <ButtonLink href={`${profileHref}?edit=true`} variant="secondary" leadingIcon={<Pencil className="h-4 w-4" />}>Edit employee</ButtonLink>
          </div>
        </section>
      </div>
    </aside>
  );
}

function PreviewCard({ title, icon: Icon, editHref, children }: { title: string; icon: typeof Mail; editHref: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-bold text-headline"><Icon className="h-5 w-5 text-section-icon" aria-hidden="true" />{title}</h3>
        <Link href={editHref} className="inline-flex items-center gap-1 text-support font-semibold text-primary-ink hover:underline"><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit</Link>
      </div>
      <dl className="space-y-2.5">{children}</dl>
    </section>
  );
}

function PreviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 text-support">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-ink-strong">{value}</dd>
    </div>
  );
}
