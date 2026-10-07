# ERGX-S056 — Notification Center

**Module / surface:** Platform / Notifications  
**Route hint:** `/notifications`  
**Phase 2 classification:** New/partial — extend  
**Implementation wave:** Wave 2  
**Priority:** P0  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
In-app + email only for Phase 2. Deep links use controlled route_name/resource_id and re-check source authorization; no arbitrary trusted URLs.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
