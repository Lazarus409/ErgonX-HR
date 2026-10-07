# ERGX-S042 — Offer Management

**Module / surface:** Recruitment  
**Route hint:** `/recruitment/offers/:offerId`  
**Phase 2 classification:** Existing/partial — extend  
**Implementation wave:** Wave 4  
**Priority:** P1  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Governed offer lifecycle: Draft → Approval → Sent → Accepted/Declined. Preserve candidate/application lineage into Employee conversion.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
