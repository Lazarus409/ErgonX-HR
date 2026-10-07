# ERGX-S045 — Institution Profile

**Module / surface:** Settings / Institution  
**Route hint:** `/settings/institution`  
**Phase 2 classification:** Existing/partial — refine  
**Implementation wave:** Wave 2  
**Priority:** P1  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Logo, legal identity, institution type, country, default currency, timezone and contact data. Currency formatting preferences must not silently change transaction currency.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
