# ERGX-S051 — Vendor Bill Detail

**Module / surface:** Accounting / Accounts Payable  
**Route hint:** `/accounting/ap/bills/:billId`  
**Phase 2 classification:** Existing/partial — extend  
**Implementation wave:** Wave 6  
**Priority:** P1  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Document view, approval route, attachments and payment status. Scheduling/recording payment must not imply an external bank transfer unless an integration exists.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
