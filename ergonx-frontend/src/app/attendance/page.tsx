"use client";

import { CalendarClock, Clock3, LayoutDashboard, Radio, Repeat, Timer, Users, Wrench } from "lucide-react";

import ModuleLanding from "@/components/home/ModuleLanding";

const areas = [
  { title: "Attendance Dashboard", description: "Coverage, lateness and absence trends across the institution.", href: "/attendance/dashboard", icon: LayoutDashboard, permission: "dashboard.attendance.view" },
  { title: "Live Attendance", description: "Who has clocked in today and who is late or absent.", href: "/attendance/live", icon: Radio, permission: "attendance.view" },
  { title: "Adjustments", description: "Review attendance correction requests.", href: "/attendance/adjustments", icon: Wrench, permission: "attendance.approve" },
  { title: "Overtime", description: "Review and approve recorded overtime.", href: "/attendance/overtime", icon: Timer, permission: "attendance.approve" },
  { title: "Schedules", description: "Work schedules and who they are assigned to.", href: "/attendance/schedules", icon: CalendarClock, permission: "schedule.view" },
  { title: "Shifts", description: "Define shift times and breaks.", href: "/attendance/shifts", icon: Clock3, permission: "schedule.manage" },
  { title: "Shift Patterns", description: "Weekly patterns built from shifts.", href: "/attendance/shift-patterns", icon: Repeat, permission: "schedule.manage" },
  { title: "Rotations", description: "Rotating patterns for shift-based teams.", href: "/attendance/rotations", icon: Repeat, permission: "schedule.manage" },
  { title: "Flexible Work", description: "Rules for flexible and remote working hours.", href: "/attendance/flexible-work", icon: Users, permission: "schedule.manage" },
];

export default function AttendanceHomePage() {
  return <ModuleLanding title="Attendance" eyebrow="Time & attendance" description="Track attendance, approve corrections and manage schedules." module="ATTENDANCE" accent="attendance" icon={Clock3} areas={areas} />;
}
