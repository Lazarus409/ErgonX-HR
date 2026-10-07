# ERGX-S053 — Job Requisition Detail

**Module / surface:** Recruitment  
**Route hint:** `/recruitment/requisitions/:requisitionId`  
**Phase 2 classification:** New Phase 2 capability  
**Implementation wave:** Wave 4  
**Priority:** P1  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Requisition lifecycle, hiring team, approval and publish controls. Approval must complete before publish when configured.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
