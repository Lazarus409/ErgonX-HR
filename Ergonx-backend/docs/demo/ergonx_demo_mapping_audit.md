# ErgonX Integrated Demo Seed: Runtime Mapping Audit

Status: implementation baseline  
Reviewed: 2026-09-17  
Sources: `ERGONX_CODEX_DEMO_SEED_IMPLEMENTATION_SPEC_v1.0.md`,
`ERGONX_INTEGRATED_DEMO_DATASET_v1.0.xlsx`, and the canonical backend runtime.

## Purpose

The integrated demo command must create one isolated `CSA-DEMO` institution
through domain services. The workbook is a data specification, not a runtime
import. This audit identifies the currently supported seed paths before the
command is implemented.

## Runtime mapping

| Seed area | Runtime support | Intended implementation |
| --- | --- | --- |
| Institution, modules, onboarding | Supported | `Institution`, `InstitutionModule`, `bootstrap_institution`, and `validate_institution_onboarding`. |
| Built-in and custom roles | Supported | Reuse bootstrapped roles; create custom roles via `create_custom_role` with permission codes resolved from the runtime catalogue. |
| Users and memberships | Supported | `User`, `InstitutionMembership`, and `create_membership`; all identities remain within `@csa.test`. |
| Organization | Supported | `Department`, `Position`, `Grade`, and `Location`; stable workbook codes are supported. |
| Employees, employment, onboarding | Supported | `Employee`, `Employment`, `create_employment`, and `EmployeeOnboarding`; employee number is the stable key. |
| Compensation and payroll profiles | Supported | `change_current_compensation`, `EmployeePayrollProfile`, and governed payroll profile services. |
| Recruitment pipeline | Supported with adaptation | `JobPosting`, `Candidate`, `Application`, stages, interviews, evaluations, offers, and `hire_candidate` are supported through workflow services. |
| Leave | Supported | Leave type/policy/balance models and create/submit/approve services are available. |
| Scheduling, attendance, overtime | Supported | Shifts, shift patterns, flexible rules, work schedules, assignments, attendance classification, and overtime approval are available. |
| Ghana payroll | Supported | Existing payroll configuration, period/run, adjustment, calculation, approval, finalization, reconciliation, and payslip services are available. |
| Accounting and payroll-to-GL | Supported | Ghana accounting preset, periods, AP/AR/cash/expense services, payroll mappings, journal workflow, and posting are available. |
| Home, notifications, search | Supported by selectors | Seed operational workflow states and let Home/search/notification services produce the experience; no copied Home table will be created. |

## Required adaptations and exclusions

1. **Recruitment requisitions are not a runtime entity.** The canonical
   recruitment module starts at `JobPosting`. Workbook requisition scenarios
   will be reported as `SKIPPED_UNSUPPORTED`; their business intent will be
   represented by the supported job postings where possible.
2. **Not every workbook business reference has a matching persisted reference
   field.** Employee, organisation, shift, schedule, job-posting and selected
   financial entities have stable codes/references. `Application`, `Interview`
   and `Offer` are UUID-backed in the current model. The seed will retain the
   required scenario names in notes/validation output rather than inventing
   schema fields or bypassing reference services.
3. **Payroll and journal figures remain service-calculated.** Workbook totals
   are illustrative; statutory payroll and balanced accounting values will
   never be hard-coded or force-written into finalized history.
4. **Current existing demo commands are separate tenants.**
   `seed_recruitment_demo`, `seed_payroll_demo`, and `seed_accounting_demo`
   establish useful service patterns but cannot be composed directly because
   they create different institutions. `seed_ergonx_demo` will own only the
   reserved `CSA-DEMO` tenant.

## Implementation controls

- Refuse execution when `DEBUG=False`, unless an explicit dedicated demo flag
  is later approved.
- Use natural demo keys and detect historical/financial drift instead of
  rewriting finalized or posted data.
- Implement `--validate-only` before any reset capability.
- Add `--reset` only after deletion scope is restricted to the verified
  `CSA-DEMO` institution and covered by tests.
- Record every excluded workbook scenario in the command report as
  `SKIPPED_UNSUPPORTED`.

## Next implementation slice

Create the command shell, its development guard, `--validate-only`, tenant
ownership validation, and the isolated institution/module/RBAC/organisation
foundation. Employee and workflow data will then be added in dependency order.
