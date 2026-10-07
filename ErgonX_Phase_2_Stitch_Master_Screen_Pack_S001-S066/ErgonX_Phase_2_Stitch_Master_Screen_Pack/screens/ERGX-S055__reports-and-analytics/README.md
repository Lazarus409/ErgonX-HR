# ERGX-S055 — Reports & Analytics Catalogue

**Module / surface:** Reports & Analytics  
**Route hint:** `/reports`  
**Phase 2 classification:** Existing/partial — extend  
**Implementation wave:** Wave 8  
**Priority:** P2  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Stage implementation: catalogue → saved configurations → sharing/access → scheduling. Do not attempt a generic BI/report-builder platform first.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
