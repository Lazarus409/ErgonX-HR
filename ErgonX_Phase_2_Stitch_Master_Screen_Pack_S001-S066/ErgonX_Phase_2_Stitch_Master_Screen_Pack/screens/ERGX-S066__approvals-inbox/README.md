# ERGX-S066 — Approvals Inbox — Pending Decisions

**Module / surface:** Approvals / Platform  
**Route hint:** `/approvals`  
**Phase 2 classification:** Existing/partial — extend  
**Implementation wave:** Wave 2  
**Priority:** P0  

## Files
- `reference.png` — Stitch reference image.
- `stitch.html` — Stitch-generated reference markup/code.
- `DESIGN.md` — Stitch design output.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Canonical cross-module approvals inbox candidate. Leave, finance and attendance decisions must be backed by real approval requests and permissions. Procurement/PO sample content is illustrative only. 'Approve All' requires explicit batch eligibility and per-record authorization/audit.

## Implementation authority
Do not create a parallel business flow simply because this export differs visually from another screen. Reconcile the concept with the canonical ErgonX route, existing API contracts, backend models, institution scoping, module enablement and granular permissions first.
