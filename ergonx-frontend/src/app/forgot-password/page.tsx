"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, Mail, MailCheck } from "lucide-react";

import AuthShell, { AuthHeading } from "@/components/brand/AuthShell";
import Alert from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { authApi, getApiErrorMessage } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await authApi.requestPasswordReset(email.trim());
      setSent(true);
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthShell>
      <Link href="/login" className="mb-8 inline-flex items-center gap-2 text-support font-semibold text-ink-muted hover:text-ink-strong"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to sign in</Link>
      <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary" aria-hidden="true"><MailCheck className="h-6 w-6" /></span>
      <AuthHeading title="Reset your password" description="Enter your sign-in email and we'll send a secure password reset link if an active account exists." />
      {sent ? (
        <Alert tone="success" title="Check your inbox">If an active ErgonX account matches that email, a password reset link has been sent. Check your inbox and spam folder.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Sign-in email"><Input required autoFocus type="email" size="lg" value={email} onChange={(event) => setEmail(event.target.value)} leadingIcon={<Mail />} autoComplete="email" /></Field>
          <Button type="submit" variant="strong" size="lg" block loading={saving} loadingLabel="Sending…">Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
