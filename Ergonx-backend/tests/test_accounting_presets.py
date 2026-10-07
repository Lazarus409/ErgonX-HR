from datetime import date

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.urls import reverse

from apps.accounting.models import (
    Account,
    AccountingPreset,
    AccountingPresetVersion,
    AccountTemplate,
    ChartOfAccountsTemplate,
    InstitutionAccountingConfiguration,
)
from apps.accounting.selectors import available_accounting_preset_versions
from apps.accounting.services import apply_accounting_preset, configure_accounting
from apps.audit.models import AuditLog
from apps.institutions.models import InstitutionModule


pytestmark = pytest.mark.django_db


def _enable_accounting(institution):
    module = institution.modules.get(module_code=InstitutionModule.ModuleCode.ACCOUNTING)
    module.is_enabled = True
    module.save(update_fields=("is_enabled", "updated_at"))


def _finance(institution, user_factory, membership_factory, email="preset.finance@example.com"):
    actor = user_factory(email=email)
    membership_factory(
        user=actor,
        institution=institution,
        role_code="FINANCE_MANAGER",
        is_primary=True,
    )
    return actor


def _preset(*, code="GH-DEMO", status=AccountingPresetVersion.Status.ACTIVE):
    preset = AccountingPreset.objects.create(
        code=code,
        country_code="GH",
        name=f"{code} preset",
        description="Test-only accounting preset",
        institution_type="COMMERCIAL",
        is_system_managed=True,
    )
    version = AccountingPresetVersion.objects.create(
        accounting_preset=preset,
        version_code=f"{code}-2026.1",
        localization_version="GH-LOCALIZATION-2026.1",
        effective_from=date(2026, 1, 1),
        reporting_framework="IFRS",
        status=status,
        source_metadata={"test_only": True},
    )
    chart = ChartOfAccountsTemplate.objects.create(
        preset_version=version,
        name="Starter chart",
        description="Test chart",
    )
    root = AccountTemplate.objects.create(
        coa_template=chart,
        code="1000",
        name="Assets",
        account_type=Account.AccountType.ASSET,
        normal_balance=Account.NormalBalance.DEBIT,
        is_postable=False,
        system_mapping_code="ASSETS_ROOT",
    )
    cash = AccountTemplate.objects.create(
        coa_template=chart,
        code="1100",
        name="Cash",
        account_type=Account.AccountType.ASSET,
        parent_template=root,
        normal_balance=Account.NormalBalance.DEBIT,
        is_postable=True,
        system_mapping_code="CASH",
    )
    return preset, version, chart, root, cash


def test_preset_application_instantiates_hierarchy_and_is_idempotent(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="PRESET-APPLY", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(institution, user_factory, membership_factory)
    _, version, chart, _, _ = _preset()

    result = apply_accounting_preset(
        institution=institution,
        actor=actor,
        preset_version=version,
        coa_template=chart,
        base_currency="GHS",
        fiscal_year_start_month=1,
    )
    assert result["created_count"] == 2
    assert result["reused_count"] == 0
    configuration = InstitutionAccountingConfiguration.objects.get(
        institution=institution
    )
    assert configuration.accounting_setup_mode == "PRESET"
    assert configuration.selected_accounting_preset_version == version
    cash = Account.objects.get(institution=institution, code="1100")
    assert cash.parent.code == "1000"

    cash.name = "Customized cash account"
    cash.save()
    retry = apply_accounting_preset(
        institution=institution,
        actor=actor,
        preset_version=version,
        coa_template=chart,
        base_currency="GHS",
        fiscal_year_start_month=1,
    )
    assert retry["created_count"] == 0
    assert retry["reused_count"] == 2
    cash.refresh_from_db()
    assert cash.name == "Customized cash account"
    assert Account.objects.filter(institution=institution).count() == 2
    assert AuditLog.objects.filter(
        institution=institution, action="accounting.preset.applied"
    ).count() == 1


def test_preset_application_conflict_rolls_back_all_writes(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="PRESET-CONFLICT", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(
        institution, user_factory, membership_factory, "conflict.finance@example.com"
    )
    _, version, chart, _, _ = _preset(code="GH-CONFLICT")
    Account.objects.create(
        institution=institution,
        code="1100",
        name="Different existing account",
        account_type=Account.AccountType.LIABILITY,
        normal_balance=Account.NormalBalance.CREDIT,
    )

    with pytest.raises(ValidationError, match="conflicts"):
        apply_accounting_preset(
            institution=institution,
            actor=actor,
            preset_version=version,
            coa_template=chart,
            base_currency="GHS",
            fiscal_year_start_month=1,
        )
    assert not Account.objects.filter(institution=institution, code="1000").exists()
    assert not InstitutionAccountingConfiguration.objects.filter(
        institution=institution
    ).exists()
    assert not AuditLog.objects.filter(
        institution=institution, action="accounting.preset.applied"
    ).exists()


def test_preset_application_rejects_bypass_country_status_and_version_switch(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="PRESET-GUARDS", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(
        institution, user_factory, membership_factory, "guards.finance@example.com"
    )
    _, version, chart, _, _ = _preset(code="GH-GUARDS")
    with pytest.raises(ValidationError, match="preset apply action"):
        configure_accounting(
            institution=institution,
            actor=actor,
            country_code="GH",
            base_currency="GHS",
            accounting_setup_mode="PRESET",
            selected_accounting_preset_version=version,
            reporting_framework="IFRS",
            fiscal_year_start_month=1,
            is_configured=True,
        )
    apply_accounting_preset(
        institution=institution,
        actor=actor,
        preset_version=version,
        coa_template=chart,
        base_currency="GHS",
        fiscal_year_start_month=1,
    )
    _, other_version, other_chart, _, _ = _preset(code="GH-GUARDS-NEXT")
    with pytest.raises(ValidationError, match="migration"):
        apply_accounting_preset(
            institution=institution,
            actor=actor,
            preset_version=other_version,
            coa_template=other_chart,
            base_currency="GHS",
            fiscal_year_start_month=1,
        )

    foreign = institution_factory(code="PRESET-NG", country_code="NG")
    _enable_accounting(foreign)
    foreign_actor = _finance(
        foreign, user_factory, membership_factory, "foreign.finance@example.com"
    )
    with pytest.raises(ValidationError, match="country"):
        apply_accounting_preset(
            institution=foreign,
            actor=foreign_actor,
            preset_version=version,
            coa_template=chart,
            base_currency="NGN",
            fiscal_year_start_month=1,
        )

    _, draft_version, draft_chart, _, _ = _preset(
        code="GH-DRAFT", status=AccountingPresetVersion.Status.DRAFT
    )
    fresh = institution_factory(code="PRESET-DRAFT", country_code="GH")
    _enable_accounting(fresh)
    fresh_actor = _finance(
        fresh, user_factory, membership_factory, "draft.finance@example.com"
    )
    with pytest.raises(ValidationError, match="active"):
        apply_accounting_preset(
            institution=fresh,
            actor=fresh_actor,
            preset_version=draft_version,
            coa_template=draft_chart,
            base_currency="GHS",
            fiscal_year_start_month=1,
        )


def test_template_parent_integrity_and_available_selector(
    institution_factory
):
    institution = institution_factory(code="PRESET-SELECT", country_code="GH")
    _, active, chart, _, _ = _preset(code="GH-SELECT")
    _, _, foreign_chart, foreign_parent, _ = _preset(code="GH-OTHER")
    with pytest.raises(ValidationError, match="another chart"):
        AccountTemplate.objects.create(
            coa_template=chart,
            code="1200",
            name="Invalid child",
            account_type="ASSET",
            parent_template=foreign_parent,
            normal_balance="DEBIT",
        )
    future_preset = AccountingPreset.objects.create(
        code="GH-FUTURE",
        country_code="GH",
        name="Future",
        institution_type="SME",
    )
    future = AccountingPresetVersion.objects.create(
        accounting_preset=future_preset,
        version_code="GH-FUTURE-2027.1",
        effective_from=date(2027, 1, 1),
        reporting_framework="IFRS_FOR_SMES",
        status="ACTIVE",
    )
    selected = available_accounting_preset_versions(
        institution=institution, as_of=date(2026, 9, 12)
    )
    selected_ids = set(selected.values_list("id", flat=True))
    assert active.id in selected_ids
    assert future.id not in selected_ids
    assert foreign_chart.preset_version.accounting_preset.country_code == "GH"


def test_preset_application_api_choices_and_permission(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="PRESET-API", country_code="GH")
    _enable_accounting(institution)
    finance = _finance(
        institution, user_factory, membership_factory, "api.finance@example.com"
    )
    accountant = user_factory(email="api.accountant@example.com")
    membership_factory(
        user=accountant,
        institution=institution,
        role_code="ACCOUNTANT",
        is_primary=True,
    )
    _, version, chart, _, _ = _preset(code="GH-API")
    url = reverse("v1:accounting-preset-version-apply", args=(version.id,))

    api_client.force_authenticate(accountant)
    denied = api_client.post(
        url,
        {"coa_template": str(chart.id), "base_currency": "GHS", "fiscal_year_start_month": 1},
        format="json",
    )
    assert denied.status_code == 403
    assert denied.json()["code"] == "permission_denied"

    api_client.force_authenticate(finance)
    choices = api_client.get(reverse("v1:accounting-configuration-choices"))
    assert choices.status_code == 200
    preset_choice = choices.json()["data"]["choices"][0]
    assert preset_choice["institution_type"] == "COMMERCIAL"
    assert preset_choice["coa_templates"] == [
        {"id": str(chart.id), "name": "Starter chart"}
    ]
    bypass = api_client.post(
        reverse("v1:accounting-configuration-list"),
        {
            "country_code": "GH",
            "base_currency": "GHS",
            "accounting_setup_mode": "PRESET",
            "selected_accounting_preset_version": str(version.id),
            "reporting_framework": "IFRS",
            "fiscal_year_start_month": 1,
            "is_configured": True,
        },
        format="json",
    )
    assert bypass.status_code == 400
    assert bypass.json()["code"] == "invalid_state_transition"
    response = api_client.post(
        url,
        {"coa_template": str(chart.id), "base_currency": "GHS", "fiscal_year_start_month": 1},
        format="json",
    )
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"success", "data", "message", "errors"}
    assert payload["data"]["created_count"] == 2
    assert [account["code"] for account in payload["data"]["accounts"]] == ["1000", "1100"]

    listing = api_client.get(
        reverse("v1:account-template-list"),
        {"coa_template": str(chart.id), "search": "CASH"},
    ).json()["data"]
    assert listing["count"] == 1
    assert listing["results"][0]["system_mapping_code"] == "CASH"


@pytest.mark.postgresql
def test_postgresql_enforces_template_identity_constraints():
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL-specific accounting preset constraint coverage")
    _, _, chart, _, _ = _preset(code="GH-PG-PRESET")
    with pytest.raises(IntegrityError), transaction.atomic():
        AccountTemplate.objects.bulk_create(
            [
                AccountTemplate(
                    coa_template=chart,
                    code="1200",
                    name="One",
                    account_type="ASSET",
                    normal_balance="DEBIT",
                    system_mapping_code="DUPLICATE_MAPPING",
                ),
                AccountTemplate(
                    coa_template=chart,
                    code="1300",
                    name="Two",
                    account_type="ASSET",
                    normal_balance="DEBIT",
                    system_mapping_code="DUPLICATE_MAPPING",
                ),
            ]
        )
