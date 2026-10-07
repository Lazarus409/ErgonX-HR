# ERGX-S038 — My Profile

**Module:** Employee Self-Service / HR  
**Route hint:** `/my-workspace/profile`  
**Classification:** existing-extension  
**Phase 2 wave:** Wave 3  
**Contract status:** KEEP/REFINE  
**Original Stitch heading:** My Profile

## Contents
- `reference.png` — Stitch-rendered visual reference
- `stitch.html` — Stitch-generated HTML/code reference
- `DESIGN.md` — Stitch design-system output for this screen
- `metadata.json` — ErgonX handoff metadata

## Implementation note
Employee profile covering personal, employment, contact, payment and tax information plus optional identity verification status.

## Codex guardrail
Treat the Stitch code and screenshot as **design references**, not as the authority for ErgonX business behavior. Before implementation, inspect the existing route, API, domain model, permissions, module gates, institution scoping and shared components. Reuse/extend existing contracts where possible. Do not copy mock data into production behavior.
