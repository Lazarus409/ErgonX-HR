# ERGX-S048 — Request Leave

**Module / surface:** Leave / Self Service  
**Route hint:** `/my-workspace/leave/request`  
**Phase 2 classification:** Existing/partial — extend  
**Implementation wave:** Wave 3  
**Priority:** P1  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Support draft, half-day boundaries, working-day calculation, attachments, balance preview and approval-route preview. Policy rules are institution-configured.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
