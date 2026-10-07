"use client";

import { BarChart3, BookOpenCheck, Building2, CalendarRange, ChartNoAxesCombined, Landmark, ReceiptText, Settings2, ShieldCheck, WalletCards } from "lucide-react";

import ModuleLanding from "@/components/home/ModuleLanding";

const areas = [
  { title: "Accounting Dashboard", description: "Review receivables, payables, journal status, and financial position summaries.", href: "/accounting/dashboard", icon: ChartNoAxesCombined, permission: "dashboard.finance.view" },
  { title: "Accounting Setup", description: "Review or apply an authorized localization preset and configure accounting readiness.", href: "/accounting/ghana-setup", icon: Settings2, permission: "accounting.configure" },
  { title: "Tax & Ghana Localisation", description: "Review the statutory tax and withholding catalogue for the active accounting preset.", href: "/accounting/localization", icon: ShieldCheck, permission: "account.view" },
  { title: "Chart of Accounts", description: "Browse and maintain the active institution's chart of accounts.", href: "/accounting/chart-of-accounts", icon: BookOpenCheck, permission: "account.view" },
  { title: "Fiscal Periods", description: "Manage fiscal years and controlled accounting periods.", href: "/accounting/periods", icon: CalendarRange, permission: "account.view" },
  { title: "Journals", description: "Review controlled journal workflows and create journals when authorized.", href: "/accounting/journals", icon: ReceiptText, permission: "journal.view" },
  { title: "Accounts Payable", description: "Manage vendor bills, approvals, posting, and payable workflow.", href: "/accounting/payables", icon: WalletCards, permission: "vendor_bill.view" },
  { title: "Accounts Receivable", description: "Manage customer invoices and receivable workflow.", href: "/accounting/receivables", icon: Building2, permission: "invoice.view" },
  { title: "Banking", description: "Review bank accounts, settlement, and statement reconciliation.", href: "/accounting/banking", icon: Landmark, permission: "bank_account.view" },
  { title: "Payroll-to-GL Mapping", description: "Review and maintain effective payroll component accounting mappings.", href: "/accounting/payroll-mappings", icon: ReceiptText, permission: "payroll_accounting.view" },
  { title: "Financial Reports", description: "Review trial balance and available source-backed accounting reporting.", href: "/accounting/reports", icon: BarChart3, permission: "account.view" },
];

export default function AccountingPage() {
  return <ModuleLanding title="Accounting" description="Manage financial configuration, controlled workflows, and reporting." module="ACCOUNTING" accent="accounting" icon={Landmark} eyebrow="Finance" areas={areas} />;
}
