# Ghana Accounting Localization Completion Report

Report version: 1.0  
Assessment date: 2026-09-12  
Delivery status: **PARTIALLY COMPLETE**

This report covers ERD v1.1 §§24–25 and the Ghana-localization portion of the product roadmap. It makes no claim that later AP/AR, vendor/customer, tax-posting, filing, or payroll-integration workflows exist.

## 1. Models added or changed

- Added global `GhanaLocalizationVersion` with code, version, effective dates, GHS default currency, authority, source metadata, and lifecycle status.
- Added ERD-defined `TaxCode`, `TaxComponent`, and `WithholdingRule` catalogs with effective-date, uniqueness, sequence, non-negative threshold, and 0–100 percent rate safeguards.
- Existing `AccountingPresetVersion.localization_version` remains an ERD-mandated string; `ERD-008` records the missing relational link.

## 2. Migrations added

- `apps/accounting/migrations/0003_ghanalocalizationversion_taxcode_taxcomponent_and_more.py` creates the Ghana localization and tax-catalog schema.
- `apps/accounting/migrations/0004_seed_ghana_accounting_2026.py` deterministically seeds the 2026 Ghana localization, preset family, charts, tax components, and withholding catalog with primary-source metadata.

## 3. Services added

No tax transaction service was added. The current stage safely exposes versioned configuration; it deliberately does not infer tax applicability, calculate tax, modify a tax profile, or post a journal.

## 4. Selectors added

No separate selector is needed for the global read-only catalog. Existing effective/same-country preset selection continues to control institutional onboarding choices.

## 5. Permissions added

No new permission code was required. Catalog reads require active tenant context, the enabled `ACCOUNTING` module, and `account.view`.

## 6. API endpoints added

- `/ghana-localization-versions/` list/detail.
- `/tax-codes/` list/detail.
- `/tax-components/` list/detail.
- `/withholding-rules/` list/detail.

These eight operations extend the Accounting API from 43 to 51 operations. They are intentionally read-only.

## 7. Filters, search, and ordering supported

- Localization versions: code/version/status/effective date filters; code/version/authority search; code/version/effective ordering.
- Tax codes: preset, code, treatment, active/effective filters; code/name/treatment search.
- Components: tax code, code, sequence filters; code/name/mapping-code search; code/name/sequence/rate ordering.
- Withholding: preset, code, residency, category, VAT-withholding, confirmation, and effective-date filters; code/name/residency/category search.

## 8. OpenAPI updated

The schema publishes all 51 Accounting operations with shared access requirements, result envelopes, machine-readable errors, filter parameters, pagination, and model schemas. The checked-in schema is regenerated after final validation.

## 9. Audit events added

None. This is system-managed global catalog data seeded through immutable migration history; tenants cannot mutate it through the API.

## 10. Notifications added

None. Catalog inspection has no reviewer transition. Rules retain `requires_confirmation=true` so a later transaction workflow can make the review explicit.

## 11. Tests added

`tests/test_ghana_accounting_localization.py` verifies the seeded version/preset linkage, source metadata, exact 15%/2.5%/2.5% component structure, 20% aggregate, VAT-withholding rule, guarded public/nonprofit status, model fail-closed validation, API module gating, filters, read-only behavior, and catalog responses.

The shared Accounting contract matrix was expanded to every 51 operations for authentication, ACCOUNTING-module gating, and permission enforcement. OpenAPI operation-count coverage was updated to the same total.

## 12. PostgreSQL result

Focused SQLite validation (without migration replay) completed on 2026-09-12:

```text
20 passed, 3 PostgreSQL-specific tests skipped in 17.06s
```

The SQLite migration chain was applied through `accounting.0004`, then the seeded localization, the three 20%-aggregate VAT components, and the 7% VAT-withholding rule were directly checked.

PostgreSQL 16 migration replay was applied through `accounting.0004`; direct catalog assertions passed. The PostgreSQL-specific tax-component identity test passed:

```text
1 passed, 3 deselected in 17.53s
```

The wider application regression suite remains a separate final-release gate; this localized delivery correctly stays partial because dependent workflows are not implemented.

## 13. Frontend integration note path

`docs/integration/ghana_accounting_localization_frontend_contract.md`

## 14. Seed and demo-data support

Migration `0004` provides the versioned production catalog. It seeds active Commercial and SME starter presets, plus Public and Nonprofit starter presets as guarded drafts pending specialized review. It does not mutate the development-only `seed_accounting_demo` data.

## 15. Remaining issues

- `ROADMAP-003`: no vendor/customer tax profiles, VAT certificate lifecycle, accounting compliance calendar, or payroll-to-GL mappings before their dependent ERD stages.
- `ERD-008`: no foreign key from preset version to localization version.
- `ERD-009`: no direct statutory-source field on tax records.
- `ERD-005` and `ERD-006`: Account mapping provenance and preset migration workflow remain unresolved.
- Public/nonprofit starter charts are drafts pending professional framework/legal review.

## Completion decision

**PARTIALLY COMPLETE.** The ERD tax/localization catalog and safe Ghana 2026 discovery/configuration data are implemented. The dependencies and statutory boundaries above intentionally prevent treating this delivery as transaction tax, compliance, or integration completion.
