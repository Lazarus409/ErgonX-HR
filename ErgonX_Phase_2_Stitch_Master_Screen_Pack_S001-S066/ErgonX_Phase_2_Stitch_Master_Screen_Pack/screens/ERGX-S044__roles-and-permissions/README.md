# ERGX-S044 — Roles & Permissions

**Module / surface:** Settings / RBAC  
**Route hint:** `/settings/roles`  
**Phase 2 classification:** Existing/partial — extend  
**Implementation wave:** Wave 2  
**Priority:** P0  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
System roles remain protected. UI permission buckets must map to granular backend permissions; backend authorization is authoritative.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
