"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
const modules: Record<string, { title: string; resources: Record<string, string> }> = {
  employees: { title: "Employees", resources: { Employees: "employees", Employments: "employments" } },
  leave: { title: "Leave", resources: { Requests: "leave-requests", Balances: "leave-balances", Policies: "leave-policies" } },
  attendance: { title: "Attendance", resources: { Records: "attendance-records", Adjustments: "attendance-adjustments", Overtime: "overtime-records" } },
  payroll: { title: "Payroll", resources: { Runs: "payroll-runs", Periods: "payroll-periods", Payslips: "payslips" } },
  accounting: { title: "Accounting", resources: { Journals: "journal-entries", Accounts: "accounts", Expenses: "expenses", Invoices: "invoices", "Vendor bills": "vendor-bills" } },
};

function headers() { const token = localStorage.getItem("ergonx.accessToken"); const institutionId = localStorage.getItem("ergonx.institutionId"); return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(institutionId ? { "X-Institution-ID": institutionId } : {}) }; }
function rowsFrom(payload: unknown): Record<string, unknown>[] { if (Array.isArray(payload)) return payload as Record<string, unknown>[]; if (payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown[] }).results)) return (payload as { results: Record<string, unknown>[] }).results; return []; }

export default function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const [moduleKey, setModuleKey] = useState(""); const [resource, setResource] = useState(""); const [rows, setRows] = useState<Record<string, unknown>[]>([]); const [error, setError] = useState("");
  const module = modules[moduleKey];
  useEffect(() => { params.then(({ module }) => { setModuleKey(module); setResource(Object.values(modules[module]?.resources ?? {})[0] ?? ""); }); }, [params]);
  useEffect(() => { if (!resource) return; setError(""); fetch(`${apiUrl}/${resource}/`, { headers: headers() }).then(response => response.ok ? response.json() : Promise.reject(response.status)).then(payload => setRows(rowsFrom(payload))).catch(() => setError("Sign in with an institution that has access to this module.")); }, [resource]);
  if (!module) return <main><Link href="/">Back to workspaces</Link><h1>Unknown module</h1></main>;
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row)))).slice(0, 6);
  return <main><Link href="/">Back to workspaces</Link><p className="eyebrow">Operational module</p><h1>{module.title}</h1><nav className="resource-tabs">{Object.entries(module.resources).map(([label, path]) => <button className={resource === path ? "active" : ""} onClick={() => setResource(path)} key={path}>{label}</button>)}</nav>{error ? <p className="notice">{error} <Link href="/login">Sign in</Link></p> : <div className="table-wrap"><table><thead><tr>{columns.map(column => <th key={column}>{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map(column => <td key={column}>{typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}{!rows.length && <tr><td colSpan={Math.max(columns.length, 1)}>No records found.</td></tr>}</tbody></table></div>}</main>;
}
