# ERGX-S064 — Approvals — Governance Review Variant

**Module / surface:** Approvals / Platform  
**Route hint:** `/approvals`  
**Phase 2 classification:** Visual/functional variant  
**Implementation wave:** Wave 2  
**Priority:** P1  
**Variant of:** ERGX-S066  

## Files
- `reference.png` — **not present in the source Stitch ZIP**; use `stitch.html` as the visual/layout source for this export.
- `stitch.html` — Stitch-generated reference markup/code.
- `DESIGN.md` — Stitch design output.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Approval inbox variant with richer governance/audit detail. Procurement/PO examples are illustrative only and do not authorize adding Procurement. Batch/quick approvals require backend eligibility checks and per-record audit.

## Implementation authority
Do not create a parallel business flow simply because this export differs visually from another screen. Reconcile the concept with the canonical ErgonX route, existing API contracts, backend models, institution scoping, module enablement and granular permissions first.
