# ERGX-S032 — Payroll Run Detail

**Module:** Payroll  
**Route hint:** `/payroll/runs/:runId`  
**Classification:** phase2-extension  
**Phase 2 wave:** Wave 5  
**Contract status:** KEEP/EXTEND  
**Original Stitch heading:** Payroll run detail

## Contents
- `reference.png` — Stitch-rendered visual reference
- `stitch.html` — Stitch-generated HTML/code reference
- `DESIGN.md` — Stitch design-system output for this screen
- `metadata.json` — ErgonX handoff metadata

## Implementation note
Payroll run detail with structured exceptions, compliance checks, approval state and restricted data controls.

## Codex guardrail
Treat the Stitch code and screenshot as **design references**, not as the authority for ErgonX business behavior. Before implementation, inspect the existing route, API, domain model, permissions, module gates, institution scoping and shared components. Reuse/extend existing contracts where possible. Do not copy mock data into production behavior.
