# ERGX-S052 — Budget Detail — Academic Affairs

**Module / surface:** Accounting / Budgets  
**Route hint:** `/accounting/budgets/:budgetId`  
**Phase 2 classification:** New Phase 2 capability  
**Implementation wave:** Wave 7  
**Priority:** P2  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Allocated, actual, remaining and variance are valid targets. 'Committed' must not be shown until a legitimate commitment source such as Procurement/POs exists.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
