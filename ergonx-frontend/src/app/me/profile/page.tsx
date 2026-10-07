"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { Briefcase, Save, UserRound } from "lucide-react";
import { formatDate, humanizeEnum } from "@/lib/format";

import Alert from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, FileInput, Input, Select } from "@/components/ui/Field";
import PageHeader from "@/components/ui/PageHeader";
import { employeesApi, getApiErrorMessage, imagesApi } from "@/lib/api";
import { useAuth } from "@/components/guards/AuthProvider";
import { cx } from "@/lib/cx";
import type { Employee } from "@/types/hr";

export default function MyProfilePage() {
  const { user, refreshSession } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [phone, setPhone] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [avatarKey, setAvatarKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The session carries the saved avatar; a fresh upload shows immediately, before the session refreshes.
  const [uploadedImageId, setImageId] = useState<string | null>(null);
  const imageId = uploadedImageId ?? user?.profileImageId ?? null;
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    employeesApi.getCurrentEmployee().then((value) => {
      setEmployee(value);
      setPhone(value?.phone ?? "");
      setPersonalEmail(value?.personal_email ?? "");
      setAvatarKey(value?.avatar_key ?? "");
    }).catch((caught) => setError(getApiErrorMessage(caught)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault(); setError(null); setMessage(null);
    if (!employee) return;
    setSaving(true);
    try {
      const updated = await employeesApi.updateMyProfile({ phone, personal_email: personalEmail, avatar_key: avatarKey });
      setEmployee(updated); setMessage("Your contact details have been updated.");
    } catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function uploadProfileImage(file: File | undefined) {
    if (!file || !employee || !user) return;
    setError(null);
    if (!["image/jpeg", "image/png", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Profile images must be JPEG, PNG, or GIF files no larger than 5 MB.");
      return;
    }
    setUploading(true); setUploadProgress(0);
    try {
      await imagesApi.uploadImage(file, "EMPLOYEE", employee.id, setUploadProgress);
      const userImage = await imagesApi.uploadImage(file, "USER", user.id, setUploadProgress);
      setImageId(userImage.id);
      await refreshSession();
      setMessage("Profile picture updated.");
    } catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setUploading(false); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="My profile" description="Keep your personal contact details current. Employment details are managed by HR." icon={UserRound} accent="brand" />
      {error && <Alert tone="danger" onDismiss={() => setError(null)}>{error}</Alert>}
      {message && <Alert tone="success" onDismiss={() => setMessage(null)}>{message}</Alert>}

      <Card as="form" onSubmit={save} title="Personal information" description="Fields managed by HR are read-only." icon={UserRound} accent="brand">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Full name"><Input value={employee?.full_name ?? "Loading…"} readOnly /></Field>
          <Field label="Employee number"><Input value={employee?.employee_number ?? ""} readOnly /></Field>
          <Field label="Work email"><Input value={employee?.work_email ?? ""} readOnly /></Field>
          <Field label="Personal email" optional><Input type="email" value={personalEmail} onChange={(event) => setPersonalEmail(event.target.value)} autoComplete="email" /></Field>
          <Field label="Phone" optional><Input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" /></Field>
          <Field label="Fallback avatar" helper="Shown when no profile picture is uploaded.">
            <Select value={avatarKey} onChange={(event) => setAvatarKey(event.target.value)}><option value="">Initials</option><option value="blue">Blue avatar</option><option value="green">Green avatar</option><option value="violet">Violet avatar</option><option value="amber">Amber avatar</option></Select>
          </Field>
        </div>

        <div className="mt-6 grid gap-5 border-t border-line-soft pt-6 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex items-center gap-4">
            {imageId ? (
              <Image src={imagesApi.imageContentUrl(imageId)} alt="Profile preview" width={64} height={64} unoptimized className="h-16 w-16 rounded-full object-cover ring-4 ring-surface-muted" />
            ) : (
              <span className={cx("flex h-16 w-16 items-center justify-center rounded-full text-body font-bold text-white ring-4 ring-surface-muted", avatarClass(avatarKey))} aria-hidden="true">{initials(employee?.full_name)}</span>
            )}
          </div>
          <div>
            <FileInput accept="image/jpeg,image/png,image/gif" disabled={uploading} onChange={(event) => void uploadProfileImage(event.target.files?.[0])} hint="JPEG, PNG or GIF, up to 5 MB." fileName={uploading ? `Uploading… ${uploadProgress}%` : undefined} />
            {uploading && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} aria-label="Upload progress">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button type="submit" loading={saving} loadingLabel="Saving…" leadingIcon={<Save className="h-4 w-4" />} disabled={!employee}>Save changes</Button>
        </div>
      </Card>

      {employee && (
        <Card title="Employment summary" description="Managed by HR. Ask HR to correct anything here." icon={Briefcase} accent="hr">
          {employee.current_employment ? (
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {([
                ["Employee number", employee.employee_number],
                ["Department / functional area", employee.current_employment.department],
                ["Position", employee.current_employment.position],
                ["Grade", employee.current_employment.grade],
                ["Location", employee.current_employment.location],
                ["Employment type", humanizeEnum(employee.current_employment.employment_type)],
                ["Manager", employee.current_employment.manager],
                ["In this role since", formatDate(employee.current_employment.start_date)],
                ["Hire date", formatDate(employee.hire_date)],
              ] as Array<[string, string | null | undefined]>).map(([label, value]) => (
                <div key={label} className="rounded-lg bg-surface-muted/70 p-3"><dt className="text-caption text-ink-muted">{label}</dt><dd className="mt-0.5 text-sm font-semibold text-ink-strong">{value || "—"}</dd></div>
              ))}
            </dl>
          ) : <p className="text-support text-ink-muted">No current employment is recorded for you yet.</p>}
        </Card>
      )}
    </div>
  );
}

function initials(name?: string | null) { return (name ?? "ErgonX").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function avatarClass(key: string) { return key === "green" ? "bg-mod-accounting" : key === "violet" ? "bg-mod-recruitment" : key === "amber" ? "bg-mod-payroll" : key === "blue" ? "bg-primary" : "bg-brand-ink"; }
