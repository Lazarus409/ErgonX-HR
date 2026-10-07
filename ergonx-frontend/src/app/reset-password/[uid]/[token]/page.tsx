"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";

import AuthShell, { AuthHeading } from "@/components/brand/AuthShell";
import Alert from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import PasswordStrength from "@/components/ui/PasswordStrength";
import { authApi, getApiErrorMessage } from "@/lib/api";

export default function ResetPasswordPage() {
  const { uid, token } = useParams<{ uid: string; token: string }>();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("The new password and confirmation do not match.");
      return;
    }
    setSaving(true);
    try {
      await authApi.confirmPasswordReset({ uid, token, new_password: password });
      setSuccess(true);
      window.setTimeout(() => router.replace("/login"), 1300);
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthShell>
      <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary" aria-hidden="true"><KeyRound className="h-6 w-6" /></span>
      <AuthHeading title="Choose a new password" description="Use a strong password you have not used elsewhere." />
      {success ? (
        <Alert tone="success" title="Password updated">Redirecting you to sign in…</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="New password">
            <Input required minLength={8} type="password" size="lg" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <PasswordStrength value={password} />
          <Field label="Confirm new password" error={confirmation && password !== confirmation ? "Passwords do not match yet." : null}>
            <Input required minLength={8} type="password" size="lg" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </Field>
          <Button type="submit" variant="strong" size="lg" block loading={saving} loadingLabel="Updating…">Set new password</Button>
        </form>
      )}
      <Link href="/login" className="mt-6 block text-center text-support font-semibold text-ink-muted hover:text-ink-strong">Return to sign in</Link>
    </AuthShell>
  );
}
