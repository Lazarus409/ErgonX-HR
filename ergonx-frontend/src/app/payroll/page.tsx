"use client";

import {
  Banknote,
  CalendarDays,
  FileCog,
  FileText,
  GitPullRequest,
  IdCard,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import ModuleLanding from "@/components/home/ModuleLanding";
import PayrollWorkflow from "@/components/payroll/PayrollWorkflow";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const payrollPages = [
  {
    title: "Payroll Dashboard",
    description: "View payroll KPIs, current runs, workflow status and recent activity.",
    href: "/payroll/dashboard",
    permission: "dashboard.payroll.view",
    icon: LayoutDashboard,
  },
  {
    title: "Pay Components",
    description: "Manage earnings, deductions and employer contribution components.",
    href: "/payroll/components",
    permission: "payroll.view",
    icon: Banknote,
  },
  {
    title: "Salary Structures",
    description: "Create salary structures and associate approved pay components.",
    href: "/payroll/salary-structures",
    permission: "payroll.view",
    icon: WalletCards,
  },
  {
    title: "Payroll Periods",
    description: "Manage payroll periods, dates and processing status.",
    href: "/payroll/periods",
    permission: "payroll.view",
    icon: CalendarDays,
  },
  {
    title: "Payroll Runs",
    description: "Review payroll calculations, approvals and finalised runs.",
    href: "/payroll/runs",
    permission: "payroll.view",
    icon: GitPullRequest,
  },
  {
    title: "Payroll Adjustments",
    description: "Create, review and approve payroll adjustments.",
    href: "/payroll/adjustments",
    permission: "payroll.view",
    icon: FileCog,
  },
  {
    title: "Payslips",
    description: "View and access employee payslips generated from payroll runs.",
    href: "/payroll/payslips",
    permission: "payroll.view",
    icon: FileText,
  },
  {
    title: "Payroll Configuration",
    description: "Configure institution-level payroll settings and mappings.",
    href: "/payroll/configuration",
    permission: "payroll.configure",
    icon: Settings,
  },
  {
    title: "Employee Payroll Profiles",
    description: "Maintain employee tax residency and tax identifiers used by payroll policy.",
    href: "/payroll/employee-profiles",
    permission: "payroll.view",
    icon: IdCard,
  },
  {
    title: "Ghana Payroll Setup",
    description: "Configure the institution's Ghana payroll preset or custom setup.",
    href: "/payroll/ghana-setup",
    permission: "payroll.configure",
    icon: ShieldCheck,
  },
];

export default function PayrollPage() {
  return (
    <ModuleLanding
      title="Payroll"
      eyebrow="Payroll"
      description="Manage payroll configuration, salary structures, payroll periods, payroll runs, adjustments and payslips."
      module="PAYROLL"
      accent="payroll"
      icon={WalletCards}
      areas={payrollPages}
      actions={<ButtonLink href="/payroll/runs" leadingIcon={<GitPullRequest className="h-4 w-4" />}>View payroll runs</ButtonLink>}
    >
      <Card title="Payroll workflow" description="Every run follows the controlled processing lifecycle below." accent="payroll" accentLine>
        <PayrollWorkflow />
      </Card>
    </ModuleLanding>
  );
}
