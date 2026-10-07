# ERGX-S046 — Users & Access

**Module / surface:** Users & Access  
**Route hint:** `/users-access`  
**Phase 2 classification:** Existing/partial — extend  
**Implementation wave:** Wave 2  
**Priority:** P0  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Members, invitations and access requests. Invitation links should be one-time/expiring; access changes require backend role assignments and audit.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
