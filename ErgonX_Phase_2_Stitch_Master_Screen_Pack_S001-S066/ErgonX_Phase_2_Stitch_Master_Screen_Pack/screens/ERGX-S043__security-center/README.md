# ERGX-S043 — Security Center

**Module / surface:** Security / Self Service  
**Route hint:** `/security`  
**Phase 2 classification:** Existing/partial — extend  
**Implementation wave:** Wave 2  
**Priority:** P0  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Support password, TOTP, email OTP, session management and recent security activity. Do not expose SMS OTP or recovery phone until a reliable SMS provider exists.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
