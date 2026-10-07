# Codex Master Handoff — ErgonX Phase 2 Stitch Pack

## Objective
Use these 66 normalized screen references to migrate and extend ErgonX Phase 2 without breaking the existing domain model, tenant isolation, security controls or supported API contracts.

## Required workflow for every screen
1. Read the screen `metadata.json` and `README.md`.
2. Locate the current canonical route/page in the actual codebase.
3. Inspect existing components before adding new UI primitives.
4. Inspect current `/api/v1/` contracts and backend models.
5. Resolve all authorization server-side using granular permissions.
6. Preserve institution scoping and module enablement.
7. Reuse Design System v2 components.
8. Replace all Stitch mock/sample values with real API state or governed empty/loading/error states.
9. Add new backend models/endpoints only where the Phase 2 Technical Contract Pack authorizes them.
10. Add tests for critical behaviors and lifecycle transitions.
11. Never create a duplicate business route solely because multiple Stitch variants exist.

## Global hard constraints
- MFA: TOTP + email OTP only. No SMS OTP.
- Executive Dashboard: Institution Admin + Director/CEO/equivalent executive permission.
- Insights: other authorized operational/admin roles; standard Employee uses Employee Home.
- Expenses are in current Accounting scope and expand through Expense Management 2.0.
- Posted journals and finalized payroll records are immutable; corrections/reversals are linked governed actions.
- Ghana payroll unresolved statutory values remain fail-closed/configuration-driven and are never guessed.
- Procurement, Learning, Performance and Benefits are not silently authorized by concept navigation or sample content.
- PWA remains online-first for sensitive data: no API/JWT/tenant data caching and no offline writes.
- Search scopes authorization before retrieval.
- Notification deep links are controlled internal routes and re-authorize the target record.
- Unsupported PDF/XLSX/XBRL exports must not be advertised by the production UI.
- Sample/demo values from Stitch must not appear as production facts.

## Variants
When two screens target the same route, choose a canonical composition based on the Phase 2 register and merge useful visual ideas. Do not build two competing implementations.

See:
- `MASTER_SCREEN_MANIFEST.csv`
- `INDEX_BY_MODULE.md`
- `ROUTE_VARIANT_INDEX.md`
