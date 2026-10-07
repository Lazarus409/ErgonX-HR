# Accounting Presets Frontend Integration Contract

Contract version: 1.0  
API version: v1  
Module: Accounting Presets

## Module

The generic Accounting Presets framework exposes versioned country/institution-type preset catalogs, chart templates, account-template hierarchies, and an explicit transactional action that instantiates a chart into the active institution. It contains no production Ghana statutory content; that is the next localization stage.

## Base URL

`/api/v1/`

Successful responses use `{success, data, message, errors}`. Errors add a stable top-level `code`.

## Required module flag

`ACCOUNTING`

## Permissions

- `account.view` — inspect presets, versions, chart templates, account templates, and setup choices
- `accounting.configure` — apply a preset and bind institution accounting configuration

## Endpoints

| Method | Path | Purpose | Permission | Query/payload | Response data |
|---|---|---|---|---|---|
| GET | `/accounting-presets/` | List preset families | `account.view` | `country_code`, `institution_type`, `is_system_managed`, `search` | paginated presets |
| GET | `/accounting-presets/{id}/` | Read preset family | `account.view` | none | preset |
| GET | `/accounting-preset-versions/` | List versions | `account.view` | `accounting_preset`, `status`, `effective_from`, `search` | paginated versions |
| GET | `/accounting-preset-versions/{id}/` | Read exact version | `account.view` | none | version |
| POST | `/accounting-preset-versions/{id}/apply/` | Instantiate one chart and select version | `accounting.configure` | application payload | application result |
| GET | `/chart-of-accounts-templates/` | List available charts | `account.view` | `preset_version`, `search` | paginated chart templates |
| GET | `/chart-of-accounts-templates/{id}/` | Read chart | `account.view` | none | chart template |
| GET | `/account-templates/` | Browse account definitions | `account.view` | `coa_template`, `account_type`, `normal_balance`, `parent_template`, `is_postable`, `system_mapping_code`, `search`, `ordering` | paginated account templates |
| GET | `/account-templates/{id}/` | Read account definition | `account.view` | none | account template |
| GET | `/accounting-configurations/choices/` | Same-country effective choices | `account.view` | none | country/currency plus preset and Custom choices |

List endpoints use shared page-number pagination (`page`, `page_size`; default 25, maximum 100).

## Status enums

Preset version: `DRAFT`, `ACTIVE`, `RETIRED`.

Account type: `ASSET`, `LIABILITY`, `EQUITY`, `INCOME`, `EXPENSE`.

Normal balance: `DEBIT`, `CREDIT`.

Setup mode after application: `PRESET`.

## Workflow transitions

System-managed catalog data is read-only through tenant APIs. Applying follows:

```text
ACTIVE + currently effective + same country
    -> validate selected chart and complete hierarchy
    -> validate all existing code conflicts
    -> create/reuse accounts atomically
    -> bind InstitutionAccountingConfiguration to exact version
    -> audit accounting.preset.applied
```

Same-version/same-chart retries return the existing chart without restoring or overwriting later institution customizations. A different preset version or chart requires a future explicit migration workflow and currently fails closed.

## Frontend behavior notes

- Use `/accounting-configurations/choices/` for onboarding. It excludes draft, retired, future, expired, and other-country versions.
- Display `institution_type`; the backend cannot automatically recommend one because ERD v1.1 has no institution classification field.
- If a version exposes more than one chart, require the user to select `coa_template`. It may be omitted only when the version has exactly one chart.
- Require explicit confirmation of base currency and fiscal-year start month.
- Do not create a PRESET configuration with the ordinary configuration endpoint. Use the apply action so chart creation and configuration binding remain atomic.
- Preview templates using account-template filters before confirmation.
- Treat `system_mapping_code` as template metadata only. Instantiated Account currently lacks a corresponding ERD field.
- On `duplicate_operation`, show the conflicting code and stop; do not retry with overwrite behavior.
- The returned `created_count` and `reused_count` explain the application result.

## Example payloads

```json
{
  "coa_template": "chart-template-uuid",
  "base_currency": "GHS",
  "fiscal_year_start_month": 1
}
```

Representative response data:

```json
{
  "configuration": {
    "id": "configuration-uuid",
    "country_code": "GH",
    "base_currency": "GHS",
    "accounting_setup_mode": "PRESET",
    "selected_accounting_preset_version": "version-uuid",
    "reporting_framework": "IFRS",
    "fiscal_year_start_month": 1,
    "is_configured": true
  },
  "coa_template": {
    "id": "chart-template-uuid",
    "preset_version": "version-uuid",
    "name": "Starter chart"
  },
  "created_count": 42,
  "reused_count": 0,
  "accounts": []
}
```

Major error codes: `authentication_required`, `module_disabled`, `permission_denied`, `not_found`, `validation_error`, `invalid_state_transition`, `policy_not_applicable`, `duplicate_operation`, `record_immutable`.

## Known limitations

- `ERD-005`: instantiated Account has no durable template/mapping-code field.
- `ERD-006`: preset upgrade/diff/remap/rollback workflow is unspecified and blocked.
- `ERD-007`: institution type cannot be persisted for automatic recommendation.
- Production accounting preset data is intentionally not seeded here. The demo preset is development-only and explicitly prohibits production use.

Canonical runtime schema: `/api/v1/schema/`; Swagger UI: `/api/v1/docs/`; repository artifact: `openapi-schema.yml`.
