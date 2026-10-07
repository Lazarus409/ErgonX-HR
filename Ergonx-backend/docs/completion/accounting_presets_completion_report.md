# Accounting Presets Completion Report

Report version: 1.0  
Assessment date: 2026-09-12  
Delivery status: **COMPLETE WITH DOCUMENTED LIMITATIONS**

This report covers the generic preset framework in ERD v1.1 §23. It deliberately excludes Ghana tax/localization data from §§24–25.

## 1. Models added or changed

- Existing `AccountingPreset` and `AccountingPresetVersion` remain the versioned global roots.
- Added `ChartOfAccountsTemplate` and `AccountTemplate` with self-referential hierarchy, account type, normal balance, postability, and optional system mapping code.
- Template codes and non-null mapping codes are unique within one chart; chart names are unique within a version.
- Parent templates must belong to the same chart and cycles are rejected.

## 2. Migrations added

- `apps/accounting/migrations/0002_chartofaccountstemplate_accounttemplate_and_more.py` creates both template models and their constraints.

Migration drift check is clean.

## 3. Services added

`apply_accounting_preset` validates permission, active/effective status, country, chart selection, existing configuration, version-switch policy, hierarchy, and account-code compatibility. It then creates/reuses the complete account graph and binds `InstitutionAccountingConfiguration` within one transaction.

Institution, configuration, preset-version, and matching account rows are locked where applicable. Any conflict rolls back all account/configuration/audit writes. Same-version/same-chart retries are idempotent and do not overwrite institution customization.

Ordinary configuration writes cannot bypass the apply action to select a new PRESET version.

## 4. Selectors added

- `available_accounting_preset_versions` — active, currently effective, same-country versions with presets/charts loaded.
- `account_templates_for_application` — exact chart selection and ordered account hierarchy for one version.

The onboarding choices endpoint consumes the selector boundary.

## 5. Permissions added

No new codes were required. Catalog reads use `account.view`; application uses `accounting.configure`. Both also require active tenant context and enabled ACCOUNTING module.

## 6. API endpoints added

- Read-only `/chart-of-accounts-templates/` list/detail.
- Read-only `/account-templates/` list/detail.
- `POST /accounting-preset-versions/{id}/apply/`.

The five new operations extend the current Accounting API from 38 to 43 operations. Setup choices now include institution type and available chart IDs/names.

## 7. Filters, search, and ordering supported

- Chart templates: preset-version filter and name/description search.
- Account templates: chart, account type, normal balance, parent, postability, and mapping-code filters; code/name/mapping search; code/name/type ordering.
- Existing preset/version filters remain available.

## 8. OpenAPI updated

The current `openapi-schema.yml` contains all 43 Accounting operations with access descriptions, envelopes, stable errors, filters, pagination, enums, and request/response schemas. Preset application publishes the `AccountingPresetApplication` request and `AccountingPresetApplicationResult` response plus workflow-specific error codes.

## 9. Audit events added

`accounting.preset.applied` records the exact preset version/chart and created/reused account IDs/codes. `accounting.configuration.changed` records the resulting configuration before/after state. Idempotent retries create neither event again.

## 10. Notifications added

None. Preset application is an administrator-controlled synchronous setup action with no separate reviewer/recipient workflow.

## 11. Tests added

`tests/test_accounting_presets.py` covers hierarchy integrity, effective/country/status selection, atomic application, compatible reuse, conflict rollback, customization-safe idempotency, configuration-bypass rejection, preset-version switch blocking, API permission/envelopes/filters, and PostgreSQL identity constraints.

The shared Accounting API matrix now covers all 43 operations for authentication, module enablement, permissions, and tenant scope. The OpenAPI contract test pins the same operation count and application schema.

## 12. PostgreSQL result

Final SQLite validation on 2026-09-12:

```text
96 passed, 5 PostgreSQL-only tests skipped in 81.86s
```

Final PostgreSQL 16 validation:

```text
101 passed in 167.22s
```

PostgreSQL executed both Accounting constraint suites, including exactly-one-positive journal lines, unique reversal identity, unique account-template code, and unique non-null system-mapping identity.

## 13. Frontend integration note path

`docs/integration/accounting_presets_frontend_contract.md`

## 14. Seed and demo-data support

`seed_accounting_demo` now creates a clearly marked development-only preset/version/chart with three mapped account templates, applies it to the reserved demo tenant, and then creates two posted journals. Reruns do not duplicate template, account, audit, notification, or financial records. The command refuses `DEBUG=False`.

No production accounting preset is seeded; Ghana catalog/statutory data belongs to the next ERD stage.

## 15. Remaining issues

- `ERD-005` — instantiated Account lacks template/mapping provenance.
- `ERD-006` — preset version migration workflow is unspecified and fails closed.
- `ERD-007` — institution classification for recommendation is absent.
- Production Ghana preset content and statutory mapping research are not part of this generic stage.

The authoritative decisions remain in `DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`.

## Completion decision

**COMPLETE WITH DOCUMENTED LIMITATIONS.** The generic versioned preset/template/application framework satisfies runtime, API, OpenAPI, audit, deterministic-demo, tenant/security, SQLite, and PostgreSQL 16 delivery gates. Production country content and the explicit ERD limitations in §15 remain outside this completion claim.
