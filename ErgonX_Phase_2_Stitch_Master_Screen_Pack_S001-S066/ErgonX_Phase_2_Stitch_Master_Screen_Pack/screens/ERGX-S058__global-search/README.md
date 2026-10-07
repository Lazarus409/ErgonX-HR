# ERGX-S058 — Global Search

**Module / surface:** Platform / Search  
**Route hint:** `/search`  
**Phase 2 classification:** Existing/partial — extend  
**Implementation wave:** Wave 2  
**Priority:** P1  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Institution- and permission-scoped cross-module search. Authorization must scope retrieval before results are returned, not fetch-all-then-hide.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
