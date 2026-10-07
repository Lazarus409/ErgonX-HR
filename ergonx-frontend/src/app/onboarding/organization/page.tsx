"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/guards/AuthProvider";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import { getApiErrorMessage, institutionsApi, organizationApi } from "@/lib/api";
import type { Department, Grade, Location, Position } from "@/types/hr";
import { buttonClasses } from "@/components/ui/Button";

type StarterForm = {
  departmentName: string;
  gradeName: string;
  locationName: string;
  city: string;
  positionTitle: string;
};

const initialForm: StarterForm = {
  departmentName: "", gradeName: "", locationName: "", city: "", positionTitle: "",
};

function existingByName<T>(items: T[], name: string, nameOf: (item: T) => string): T | undefined {
  return items.find((item) => nameOf(item).trim().toLowerCase() === name.trim().toLowerCase());
}

export default function OrganizationStarterPage() {
  const router = useRouter();
  const { institution } = useAuth();
  const [form, setForm] = useState<StarterForm>(initialForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (key: keyof StarterForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (Object.values(form).some((value) => !value.trim())) {
      setError("Complete every starter structure field.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      // A failed multi-request attempt can be retried safely: records with the
      // same name are re-used instead of creating duplicates. Codes are generated.
      const lookups = await organizationApi.loadOrganizationLookups();
      let department: Department | undefined = existingByName(lookups.departments, form.departmentName, (item) => item.name);
      const grade: Grade | undefined = existingByName(lookups.grades, form.gradeName, (item) => item.name);
      const location: Location | undefined = existingByName(lookups.locations, form.locationName, (item) => item.name);
      const position: Position | undefined = existingByName(lookups.positions, form.positionTitle, (item) => item.title);

      if (!department) {
        department = await organizationApi.createDepartment({ name: form.departmentName.trim(), is_active: true });
      }
      if (!grade) {
        await organizationApi.createGrade({ name: form.gradeName.trim(), level: 1, is_active: true });
      }
      if (!location) {
        await organizationApi.createLocation({ name: form.locationName.trim(), city: form.city.trim(), country: "GH", timezone: "Africa/Accra", is_active: true });
      }
      if (!position) {
        await organizationApi.createPosition({ title: form.positionTitle.trim(), department: department.id, is_active: true });
      }
      await institutionsApi.validateInstitutionOnboarding();
      router.replace("/onboarding");
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Create starter organization structure" description="These four records are the minimum Core HR structure required before institution setup can be validated." actions={<Link href="/onboarding" className="rounded-lg border border-line-strong px-3 py-2 text-sm font-semibold">Back to setup</Link>} />
      {error && <ErrorState title="Could not create starter structure" message={error} />}
      <section className="rounded-2xl border border-line bg-surface p-6">
        <p className="text-sm text-ink-muted">Creating records for {institution?.name ?? "your institution"}. Reference codes are generated automatically.</p>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Section title="Department / Functional Area"><Input label="Department / Functional Area name" value={form.departmentName} onChange={(value) => update("departmentName", value)} /></Section>
          <Section title="Grade"><Input label="Grade name" value={form.gradeName} onChange={(value) => update("gradeName", value)} /></Section>
          <Section title="Location"><Input label="Location name" value={form.locationName} onChange={(value) => update("locationName", value)} /><Input label="City" value={form.city} onChange={(value) => update("city", value)} /></Section>
          <Section title="Position"><Input label="Position title" value={form.positionTitle} onChange={(value) => update("positionTitle", value)} /></Section>
        </div>
        <div className="mt-7 flex justify-end"><button type="button" disabled={saving} onClick={() => void save()} className={buttonClasses({ variant: "primary", size: "lg" })}>{saving ? "Creating structure..." : "Create starter structure"}</button></div>
      </section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-line p-4"><h2 className="font-semibold">{title}</h2><div className="mt-4 space-y-3">{children}</div></div>;
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium text-ink">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full h-9 rounded-lg border border-line-strong px-3" /></label>;
}
