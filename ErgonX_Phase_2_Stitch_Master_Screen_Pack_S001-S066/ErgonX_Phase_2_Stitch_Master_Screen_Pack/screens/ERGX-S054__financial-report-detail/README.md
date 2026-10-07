# ERGX-S054 — Financial Report Detail — Statement of Financial Position

**Module / surface:** Accounting / Financial Reports  
**Route hint:** `/accounting/financial-reports/:reportId`  
**Phase 2 classification:** Existing/partial — extend  
**Implementation wave:** Wave 7  
**Priority:** P2  

## Files
- `reference.png` — Stitch-generated visual reference.
- `stitch.html` — Stitch-generated screen code/reference markup.
- `DESIGN.md` — Stitch design-system output supplied with this export.
- `metadata.json` — normalized implementation metadata.

## Codex guardrail
Formal statement output must be generated from authoritative posted accounting data. Do not expose PDF/XLSX/XBRL export options unless backend exporters exist.

## Authority rule
Do not implement this screen by copying Stitch behavior literally. First inspect the current ErgonX route, components, API contracts, backend models, RBAC permissions, tenant scoping and module guards. Reuse existing contracts where valid and add Phase 2 backend capability only where the implementation register explicitly requires it.
