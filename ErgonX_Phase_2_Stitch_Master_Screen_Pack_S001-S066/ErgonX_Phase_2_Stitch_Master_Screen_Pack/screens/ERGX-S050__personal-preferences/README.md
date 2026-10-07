# ERGX-S050 — Personal Preferences

**Module / surface:** Self Service / Platform  
**Route hint:** `/preferences`  
**Phase 2 classification:** New/partial — extend  
**Implementation wave:** Wave 2  
**Priority:** P1  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Locale, timezone, date/time/number formatting, appearance, accessibility and notification preferences. User formatting does not alter accounting currency values.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
