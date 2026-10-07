# ERGX-S039 — Journal Entry Detail

**Module:** Accounting / General Ledger  
**Route hint:** `/accounting/journals/:journalId`  
**Classification:** existing-extension  
**Phase 2 wave:** Wave 6  
**Contract status:** KEEP/EXTEND  
**Original Stitch heading:** Journal Entry Detail

## Contents
- `reference.png` — Stitch-rendered visual reference
- `stitch.html` — Stitch-generated HTML/code reference
- `DESIGN.md` — Stitch design-system output for this screen
- `metadata.json` — ErgonX handoff metadata

## Implementation note
Journal detail with lines, related records, notes, attachments and audit events. Posted journals remain immutable.

## Codex guardrail
Treat the Stitch code and screenshot as **design references**, not as the authority for ErgonX business behavior. Before implementation, inspect the existing route, API, domain model, permissions, module gates, institution scoping and shared components. Reuse/extend existing contracts where possible. Do not copy mock data into production behavior.
