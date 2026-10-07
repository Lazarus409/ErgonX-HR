# ERGX-S034 — Interview Scheduling

**Module:** Recruitment  
**Route hint:** `/recruitment/interviews/new`  
**Classification:** phase2-extension  
**Phase 2 wave:** Wave 4  
**Contract status:** EXTEND  
**Original Stitch heading:** Schedule interview

## Contents
- `reference.png` — Stitch-rendered visual reference
- `stitch.html` — Stitch-generated HTML/code reference
- `DESIGN.md` — Stitch design-system output for this screen
- `metadata.json` — ErgonX handoff metadata

## Implementation note
Internal interview scheduler with date/time, timezone, panel, candidate notification and conflict UI. External calendar/Teams availability remains future integration unless connected.

## Codex guardrail
Treat the Stitch code and screenshot as **design references**, not as the authority for ErgonX business behavior. Before implementation, inspect the existing route, API, domain model, permissions, module gates, institution scoping and shared components. Reuse/extend existing contracts where possible. Do not copy mock data into production behavior.
