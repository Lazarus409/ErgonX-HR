# APEX-DEMO Route Coverage Audit

Audit date: 2026-09-22  
Scope: deterministic `seed_ergonx_demo`, frontend operational routes, and the APEX-DEMO development-only tenant.

| Route area | Seed evidence | Expected demo outcome | Follow-up check |
|---|---|---|---|
| Home / notifications | Active users, membership roles, workflow records, notification-producing actions, and four tenant-scoped `UserActivityEvent` records are seeded. The events point to an employee detail, candidate detail, leave-request detail, and journal detail. | Permission-aware quick actions, attention items, notification counts, and real Recent Work links | Verify each persona's Home after seed |
| Executive / HR dashboards | Employee records and employment dimensions are seeded | Workforce totals and status composition render | Confirm Director and Institution Admin access |
| Recruitment dashboard / pipeline | Recruitment stages, postings, candidates, applications, interviews, and offers are seeded | Pipeline-stage bars and recruitment KPI values render | Verify Recruitment Officer and HR Admin |
| Leave / attendance | Employee, leave, schedule, and attendance data are seeded | Current, pending, and operational list/dashboard states render | Verify Employee self-service and HR approval queues |
| Payroll / payslips | Payroll profiles, September 2026 period, adjustment, finalized run, records, and journal generation are seeded | Payroll dashboard, run detail, payslips and accounting handoff render | Verify Payroll Officer, Accountant, and Employee |
| Accounting | Presets, fiscal periods, bank data, invoices, bills, expenses, mappings, and journals are seeded | Finance dashboard, AP/AR, expenses, journals, and reports render | Verify Finance Manager, Accountant, Auditor |
| Reports | Operational records above are source rows for each report selector | Every report category has non-empty source-backed rows where relevant | Download each CSV and verify filename/content |
| Settings / audit | Institution roles, memberships, onboarding, and auditable seed/setup actions are present | Role access and audit history render for Institution Admin / Auditor | Confirm audit tenant isolation and redaction |
| Universal search | Employees, recruitment, and accounting references are seeded | Search returns only permitted, tenant-scoped results | Test at least HR Admin, Accountant, Employee |

## Idempotency gate

Run the command twice against PostgreSQL before demo handoff:

```powershell
cd Ergonx-backend
.\venv\Scripts\python.exe manage.py seed_ergonx_demo
.\venv\Scripts\python.exe manage.py seed_ergonx_demo
```

The command deliberately detects and rejects critical financial/profile drift rather than duplicating finalized payroll or financial effects. The required release check is to compare payroll-run, journal, invoice, vendor-bill, and payroll-record counts after each run and confirm the second run adds no financial consequences.

### Executed result — 2026-09-21

The command was run twice against the local PostgreSQL APEX-DEMO tenant. Counts were identical after each run:

| Record type | After first run | After second run |
|---|---:|---:|
| Payroll runs | 1 | 1 |
| Payroll records | 30 | 30 |
| Journals | 5 | 5 |
| Invoices | 1 | 1 |
| Vendor bills | 1 | 1 |

Result: passed. The second seed run created no duplicate financial consequences.

## Home activity validation — 2026-09-22

Two additional PostgreSQL seed runs retained exactly four activity events, alongside the unchanged financial counts above. `seed_ergonx_demo --validate-only` now verifies the four activity/entity pairs. The server-side Home payload resolved them to real detail routes for the relevant active personas:

| Persona | Activity | Resume route class |
|---|---|---|
| Institution Admin | Approve journal / Add employee | Accounting journal / HR employee |
| Recruitment Officer | Manage candidate | Recruitment candidate |
| Employee | Request leave | Leave request |

No new dashboard-metric records or financial side effects are created for this coverage.

## Browser evidence — 2026-09-22

Using the APEX-DEMO Institution Admin, a live browser pass confirmed that Home renders the authenticated shell, permission-aware navigation, live quick actions, notification count, and two Recent Work entries. An authenticated sweep of 16 operational routes (including every module dashboard, Settings/Audit, Notifications, self-service leave, payslips, and journals) rendered without page errors or error states. At 390px, Home, Executive, Settings, Audit, payslips, and journals reported no horizontal overflow. Selecting the seeded journal activity navigated to the exact posted-journal detail URL, where the source-backed journal-lines table and shared Back control rendered. The APEX-DEMO synthetic passwords were reset through the development-only `seed_ergonx_demo --reset-passwords` option to the documented seed password before this pass because the local records had drifted.

## Dashboard aggregate validation — 2026-09-22

The APEX-DEMO authoritative selectors currently return one September 2026 P&L point from posted journal lines: income `GHS 32,000.00`, expenses `GHS 280,756.00`, and net result `GHS -248,756.00`. Current-year LeaveBalance totals are 50 accrued days and 4 used days, which yields a source-backed 8% utilisation result. These are selector outputs, not browser-calculated values or seed-only dashboard records.

## Known coverage limitations

- The documented ten-persona login/bootstrap smoke passed on 2026-09-22; it proves session, tenant, landing, and permission payload delivery. It does not claim that every persona has had every route visually inspected.
- A 390px production-browser shell pass confirmed the mobile navigation control and permission-aware drawer. Tablet and route-by-route responsive visual review remain incremental QA work.
- Email delivery is intentionally not simulated; onboarding invitations provide a secure link for approved-channel sharing in the local environment.
- Trend charts are limited to fields exposed by source aggregates; no fake historical series is seeded solely for visual presentation.
