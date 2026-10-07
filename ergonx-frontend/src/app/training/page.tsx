"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Award, BookOpen, CalendarClock, CheckCircle2, Edit3, GraduationCap, Play, Plus, Trash2, UserPlus, XCircle } from "lucide-react";

import Alert from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import { employeesApi, getApiErrorMessage, trainingApi } from "@/lib/api";
import {
  CERTIFICATE_STATUS_LABELS,
  CERTIFICATE_STATUS_TONES,
  COURSE_CATEGORY_LABELS,
  DELIVERY_MODE_LABELS,
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_STATUS_TONES,
  type Certification,
  type CourseCategory,
  type DeliveryMode,
  type EnrollmentStatus,
  type TrainingCourse,
  type TrainingEnrollment,
} from "@/lib/api/training";
import { useAccess } from "@/lib/access";
import { formatDate, formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";

type View = "overview" | "enrollments" | "courses";
type CourseForm = { code: string; title: string; description: string; category: CourseCategory; delivery_mode: DeliveryMode; provider: string; duration_hours: string; certificate_validity_months: string; is_mandatory: boolean };
const emptyCourse: CourseForm = { code: "", title: "", description: "", category: "SAFETY", delivery_mode: "CLASSROOM", provider: "", duration_hours: "", certificate_validity_months: "", is_mandatory: false };
const ALL = "ALL";
const today = () => new Date().toISOString().slice(0, 10);

/** Training (ErgonX HR): course catalogue, enrolments and certificates that need renewing. */
export default function TrainingPage() {
  const { can } = useAccess();
  const canManage = can("training.manage");
  const [view, setView] = useState<View>("overview");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [courseFilter, setCourseFilter] = useState<string>(ALL);
  const [notice, setNotice] = useState("");
  const [pageError, setPageError] = useState("");

  const load = useCallback(() => Promise.all([trainingApi.getOverview(), trainingApi.listCourses({ is_active: true }), trainingApi.listEnrollments({ ordering: "-planned_start" })]), []);
  const { data, loading, error, reload } = useApiResource(load);
  const overview = data?.[0];
  const courses = useMemo(() => data?.[1].results ?? [], [data]);
  const enrollments = useMemo(() => data?.[2].results ?? [], [data]);
  const initial = loading && !data;

  const filteredEnrollments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return enrollments.filter((item) => (statusFilter === ALL || item.status === statusFilter) && (courseFilter === ALL || item.course === courseFilter) && (!query || item.employee_name.toLowerCase().includes(query) || item.employee_number.toLowerCase().includes(query) || item.course_title.toLowerCase().includes(query)));
  }, [enrollments, search, statusFilter, courseFilter]);

  // ---- course form
  const [courseOpen, setCourseOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<TrainingCourse | null>(null);
  const [courseForm, setCourseForm] = useState<CourseForm>(emptyCourse);
  const [courseError, setCourseError] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingCourse, setRemovingCourse] = useState<TrainingCourse | null>(null);
  const openCourse = (course: TrainingCourse | null) => {
    setEditingCourse(course);
    setCourseForm(course ? { code: course.code, title: course.title, description: course.description, category: course.category, delivery_mode: course.delivery_mode, provider: course.provider, duration_hours: course.duration_hours ?? "", certificate_validity_months: course.certificate_validity_months ? String(course.certificate_validity_months) : "", is_mandatory: course.is_mandatory } : emptyCourse);
    setCourseError("");
    setCourseOpen(true);
  };
  const saveCourse = async () => {
    if (!courseForm.title.trim()) { setCourseError("Give the course a title."); return; }
    setSaving(true);
    setCourseError("");
    const payload = { ...courseForm, code: courseForm.code.trim(), title: courseForm.title.trim(), duration_hours: courseForm.duration_hours || null, certificate_validity_months: courseForm.certificate_validity_months ? Number(courseForm.certificate_validity_months) : null };
    try {
      if (editingCourse) await trainingApi.updateCourse(editingCourse.id, payload);
      else await trainingApi.createCourse(payload);
      setCourseOpen(false);
      reload();
    } catch (caught) { setCourseError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  const removeCourse = async () => {
    if (!removingCourse) return;
    setSaving(true);
    try { await trainingApi.deactivateCourse(removingCourse.id); setRemovingCourse(null); reload(); }
    catch (caught) { setPageError(getApiErrorMessage(caught)); setRemovingCourse(null); }
    finally { setSaving(false); }
  };

  // ---- enrol dialog
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [enrolCourse, setEnrolCourse] = useState("");
  const [enrolStart, setEnrolStart] = useState("");
  const [enrolEnd, setEnrolEnd] = useState("");
  const [enrolNotes, setEnrolNotes] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [enrolError, setEnrolError] = useState("");
  const loadEmployees = useCallback(() => (enrolOpen ? employeesApi.listEmployees({ page_size: MAX_PAGE_SIZE, status: "ACTIVE", ordering: "last_name" }) : Promise.resolve(null)), [enrolOpen]);
  const { data: employeePage, loading: employeesLoading } = useApiResource(loadEmployees);
  const pickable = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase();
    return (employeePage?.results ?? []).filter((item) => !query || item.full_name.toLowerCase().includes(query) || item.employee_number.toLowerCase().includes(query));
  }, [employeePage, pickerSearch]);
  const openEnrol = (courseId = "") => { setEnrolCourse(courseId); setEnrolStart(""); setEnrolEnd(""); setEnrolNotes(""); setPicked([]); setPickerSearch(""); setEnrolError(""); setEnrolOpen(true); };
  const submitEnrol = async () => {
    if (!enrolCourse || picked.length === 0) { setEnrolError("Choose a course and at least one employee."); return; }
    setSaving(true);
    setEnrolError("");
    try {
      const result = await trainingApi.enroll({ course: enrolCourse, employees: picked, planned_start: enrolStart || null, planned_end: enrolEnd || null, notes: enrolNotes });
      setEnrolOpen(false);
      setNotice(`${result.created.length} enrolled${result.skipped.length ? `; ${result.skipped.length} already enrolled and skipped` : ""}.`);
      reload();
    } catch (caught) { setEnrolError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };

  // ---- complete / start / cancel
  const [completing, setCompleting] = useState<TrainingEnrollment | null>(null);
  const [completeForm, setCompleteForm] = useState({ passed: true, completed_on: today(), score: "", certificate_number: "" });
  const [completeError, setCompleteError] = useState("");
  const [cancelling, setCancelling] = useState<TrainingEnrollment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const start = async (item: TrainingEnrollment) => {
    setBusyId(item.id);
    try { await trainingApi.startEnrollment(item.id); reload(); }
    catch (caught) { setPageError(getApiErrorMessage(caught)); }
    finally { setBusyId(null); }
  };
  const submitComplete = async () => {
    if (!completing) return;
    setSaving(true);
    setCompleteError("");
    try {
      await trainingApi.completeEnrollment(completing.id, { passed: completeForm.passed, completed_on: completeForm.completed_on, score: completeForm.score || null, certificate_number: completeForm.certificate_number });
      setCompleting(null);
      reload();
    } catch (caught) { setCompleteError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  const submitCancel = async () => {
    if (!cancelling) return;
    setSaving(true);
    try { await trainingApi.cancelEnrollment(cancelling.id); setCancelling(null); reload(); }
    catch (caught) { setPageError(getApiErrorMessage(caught)); setCancelling(null); }
    finally { setSaving(false); }
  };

  const attention = overview?.attention ?? [];
  const upcoming = enrollments.filter((item) => item.status === "PLANNED" && item.planned_start && item.planned_start >= today()).sort((a, b) => (a.planned_start ?? "").localeCompare(b.planned_start ?? "")).slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Human Resources"
        title="Training"
        description="Plan training, record completions and keep certifications current."
        icon={GraduationCap}
        accent="hr"
        actions={canManage ? <div className="flex flex-wrap gap-2"><Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => openCourse(null)}>Add course</Button><Button leadingIcon={<UserPlus className="h-4 w-4" />} onClick={() => openEnrol()}>Enrol employees</Button></div> : null}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Training summary">
        <MetricCard label="Active courses" value={overview ? formatNumber(overview.active_courses) : "—"} icon={BookOpen} accent="hr" loading={initial} />
        <MetricCard label="Planned or in progress" value={overview ? formatNumber(overview.planned + overview.in_progress) : "—"} description={overview ? `${formatNumber(overview.in_progress)} in progress` : undefined} icon={CalendarClock} accent="leave" loading={initial} />
        <MetricCard label="Completed this year" value={overview ? formatNumber(overview.completed_this_year) : "—"} icon={CheckCircle2} accent="attendance" loading={initial} />
        <MetricCard label="Certificates to renew" value={overview ? formatNumber(overview.certificates_expiring + overview.certificates_expired) : "—"} description={overview ? `${formatNumber(overview.certificates_expired)} expired · ${formatNumber(overview.certificates_expiring)} within 60 days` : undefined} icon={AlertTriangle} accent="audit" loading={initial} />
      </section>

      {notice && <Alert tone="success" onDismiss={() => setNotice("")}>{notice}</Alert>}
      {pageError && <Alert tone="danger" onDismiss={() => setPageError("")}>{pageError}</Alert>}

      <Tabs label="Training" value={view} onChange={(value) => setView(value as View)} items={[{ value: "overview", label: "Overview" }, { value: "enrollments", label: `Enrolments (${enrollments.length})` }, { value: "courses", label: `Courses (${courses.length})` }]} />

      {view === "overview" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <DataTable<Certification>
            caption="Certificates to renew"
            rows={attention}
            rowKey={(row) => row.enrollment_id}
            loading={initial}
            error={error}
            onRetry={reload}
            minWidth={520}
            empty={{ title: "All certificates are current", description: "Certificates expiring within 60 days appear here.", icon: Award }}
            columns={[
              { key: "employee", header: "Employee", cell: (row) => <Link href={`/hr/employees/${row.employee_id}`} className="font-semibold text-ink-strong hover:underline">{row.employee}</Link> },
              { key: "course", header: "Certificate", cell: (row) => row.course },
              { key: "expires", header: "Expires", sortValue: (row) => row.expires_on, cell: (row) => formatDate(row.expires_on) },
              { key: "status", header: "Status", cell: (row) => <Badge size="sm" tone={CERTIFICATE_STATUS_TONES[row.status]}>{CERTIFICATE_STATUS_LABELS[row.status]}</Badge> },
            ]}
          />
          <DataTable<TrainingEnrollment>
            caption="Upcoming training"
            rows={upcoming}
            rowKey={(row) => row.id}
            loading={initial}
            minWidth={480}
            empty={{ title: "Nothing scheduled", description: "Planned training with a start date appears here.", icon: CalendarClock }}
            columns={[
              { key: "start", header: "Starts", cell: (row) => formatDate(row.planned_start) },
              { key: "course", header: "Course", cell: (row) => <span className="font-semibold text-ink-strong">{row.course_title}</span> },
              { key: "employee", header: "Employee", cell: (row) => row.employee_name },
            ]}
          />
        </div>
      )}

      {view === "enrollments" && (
        <DataTable<TrainingEnrollment>
          caption="Training enrolments"
          rows={filteredEnrollments}
          rowKey={(row) => row.id}
          loading={initial}
          error={error}
          onRetry={reload}
          minWidth={900}
          toolbar={
            <DataToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search employee or course…"
              filters={<>
                <Select size="sm" aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value={ALL}>All statuses</option>{(Object.keys(ENROLLMENT_STATUS_LABELS) as EnrollmentStatus[]).map((value) => <option key={value} value={value}>{ENROLLMENT_STATUS_LABELS[value]}</option>)}</Select>
                <Select size="sm" aria-label="Course" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value={ALL}>All courses</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</Select>
              </>}
              onClear={search || statusFilter !== ALL || courseFilter !== ALL ? () => { setSearch(""); setStatusFilter(ALL); setCourseFilter(ALL); } : undefined}
            />
          }
          empty={{ title: "No enrolments found", description: "Enrol employees on a course to start tracking their training.", icon: GraduationCap, action: canManage ? <Button variant="secondary" leadingIcon={<UserPlus className="h-4 w-4" />} onClick={() => openEnrol()}>Enrol employees</Button> : undefined }}
          columns={[
            { key: "employee", header: "Employee", sortValue: (row) => row.employee_name, cell: (row) => <span><Link href={`/hr/employees/${row.employee}`} className="block font-semibold text-ink-strong hover:underline">{row.employee_name}</Link><span className="text-caption text-ink-muted">{row.employee_number}</span></span> },
            { key: "course", header: "Course", sortValue: (row) => row.course_title, cell: (row) => <span><span className="block text-ink-strong">{row.course_title}</span><span className="text-caption text-ink-muted">{row.course_code}</span></span> },
            { key: "dates", header: "Dates", sortValue: (row) => row.planned_start ?? "", cell: (row) => row.completed_on ? `Completed ${formatDate(row.completed_on)}` : row.planned_start ? `${formatDate(row.planned_start)}${row.planned_end ? ` – ${formatDate(row.planned_end)}` : ""}` : "Not scheduled" },
            { key: "status", header: "Status", cell: (row) => <Badge size="sm" tone={ENROLLMENT_STATUS_TONES[row.status]}>{ENROLLMENT_STATUS_LABELS[row.status]}</Badge> },
            { key: "certificate", header: "Certificate", hideBelow: "lg", cell: (row) => row.certificate_status ? <span className="flex flex-col"><Badge size="sm" tone={CERTIFICATE_STATUS_TONES[row.certificate_status]}>{CERTIFICATE_STATUS_LABELS[row.certificate_status]}</Badge>{row.certificate_expires_on && <span className="text-caption text-ink-muted">until {formatDate(row.certificate_expires_on)}</span>}</span> : <span className="text-ink-subtle">—</span> },
            { key: "actions", header: <span className="sr-only">Actions</span>, cell: (row) => canManage && (row.status === "PLANNED" || row.status === "IN_PROGRESS") ? (
              <div className="flex justify-end gap-1">
                {row.status === "PLANNED" && <IconButton size="sm" label={`Start ${row.course_title} for ${row.employee_name}`} disabled={busyId === row.id} onClick={() => void start(row)}><Play className="h-4 w-4" /></IconButton>}
                <IconButton size="sm" label={`Record completion for ${row.employee_name}`} onClick={() => { setCompleting(row); setCompleteForm({ passed: true, completed_on: today(), score: "", certificate_number: "" }); setCompleteError(""); }}><CheckCircle2 className="h-4 w-4" /></IconButton>
                <IconButton size="sm" label={`Cancel enrolment for ${row.employee_name}`} className="text-danger-ink hover:bg-danger-soft" onClick={() => setCancelling(row)}><XCircle className="h-4 w-4" /></IconButton>
              </div>
            ) : null },
          ]}
        />
      )}

      {view === "courses" && (
        <DataTable<TrainingCourse>
          caption="Training courses"
          rows={courses}
          rowKey={(row) => row.id}
          loading={initial}
          error={error}
          onRetry={reload}
          minWidth={860}
          empty={{ title: "No courses yet", description: "Add the courses your organization runs or sends staff on.", icon: BookOpen, action: canManage ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => openCourse(null)}>Add course</Button> : undefined }}
          columns={[
            { key: "title", header: "Course", sortValue: (row) => row.title, cell: (row) => <span><span className="flex items-center gap-2 font-semibold text-ink-strong">{row.title}{row.is_mandatory && <Badge size="sm" tone="brand">Mandatory</Badge>}</span><span className="text-caption text-ink-muted">{row.code}{row.provider ? ` · ${row.provider}` : ""}</span></span> },
            { key: "category", header: "Category", cell: (row) => COURSE_CATEGORY_LABELS[row.category] },
            { key: "delivery", header: "Delivery", hideBelow: "lg", cell: (row) => `${DELIVERY_MODE_LABELS[row.delivery_mode]}${row.duration_hours ? ` · ${Number(row.duration_hours)} h` : ""}` },
            { key: "certificate", header: "Certificate", cell: (row) => row.certificate_validity_months ? `Valid ${row.certificate_validity_months} months` : "No expiry" },
            { key: "enrolled", header: "Open enrolments", numeric: true, cell: (row) => formatNumber(row.enrolled ?? 0) },
            { key: "actions", header: <span className="sr-only">Actions</span>, cell: (row) => canManage ? <div className="flex justify-end gap-1"><IconButton size="sm" label={`Enrol employees on ${row.title}`} onClick={() => openEnrol(row.id)}><UserPlus className="h-4 w-4" /></IconButton><IconButton size="sm" label={`Edit ${row.title}`} onClick={() => openCourse(row)}><Edit3 className="h-4 w-4" /></IconButton><IconButton size="sm" label={`Remove ${row.title}`} className="text-danger-ink hover:bg-danger-soft" onClick={() => setRemovingCourse(row)}><Trash2 className="h-4 w-4" /></IconButton></div> : null },
          ]}
        />
      )}

      <Dialog open={courseOpen} onClose={() => setCourseOpen(false)} dismissible={!saving} size="lg" title={editingCourse ? "Edit course" : "Add course"} description="Courses you run internally or send employees on." footer={<><Button variant="secondary" onClick={() => setCourseOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void saveCourse()} loading={saving}>{editingCourse ? "Save changes" : "Add course"}</Button></>}>
        <div className="space-y-5">
          {courseError && <Alert tone="danger">{courseError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="Title" required><Input value={courseForm.title} onChange={(event) => setCourseForm({ ...courseForm, title: event.target.value })} placeholder="e.g. Fire Safety & Emergency Response" data-autofocus /></Field>
            <Field label="Code" optional><Input value={courseForm.code} onChange={(event) => setCourseForm({ ...courseForm, code: event.target.value.toUpperCase() })} placeholder="Automatic" className="font-mono" /></Field>
          </div>
          <Field label="Description" optional><Textarea value={courseForm.description} onChange={(event) => setCourseForm({ ...courseForm, description: event.target.value })} rows={2} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category"><Select value={courseForm.category} onChange={(event) => setCourseForm({ ...courseForm, category: event.target.value as CourseCategory })}>{(Object.keys(COURSE_CATEGORY_LABELS) as CourseCategory[]).map((value) => <option key={value} value={value}>{COURSE_CATEGORY_LABELS[value]}</option>)}</Select></Field>
            <Field label="Delivery"><Select value={courseForm.delivery_mode} onChange={(event) => setCourseForm({ ...courseForm, delivery_mode: event.target.value as DeliveryMode })}>{(Object.keys(DELIVERY_MODE_LABELS) as DeliveryMode[]).map((value) => <option key={value} value={value}>{DELIVERY_MODE_LABELS[value]}</option>)}</Select></Field>
            <Field label="Provider" optional><Input value={courseForm.provider} onChange={(event) => setCourseForm({ ...courseForm, provider: event.target.value })} placeholder="e.g. HSSE team, or an external provider" /></Field>
            <Field label="Duration (hours)" optional><Input type="number" min={0.5} step={0.5} value={courseForm.duration_hours} onChange={(event) => setCourseForm({ ...courseForm, duration_hours: event.target.value })} /></Field>
            <Field label="Certificate valid for (months)" optional helper="Leave blank if the certificate does not expire."><Input type="number" min={1} max={120} value={courseForm.certificate_validity_months} onChange={(event) => setCourseForm({ ...courseForm, certificate_validity_months: event.target.value })} /></Field>
          </div>
          <Checkbox label="Mandatory training" description="Marked as mandatory in the catalogue and on employee records." checked={courseForm.is_mandatory} onChange={(event) => setCourseForm({ ...courseForm, is_mandatory: event.target.checked })} />
        </div>
      </Dialog>

      <Dialog open={enrolOpen} onClose={() => setEnrolOpen(false)} dismissible={!saving} size="lg" title="Enrol employees" description="Anyone already planned or in progress on the course is skipped." footer={<><Button variant="secondary" onClick={() => setEnrolOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void submitEnrol()} loading={saving}>{picked.length ? `Enrol ${picked.length}` : "Enrol"}</Button></>}>
        <div className="space-y-5">
          {enrolError && <Alert tone="danger">{enrolError}</Alert>}
          <Field label="Course" required><Select value={enrolCourse} onChange={(event) => setEnrolCourse(event.target.value)}><option value="">Choose a course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</Select></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" optional><Input type="date" value={enrolStart} onChange={(event) => setEnrolStart(event.target.value)} /></Field>
            <Field label="Ends" optional><Input type="date" value={enrolEnd} onChange={(event) => setEnrolEnd(event.target.value)} /></Field>
          </div>
          <Field label={`Employees${picked.length ? ` (${picked.length} selected)` : ""}`} required>
            <div className="rounded-xl border border-line">
              <div className="border-b border-line p-2"><Input size="sm" value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} placeholder="Search employees…" /></div>
              <div className="max-h-64 overflow-y-auto p-2">
                {employeesLoading && !employeePage ? <p className="p-2 text-support text-ink-muted">Loading employees…</p> : pickable.map((person) => (
                  <Checkbox key={person.id} label={`${person.full_name} · ${person.employee_number}`} checked={picked.includes(person.id)} onChange={() => setPicked((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} />
                ))}
              </div>
            </div>
          </Field>
          <Field label="Notes" optional><Textarea value={enrolNotes} onChange={(event) => setEnrolNotes(event.target.value)} rows={2} /></Field>
        </div>
      </Dialog>

      <Dialog open={completing !== null} onClose={() => setCompleting(null)} dismissible={!saving} title="Record completion" description={completing ? `${completing.employee_name} · ${completing.course_title}` : undefined} footer={<><Button variant="secondary" onClick={() => setCompleting(null)} disabled={saving}>Cancel</Button><Button onClick={() => void submitComplete()} loading={saving}>Save</Button></>}>
        <div className="space-y-4">
          {completeError && <Alert tone="danger">{completeError}</Alert>}
          <Field label="Result"><Select value={completeForm.passed ? "PASSED" : "NOT_PASSED"} onChange={(event) => setCompleteForm({ ...completeForm, passed: event.target.value === "PASSED" })}><option value="PASSED">Completed / passed</option><option value="NOT_PASSED">Not passed</option></Select></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Completed on" required><Input type="date" max={today()} value={completeForm.completed_on} onChange={(event) => setCompleteForm({ ...completeForm, completed_on: event.target.value })} /></Field>
            <Field label="Score (%)" optional><Input type="number" min={0} max={100} value={completeForm.score} onChange={(event) => setCompleteForm({ ...completeForm, score: event.target.value })} /></Field>
          </div>
          {completeForm.passed && <Field label="Certificate number" optional helper="The expiry date is set from the course's certificate validity."><Input value={completeForm.certificate_number} onChange={(event) => setCompleteForm({ ...completeForm, certificate_number: event.target.value })} /></Field>}
        </div>
      </Dialog>

      <ConfirmDialog open={removingCourse !== null} title="Remove course" description={removingCourse ? `Stop offering ${removingCourse.title}? Existing training records are kept.` : ""} confirmLabel="Remove" destructive loading={saving} onCancel={() => setRemovingCourse(null)} onConfirm={() => void removeCourse()} />
      <ConfirmDialog open={cancelling !== null} title="Cancel enrolment" description={cancelling ? `Cancel ${cancelling.course_title} for ${cancelling.employee_name}?` : ""} confirmLabel="Cancel enrolment" destructive loading={saving} onCancel={() => setCancelling(null)} onConfirm={() => void submitCancel()} />
    </div>
  );
}
