# ERGX-S036 — My Payslips

**Module:** Employee Self-Service / Payroll  
**Route hint:** `/my-workspace/payslips`  
**Classification:** existing-extension  
**Phase 2 wave:** Wave 3  
**Contract status:** KEEP/REFINE  
**Original Stitch heading:** My Payslips

## Contents
- `reference.png` — Stitch-rendered visual reference
- `stitch.html` — Stitch-generated HTML/code reference
- `DESIGN.md` — Stitch design-system output for this screen
- `metadata.json` — ErgonX handoff metadata

## Implementation note
Employee payslip list, filtering, secure preview and download. Only finalized/available payslips should be exposed.

## Codex guardrail
Treat the Stitch code and screenshot as **design references**, not as the authority for ErgonX business behavior. Before implementation, inspect the existing route, API, domain model, permissions, module gates, institution scoping and shared components. Reuse/extend existing contracts where possible. Do not copy mock data into production behavior.
