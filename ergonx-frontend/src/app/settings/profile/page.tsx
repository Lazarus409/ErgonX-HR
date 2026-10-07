"use client";

import Link from "next/link";
import { Accessibility, Bell, Calendar, Check, Globe, Hash, Monitor, Moon, Palette, Pin, Save, Sun } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { useTheme, type ThemePreference } from "@/components/context/ThemeProvider";
import { useAuth } from "@/components/guards/AuthProvider";
import { Button } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import { getApiErrorMessage, homeApi, institutionsApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { DISPLAY_PREFERENCE_KEY, getDisplayPreferences, normalizeDisplay, rememberDisplayPreferences, type DisplayPreferences } from "@/lib/displayPreferences";
import { useApiResource } from "@/lib/useApiResource";

type PreferenceData = Awaited<ReturnType<typeof institutionsApi.listMyPreferences>>;

function pinnedCodes(preferences: PreferenceData): string[] {
  const preference = preferences.find((item) => item.preference_key === "quick_actions");
  const value = preference?.value_json.pinned;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const SAMPLE = new Date(2026, 0, 12, 14, 30);

function Section({ icon: Icon, title, description, children }: { icon: typeof Globe; title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1 sm:p-6">
      <div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-ink" aria-hidden="true"><Icon className="h-5 w-5" /></span><div><h2 className="text-card-title font-semibold text-ink-strong">{title}</h2><p className="mt-0.5 text-support text-ink-muted">{description}</p></div></div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Choice<T extends string | boolean>({ value, current, onChange, label, hint }: { value: T; current: T; onChange: (value: T) => void; label: string; hint?: string }) {
  const selected = value === current;
  return (
    <button type="button" aria-pressed={selected} onClick={() => onChange(value)} className={cx("flex items-start gap-3 rounded-lg border p-3 text-left transition", selected ? "border-primary bg-primary-soft ring-1 ring-primary/20" : "border-line hover:bg-surface-hover")}>
      <span className={cx("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-primary bg-primary text-white" : "border-line-strong")}>{selected && <Check className="h-3 w-3" strokeWidth={3} />}</span>
      <span><span className="block text-sm font-semibold text-ink-strong">{label}</span>{hint && <span className="block text-caption text-ink-muted">{hint}</span>}</span>
    </button>
  );
}

/** Personal preferences (Stitch S050). Every control here changes real behaviour for this member only. */
export default function ProfileSettingsPage() {
  const { institution } = useAuth();
  const { preference: themePreference, setTheme } = useTheme();
  const load = useCallback(async () => {
    const [preferences, home] = await Promise.all([institutionsApi.listMyPreferences(), homeApi.getHome()]);
    return { preferences, actions: home.quick_actions };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);
  const initialPinned = useMemo(() => (data ? pinnedCodes(data.preferences) : []), [data]);
  const savedDisplay = useMemo(() => {
    const row = data?.preferences.find((item) => item.preference_key === DISPLAY_PREFERENCE_KEY);
    return row ? normalizeDisplay(row.value_json) : getDisplayPreferences();
  }, [data]);
  const [display, setDisplay] = useState<DisplayPreferences | null>(null);
  const [pinnedDraft, setPinnedDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const current = display ?? savedDisplay;
  const pinned = pinnedDraft ?? initialPinned;
  const dirty = display !== null || pinnedDraft !== null;

  const update = (patch: Partial<DisplayPreferences>) => { setSaved(false); setDisplay({ ...current, ...patch }); };
  const toggle = (code: string) => { setSaved(false); setPinnedDraft(pinned.includes(code) ? pinned.filter((item) => item !== code) : [...pinned, code]); };

  const save = async () => {
    setSaving(true); setSaveError(null); setSaved(false);
    try {
      if (display) {
        await institutionsApi.savePreference(DISPLAY_PREFERENCE_KEY, { ...display });
        rememberDisplayPreferences(display);
      }
      if (pinnedDraft) await institutionsApi.savePreference("quick_actions", { pinned: pinnedDraft });
      setDisplay(null); setPinnedDraft(null); setSaved(true); await reload();
    } catch (caught) { setSaveError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState title="Unable to load personal preferences" message={error ?? "Your preferences could not be loaded."} onRetry={reload} />;
  const sampleDate = current.dateStyle === "iso" ? "2026-01-12" : current.dateStyle === "numeric" ? "12/01/2026" : "12 Jan 2026";
  const sampleTime = SAMPLE.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: current.hour12 });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Personal preferences" description="How ErgonX looks and behaves for you. Other members are not affected."
        actions={<Button leadingIcon={<Save className="h-4 w-4" />} disabled={!dirty} loading={saving} loadingLabel="Saving…" onClick={() => void save()}>Save preferences</Button>} />
      {saveError && <ErrorState variant="inline" title="Preferences not saved" message={saveError} />}
      {saved && <p className="rounded-lg border border-success/25 bg-success-soft p-3 text-sm text-success-ink">Your preferences were saved.</p>}

      <Section icon={Globe} title="Language and region" description="Language and time zone used across the workspace.">
        <dl className="grid gap-3 sm:grid-cols-2 text-support">
          <div className="rounded-lg bg-surface-muted/70 p-3"><dt className="text-ink-muted">Language</dt><dd className="font-semibold text-ink-strong">English</dd><dd className="text-caption text-ink-muted">The only language available today.</dd></div>
          <div className="rounded-lg bg-surface-muted/70 p-3"><dt className="text-ink-muted">Time zone</dt><dd className="font-semibold text-ink-strong">{institution?.timezone ?? "Institution default"}</dd><dd className="text-caption text-ink-muted">Set by your institution.</dd></div>
        </dl>
      </Section>

      <Section icon={Calendar} title="Time and date" description={`Preview: ${sampleDate}, ${sampleTime}`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Choice value="medium" current={current.dateStyle} onChange={(dateStyle) => update({ dateStyle })} label="12 Jan 2026" hint="Day, short month, year" />
          <Choice value="numeric" current={current.dateStyle} onChange={(dateStyle) => update({ dateStyle })} label="12/01/2026" hint="Day/month/year" />
          <Choice value="iso" current={current.dateStyle} onChange={(dateStyle) => update({ dateStyle })} label="2026-01-12" hint="ISO 8601" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Choice value={false} current={current.hour12} onChange={(hour12) => update({ hour12 })} label="24-hour clock" hint="14:30" />
          <Choice value={true} current={current.hour12} onChange={(hour12) => update({ hour12 })} label="12-hour clock" hint="2:30 pm" />
        </div>
      </Section>

      <Section icon={Hash} title="Numbers and formats" description="Digit grouping for amounts and counts. Currency codes are unchanged.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice value="comma" current={current.numberStyle} onChange={(numberStyle) => update({ numberStyle })} label="1,234,567.89" hint="Comma groups, point decimals" />
          <Choice value="space" current={current.numberStyle} onChange={(numberStyle) => update({ numberStyle })} label="1 234 567,89" hint="Space groups, comma decimals" />
        </div>
      </Section>

      <Section icon={Palette} title="Appearance" description="Applies immediately on this browser.">
        <div className="grid gap-3 sm:grid-cols-3">
          {([["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "Match my device", Monitor]] as Array<[ThemePreference, string, typeof Sun]>).map(([value, label, Icon]) => (
            <button key={value} type="button" aria-pressed={themePreference === value} onClick={() => setTheme(value)} className={cx("flex items-center gap-3 rounded-lg border p-3 text-sm font-semibold", themePreference === value ? "border-primary bg-primary-soft text-ink-strong ring-1 ring-primary/20" : "border-line text-ink hover:bg-surface-hover")}><Icon className="h-4 w-4" aria-hidden="true" />{label}</button>
          ))}
        </div>
      </Section>

      <Section icon={Accessibility} title="Motion and accessibility" description="Your device's reduced-motion setting is always respected; this adds it for ErgonX.">
        <label className="flex items-center gap-3 text-sm text-ink-strong"><input type="checkbox" className="h-4 w-4" checked={current.reduceMotion} onChange={(event) => update({ reduceMotion: event.target.checked })} />Reduce motion and animations</label>
      </Section>

      <Section icon={Bell} title="Notifications" description="Every notification appears in ErgonX; choose which modules also email you.">
        <Link href="/notifications" className="text-sm font-semibold text-primary-ink hover:underline">Open notification preferences</Link>
      </Section>

      <Section icon={Pin} title="Home quick actions" description="Pin the actions you want first on Home. They stay permission- and module-aware.">
        <div className="grid gap-3 sm:grid-cols-2">
          {data.actions.map((action) => {
            const checked = pinned.includes(action.code);
            return <button key={action.code} type="button" onClick={() => toggle(action.code)} aria-pressed={checked} className={cx("flex items-center gap-3 rounded-lg border p-3 text-left", checked ? "border-primary bg-primary-soft ring-1 ring-primary/20" : "border-line hover:bg-surface-hover")}><span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", checked ? "border-primary bg-primary text-white" : "border-line-strong bg-surface")}>{checked && <Check size={14} strokeWidth={3} />}</span><span className="text-sm font-semibold text-ink-strong">{action.label}</span></button>;
          })}
        </div>
        {data.actions.length === 0 && <p className="rounded-lg bg-surface-muted p-4 text-sm text-ink-muted">No quick actions are currently authorized for your role.</p>}
      </Section>
    </div>
  );
}
