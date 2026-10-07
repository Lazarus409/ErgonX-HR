# ErgonX integrated demo dataset

Run the development-only seed from `Ergonx-backend`:

```powershell
python manage.py seed_ergonx_demo
python manage.py seed_ergonx_demo --validate-only
```

The command owns only the reserved `CSA-DEMO` institution. It is idempotent
and refuses to run with `DEBUG=False`.

## Current seeded scope

- 30 users, employees, current employments, compensation records, and payroll profiles.
- Organization, RBAC personas, Ghana payroll preset, and Ghana commercial accounting preset.
- Recruitment: three postings, eight applications, four interviews, two offers, and one linked employee handoff.
- Leave: annual and sick policies plus pending, approved, and draft requests.
- Attendance: four schedules, 30 assignments, present/late/night/on-leave scenarios, and approved/pending overtime.
- Payroll: September 2026 finalized run, 30 records, and 30 payslips.
- Accounting: FY2026, September period, a posted payroll journal, vendor bill/payment, customer invoice/partial receipt, bank account, and pending expense.

## Deliberate limitations

- Recruitment requisitions are not seeded because the live Recruitment model begins with job postings.
- Ghana casual-worker withholding is mapped by the Ghana accounting preset to
  debit `NET_PAY_PAYABLE` and credit `PAYE_PAYABLE`; payroll-to-GL is created
  and posted through the normal journal workflow.
