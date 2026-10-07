"use client";

import { Building2, GraduationCap, MapPin, UserRoundCog } from "lucide-react";

import ModuleLanding from "@/components/home/ModuleLanding";

const areas = [
  { title: "Departments / Functional Areas", description: "Add and organize departments / functional areas.", href: "/hr/departments", icon: Building2, permission: "organization.view" },
  { title: "Positions", description: "Add job positions and the department / functional area each belongs to.", href: "/hr/positions", icon: UserRoundCog, permission: "organization.view" },
  { title: "Grades", description: "Set up the grade levels used for employees and pay.", href: "/hr/grades", icon: GraduationCap, permission: "organization.view" },
  { title: "Locations", description: "Add offices, sites and remote arrangements.", href: "/hr/locations", icon: MapPin, permission: "organization.view" },
];

export default function OrganizationPage() {
  return <ModuleLanding title="Organization" description="Set up the departments, positions, grades and locations your people are organized into." module="HR" accent="hr" icon={Building2} eyebrow="Human Resources" areas={areas} />;
}
