"use client";

import Link from "next/link";
import { KeyRound, Save, UserRound } from "lucide-react";
import { useCallback, useState } from "react";

import { useAuth } from "@/components/guards/AuthProvider";
import { PlatformHero } from "@/components/platform/ui";
import Alert from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import PasswordStrength from "@/components/ui/PasswordStrength";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { authApi, getApiErrorMessage } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";

export default function PlatformProfilePage() {
  const { refreshSession } = useAuth();
  const load = useCallback(() => authApi.getAccountProfile(), []);
  const { data, loading: loadingProfile, error, reload } = useApiResource(load);
  const [profile, setProfile] = useState<{ first_name?: string; last_name?: string; email?: string }>({});
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); setSavingProfile(true); setProfileError(null); setProfileSuccess(false);
    try {
      await authApi.updateAccountProfile({
        first_name: profile.first_name ?? data?.first_name,
        last_name: profile.last_name ?? data?.last_name,
        email: profile.email ?? data?.email,
      });
      await refreshSession();
      setProfileSuccess(true);
      reload();
    } catch (caught) { setProfileError(getApiErrorMessage(caught)); } finally { setSavingProfile(false); }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault(); setPasswordError(null); setPasswordSuccess(false);
    if (newPassword !== confirmPassword) { setPasswordError("The new password and confirmation do not match."); return; }
    setSavingPassword(true);
    try {
      await authApi.changePassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setPasswordSuccess(true);
    } catch (caught) { setPasswordError(getApiErrorMessage(caught)); } finally { setSavingPassword(false); }
  };

  // The /platform layout already guards access and renders the console header.
  if (loadingProfile && !data) return <LoadingState />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
        {error || !data ? (
          <ErrorState message={error ?? "Could not load your account."} onRetry={reload} />
        ) : (
          <>
            <PlatformHero title="Your Super Admin profile" subtitle="Manage your platform identity and account security." />
            <div className="grid gap-6 lg:grid-cols-2">
              <Card as="form" onSubmit={saveProfile} title="Profile details" description="Your email is your sign-in identifier." icon={UserRound} accent="brand">
                <div className="space-y-4">
                  {profileError && <Alert tone="danger">{profileError}</Alert>}
                  {profileSuccess && <Alert tone="success">Profile saved successfully.</Alert>}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="First name" required><Input value={profile.first_name ?? data.first_name ?? ""} onChange={(event) => setProfile((current) => ({ ...current, first_name: event.target.value }))} autoComplete="given-name" /></Field>
                    <Field label="Last name" required><Input value={profile.last_name ?? data.last_name ?? ""} onChange={(event) => setProfile((current) => ({ ...current, last_name: event.target.value }))} autoComplete="family-name" /></Field>
                    <Field label="Sign-in email" required className="sm:col-span-2"><Input type="email" value={profile.email ?? data.email ?? ""} onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))} autoComplete="email" /></Field>
                  </div>
                  <Button type="submit" loading={savingProfile} loadingLabel="Saving…" leadingIcon={<Save className="h-4 w-4" />}>Save profile</Button>
                </div>
              </Card>
              <Card as="form" onSubmit={changePassword} title="Password and security" description="Set a new password by confirming your current password." icon={KeyRound} accent="brand">
                <div className="space-y-4">
                  {passwordError && <Alert tone="danger">{passwordError}</Alert>}
                  {passwordSuccess && <Alert tone="success">Your password has been updated.</Alert>}
                  <Field label="Current password" required><Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></Field>
                  <Field label="New password" required><Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></Field>
                  <PasswordStrength value={newPassword} />
                  <Field label="Confirm new password" required error={confirmPassword && newPassword !== confirmPassword ? "Passwords do not match yet." : null}><Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></Field>
                  <Button type="submit" loading={savingPassword} loadingLabel="Updating…" leadingIcon={<KeyRound className="h-4 w-4" />}>Change password</Button>
                  <p className="border-t border-line-soft pt-4 text-caption text-ink-muted">Forgot your password? Use the <Link className="font-semibold text-primary-ink underline" href="/forgot-password">email reset page</Link> to receive a secure reset link.</p>
                </div>
              </Card>
            </div>
          </>
        )}
    </div>
  );
}
