# ERGX-S060 — Confirmation Dialog Patterns

**Module / surface:** Design System / Platform  
**Route hint:** `shared`  
**Phase 2 classification:** Design-system standard  
**Implementation wave:** Wave 1  
**Priority:** P0  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Standardize confirmations for reversible, destructive and governed actions. Domain backend remains responsible for actual authorization, lifecycle and audit.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
