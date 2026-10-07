# ERGX-S065 — Employee Directory — Filter Drawer Variant

**Module / surface:** Human Resources  
**Route hint:** `/employees`  
**Phase 2 classification:** Visual variant  
**Implementation wave:** Wave 3  
**Priority:** P1  
**Variant of:** ERGX-S008  

## Files
- `reference.png` — Stitch reference image.
- `stitch.html` — Stitch-generated reference markup/code.
- `DESIGN.md` — Stitch design output.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Responsive/compact Employee Directory variant with KPI cards and filter drawer. Reuse canonical Employee Directory contracts and field-level RBAC. Do not create a second employee listing domain.

## Implementation authority
Do not create a parallel business flow simply because this export differs visually from another screen. Reconcile the concept with the canonical ErgonX route, existing API contracts, backend models, institution scoping, module enablement and granular permissions first.
