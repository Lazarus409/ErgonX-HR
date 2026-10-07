# ERGX-S049 — My Documents

**Module / surface:** Self Service / Documents  
**Route hint:** `/my-workspace/documents`  
**Phase 2 classification:** Existing screen — refine  
**Implementation wave:** Wave 3  
**Priority:** P1  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Categories, issue/expiry dates, status and uploads. Only show storage quota if the backend actually enforces one.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
