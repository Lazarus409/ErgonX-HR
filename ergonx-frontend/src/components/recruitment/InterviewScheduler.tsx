"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, Info, Laptop, Save, UsersRound, Video } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog } from "@/components/ui/Overlay";
import { getApiErrorMessage, recruitmentApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { HIRING_TEAM_ROLES, INTERVIEW_MODES, INTERVIEW_STAGES, type InterviewSlot, type RecruitmentInterview } from "@/types/recruitment";

const STEPS = ["Schedule", "Invite and confirm", "Review", "Complete"];
const DURATIONS = [30, 45, 60, 90, 120];
const inputClass = "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong";

function browserZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}
const ZONES = Array.from(new Set([browserZone(), "Africa/Accra", "Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg", "Europe/London", "America/New_York", "UTC"]));

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function weekdaysFrom(anchor: Date) {
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
  return Array.from({ length: 5 }, (_, index) => { const day = new Date(monday); day.setDate(monday.getDate() + index); return day; });
}
function nextWorkday() {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
  return day;
}
function formatInZone(iso: string, zone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone }).format(new Date(iso));
}

/** Concept "Interview scheduling" (option 1). */
export default function InterviewScheduler({ applicationId, interviewId }: { applicationId: string | null; interviewId: string | null }) {
  const [picked, setPicked] = useState<string | null>(applicationId);
  if (!picked && !interviewId) return <ApplicationPicker onPick={setPicked} />;
  return <SchedulerLoader applicationId={picked} interviewId={interviewId} />;
}

function ApplicationPicker({ onPick }: { onPick: (id: string) => void }) {
  const load = useCallback(() => recruitmentApi.listApplications({ status: "ACTIVE", page_size: 100, ordering: "-applied_at" }), []);
  const candidates = useCallback(() => recruitmentApi.listCandidates({ page_size: 200 }), []);
  const { data, loading, error } = useApiResource(load);
  const { data: people } = useApiResource(candidates);
  const jobs = useCallback(() => recruitmentApi.listJobPostings({ page_size: 100 }), []);
  const { data: postings } = useApiResource(jobs);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Unable to load applications."} />;
  const name = (id: string) => { const row = people?.results.find((item) => item.id === id); return row ? `${row.first_name} ${row.last_name}` : "Candidate"; };
  const title = (id: string) => postings?.results.find((item) => item.id === id)?.title ?? "Role";
  return (
    <div className="space-y-5">
      <Link href="/recruitment/interviews" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to interviews</Link>
      <div><h1 className="text-[1.75rem] font-bold leading-9 text-headline sm:text-title">Schedule interview</h1><p className="mt-1.5 text-heading-support">Choose the candidate application to schedule an interview for.</p></div>
      <ul className="divide-y divide-line-soft rounded-2xl border border-line bg-surface shadow-elevation-1">
        {data.results.map((item) => (
          <li key={item.id}><button type="button" onClick={() => onPick(item.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover"><Avatar name={name(item.candidate)} size="sm" /><span className="flex-1"><span className="block font-semibold text-ink-strong">{name(item.candidate)}</span><span className="text-caption text-ink-muted">{title(item.job_posting)}</span></span><ChevronRight className="h-4 w-4 text-ink-muted" aria-hidden="true" /></button></li>
        ))}
        {!data.results.length && <li className="px-4 py-6 text-center text-sm text-ink-muted">No active applications to interview.</li>}
      </ul>
    </div>
  );
}

function SchedulerLoader({ applicationId, interviewId }: { applicationId: string | null; interviewId: string | null }) {
  const router = useRouter();
  const load = useCallback(async () => {
    const existing = interviewId ? await recruitmentApi.getInterview(interviewId) : null;
    const appId = existing?.application ?? applicationId;
    if (!appId) throw new Error("Choose an application to schedule an interview for.");
    const overview = await recruitmentApi.getApplicationOverview(appId);
    const [people, team] = await Promise.all([
      recruitmentApi.listRecruitmentPeople().catch(() => []),
      recruitmentApi.listHiringTeam(overview.job.id).catch(() => []),
    ]);
    return { existing, overview, people, team };
  }, [applicationId, interviewId]);
  const { data, loading, error } = useApiResource(load);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Unable to load the application."} />;
  return <Scheduler {...data} onDone={(target) => router.push(target)} />;
}

type Loaded = {
  existing: RecruitmentInterview | null;
  overview: Awaited<ReturnType<typeof recruitmentApi.getApplicationOverview>>;
  people: Array<{ id: string; name: string; role: string }>;
  team: Array<{ user: string; user_name: string; role: string }>;
};

function Scheduler({ existing, overview, people, team, onDone }: Loaded & { onDone: (target: string) => void }) {
  const { candidate, job, application } = overview;
  const initialPanel = existing?.panel_members?.map((member) => member.id) ?? Array.from(new Set(team.filter((member) => member.role === "HIRING_MANAGER" || member.role === "INTERVIEW_PANEL").map((member) => member.user))).slice(0, 4);
  const [step, setStep] = useState(1);
  const [stage, setStage] = useState(existing?.interview_stage || "FIRST_ROUND");
  const [mode, setMode] = useState(existing?.mode || "VIDEO");
  const [location, setLocation] = useState(existing?.location_or_link ?? "");
  const [duration, setDuration] = useState(existing?.duration_minutes ?? 60);
  const [zone, setZone] = useState(existing?.time_zone || browserZone());
  const [agenda, setAgenda] = useState(existing?.agenda ?? "");
  const [panel, setPanel] = useState<string[]>(initialPanel);
  const [day, setDay] = useState<Date>(() => (existing ? new Date(existing.scheduled_at) : nextWorkday()));
  const [slot, setSlot] = useState<string | null>(existing && existing.status === "DRAFT" ? existing.scheduled_at : null);
  const [slots, setSlots] = useState<InterviewSlot[] | null>(null);
  const [memberSlots, setMemberSlots] = useState<Record<string, InterviewSlot[]>>({});
  const [message, setMessage] = useState<string | null>(existing?.candidate_message || null);
  const [editingMessage, setEditingMessage] = useState(false);
  const [sendInvite, setSendInvite] = useState(true);
  const [managing, setManaging] = useState(false);
  const [saving, setSaving] = useState<"draft" | "final" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<RecruitmentInterview | null>(null);
  const names = (ids: string[]) => ids.map((id) => people.find((person) => person.id === id)?.name ?? team.find((member) => member.user === id)?.user_name ?? "Interviewer");
  const roleOf = (id: string) => HIRING_TEAM_ROLES.find(([value]) => value === team.find((member) => member.user === id)?.role)?.[1] ?? people.find((person) => person.id === id)?.role ?? "Interviewer";
  const week = useMemo(() => weekdaysFrom(day), [day]);
  const dayKey = isoDay(day);
  const panelKey = panel.join(",");

  useEffect(() => {
    let active = true;
    const ids = panelKey ? panelKey.split(",") : [];
    const exclude = existing?.id;
    Promise.all([
      recruitmentApi.getInterviewAvailability({ date: dayKey, interviewers: ids, duration, time_zone: zone, exclude }),
      ...ids.map((id) => recruitmentApi.getInterviewAvailability({ date: dayKey, interviewers: [id], duration, time_zone: zone, exclude }).then((row) => [id, row.slots] as const)),
    ]).then(([combined, ...members]) => {
      if (!active) return;
      setSlots((combined as { slots: InterviewSlot[] }).slots);
      setMemberSlots(Object.fromEntries(members as Array<readonly [string, InterviewSlot[]]>));
    }).catch((caught) => active && setProblem(getApiErrorMessage(caught)));
    return () => { active = false; };
  }, [dayKey, panelKey, duration, zone, existing?.id]);

  const stageLabel = INTERVIEW_STAGES.find(([value]) => value === stage)?.[1] ?? "Interview";
  const modeLabel = INTERVIEW_MODES.find(([value]) => value === mode)?.[1] ?? "";
  const defaultMessage = useMemo(() => {
    const when = slot ? `${formatInZone(slot, zone, { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}` : "[date to be confirmed]";
    const time = slot ? `${formatInZone(slot, zone, { hour: "2-digit", minute: "2-digit" })} – ${formatInZone(new Date(new Date(slot).getTime() + duration * 60000).toISOString(), zone, { hour: "2-digit", minute: "2-digit" })} (${zone})` : "";
    const where = mode === "VIDEO" ? `Video call${location ? `: ${location}` : " (link will be sent)"}` : mode === "PHONE" ? "Phone call" : location || modeLabel;
    return [
      `Hi ${candidate.first_name},`, "",
      `You're invited to a ${stageLabel.toLowerCase()} for the ${job.title} role.`, "",
      `Date: ${when}`, time ? `Time: ${time}` : "", `Where: ${where}`, `Interviewers: ${names(panel).join(", ") || "the hiring team"}`, "",
      "We look forward to speaking with you.", "The Recruitment Team",
    ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, zone, duration, mode, location, stageLabel, panelKey, candidate.first_name, job.title]);
  const body = message ?? defaultMessage;
  const selectedSlot = slots?.find((row) => row.start === slot || (slot && new Date(row.start).getTime() === new Date(slot).getTime()));
  const memberState = (id: string) => {
    if (!slot) return null;
    const row = memberSlots[id]?.find((item) => new Date(item.start).getTime() === new Date(slot).getTime());
    return row?.state ?? null;
  };

  const save = async (draft: boolean) => {
    if (!slot) { setProblem("Choose a date and time."); return; }
    setSaving(draft ? "draft" : "final");
    setProblem(null);
    try {
      const saved = await recruitmentApi.scheduleInterview({
        application: application.id, scheduled_at: slot, duration_minutes: duration, interview_stage: stage, mode, time_zone: zone,
        location_or_link: location.trim(), agenda: agenda.trim(), panel, candidate_message: body, draft, send_invitation: sendInvite,
      }, existing?.id);
      if (draft) onDone(`/recruitment/candidates/${candidate.id}?application=${application.id}`);
      else { setResult(saved); setStep(4); }
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setSaving(null);
    }
  };
  const back = `/recruitment/candidates/${candidate.id}?application=${application.id}`;

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={back} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to candidate</Link>
        <Link href={back} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-ink hover:underline">View candidate profile<ExternalLink className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
      <div>
        <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">{existing && existing.status === "SCHEDULED" ? "Reschedule interview" : "Schedule interview"}</h1>
        <p className="mt-1.5 text-[1.0625rem] text-heading-support">Find a time that works for your team and the candidate. All times shown are in the selected time zone.</p>
      </div>
      <ol className="grid grid-cols-4" aria-label="Scheduling progress">
        {STEPS.map((name, index) => {
          const number = index + 1;
          const active = step === number;
          return (
            <li key={name} className="relative flex flex-col items-center gap-2 text-center" aria-current={active ? "step" : undefined}>
              {index > 0 && <span aria-hidden="true" className={cx("absolute right-1/2 top-[1.125rem] h-0.5 w-full", step >= number ? "bg-primary" : "bg-line")} />}
              <span className={cx("relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold", active ? "border-primary bg-primary text-white" : step > number ? "border-primary bg-primary-soft text-primary-ink" : "border-line-strong bg-surface text-ink-muted")}>{step > number ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : number}</span>
              <span className={cx("hidden text-sm font-semibold sm:block", active ? "text-primary-ink" : "text-ink-muted")}>{name}</span>
            </li>
          );
        })}
      </ol>

      {problem && <ErrorState variant="inline" title="Interview not scheduled" message={problem} />}

      {step === 4 && result ? (
        <section className="rounded-2xl border border-success/30 bg-success-soft p-6">
          <p className="flex items-center gap-2 text-heading font-bold text-success-ink"><CheckCircle2 className="h-6 w-6" aria-hidden="true" />Interview scheduled</p>
          <p className="mt-1 text-ink">{stageLabel} with {candidate.full_name} on {formatInZone(result.scheduled_at, zone, { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })} ({zone}). Panel members were notified in ErgonX.</p>
          <p className="mt-1 text-sm text-ink-muted">
            {result.invitation_status === "SENT" ? `Invitation emailed to ${candidate.email}.` : result.invitation_status === "NOT_CONFIGURED" ? "Email delivery is not configured for this environment, so the invitation was not emailed. Share the message with the candidate directly." : result.invitation_status === "FAILED" ? "The invitation email could not be delivered. Share the message with the candidate directly." : "No invitation was emailed."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => onDone(back)}>Back to candidate</Button><Button variant="secondary" onClick={() => onDone("/recruitment/interviews")}>All interviews</Button></div>
        </section>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.95fr)]">
            <section className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
              <Avatar name={candidate.full_name || `${candidate.first_name} ${candidate.last_name}`} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><p className="text-[1.125rem] font-bold text-ink-strong">{candidate.full_name}</p><span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-caption font-semibold text-success-ink"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{application.status === "ACTIVE" ? "Active candidate" : humanizeEnum(application.status)}</span></div>
                <p className="truncate text-sm text-ink-muted">{candidate.email}</p>
                <p className="text-sm text-ink-muted">{candidate.phone || "No phone recorded"}</p>
              </div>
            </section>
            <section className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-section-icon"><Laptop className="h-7 w-7" aria-hidden="true" /></span>
              <div className="min-w-0">
                <p className="font-bold text-ink-strong">{job.title}</p>
                <p className="text-sm text-heading-support">{job.department_name} · {job.location_name}</p>
                <p className="text-caption text-ink-muted">{job.code} | {humanizeEnum(job.employment_type)}</p>
              </div>
            </section>
            <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 xl:row-span-3">
              <div className="flex items-center justify-between"><h2 className="text-heading font-bold text-ink-strong">Interviewers ({panel.length})</h2><button type="button" onClick={() => setManaging(true)} className="text-sm font-semibold text-primary-ink hover:underline">Manage</button></div>
              <ul className="mt-3 divide-y divide-line-soft">
                {panel.map((id) => {
                  const state = memberState(id);
                  return (
                    <li key={id} className="flex items-center gap-3 py-2.5">
                      <Avatar name={names([id])[0]} />
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink-strong">{names([id])[0]}</span><span className="text-caption text-ink-muted">{roleOf(id)}</span></span>
                      {state && <span className={cx("rounded-full px-2.5 py-0.5 text-caption font-semibold", state === "available" ? "bg-success-soft text-success-ink" : state === "conflict" ? "bg-danger-soft text-danger-ink" : "bg-surface-muted text-ink-muted")}>{state === "available" ? "Available" : state === "conflict" ? "Busy" : "Unavailable"}</span>}
                    </li>
                  );
                })}
                {!panel.length && <li className="py-3 text-sm text-ink-muted">Add at least one interviewer.</li>}
              </ul>

              <div className="mt-5 border-t border-line-soft pt-4">
                <div className="flex items-center justify-between"><h2 className="text-heading font-bold text-ink-strong">Candidate notification</h2><button type="button" onClick={() => setEditingMessage((current) => !current)} className="text-sm font-semibold text-primary-ink hover:underline">{editingMessage ? "Preview" : "Edit"}</button></div>
                <div className="mt-3 overflow-hidden rounded-xl border border-line-soft">
                  <p className="bg-surface-muted px-3 py-2 text-sm"><span className="font-semibold">Subject:</span> Interview invitation – {job.title}</p>
                  {editingMessage
                    ? <textarea rows={12} value={body} maxLength={4000} onChange={(event) => setMessage(event.target.value)} className="w-full border-0 px-3 py-2 text-sm" aria-label="Candidate message" />
                    : <pre className="whitespace-pre-wrap px-3 py-2 font-sans text-sm text-ink">{body}</pre>}
                </div>
                {message !== null && <button type="button" onClick={() => setMessage(null)} className="mt-1 text-caption font-semibold text-primary-ink hover:underline">Reset to generated message</button>}
                <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={sendInvite} onChange={(event) => setSendInvite(event.target.checked)} className="h-4 w-4" />Email this invitation to {candidate.email}</label>
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
              <h2 className="text-heading font-bold text-ink-strong">Interview details</h2>
              <div className="mt-4 space-y-4">
                <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Interview stage <span className="text-danger-ink">*</span></span><select value={stage} onChange={(event) => setStage(event.target.value)} className={inputClass}>{INTERVIEW_STAGES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                <fieldset><legend className="mb-1.5 text-sm font-semibold text-ink-strong">Interview type <span className="text-danger-ink">*</span></legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">{INTERVIEW_MODES.map(([value, text]) => <label key={value} className="inline-flex items-center gap-2 text-sm"><input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="h-4 w-4" />{text}</label>)}</div>
                </fieldset>
                <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">{mode === "IN_PERSON" ? "Location" : mode === "PHONE" ? "Dial-in or number (optional)" : "Meeting link"}{mode === "IN_PERSON" && <span className="text-danger-ink"> *</span>}</span>
                  <div className="relative"><Video className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder={mode === "IN_PERSON" ? "Building and room" : "https://…"} className={cx(inputClass, "pl-9")} /></div>
                </label>
                <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Duration <span className="text-danger-ink">*</span></span><select value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setSlot(null); }} className={inputClass}>{DURATIONS.map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></label>
                <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Time zone <span className="text-danger-ink">*</span></span><select value={zone} onChange={(event) => { setZone(event.target.value); setSlot(null); }} className={inputClass}>{ZONES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label className="block border-t border-line-soft pt-4"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Interview agenda (optional)</span><textarea rows={4} maxLength={500} value={agenda} onChange={(event) => setAgenda(event.target.value)} placeholder={"1. Introductions (5 min)\n2. Experience (30 min)\n3. Candidate questions (15 min)"} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /><span className="mt-1 block text-right text-caption text-ink-muted">{agenda.length}/500</span></label>
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-heading font-bold text-ink-strong">Select date and time</h2><span className="inline-flex items-center gap-1 text-caption text-ink-muted"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{zone}</span></div>
              <div className="mt-4 flex items-center gap-1.5">
                <button type="button" aria-label="Previous week" onClick={() => { const next = new Date(day); next.setDate(day.getDate() - 7); setDay(next); setSlot(null); }} className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-hover"><ChevronLeft className="h-5 w-5" /></button>
                <div className="grid flex-1 grid-cols-5 gap-1.5">
                  {week.map((date) => {
                    const selected = isoDay(date) === dayKey;
                    return <button key={isoDay(date)} type="button" onClick={() => { setDay(date); setSlot(null); }} aria-pressed={selected} className={cx("rounded-lg border px-1 py-1.5 text-center text-sm", selected ? "border-primary bg-primary-soft font-semibold text-primary-ink" : "border-line text-ink hover:bg-surface-hover")}><span className="block">{date.toLocaleDateString("en-GB", { weekday: "short" })}</span><span className="block">{date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span></button>;
                  })}
                </div>
                <button type="button" aria-label="Next week" onClick={() => { const next = new Date(day); next.setDate(day.getDate() + 7); setDay(next); setSlot(null); }} className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-hover"><ChevronRight className="h-5 w-5" /></button>
              </div>
              <div className="mt-4 flex gap-2.5 rounded-xl bg-primary-soft/60 px-3 py-2.5 text-sm"><Info className="mt-0.5 h-5 w-5 shrink-0 text-primary-ink" aria-hidden="true" /><div><p className="font-semibold text-primary-ink">Times show when all selected interviewers are available.</p><p className="text-ink">Clashes come from their other interviews; approved leave marks the day unavailable.</p></div></div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {slots === null ? [0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="skeleton h-10 rounded-lg" />) : slots.map((row) => {
                  const chosen = slot !== null && new Date(row.start).getTime() === new Date(slot).getTime();
                  return (
                    <button key={row.start} type="button" disabled={row.state === "unavailable"} title={row.reason || undefined} onClick={() => setSlot(row.start)} aria-pressed={chosen}
                      className={cx("flex h-10 items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold transition",
                        row.state === "available" && (chosen ? "border-success bg-success text-white" : "border-success/40 bg-success-soft text-success-ink hover:border-success"),
                        row.state === "conflict" && (chosen ? "border-danger bg-danger text-white" : "border-danger/40 bg-danger-soft text-danger-ink"),
                        row.state === "unavailable" && "cursor-not-allowed border-line bg-surface-muted text-ink-subtle")}>
                      {row.state === "conflict" && <AlertTriangle className="h-4 w-4" aria-hidden="true" />}{row.state === "unavailable" && <Ban className="h-4 w-4" aria-hidden="true" />}{row.time}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-caption text-ink-muted"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" />Available</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-danger" />Conflict</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink-subtle" />Unavailable</span></div>
              {slots && !slots.some((row) => row.state === "available") && (
                <div className="mt-4 flex gap-2.5 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm"><Info className="mt-0.5 h-5 w-5 shrink-0 text-warning-ink" aria-hidden="true" /><div><p className="font-semibold text-warning-ink">No suitable times?</p><p className="text-ink">Try a different date, reduce the number of interviewers, or suggest a time in the candidate message.</p></div></div>
              )}
              {selectedSlot?.state === "conflict" && <p className="mt-3 text-sm font-medium text-danger-ink">A panel member has another interview at this time. Choose a green slot to schedule.</p>}
            </section>
          </div>

          {step === 3 && (
            <section className="rounded-2xl border border-primary/30 bg-primary-soft/40 p-5 text-sm">
              <p className="font-bold text-headline">Review</p>
              <p className="mt-1 text-ink">{stageLabel} ({modeLabel}, {duration} minutes) with {candidate.full_name} on {slot ? formatInZone(slot, zone, { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }) : "—"} ({zone}).</p>
              <p className="text-ink">Panel: {names(panel).join(", ") || "none"}. {sendInvite ? `The invitation will be emailed to ${candidate.email}.` : "The candidate will not be emailed."}</p>
            </section>
          )}

          <div className="flex flex-wrap justify-end gap-3">
            {step > 1 && <Button variant="ghost" size="lg" onClick={() => setStep((current) => current - 1)}>Back</Button>}
            <Button variant="secondary" size="lg" leadingIcon={<Save className="h-5 w-5" />} loading={saving === "draft"} disabled={!slot} onClick={() => void save(true)}>Save draft</Button>
            {step < 3
              ? <Button size="lg" trailingIcon={<ArrowRight className="h-5 w-5" />} disabled={!slot || !panel.length || selectedSlot?.state !== "available" || (mode === "IN_PERSON" && !location.trim())} onClick={() => { setStep((current) => current + 1); if (step === 1) setEditingMessage(true); else setEditingMessage(false); }}>{step === 1 ? "Continue to invite" : "Review"}</Button>
              : <Button size="lg" trailingIcon={<CalendarDays className="h-5 w-5" />} loading={saving === "final"} disabled={selectedSlot?.state !== "available"} onClick={() => void save(false)}>Schedule interview</Button>}
          </div>
        </>
      )}

      <Dialog open={managing} onClose={() => setManaging(false)} title="Interview panel" description="Choose who interviews the candidate. The hiring team for this requisition is listed first." footer={<Button onClick={() => setManaging(false)}>Done</Button>}>
        <ul className="max-h-96 divide-y divide-line-soft overflow-y-auto rounded-xl border border-line-soft">
          {[...people].sort((a, b) => Number(team.some((member) => member.user === b.id)) - Number(team.some((member) => member.user === a.id))).map((person) => (
            <li key={person.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-hover">
                <input type="checkbox" checked={panel.includes(person.id)} onChange={(event) => { setPanel((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id)); setSlot(null); }} className="h-4 w-4" />
                <Avatar name={person.name} size="sm" />
                <span className="min-w-0 flex-1"><span className="block font-semibold text-ink-strong">{person.name}</span><span className="text-caption text-ink-muted">{team.some((member) => member.user === person.id) ? roleOf(person.id) : person.role}</span></span>
                {team.some((member) => member.user === person.id) && <UsersRound className="h-4 w-4 text-section-icon" aria-label="On hiring team" />}
              </label>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
