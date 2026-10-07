"use client";

import { GraduationCap } from "lucide-react";

import EmployeeTrainingList from "@/components/hr/EmployeeTrainingList";
import PageHeader from "@/components/ui/PageHeader";

/** The signed-in employee's training and certificates (ErgonX HR). */
export default function MyTrainingPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="My training" description="Your courses, completions and certificates." icon={GraduationCap} accent="hr" />
      <EmployeeTrainingList mine />
    </div>
  );
}
