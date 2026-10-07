"use client";

import { CalendarDays, CalendarRange, LayoutDashboard, ListChecks, SlidersHorizontal } from "lucide-react";

import ModuleLanding from "@/components/home/ModuleLanding";

const areas = [
  { title: "Leave Dashboard", description: "Balances, approvals and leave taken across the institution.", href: "/leave/dashboard", icon: LayoutDashboard, permission: "dashboard.leave.view" },
  { title: "Leave Requests", description: "Review, approve and reject submitted leave requests.", href: "/leave/requests", icon: ListChecks, permission: "leave.view" },
  { title: "Leave Calendar", description: "See approved and pending leave by day to plan coverage.", href: "/leave/calendar", icon: CalendarRange, permission: "leave.view" },
  { title: "Types & Policies", description: "Configure leave types, entitlements and eligibility rules.", href: "/leave/policies", icon: SlidersHorizontal, permission: "leave.configure" },
];

export default function LeaveHomePage() {
  return <ModuleLanding title="Leave" eyebrow="Leave management" description="Manage leave requests, balances and policies for the institution." module="LEAVE" accent="leave" icon={CalendarDays} areas={areas} />;
}
