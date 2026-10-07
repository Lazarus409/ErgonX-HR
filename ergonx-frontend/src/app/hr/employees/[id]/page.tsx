"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Contact,
  FileText,
  History,
  Lock,
  LogOut,
  PauseCircle,
  PlayCircle,
  Link2,
  Mail,
  MapPin,
  MoreVertical,
  Network,
  Pencil,
  Phone,
  Printer,
  Save,
  Smartphone,
  UserCog,
  UserRound,
  Users,
  Plus,
  Trash2,
  X,
  Download,
  Upload,
  type LucideIcon,
} from "lucide-react";

import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Menu, MenuItem } from "@/components/ui/Overlay";
import { EmployeeAttendanceTab, EmployeeLeaveTab, EmployeePayrollTab } from "@/components/hr/EmployeeRecordTabs";
import { isModuleOffered } from "@/lib/product";
import { EM_DASH, formatDate, humanizeEnum } from "@/lib/format";
import { Avatar } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { employeesApi, getApiErrorMessage, organizationApi } from "@/lib/api";
import { operationsApi } from "@/lib/api";
import type { DocumentRecord } from "@/types/operations";
import type { OrganizationLookups } from "@/lib/api/organization";
import type {
  EmergencyContact as ApiEmergencyContact,
  EmployeeLifecycle,
  Employee as ApiEmployee,
  Employment,
} from "@/types/hr";
import { WEEKDAY_CODES } from "@/types/hr";
import { PrintFooter, PrintMasthead } from "@/components/brand/PrintDocument";

interface EmployeeView {
  id: string;
  employmentId: string;
  employeeNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: string;
  status: string;
  hireDate: string;
  employmentType: string;
  department: string;
  position: string;
  grade: string;
  location: string;
  manager: string;
  preferredName: string;
  mobilePhone: string;
  officeLocation: string;
  linkedinUrl: string;
  dateOfBirth: string | null;
  userLinked: boolean;
}

interface EmploymentTermsForm {
  workingPattern: string;
  workArrangement: string;
  officeDays: string[];
  timeZone: string;
  team: string;
  costCentre: string;
  probationStatus: string;
  probationEndDate: string;
  noticePeriodWeeks: string;
}

function toTermsForm(employment: Employment | undefined): EmploymentTermsForm {
  return {
    workingPattern: employment?.working_pattern ?? "FULL_TIME",
    workArrangement: employment?.work_arrangement ?? "ON_SITE",
    officeDays: employment?.office_days ?? [],
    timeZone: employment?.time_zone ?? "",
    team: employment?.team ?? "",
    costCentre: employment?.cost_centre ?? "",
    probationStatus: employment?.probation_status ?? "NOT_APPLICABLE",
    probationEndDate: employment?.probation_end_date ?? "",
    noticePeriodWeeks: employment?.notice_period_weeks != null ? String(employment.notice_period_weeks) : "",
  };
}

interface EmploymentChangeForm {
  department: string;
  position: string;
  grade: string;
  location: string;
  employmentType: string;
  effectiveDate: string;
}

interface EmergencyContactView {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  address: string;
  primary: boolean;
}

function toEmergencyContactView(contact: ApiEmergencyContact): EmergencyContactView {
  return {
    id: contact.id,
    name: contact.full_name,
    relationship: contact.relationship,
    phone: contact.phone,
    email: contact.email,
    address: contact.address,
    primary: contact.is_primary,
  };
}

const emptyLookups: OrganizationLookups = {
  departments: [],
  positions: [],
  grades: [],
  locations: [],
};

function labelFor(
  items: Array<{ id: string; name?: string; title?: string }>,
  id: string | null,
): string {
  if (!id) {
    return "Not assigned";
  }

  const item = items.find((candidate) => candidate.id === id);
  return item?.name ?? item?.title ?? "Not assigned";
}

function toEmployeeView(
  employee: ApiEmployee,
  employment: Employment | undefined,
  lookups: OrganizationLookups,
): EmployeeView {
  return {
    id: employee.id,
    employmentId: employment?.id ?? "",
    employeeNumber: employee.employee_number,
    firstName: employee.first_name,
    middleName: employee.middle_name,
    lastName: employee.last_name,
    email: employee.work_email || employee.personal_email,
    phone: employee.phone,
    gender: employee.gender
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    status: employee.status,
    hireDate: employee.hire_date,
    employmentType: employment?.employment_type ?? "Not assigned",
    department: labelFor(lookups.departments, employment?.department ?? null),
    position: labelFor(lookups.positions, employment?.position ?? null),
    grade: labelFor(lookups.grades, employment?.grade ?? null),
    location: labelFor(lookups.locations, employment?.location ?? null),
    manager: "Not assigned",
    preferredName: employee.preferred_name ?? "",
    mobilePhone: employee.mobile_phone ?? "",
    officeLocation: employee.office_location ?? "",
    linkedinUrl: employee.linkedin_url ?? "",
    dateOfBirth: employee.date_of_birth,
    userLinked: Boolean(employee.user),
  };
};


type DetailTab = "overview" | "attendance" | "leave" | "payroll" | "documents";

const ALL_DETAIL_TABS: Array<{ value: DetailTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "attendance", label: "Attendance" },
  { value: "leave", label: "Leave" },
  { value: "payroll", label: "Payroll" },
  { value: "documents", label: "Documents" },
];
const DETAIL_TABS = ALL_DETAIL_TABS.filter((item) => item.value !== "payroll" || isModuleOffered("PAYROLL"));

/** Direct status changes; termination runs through offboarding instead. */
const CHANGEABLE_STATUSES = ["ACTIVE", "SUSPENDED", "INACTIVE"] as const;

function yearsOfService(start: string): string {
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return EM_DASH;
  const now = new Date();
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months -= 1;
  if (months < 0) return "Starts soon";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [years ? `${years} year${years === 1 ? "" : "s"}` : "", rest ? `${rest} month${rest === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.join(", ") || "Less than a month";
}

function anniversariesFrom(start: string): { first: string; next: string } {
  const from = new Date(`${start}T00:00:00`);
  if (Number.isNaN(from.getTime())) return { first: start, next: start };
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const first = new Date(from); first.setFullYear(from.getFullYear() + 1);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const next = new Date(from); next.setFullYear(today.getFullYear());
  if (next < today || next <= from) next.setFullYear(next.getFullYear() + 1);
  return { first: iso(first), next: iso(next) };
}

/** Concept profile card: blue section icon, bold title, optional edit link. */
function ProfileCard({ title, icon: Icon, onEdit, badge, children }: { title: string; icon: LucideIcon; onEdit?: () => void; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-line-soft pb-4">
        <h2 className="flex items-center gap-3 text-heading font-bold text-headline"><Icon className="h-6 w-6 text-section-icon" aria-hidden="true" />{title}</h2>
        {badge}
        {onEdit && <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-ink hover:underline print:hidden"><Pencil className="h-4 w-4" aria-hidden="true" />Edit</button>}
      </div>
      {children}
    </section>
  );
}

function ProfileRow({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] items-start gap-3 text-[0.9375rem]">
      <dt className="flex items-center gap-2 text-ink-muted">{Icon && <Icon className="h-4 w-4 shrink-0 text-section-icon" aria-hidden="true" />}{label}</dt>
      <dd className="min-w-0 text-ink-strong">{value}</dd>
    </div>
  );
}

function InfoItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
        {icon}
        {label}
      </div>

      <p className="mt-2 font-medium text-ink-strong">{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
;
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-1 text-danger-ink">*</span>}
      </span>

      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  required?: boolean;
}) {
;
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-1 text-danger-ink">*</span>}
      </span>

      <select
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function LookupSelect({
  label,
  value,
  options,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-1 text-danger-ink">*</span>}
      </span>

      <select
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SectionCard({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-line bg-surface shadow-elevation-1">
      <div className="flex items-start justify-between gap-4 border-b border-line-soft px-6 py-5">
        <div className="min-w-0">
          <h2 className="text-heading font-bold text-headline">{title}</h2>

          {description && (
            <p className="mt-1 text-sm text-heading-support">{description}</p>
          )}
        </div>

        {action && (
          <div className="shrink-0">
            {action}
          </div>
        )}
      </div>

      <div className="p-6">{children}</div>
    </section>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editMode = searchParams.get("edit") === "true";
  const [employee, setEmployee] = useState<EmployeeView | null>(null);
  const [formData, setFormData] = useState<EmployeeView | null>(null);
  const [employmentHistory, setEmploymentHistory] = useState<Employment[]>([]);
  const [lookups, setLookups] = useState<OrganizationLookups>(emptyLookups);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(editMode);
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showEmploymentChange, setShowEmploymentChange] = useState(false);
  const [isRehire, setIsRehire] = useState(false);
  const [employmentChange, setEmploymentChange] =
    useState<EmploymentChangeForm | null>(null);
  const [changingEmployment, setChangingEmployment] = useState(false);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContactView[]>([]);
  const [showEmergencyForm, setShowEmergencyForm] = useState(false);
  const [editingEmergencyId, setEditingEmergencyId] = useState<string | null>(null);
  const [emergencyForm, setEmergencyForm] = useState({
    name: "",
    relationship: "",
    phone: "",
    email: "",
    address: "",
    primary: false,
  });
  const [lifecycle, setLifecycle] = useState<EmployeeLifecycle | null>(null);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentProgress, setDocumentProgress] = useState(0);
  const [documentActionId, setDocumentActionId] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [manager, setManager] = useState<{ id: string; name: string; title: string } | null>(null);
  const [termsForm, setTermsForm] = useState<EmploymentTermsForm>(() => toTermsForm(undefined));

  const updateField = (field: keyof EmployeeView, value: string) => {
    setFormData((current) => ({
      ...(current as EmployeeView),
      [field]: value,
    }));
  };

  useEffect(() => {
    let active = true;

    async function loadEmployee() {
      setLoading(true);
      setLoadError(null);

      try {
        const [record, history, referenceData, contacts, lifecycleData, documentData] = await Promise.all([
          employeesApi.getEmployee(params.id),
          employeesApi.listEmploymentHistory(params.id),
          organizationApi.loadOrganizationLookups(),
          employeesApi.listEmergencyContacts(params.id),
          employeesApi.getEmployeeLifecycle(params.id),
          operationsApi.listDocuments({ entity_type: "employees.Employee", entity_id: params.id, is_active: true, page_size: 100 }),
        ]);
        const currentEmployment = history.results.find(
          (employment) => employment.is_current,
        );

        if (!active) {
          return;
        }

        const view = toEmployeeView(record, currentEmployment, referenceData);
        setEmployee(view);
        setFormData(view);
        setEmploymentHistory(history.results);
        setLookups(referenceData);
        setEmergencyContacts(contacts.results.map(toEmergencyContactView));
        setLifecycle(lifecycleData);
        setDocuments(documentData.results);
        setDocumentsError(null);
      } catch (caught) {
        if (active) {
          setLoadError(getApiErrorMessage(caught));
          setDocumentsError(getApiErrorMessage(caught));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadEmployee();

    return () => {
      active = false;
    };
  }, [params.id]);

  const reportsTo = employmentHistory.find((employment) => employment.is_current)?.reports_to ?? null;
  useEffect(() => {
    if (!reportsTo) return;
    let active = true;
    employeesApi.getEmployment(reportsTo)
      .then(async (managerEmployment) => {
        const record = await employeesApi.getEmployee(managerEmployment.employee);
        if (!active) return;
        setManager({ id: record.id, name: employeesApi.employeeDisplayName(record), title: labelFor(lookups.positions, managerEmployment.position) });
      })
      .catch(() => { if (active) setManager(null); });
    return () => { active = false; };
  }, [reportsTo, lookups.positions]);

  const uploadEmployeeDocument = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > operationsApi.MAX_DOCUMENT_BYTES) {
      setDocumentsError("Employee documents must be 25 MB or smaller.");
      return;
    }
    setDocumentUploading(true);
    setDocumentProgress(0);
    setDocumentsError(null);
    try {
      const uploaded = await operationsApi.uploadDocument(
        file,
        { category: "EMPLOYEE_DOCUMENT", classification: "CONFIDENTIAL", entity_type: "employees.Employee", entity_id: params.id },
        setDocumentProgress,
      );
      setDocuments((current) => [uploaded, ...current]);
    } catch (caught) {
      setDocumentsError(getApiErrorMessage(caught));
    } finally {
      setDocumentUploading(false);
    }
  };

  const downloadEmployeeDocument = async (document: DocumentRecord) => {
    try {
      const blob = await operationsApi.downloadDocument(document.id);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.original_filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setDocumentsError(getApiErrorMessage(caught));
    }
  };

  const deactivateEmployeeDocument = async (document: DocumentRecord) => {
    if (!window.confirm(`Deactivate ${document.original_filename}? It will remain in history but no longer be active.`)) return;
    setDocumentActionId(document.id);
    setDocumentsError(null);
    try {
      await operationsApi.deactivateDocument(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (caught) {
      setDocumentsError(getApiErrorMessage(caught));
    } finally {
      setDocumentActionId(null);
    }
  };

  const startEditing = () => {
    if (!employee) return;
    setFormData(employee);
    setTermsForm(toTermsForm(employmentHistory.find((employment) => employment.is_current)));
    setSavedMessage("");
    setSaveError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setFormData(employee);
    setSavedMessage("");
    setSaveError(null);
    setShowSaveConfirmation(false);
    setIsEditing(false);
  };

  const requestSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowSaveConfirmation(true);
  };

  const confirmSave = async () => {
    if (!formData || saving) return;

    setSaving(true);

    try {
      const updated = await employeesApi.updateEmployee(formData.id, {
        first_name: formData.firstName.trim(),
        middle_name: formData.middleName.trim(),
        last_name: formData.lastName.trim(),
        work_email: formData.email.trim(),
        phone: formData.phone.trim(),
        preferred_name: formData.preferredName.trim(),
        mobile_phone: formData.mobilePhone.trim(),
        office_location: formData.officeLocation.trim(),
        linkedin_url: formData.linkedinUrl.trim(),
        gender: formData.gender
          .toUpperCase()
          .replace(/\s+/g, "_"),
        hire_date: formData.hireDate,
      });
      let currentEmployment = employmentHistory.find(
        (employment) => employment.is_current,
      );
      if (currentEmployment) {
        const savedTerms = await employeesApi.updateEmployment(currentEmployment.id, {
          working_pattern: termsForm.workingPattern,
          work_arrangement: termsForm.workArrangement,
          office_days: termsForm.officeDays,
          time_zone: termsForm.timeZone.trim(),
          team: termsForm.team.trim(),
          cost_centre: termsForm.costCentre.trim(),
          probation_status: termsForm.probationStatus,
          probation_end_date: termsForm.probationEndDate || null,
          notice_period_weeks: termsForm.noticePeriodWeeks ? Number(termsForm.noticePeriodWeeks) : null,
        });
        currentEmployment = savedTerms;
        setEmploymentHistory((history) => history.map((employment) => (employment.id === savedTerms.id ? savedTerms : employment)));
      }
      const view = toEmployeeView(updated, currentEmployment, lookups);

      setEmployee(view);
      setFormData(view);
      setShowSaveConfirmation(false);
      setIsEditing(false);
      setSavedMessage("Employee profile details saved.");
    } catch (caught) {
      setShowSaveConfirmation(false);
      setSaveError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const currentEmployment = employmentHistory.find(
    (employment) => employment.is_current,
  );

  const confirmStatusChange = async () => {
    if (!employee || !pendingStatus || statusSaving) return;
    setStatusSaving(true);
    setSaveError(null);
    try {
      const updated = await employeesApi.updateEmployee(employee.id, { status: pendingStatus });
      const view = toEmployeeView(updated, currentEmployment, lookups);
      setEmployee(view);
      setFormData(view);
      setSavedMessage(`Employee status changed to ${humanizeEnum(pendingStatus)}.`);
    } catch (caught) {
      setSaveError(getApiErrorMessage(caught));
    } finally {
      setStatusSaving(false);
      setPendingStatus(null);
    }
  };

  const openEmploymentChange = () => {
    setSavedMessage("");
    setSaveError(null);
    setEmploymentChange({
      department: currentEmployment?.department ?? "",
      position: currentEmployment?.position ?? "",
      grade: currentEmployment?.grade ?? "",
      location: currentEmployment?.location ?? "",
      employmentType: currentEmployment?.employment_type ?? "",
      effectiveDate: "",
    });
    setIsRehire(employee?.status === "TERMINATED" || employee?.status === "INACTIVE");
    setShowEmploymentChange(true);
  };

  const updateEmploymentChange = (
    field: keyof EmploymentChangeForm,
    value: string,
  ) => {
    setEmploymentChange((current) =>
      current ? { ...current, [field]: value } : current,
    );
  };

  const saveEmploymentChange = async () => {
    if (!employee || !employmentChange || changingEmployment) {
      return;
    }

    if (
      !employmentChange.grade ||
      !employmentChange.location ||
      !employmentChange.employmentType ||
      !employmentChange.effectiveDate
      || (isRehire && (!employmentChange.department || !employmentChange.position))
    ) {
      setSaveError(
        "Effective date, department / functional area, position, grade, location, and employment type are required for rehire.",
      );
      return;
    }

    setChangingEmployment(true);
    setSaveError(null);

    try {
      const created = isRehire ? (await employeesApi.rehireEmployee(employee.id, {
        department_id: employmentChange.department,
        position_id: employmentChange.position,
        grade_id: employmentChange.grade,
        location_id: employmentChange.location,
        employment_type: employmentChange.employmentType,
        staff_category: currentEmployment?.staff_category ?? "OTHER",
        start_date: employmentChange.effectiveDate,
      })).employment : await employeesApi.createEmployment({
        employee: employee.id,
        department: employmentChange.department || null,
        position: employmentChange.position || null,
        grade: employmentChange.grade,
        location: employmentChange.location,
        employment_type: employmentChange.employmentType,
        reports_to: currentEmployment?.reports_to ?? null,
        staff_category: currentEmployment?.staff_category ?? "OTHER",
        start_date: employmentChange.effectiveDate,
      });
      const [profile, history] = await Promise.all([
        employeesApi.getEmployee(employee.id),
        employeesApi.listEmploymentHistory(employee.id),
      ]);
      const view = toEmployeeView(profile, created, lookups);

      setEmploymentHistory(history.results);
      setEmployee(view);
      setFormData(view);
      setShowEmploymentChange(false);
      setEmploymentChange(null);
      setSavedMessage(isRehire ? "Employee rehired and onboarding started." : "Employment assignment changed and prior history preserved.");
    } catch (caught) {
      setSaveError(getApiErrorMessage(caught));
    } finally {
      setChangingEmployment(false);
    }
  };

  const resetEmergencyForm = () => {
    setEmergencyForm({
      name: "",
      relationship: "",
      phone: "",
      email: "",
      address: "",
    primary: false,
    });
    setEditingEmergencyId(null);
    setShowEmergencyForm(false);
  };

  const openAddEmergencyForm = () => {
    setEmergencyForm({
      name: "",
      relationship: "",
      phone: "",
      email: "",
      address: "",
    primary: false,
    });
    setEditingEmergencyId(null);
    setShowEmergencyForm(true);
  };

  const openEditEmergencyForm = (
    contact: (typeof emergencyContacts)[number]
  ) => {
    setEmergencyForm({
      name: contact.name,
      relationship: contact.relationship,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      primary: contact.primary,
    });
    setEditingEmergencyId(contact.id);
    setShowEmergencyForm(true);
  };

  const saveEmergencyContact = async () => {
    if (
      !emergencyForm.name.trim() ||
      !emergencyForm.relationship.trim() ||
      !emergencyForm.phone.trim() ||
      !employee
    ) {
      return;
    }

    setSaveError(null);
    try {
      const payload = {
        employee: employee.id,
        full_name: emergencyForm.name.trim(),
        relationship: emergencyForm.relationship.trim(),
        phone: emergencyForm.phone.trim(),
        email: emergencyForm.email.trim(),
        address: emergencyForm.address.trim(),
        is_primary: emergencyForm.primary,
      };

      if (editingEmergencyId) {
        await employeesApi.updateEmergencyContact(editingEmergencyId, payload);
      } else {
        await employeesApi.createEmergencyContact(payload);
      }

      const contacts = await employeesApi.listEmergencyContacts(employee.id);
      setEmergencyContacts(contacts.results.map(toEmergencyContactView));
      resetEmergencyForm();
      setSavedMessage("Emergency contact saved.");
    } catch (caught) {
      setSaveError(getApiErrorMessage(caught));
    }
  };

  const deleteEmergencyContact = async (id: string) => {
    if (
      !window.confirm(
        "Are you sure you want to delete this emergency contact?"
      )
    ) {
      return;
    }

    try {
      await employeesApi.deleteEmergencyContact(id);
      setEmergencyContacts((contacts) => contacts.filter((contact) => contact.id !== id));
      setSavedMessage("Emergency contact removed.");
    } catch (caught) {
      setSaveError(getApiErrorMessage(caught));
    }
  };

  const runLifecycleAction = async (
    action: "onboarding-start" | "onboarding-complete" | "offboarding-start" | "offboarding-complete",
  ) => {
    if (!employee || lifecycleSaving) return;

    const isOffboardingCompletion = action === "offboarding-complete";
    if (isOffboardingCompletion && !window.confirm("Complete offboarding? This ends the employee's current employment and deactivates their membership in this institution.")) {
      return;
    }

    setLifecycleSaving(true);
    setSaveError(null);
    try {
      if (action === "onboarding-start") await employeesApi.startEmployeeOnboarding(employee.id);
      if (action === "onboarding-complete") await employeesApi.completeEmployeeOnboarding(employee.id);
      if (action === "offboarding-start") await employeesApi.startEmployeeOffboarding(employee.id);
      if (action === "offboarding-complete") await employeesApi.completeEmployeeOffboarding(employee.id);

      const [nextLifecycle, nextEmployee, history] = await Promise.all([
        employeesApi.getEmployeeLifecycle(employee.id),
        employeesApi.getEmployee(employee.id),
        employeesApi.listEmploymentHistory(employee.id),
      ]);
      const current = history.results.find((employment) => employment.is_current);
      const view = toEmployeeView(nextEmployee, current, lookups);
      setLifecycle(nextLifecycle);
      setEmploymentHistory(history.results);
      setEmployee(view);
      setFormData(view);
      setSavedMessage("Employee lifecycle updated.");
    } catch (caught) {
      setSaveError(getApiErrorMessage(caught));
    } finally {
      setLifecycleSaving(false);
    }
  };

  if (loading) {
    return <LoadingState />;
  }

  if (loadError) {
    return (
      <ErrorState
        title="Unable to load employee"
        message={loadError}
      />
    );
  }

  if (!employee || !formData) {
    return <ErrorState message="The employee record could not be found." />;
  }

  const fullName = [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(" ");
  const serviceStart = employee.hireDate;
  const anniversaries = anniversariesFrom(serviceStart);
  const primaryContact = emergencyContacts.find((contact) => contact.primary) ?? emergencyContacts[0] ?? null;

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={pendingStatus !== null}
        title={`Change status to ${humanizeEnum(pendingStatus ?? "")}?`}
        description={`${fullName}'s employee status will change from ${humanizeEnum(employee.status)} to ${humanizeEnum(pendingStatus ?? "")}. The change is recorded in the audit trail.`}
        confirmLabel="Change status"
        destructive={pendingStatus === "SUSPENDED" || pendingStatus === "INACTIVE"}
        loading={statusSaving}
        onConfirm={() => void confirmStatusChange()}
        onCancel={() => setPendingStatus(null)}
      />
      <PrintMasthead documentTitle="Employee record" reference={employee.employeeNumber} />

      {savedMessage && (
        <div className="rounded-xl border border-success/25 bg-success-soft px-4 py-3 text-sm text-success-ink">
          {savedMessage}
        </div>
      )}

      {saveError && (
        <ErrorState title="Unable to save employee" message={saveError} />
      )}

      {showEmploymentChange && employmentChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl">
            <h2 className="text-lg font-bold text-headline">
              Change Employment Assignment
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              This creates a new current employment record from the effective
              date. The backend closes the prior assignment and retains the
              complete history.
            </p>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <Field
                label="Effective Date"
                type="date"
                value={employmentChange.effectiveDate}
                required
                onChange={(value) => updateEmploymentChange("effectiveDate", value)}
              />

              <LookupSelect
                label="Employment Type"
                value={employmentChange.employmentType}
                required
                options={[
                  { value: "PERMANENT", label: "Permanent" },
                  { value: "CONTRACT", label: "Contract" },
                  { value: "TEMPORARY", label: "Temporary" },
                  { value: "INTERN", label: "Intern" },
                  { value: "CASUAL", label: "Casual" },
                ]}
                onChange={(value) => updateEmploymentChange("employmentType", value)}
              />

              <LookupSelect
                label="Department / Functional Area"
                value={employmentChange.department}
                options={lookups.departments.map((department) => ({
                  value: department.id,
                  label: department.name,
                }))}
                onChange={(value) => {
                  updateEmploymentChange("department", value);
                  updateEmploymentChange("position", "");
                }}
              />

              <LookupSelect
                label="Position"
                value={employmentChange.position}
                options={lookups.positions
                  .filter(
                    (position) =>
                      !employmentChange.department ||
                      position.department === employmentChange.department,
                  )
                  .map((position) => ({
                    value: position.id,
                    label: position.title,
                  }))}
                onChange={(value) => updateEmploymentChange("position", value)}
              />

              <LookupSelect
                label="Grade"
                value={employmentChange.grade}
                required
                options={lookups.grades.map((grade) => ({
                  value: grade.id,
                  label: grade.name,
                }))}
                onChange={(value) => updateEmploymentChange("grade", value)}
              />

              <LookupSelect
                label="Location"
                value={employmentChange.location}
                required
                options={lookups.locations.map((location) => ({
                  value: location.id,
                  label: location.name,
                }))}
                onChange={(value) => updateEmploymentChange("location", value)}
              />
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowEmploymentChange(false);
                  setEmploymentChange(null);
                }}
                disabled={changingEmployment}
                className={buttonClasses({ variant: "secondary" })}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveEmploymentChange()}
                disabled={changingEmployment}
                className={buttonClasses({ variant: "primary" })}
              >
                <Save className="h-4 w-4" />
                {changingEmployment ? "Saving..." : "Confirm Change"}
              </button>
            </div>
          </div>
        </div>
      )}

      <nav aria-label="Breadcrumb" className="print:hidden">
        <ol className="flex flex-wrap items-center gap-1.5 text-support">
          <li><Link href="/hr" className="font-medium text-primary-ink hover:underline">Employees</Link></li>
          <li aria-hidden="true" className="text-ink-subtle"><ChevronRight className="h-4 w-4" /></li>
          <li><Link href="/hr/employees" className="font-medium text-primary-ink hover:underline">Employee Directory</Link></li>
          <li aria-hidden="true" className="text-ink-subtle"><ChevronRight className="h-4 w-4" /></li>
          <li aria-current="page" className="font-medium text-ink-strong">{fullName}</li>
        </ol>
      </nav>

      <header className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar name={fullName} size="lg" className="h-28 w-28 text-title shadow-elevation-2 ring-4 ring-surface sm:h-36 sm:w-36" />
          <div className="min-w-0">
            <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-headline sm:text-[2.5rem]">{fullName}</h1>
            <p className="mt-1 text-heading font-medium text-ink-strong">{employee.position}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.9375rem] text-ink">
              <span className="inline-flex items-center gap-2"><Building2 className="h-5 w-5 text-section-icon" aria-hidden="true" />{employee.department}</span>
              <span className="inline-flex items-center gap-2"><MapPin className="h-5 w-5 text-section-icon" aria-hidden="true" />{employee.location}</span>
              <span className="inline-flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5 text-section-icon" aria-hidden="true" />{currentEmployment ? humanizeEnum(currentEmployment.working_pattern) : "Not assigned"}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={employee.status} />
              {currentEmployment && <span className="rounded-full bg-primary-soft px-3 py-1 text-support font-semibold text-primary-ink">{humanizeEnum(currentEmployment.employment_type)}</span>}
              <span className="rounded-full bg-surface-muted px-3 py-1 text-support font-medium text-ink-muted">Employee ID: {employee.employeeNumber}</span>
            </div>
          </div>
        </div>

        {!isEditing && (
          <div className="flex flex-col items-start gap-5 xl:items-end">
            <div className="flex flex-wrap items-center gap-2.5 print:hidden">
              <Button size="lg" onClick={startEditing} leadingIcon={<Pencil className="h-4 w-4" />}>Edit</Button>
              <Menu
                label="More employee actions"
                trigger={(props) => <Button {...props} size="lg" variant="secondary" leadingIcon={<MoreVertical className="h-4 w-4" />}>More</Button>}
              >
                {(close) => {
                  // Concept "Record actions and lifecycle states": the menu adapts to the record's state.
                  const terminated = employee.status === "TERMINATED";
                  const offboarding = lifecycle?.offboarding?.status === "IN_PROGRESS";
                  return (
                    <div className="p-1.5">
                      <MenuItem icon={<Pencil />} disabled={terminated} description={terminated ? "Terminated records are read-only" : undefined} onSelect={() => { close(); startEditing(); }}>Edit</MenuItem>
                      {employee.status !== "ACTIVE" && !terminated && <MenuItem icon={<PlayCircle />} onSelect={() => { close(); setPendingStatus("ACTIVE"); }}>Activate</MenuItem>}
                      {employee.status === "ACTIVE" && <MenuItem icon={<PauseCircle />} onSelect={() => { close(); setPendingStatus("INACTIVE"); }}>Deactivate</MenuItem>}
                      <MenuItem icon={<LogOut />} disabled={terminated || offboarding} description={offboarding ? "Offboarding already in progress" : undefined} onSelect={() => { close(); void runLifecycleAction("offboarding-start"); }}>Offboard</MenuItem>
                      <div className="my-1 border-t border-line-soft" />
                      <MenuItem icon={<BriefcaseBusiness />} disabled={terminated} onSelect={() => { close(); openEmploymentChange(); }}>Change assignment</MenuItem>
                      <MenuItem icon={<UserCog />} onSelect={() => { close(); setTab("overview"); window.setTimeout(() => document.getElementById("onboarding-offboarding")?.scrollIntoView({ behavior: "smooth" }), 0); }}>Onboarding &amp; offboarding</MenuItem>
                      <div className="my-1 border-t border-line-soft" />
                      <MenuItem icon={<History />} onSelect={() => { close(); router.push(`/records/employee/${employee.id}`); }}>View history</MenuItem>
                      <MenuItem icon={<Printer />} onSelect={() => { close(); window.print(); }}>Export / print record</MenuItem>
                    </div>
                  );
                }}
              </Menu>
              <Menu
                label="Change employee status"
                trigger={(props) => <Button {...props} size="lg" variant="secondary" leadingIcon={<UserRound className="h-4 w-4" />} trailingIcon={<ChevronDown className="h-4 w-4" />}>Change Status</Button>}
              >
                {(close) => (
                  <div className="p-1.5">
                    {CHANGEABLE_STATUSES.map((status) => (
                      <MenuItem key={status} disabled={employee.status === status} onSelect={() => { close(); setPendingStatus(status); }}>
                        {humanizeEnum(status)}{employee.status === status ? " (current)" : ""}
                      </MenuItem>
                    ))}
                    <p className="px-3 pb-2 pt-1 text-caption text-ink-muted">Termination is completed through offboarding.</p>
                  </div>
                )}
              </Menu>
            </div>
            <blockquote className="hidden max-w-xs text-right xl:block">
              <p className="text-[1.0625rem] italic leading-7 text-ink-muted">&ldquo;Great people make brighter workplaces.&rdquo;</p>
              <span aria-hidden="true" className="ml-auto mt-3 block h-1 w-14 rounded-full bg-accent-aqua" />
            </blockquote>
          </div>
        )}
      </header>

      {!isEditing && (
        <>
          <div role="tablist" aria-label="Employee record sections" className="flex gap-8 overflow-x-auto border-b border-line print:hidden">
            {DETAIL_TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={tab === item.value}
                onClick={() => setTab(item.value)}
                className={`relative h-12 shrink-0 text-[1.0625rem] font-semibold transition-colors ${tab === item.value ? "text-primary-ink" : "text-ink-muted hover:text-ink-strong"}`}
              >
                {item.label}
                <span aria-hidden="true" className={`absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-primary transition-opacity ${tab === item.value ? "opacity-100" : "opacity-0"}`} />
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <>
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                <div className="space-y-5">
                  <ProfileCard title="About" icon={UserRound}>
                    <div className="grid gap-x-10 gap-y-3 md:grid-cols-2">
                      <dl className="space-y-3">
                        <ProfileRow label="Full name" value={fullName} />
                        <ProfileRow label="Preferred name" value={employee.preferredName || EM_DASH} />
                        <ProfileRow label="Date of birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : EM_DASH} />
                        <ProfileRow label="Gender" value={employee.gender} />
                        <ProfileRow label="Start date" value={formatDate(serviceStart)} />
                        <ProfileRow label="Years of service" value={yearsOfService(serviceStart)} />
                      </dl>
                      <dl className="space-y-3">
                        <ProfileRow label="Employment type" value={currentEmployment ? humanizeEnum(currentEmployment.employment_type) : EM_DASH} />
                        <ProfileRow label="Working pattern" value={currentEmployment ? humanizeEnum(currentEmployment.working_pattern) : EM_DASH} />
                        <ProfileRow label="Department / Functional Area" value={employee.department} />
                        <ProfileRow label="Job title" value={employee.position} />
                        <ProfileRow label="Reports to" value={manager ? <span><Link href={`/hr/employees/${manager.id}`} className="font-medium text-primary-ink hover:underline">{manager.name}</Link><span className="block text-caption text-ink-muted">{manager.title}</span></span> : EM_DASH} />
                        <ProfileRow label="Location" value={employee.location} />
                        <ProfileRow label="Cost centre" value={currentEmployment?.cost_centre || EM_DASH} />
                      </dl>
                    </div>
                  </ProfileCard>

                  <ProfileCard title="Contact Details" icon={Phone} onEdit={startEditing}>
                    <div className="grid gap-x-10 gap-y-3 md:grid-cols-2">
                      <dl className="space-y-3">
                        <ProfileRow icon={Mail} label="Work email" value={employee.email ? <a href={`mailto:${employee.email}`} className="break-all text-primary-ink hover:underline">{employee.email}</a> : EM_DASH} />
                        <ProfileRow icon={Phone} label="Work phone" value={employee.phone || EM_DASH} />
                        <ProfileRow icon={Smartphone} label="Mobile" value={employee.mobilePhone || EM_DASH} />
                      </dl>
                      <dl className="space-y-3">
                        <ProfileRow icon={MapPin} label="Office location" value={employee.officeLocation || EM_DASH} />
                        <ProfileRow icon={Link2} label="LinkedIn" value={employee.linkedinUrl ? <a href={employee.linkedinUrl} target="_blank" rel="noreferrer" className="break-all text-primary-ink hover:underline">{employee.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")}</a> : EM_DASH} />
                      </dl>
                    </div>
                  </ProfileCard>

                  <ProfileCard title="Emergency Contact" icon={Contact} onEdit={() => document.getElementById("emergency-contacts")?.scrollIntoView({ behavior: "smooth" })}>
                    {primaryContact ? (
                      <div className="grid gap-x-10 gap-y-3 md:grid-cols-2">
                        <dl className="space-y-3">
                          <ProfileRow label="Name" value={primaryContact.name} />
                          <ProfileRow label="Relationship" value={primaryContact.relationship} />
                        </dl>
                        <dl className="space-y-3">
                          <ProfileRow icon={Phone} label="Phone" value={primaryContact.phone} />
                          <ProfileRow icon={Mail} label="Email" value={primaryContact.email ? <a href={`mailto:${primaryContact.email}`} className="break-all text-primary-ink hover:underline">{primaryContact.email}</a> : EM_DASH} />
                        </dl>
                      </div>
                    ) : (
                      <p className="text-support text-ink-muted">No emergency contact recorded. Add one in the emergency contacts section below.</p>
                    )}
                  </ProfileCard>
                </div>

                <div className="space-y-5">
                  <ProfileCard title="Record Lifecycle" icon={History} badge={<StatusBadge status={employee.status} size="sm" />}>
                    <p className="flex gap-2 rounded-lg bg-success-soft/60 px-3 py-2 text-caption text-ink">{employee.status === "TERMINATED" ? <Lock className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" /> : null}This employee record is retained for payroll, attendance, leave and audit history, even after deactivation or exit, in line with the data retention policy.</p>
                    <ol className="mt-3 space-y-3 border-l-2 border-line-soft pl-4 text-sm">
                      {lifecycle?.offboarding && lifecycle.offboarding.status !== "NOT_STARTED" && <li className="relative"><span aria-hidden="true" className="absolute -left-[1.4rem] top-1 h-3 w-3 rounded-full bg-warning" /><span className="font-semibold">Offboarding</span> <span className="text-ink-muted">{humanizeEnum(lifecycle.offboarding.status)}</span></li>}
                      <li className="relative"><span aria-hidden="true" className="absolute -left-[1.4rem] top-1 h-3 w-3 rounded-full bg-success" /><span className="font-semibold">{humanizeEnum(employee.status)}</span> <span className="text-ink-muted">{formatDate(serviceStart)} – Present</span><span className="block text-caption text-ink-muted">Employee is currently {humanizeEnum(employee.status).toLowerCase()}</span></li>
                      <li className="relative"><span aria-hidden="true" className="absolute -left-[1.4rem] top-1 h-3 w-3 rounded-full bg-ink-subtle" /><span className="font-semibold">Hired</span> <span className="text-ink-muted">{formatDate(serviceStart)}</span><span className="block text-caption text-ink-muted">Employee record created</span></li>
                    </ol>
                    <Link href={`/records/employee/${employee.id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline">View full history<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
                  </ProfileCard>

                  <ProfileCard title="Employment Status" icon={UserRound} badge={<StatusBadge status={employee.status} size="sm" />}>
                    <dl className="space-y-3">
                      <ProfileRow label="Status" value={humanizeEnum(employee.status)} />
                      <ProfileRow label="Employment type" value={currentEmployment ? humanizeEnum(currentEmployment.employment_type) : EM_DASH} />
                      <ProfileRow label="Start date" value={formatDate(serviceStart)} />
                      <ProfileRow label="Probation" value={currentEmployment ? `${humanizeEnum(currentEmployment.probation_status)}${currentEmployment.probation_end_date ? ` · ${formatDate(currentEmployment.probation_end_date)}` : ""}` : EM_DASH} />
                      <ProfileRow label="Notice period" value={currentEmployment?.notice_period_weeks != null ? `${currentEmployment.notice_period_weeks} week${currentEmployment.notice_period_weeks === 1 ? "" : "s"}` : EM_DASH} />
                      <ProfileRow label="System account" value={employee.userLinked ? "Linked" : "Not linked"} />
                    </dl>
                  </ProfileCard>

                  <ProfileCard title="Reporting & Team" icon={Network}>
                    <dl className="space-y-3">
                      <ProfileRow label="Manager" value={manager ? <span className="flex items-center gap-2.5"><Avatar name={manager.name} size="md" /><span><Link href={`/hr/employees/${manager.id}`} className="font-medium text-primary-ink hover:underline">{manager.name}</Link><span className="block text-caption text-ink-muted">{manager.title}</span></span></span> : EM_DASH} />
                      <ProfileRow label="Department / Functional Area" value={employee.department} />
                      <ProfileRow label="Team" value={currentEmployment?.team || EM_DASH} />
                    </dl>
                  </ProfileCard>

                  <ProfileCard title="Work Location" icon={MapPin}>
                    <dl className="space-y-3">
                      <ProfileRow label="Primary location" value={employee.location} />
                      <ProfileRow label="Work arrangement" value={currentEmployment ? humanizeEnum(currentEmployment.work_arrangement) : EM_DASH} />
                      <ProfileRow label="Office days" value={currentEmployment?.office_days.length ? currentEmployment.office_days.map((day) => day.charAt(0) + day.slice(1).toLowerCase()).join(" · ") : EM_DASH} />
                      <ProfileRow label="Time zone" value={currentEmployment?.time_zone || EM_DASH} />
                    </dl>
                  </ProfileCard>

                  <ProfileCard title="Important Dates" icon={CalendarDays}>
                    <dl className="space-y-3">
                      <ProfileRow label="Start date" value={formatDate(serviceStart)} />
                      <ProfileRow label="Work anniversary" value={formatDate(anniversaries.first)} />
                      <ProfileRow label="Next anniversary" value={formatDate(anniversaries.next)} />
                    </dl>
                  </ProfileCard>
                </div>
              </div>

          <SectionCard
            id="employment-history"
            title="Employment History"
            description="Historical employment assignments are preserved and are not overwritten."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-ink-muted">
                    <th className="px-4 py-3 font-medium">Department / Functional Area</th>
                    <th className="px-4 py-3 font-medium">Position</th>
                    <th className="px-4 py-3 font-medium">Grade</th>
                    <th className="px-4 py-3 font-medium">Location</th>
                    <th className="px-4 py-3 font-medium">Start Date</th>
                    <th className="px-4 py-3 font-medium">End Date</th>
                  </tr>
                </thead>

                <tbody>
                  {employmentHistory.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-ink-muted">
                        No employment history is available.
                      </td>
                    </tr>
                  ) : (
                    employmentHistory.map((employment) => (
                      <tr key={employment.id} className="border-b border-line-soft">
                        <td className="px-4 py-4">
                          {labelFor(lookups.departments, employment.department)}
                        </td>
                        <td className="px-4 py-4">
                          {labelFor(lookups.positions, employment.position)}
                        </td>
                        <td className="px-4 py-4">
                          {labelFor(lookups.grades, employment.grade)}
                        </td>
                        <td className="px-4 py-4">
                          {labelFor(lookups.locations, employment.location)}
                        </td>
                        <td className="px-4 py-4">
                          {new Date(employment.start_date).toLocaleDateString("en-GB")}
                        </td>
                        <td className="px-4 py-4 text-ink-muted">
                          {employment.is_current
                            ? "Current"
                            : employment.end_date
                              ? new Date(employment.end_date).toLocaleDateString("en-GB")
                              : "Not recorded"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard
            id="emergency-contacts"
            title="Emergency Contacts"
            description="Emergency contact records for this employee."
            action={
              <button
                type="button"
                onClick={openAddEmergencyForm}
                className={buttonClasses({ variant: "primary" })}
              >
                <Plus className="h-4 w-4" />
                Add Contact
              </button>
            }
          >
            {showEmergencyForm && (
              <div className="mb-6 rounded-xl border border-line bg-surface-muted p-5">
                <div className="mb-5">
                  <h3 className="text-sm font-semibold text-ink-strong">
                    {editingEmergencyId
                      ? "Edit Emergency Contact"
                      : "Add Emergency Contact"}
                  </h3>

                  <p className="mt-1 text-xs text-ink-muted">
                    Enter the contact details for this employee.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink">
                      Full Name
                    </label>

                    <input
                      value={emergencyForm.name}
                      onChange={(event) =>
                        setEmergencyForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Enter full name"
                      className="w-full h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-ink">
                      Address
                    </label>

                    <input
                      value={emergencyForm.address}
                      onChange={(event) =>
                        setEmergencyForm((current) => ({
                          ...current,
                          address: event.target.value,
                        }))
                      }
                      placeholder="Optional residential address"
                      className="w-full h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink">
                      Relationship
                    </label>

                    <input
                      value={emergencyForm.relationship}
                      onChange={(event) =>
                        setEmergencyForm((current) => ({
                          ...current,
                          relationship: event.target.value,
                        }))
                      }
                      placeholder="e.g. Parent, Spouse, Brother"
                      className="w-full h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink">
                      Phone Number
                    </label>

                    <input
                      type="tel"
                      value={emergencyForm.phone}
                      onChange={(event) =>
                        setEmergencyForm((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                      placeholder="+233..."
                      className="w-full h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink">
                      Email
                    </label>

                    <input
                      type="email"
                      value={emergencyForm.email}
                      onChange={(event) =>
                        setEmergencyForm((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      placeholder="contact@example.com"
                      className="w-full h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                  </div>

                  <label className="flex items-center gap-3 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={emergencyForm.primary}
                      onChange={(event) =>
                        setEmergencyForm((current) => ({
                          ...current,
                          primary: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-line-strong"
                    />

                    <span className="text-sm text-ink">
                      Set as primary emergency contact
                    </span>
                  </label>
                </div>

                <div className="mt-5 flex justify-end gap-3 border-t border-line pt-4">
                  <button
                    type="button"
                    onClick={resetEmergencyForm}
                    className={buttonClasses({ variant: "secondary" })}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => void saveEmergencyContact()}
                    className={buttonClasses({ variant: "primary" })}
                  >
                    {editingEmergencyId ? "Save Changes" : "Add Contact"}
                  </button>
                </div>
              </div>
            )}

            {emergencyContacts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line-strong p-8 text-center">
                <Users className="mx-auto h-9 w-9 text-ink-subtle" />

                <p className="mt-3 font-medium text-ink-strong">
                  No emergency contacts
                </p>

                <p className="mt-1 text-sm text-ink-muted">
                  Add an emergency contact for this employee.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {emergencyContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="rounded-xl border border-line p-4"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-ink-strong">
                            {contact.name}
                          </h3>

                          {contact.primary && (
                            <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-ink">
                              Primary
                            </span>
                          )}
                        </div>

                        <p className="mt-1 text-sm text-ink-muted">
                          {contact.relationship}
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditEmergencyForm(contact)}
                          className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-ink hover:bg-surface-hover"
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => void deleteEmergencyContact(contact.id)}
                          className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-danger-ink hover:bg-danger-soft"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 border-t border-line-soft pt-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                          Phone
                        </p>
                        <p className="mt-1 text-sm text-ink">
                          {contact.phone}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                          Email
                        </p>
                        <p className="mt-1 break-all text-sm text-ink">
                          {contact.email || "Not provided"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            id="onboarding-offboarding"
            title="Onboarding / Offboarding"
            description="Lifecycle transitions are completed by the backend and cannot be edited directly."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-ink-strong">
                      Onboarding
                    </h3>

                    <p className="mt-1 text-sm text-ink-muted">Activate the onboarding workflow once employment is ready.</p>
                  </div>

                  <StatusBadge status={lifecycle?.onboarding?.status ?? "NOT_STARTED"} />
                </div>

                <div className="mt-5 border-t border-line-soft pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Current Status
                  </p>

                  <p className="mt-1 text-sm font-medium text-ink-strong">
                    {(lifecycle?.onboarding?.status ?? "NOT_STARTED").replaceAll("_", " ")}
                  </p>
                  {lifecycle?.onboarding?.notes && <p className="mt-2 text-sm text-warning-ink">{lifecycle.onboarding.notes}</p>}
                  <div className="mt-4 flex gap-2">
                    {lifecycle?.onboarding?.status !== "COMPLETED" && <button type="button" onClick={() => void runLifecycleAction("onboarding-start")} disabled={lifecycleSaving} className={buttonClasses({ variant: "secondary" })}>Start</button>}
                    {lifecycle?.onboarding?.status !== "COMPLETED" && <button type="button" onClick={() => void runLifecycleAction("onboarding-complete")} disabled={lifecycleSaving} className={buttonClasses({ variant: "primary" })}>Complete</button>}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-ink-strong">
                      Offboarding
                    </h3>

                    <p className="mt-1 text-sm text-ink-muted">Start before the employee&apos;s final working day; completion is irreversible.</p>
                  </div>

                  <StatusBadge status={lifecycle?.offboarding?.status ?? "NOT_STARTED"} />
                </div>

                <div className="mt-5 border-t border-line-soft pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Current Status
                  </p>

                  <p className="mt-1 text-sm font-medium text-ink-strong">
                    {(lifecycle?.offboarding?.status ?? "NOT_STARTED").replaceAll("_", " ")}
                  </p>
                  {lifecycle?.offboarding?.notes && <p className="mt-2 text-sm text-warning-ink">{lifecycle.offboarding.notes}</p>}
                  <div className="mt-4 flex gap-2">
                    {(employee.status === "TERMINATED" || employee.status === "INACTIVE") && <button type="button" onClick={openEmploymentChange} disabled={lifecycleSaving} className="rounded-lg bg-success px-3 py-2 text-sm font-medium text-white hover:bg-success/90 disabled:opacity-50">Rehire</button>}
                    {lifecycle?.offboarding?.status !== "COMPLETED" && <button type="button" onClick={() => void runLifecycleAction("offboarding-start")} disabled={lifecycleSaving} className={buttonClasses({ variant: "secondary" })}>Start</button>}
                    {lifecycle?.offboarding?.status !== "COMPLETED" && <button type="button" onClick={() => void runLifecycleAction("offboarding-complete")} disabled={lifecycleSaving} className={buttonClasses({ variant: "danger" })}>Complete</button>}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

            </>
          )}

          {tab === "attendance" && <EmployeeAttendanceTab employeeId={employee.id} />}
          {tab === "leave" && <EmployeeLeaveTab employeeId={employee.id} />}
          {tab === "payroll" && <EmployeePayrollTab employeeId={employee.id} />}
          {tab === "documents" && (
          <SectionCard
            id="documents"
            title="Documents"
            description="Upload and review protected documents associated with this employee."
            action={
              <label className={buttonClasses({ variant: "primary" })}>
                <Upload className="h-4 w-4" />
                {documentUploading ? `Uploading… ${documentProgress}%` : "Add Document"}
                <input
                  type="file"
                  className="sr-only"
                  disabled={documentUploading}
                  onChange={(event) => {
                    void uploadEmployeeDocument(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            }
          >
            {documentsError && <p className="mb-4 rounded-lg border border-danger/25 bg-danger-soft p-3 text-sm text-danger-ink">{documentsError}</p>}
            {documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong py-10 text-center">
                <FileText className="h-10 w-10 text-ink-subtle" />
                <h3 className="mt-3 font-medium text-ink-strong">No documents available</h3>
                <p className="mt-1 text-sm text-ink-muted">Add an employee document to make it available to authorized users.</p>
              </div>
            ) : (
              <div className="divide-y divide-line-soft rounded-xl border border-line">
                {documents.map((document) => (
                  <div key={document.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-strong">{document.original_filename}</p>
                      <p className="mt-1 text-xs text-ink-muted">{document.category || "Employee document"} · {(document.size_bytes / 1024).toFixed(0)} KB · {new Date(document.created_at).toLocaleDateString("en-GB")}</p>
                    </div>
                    <div className="flex shrink-0 gap-2 self-start sm:self-auto">
                      <button type="button" onClick={() => void downloadEmployeeDocument(document)} className={buttonClasses({ variant: "secondary" })} title="Download document">
                        <Download className="h-4 w-4" />
                        Download
                      </button>
                      <button type="button" onClick={() => void deactivateEmployeeDocument(document)} disabled={documentActionId === document.id} className="rounded-lg border border-danger/25 px-3 py-2 text-sm font-medium text-danger-ink hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-60">
                        {documentActionId === document.id ? "Deactivating…" : "Deactivate"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          )}
        </>
      )}

      {isEditing && (
        <form onSubmit={requestSave} className="space-y-6">
          <SectionCard
            title="Edit Personal Details"
            description="Update the employee's basic profile information."
          >
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field
                label="First Name"
                value={formData.firstName}
                required
                onChange={(value) => updateField("firstName", value)}
              />

              <Field
                label="Middle Name"
                value={formData.middleName}
                onChange={(value) => updateField("middleName", value)}
              />

              <Field
                label="Last Name"
                value={formData.lastName}
                required
                onChange={(value) => updateField("lastName", value)}
              />

              <SelectField
                label="Gender"
                value={formData.gender}
                required
                options={["Male", "Female", "Other", "Prefer Not To Say"]}
                onChange={(value) => updateField("gender", value)}
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Edit Contact Details"
            description="Update the employee's contact information."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Email"
                type="email"
                value={formData.email}
                required
                onChange={(value) => updateField("email", value)}
              />

              <Field
                label="Work phone"
                value={formData.phone}
                required
                onChange={(value) => updateField("phone", value)}
              />

              <Field
                label="Mobile"
                value={formData.mobilePhone}
                onChange={(value) => updateField("mobilePhone", value)}
              />

              <Field
                label="Preferred name"
                value={formData.preferredName}
                onChange={(value) => updateField("preferredName", value)}
              />

              <Field
                label="Office location"
                value={formData.officeLocation}
                onChange={(value) => updateField("officeLocation", value)}
              />

              <Field
                label="LinkedIn URL"
                type="url"
                value={formData.linkedinUrl}
                onChange={(value) => updateField("linkedinUrl", value)}
              />
            </div>
          </SectionCard>

          {currentEmployment && (
            <SectionCard
              title="Employment Terms"
              description="Working pattern, location and probation details for the current employment."
            >
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <LookupSelect label="Working pattern" value={termsForm.workingPattern} required options={[{ value: "FULL_TIME", label: "Full-time" }, { value: "PART_TIME", label: "Part-time" }, { value: "SHIFT", label: "Shift-based" }]} onChange={(value) => setTermsForm((current) => ({ ...current, workingPattern: value }))} />
                <LookupSelect label="Work arrangement" value={termsForm.workArrangement} required options={[{ value: "ON_SITE", label: "On-site" }, { value: "HYBRID", label: "Hybrid" }, { value: "REMOTE", label: "Remote" }]} onChange={(value) => setTermsForm((current) => ({ ...current, workArrangement: value }))} />
                <Field label="Time zone" value={termsForm.timeZone} onChange={(value) => setTermsForm((current) => ({ ...current, timeZone: value }))} />
                <Field label="Team" value={termsForm.team} onChange={(value) => setTermsForm((current) => ({ ...current, team: value }))} />
                <Field label="Cost centre" value={termsForm.costCentre} onChange={(value) => setTermsForm((current) => ({ ...current, costCentre: value }))} />
                <Field label="Notice period (weeks)" type="number" value={termsForm.noticePeriodWeeks} onChange={(value) => setTermsForm((current) => ({ ...current, noticePeriodWeeks: value }))} />
                <LookupSelect label="Probation" value={termsForm.probationStatus} required options={[{ value: "NOT_APPLICABLE", label: "Not applicable" }, { value: "IN_PROGRESS", label: "In progress" }, { value: "EXTENDED", label: "Extended" }, { value: "COMPLETED", label: "Completed" }]} onChange={(value) => setTermsForm((current) => ({ ...current, probationStatus: value }))} />
                <Field label="Probation end date" type="date" value={termsForm.probationEndDate} onChange={(value) => setTermsForm((current) => ({ ...current, probationEndDate: value }))} />
                <fieldset className="sm:col-span-2 lg:col-span-3">
                  <legend className="mb-1.5 block text-sm font-medium text-ink">Office days</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAY_CODES.map((day) => {
                      const checked = termsForm.officeDays.includes(day);
                      return (
                        <label key={day} className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium ${checked ? "border-primary bg-primary-soft text-primary-ink" : "border-line-strong text-ink"}`}>
                          <input type="checkbox" className="sr-only" checked={checked} onChange={() => setTermsForm((current) => ({ ...current, officeDays: checked ? current.officeDays.filter((item) => item !== day) : WEEKDAY_CODES.filter((item) => item === day || current.officeDays.includes(item)) }))} />
                          {day.charAt(0) + day.slice(1).toLowerCase()}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
            </SectionCard>
          )}

          <SectionCard
            title="Edit Employee Details"
            description="Update the employee's core employment information."
          >
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <InfoItem label="Employee Number" value={formData.employeeNumber} />

              <Field
                label="Hire Date"
                type="date"
                value={formData.hireDate}
                required
                onChange={(value) => updateField("hireDate", value)}
              />

              <SelectField
                label="Employment Type"
                value={formData.employmentType}
                required
                options={["Full Time", "Part Time", "Contract", "Temporary"]}
                onChange={(value) => updateField("employmentType", value)}
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Current Employment Assignment"
            description="Employment assignments are effective-dated and cannot be overwritten from this profile form."
          >
            <div className="rounded-xl border border-dashed border-line-strong bg-surface-muted p-4 text-sm text-ink-muted">
              Save profile changes first, then use Change Assignment on the
              profile to create an effective-dated employment change safely.
            </div>
          </SectionCard>

          <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-xl border border-line bg-surface/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={cancelEditing}
              className={buttonClasses({ variant: "secondary" })}
            >
              <X className="h-4 w-4" />
              Cancel
            </button>

            <button
              type="submit"
              className={buttonClasses({ variant: "primary" })}
            >
              <Save className="h-4 w-4" />
              Save Changes
            </button>
          </div>

          {showSaveConfirmation && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
              <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
                <h2 className="text-lg font-bold text-headline">
                  Confirm Changes
                </h2>

                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  Are you sure you want to save these employee changes?
                  Employment history will remain preserved.
                </p>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowSaveConfirmation(false)}
                    className={buttonClasses({ variant: "secondary" })}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => void confirmSave()}
                    disabled={saving}
                    className={buttonClasses({ variant: "primary" })}
                  >
                    <Save className="h-4 w-4" />
                    {saving ? "Saving..." : "Confirm Save"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
      )}

      <PrintFooter />
    </div>
  );
}
