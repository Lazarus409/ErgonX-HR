"use client";

import { useParams } from "next/navigation";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import AuthShell, { AuthHeading } from "@/components/brand/AuthShell";
import Alert from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { authApi, getApiErrorMessage } from "@/lib/api";
import type { InvitationAccessPreview, InvitationDetails } from "@/lib/api/auth";

export default function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [acceptedPreview, setAcceptedPreview] = useState<InvitationAccessPreview | null>(null);
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    authApi.getInvitation(token).then(setDetails).catch((caught) => setError(getApiErrorMessage(caught)));
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await authApi.acceptInvitation(token, {
        password,
        first_name: firstName,
        last_name: lastName,
      });
      setAccepted(true);
      setAcceptedPreview(result.access_preview ?? details?.access_preview ?? null);
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const preview = acceptedPreview ?? details?.access_preview;

  return (
    <AuthShell>
      {accepted ? (
        <div>
          <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-success-soft text-success" aria-hidden="true"><CheckCircle2 className="h-6 w-6" /></span>
          <AuthHeading eyebrow="Access configured" title="You're ready to sign in." description={`Your ${preview?.role_name ?? details?.role_name ?? ""} access for ${details?.institution_name ?? "your institution"} has been activated.`} />
          {preview && <AccessPreview preview={preview} />}
          <ButtonLink href="/login" variant="strong" size="lg" block className="mt-8">Sign in to ErgonX</ButtonLink>
        </div>
      ) : (
        <form onSubmit={submit}>
          <AuthHeading eyebrow="ErgonX invitation" title="Accept invitation" description={details ? `Join ${details.institution_name} as ${details.role_name} using ${details.email}.` : undefined} />
          {!details && !error && <div className="space-y-3" aria-label="Loading invitation"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-24 w-full rounded-2xl" /></div>}
          {preview && <AccessPreview preview={preview} />}
          {details?.existing_account && <Alert tone="info" className="mt-5">This email already has an ErgonX account. Enter its current password to add this role.</Alert>}
          {error && <Alert tone="danger" className="mt-5">{error}</Alert>}
          {details && (
            <div className="mt-6 space-y-4">
              {!details.existing_account && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First name"><Input required value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" /></Field>
                  <Field label="Last name"><Input required value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" /></Field>
                </div>
              )}
              <Field label={details.existing_account ? "Current password" : "Create password"}>
                <Input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={details.existing_account ? "current-password" : "new-password"} />
              </Field>
              <Button type="submit" variant="strong" size="lg" block loading={saving} loadingLabel="Activating access…">Accept invitation</Button>
            </div>
          )}
        </form>
      )}
    </AuthShell>
  );
}

function AccessPreview({ preview }: { preview: InvitationAccessPreview }) {
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface-muted/60 p-5" aria-label="Your access">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-strong"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />Your access</p>
      <p className="mt-2 text-support text-ink-muted">Role: <span className="font-semibold text-ink-strong">{preview.role_name}</span></p>
      <div className="mt-4 flex flex-wrap gap-2">
        {preview.modules.length ? preview.modules.map((module) => <Badge key={module.code} tone="brand">{module.name}</Badge>) : <span className="text-support text-ink-muted">Your administrator will enable the applicable modules.</span>}
      </div>
    </section>
  );
}
