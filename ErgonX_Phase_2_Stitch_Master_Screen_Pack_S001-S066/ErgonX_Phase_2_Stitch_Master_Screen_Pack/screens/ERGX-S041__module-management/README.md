# ERGX-S041 — Module Management

**Module / surface:** Settings / Platform  
**Route hint:** `/settings/modules`  
**Phase 2 classification:** Existing screen — extend/refine  
**Implementation wave:** Wave 2  
**Priority:** P1  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Keep module enable/disable and dependency controls. Do not implement SaaS billing/plan mechanics unless separately approved.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
