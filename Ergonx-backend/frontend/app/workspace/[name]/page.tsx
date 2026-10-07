"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
const paths: Record<string, string> = { executive: "dashboards/executive", hr: "dashboards/hr", leave: "dashboards/leave", attendance: "dashboards/attendance", payroll: "dashboards/payroll", finance: "dashboards/finance" };
const reportNames = ["workforce-cost", "leave", "attendance", "payroll", "accounting", "ap-ar", "expenses"];

function requestHeaders() {
  const headers: Record<string, string> = {};
  const token = window.localStorage.getItem("ergonx.accessToken");
  const institutionId = window.localStorage.getItem("ergonx.institutionId");
  if (token) headers.Authorization = `Bearer ${token}`;
  if (institutionId) headers["X-Institution-ID"] = institutionId;
  return headers;
}

export default function Workspace({ params }: { params: Promise<{ name: string }> }) {
  const [name, setName] = useState(""); const [data, setData] = useState<Record<string, unknown> | null>(null); const [error, setError] = useState("");
  useEffect(() => { params.then(({ name: workspace }) => { setName(workspace); const path = paths[workspace]; if (!path) return; fetch(`${apiUrl}/${path}/`, { headers: requestHeaders() }).then(response => response.ok ? response.json() : Promise.reject(response.status)).then(setData).catch(() => setError("Sign in and select an institution to load live metrics.")); }); }, [params]);

  async function downloadReport(report: string) {
    try { const response = await fetch(`${apiUrl}/reports/${report}/?export=csv`, { headers: requestHeaders() }); if (!response.ok) throw new Error("Export unavailable"); const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${report}.csv`; anchor.click(); URL.revokeObjectURL(url); } catch { setError("The report could not be exported. Confirm your sign-in and institution selection."); }
  }

  if (name === "reports") return <main><Link href="/">Back to workspaces</Link><h1>Reports & exports</h1><p>Download spreadsheet-ready CSV exports for the current institution.</p>{error && <p className="notice">{error}</p>}<div className="cards">{reportNames.map(report => <button className="card button-card" key={report} onClick={() => downloadReport(report)}>{report}<span>Download CSV</span></button>)}</div></main>;
  return <main><Link href="/">Back to workspaces</Link><p className="eyebrow">{name}</p><h1>{name} dashboard</h1>{error && <p className="notice">{error} <Link href="/login">Sign in</Link></p>}{data ? <section className="metrics">{Object.entries(data).map(([key, value]) => <article key={key}><small>{key.replaceAll("_", " ")}</small><strong>{typeof value === "object" ? JSON.stringify(value) : String(value)}</strong></article>)}</section> : !error && <p>Loading live metrics…</p>}</main>;
}
