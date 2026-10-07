# ERGX-S063 — Employee Home — Operational Variant

**Module / surface:** Self Service  
**Route hint:** `/my-workspace`  
**Phase 2 classification:** Visual/functional variant  
**Implementation wave:** Wave 3  
**Priority:** P1  
**Variant of:** ERGX-S047  

## Files
- `reference.png` — Stitch reference image.
- `stitch.html` — Stitch-generated reference markup/code.
- `DESIGN.md` — Stitch design output.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Variant of Employee Home. Keep useful personal actions, shift/attendance and attention items, but remove organization/team information that exceeds the employee's authorized scope. Do not introduce invented productivity/performance measures.

## Implementation authority
Do not create a parallel business flow simply because this export differs visually from another screen. Reconcile the concept with the canonical ErgonX route, existing API contracts, backend models, institution scoping, module enablement and granular permissions first.
