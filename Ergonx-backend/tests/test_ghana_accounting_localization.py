from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.urls import reverse

from apps.accounting.models import (
    AccountingPresetVersion,
    AccountingPreset,
    GhanaLocalizationVersion,
    TaxCode,
    TaxComponent,
    WithholdingRule,
)
from apps.institutions.models import InstitutionModule


pytestmark = pytest.mark.django_db


def _enable_accounting(institution):
    module = institution.modules.get(module_code=InstitutionModule.ModuleCode.ACCOUNTING)
    module.is_enabled = True
    module.save(update_fields=("is_enabled", "updated_at"))


def _finance(institution, user_factory, membership_factory):
    actor = user_factory(email="ghana-accounting-finance@example.com")
    membership_factory(
        user=actor,
        institution=institution,
        role_code="FINANCE_MANAGER",
        is_primary=True,
    )
    return actor


@pytest.fixture(autouse=True)
def _ghana_catalog():
    """Keep catalog behavior tests runnable even when migrations are disabled."""
    localization, _ = GhanaLocalizationVersion.objects.get_or_create(
        code="GH-LOCALIZATION-2026.1",
        defaults={
            "version": "2026.1",
            "effective_from": date(2026, 1, 1),
            "default_currency": "GHS",
            "tax_authority": "Ghana Revenue Authority",
            "status": GhanaLocalizationVersion.Status.ACTIVE,
            "source_metadata": {
                "sources": [
                    {"url": "https://gra.gov.gh/domestic-tax/tax-types/vat/"},
                    {"url": "https://gra.gov.gh/portfolio/withholding-tax/"},
                    {"url": "https://gra.gov.gh/domestic-tax/tax-types/vat-withholding/"},
                ]
            },
        },
    )
    versions = {}
    for code, institution_type, framework, status in (
        ("GH-COMMERCIAL", "COMMERCIAL", "IFRS", "ACTIVE"),
        ("GH-SME", "SME", "IFRS_FOR_SMES", "ACTIVE"),
        ("GH-PUBLIC", "PUBLIC", "IPSAS", "DRAFT"),
        ("GH-NONPROFIT", "NONPROFIT", "IFRS", "DRAFT"),
    ):
        preset, _ = AccountingPreset.objects.get_or_create(
            code=code,
            defaults={
                "country_code": "GH",
                "name": code,
                "institution_type": institution_type,
            },
        )
        versions[code], _ = AccountingPresetVersion.objects.get_or_create(
            accounting_preset=preset,
            version_code=f"{code}-2026.1",
            defaults={
                "localization_version": localization.code,
                "effective_from": date(2026, 1, 1),
                "reporting_framework": framework,
                "status": status,
            },
        )
    for version in versions.values():
        standard, _ = TaxCode.objects.get_or_create(
            preset_version=version,
            code="GH-VAT-STD",
            effective_from=date(2026, 1, 1),
            defaults={
                "name": "Ghana standard VAT and levies",
                "tax_treatment": "STANDARD",
                "is_active": True,
            },
        )
        for code, name, treatment in (
            ("GH-VAT-ZERO", "Ghana zero-rated supply", "ZERO_RATED"),
            ("GH-VAT-EXEMPT", "Ghana VAT-exempt supply", "EXEMPT"),
            ("GH-VAT-RELIEVED", "Ghana VAT-relieved supply", "RELIEVED"),
            ("GH-VAT-NONTAX", "Non-taxable supply", "NON_TAXABLE"),
            ("GH-VAT-IMPORT-SERVICE", "Imported service", "IMPORT_SERVICE"),
        ):
            TaxCode.objects.get_or_create(
                preset_version=version,
                code=code,
                effective_from=date(2026, 1, 1),
                defaults={"name": name, "tax_treatment": treatment, "is_active": True},
            )
        for code, name, rate, input_mapping, output_mapping, sequence in (
            ("VAT", "Value Added Tax", "15.0000", "VAT_INPUT", "VAT_OUTPUT_PAYABLE", 1),
            ("NHIL", "National Health Insurance Levy", "2.5000", "NHIL_INPUT", "NHIL_PAYABLE", 2),
            ("GETFUND", "Ghana Education Trust Fund Levy", "2.5000", "GETFUND_INPUT", "GETFUND_PAYABLE", 3),
        ):
            TaxComponent.objects.get_or_create(
                tax_code=standard,
                code=code,
                defaults={
                    "name": name,
                    "rate": Decimal(rate),
                    "input_account_mapping_code": input_mapping,
                    "output_account_mapping_code": output_mapping,
                    "sequence": sequence,
                },
            )
        for code, rate, is_vat in (
            ("GH-WHT-GOODS-RESIDENT", "3.0000", False),
            ("GH-WHT-SERVICES-RESIDENT", "7.5000", False),
            ("GH-WHT-WORKS-RESIDENT", "5.0000", False),
            ("GH-WHT-RENT-RESIDENTIAL", "8.0000", False),
            ("GH-WHT-RENT-COMMERCIAL", "15.0000", False),
            ("GH-WHT-DIVIDEND", "8.0000", False),
            ("GH-VAT-WITHHOLDING-STANDARD", "7.0000", True),
        ):
            WithholdingRule.objects.get_or_create(
                preset_version=version,
                code=code,
                effective_from=date(2026, 1, 1),
                defaults={
                    "name": code,
                    "residency": "ANY",
                    "transaction_category": "STANDARD_RATED_SUPPLY" if is_vat else "GOODS",
                    "rate": Decimal(rate),
                    "is_vat_withholding_rule": is_vat,
                    "requires_confirmation": True,
                },
            )


def test_ghana_2026_seed_links_localization_presets_tax_and_withholding_catalogs():
    localization = GhanaLocalizationVersion.objects.get(code="GH-LOCALIZATION-2026.1")
    assert localization.version == "2026.1"
    assert localization.default_currency == "GHS"
    assert localization.status == GhanaLocalizationVersion.Status.ACTIVE
    assert {source["url"] for source in localization.source_metadata["sources"]} == {
        "https://gra.gov.gh/domestic-tax/tax-types/vat/",
        "https://gra.gov.gh/portfolio/withholding-tax/",
        "https://gra.gov.gh/domestic-tax/tax-types/vat-withholding/",
    }

    versions = {
        version.accounting_preset.code: version
        for version in AccountingPresetVersion.objects.filter(
            localization_version=localization.code
        ).select_related("accounting_preset")
    }
    assert set(versions) == {
        "GH-COMMERCIAL",
        "GH-SME",
        "GH-PUBLIC",
        "GH-NONPROFIT",
    }
    assert versions["GH-COMMERCIAL"].status == AccountingPresetVersion.Status.ACTIVE
    assert versions["GH-SME"].status == AccountingPresetVersion.Status.ACTIVE
    assert versions["GH-PUBLIC"].status == AccountingPresetVersion.Status.DRAFT
    assert versions["GH-NONPROFIT"].status == AccountingPresetVersion.Status.DRAFT

    standard = TaxCode.objects.get(
        preset_version=versions["GH-COMMERCIAL"], code="GH-VAT-STD"
    )
    components = list(standard.components.order_by("sequence"))
    assert [(item.code, item.rate) for item in components] == [
        ("VAT", Decimal("15.0000")),
        ("NHIL", Decimal("2.5000")),
        ("GETFUND", Decimal("2.5000")),
    ]
    assert sum(item.rate for item in components) == Decimal("20.0000")
    assert components[0].input_account_mapping_code == "VAT_INPUT"
    assert components[2].output_account_mapping_code == "GETFUND_PAYABLE"

    withholding = WithholdingRule.objects.get(
        preset_version=versions["GH-COMMERCIAL"],
        code="GH-VAT-WITHHOLDING-STANDARD",
    )
    assert withholding.rate == Decimal("7.0000")
    assert withholding.is_vat_withholding_rule is True
    assert withholding.requires_confirmation is True
    assert {rule.code for rule in versions["GH-COMMERCIAL"].withholding_rules.all()} >= {
        "GH-WHT-GOODS-RESIDENT",
        "GH-WHT-SERVICES-RESIDENT",
        "GH-WHT-WORKS-RESIDENT",
        "GH-WHT-RENT-RESIDENTIAL",
        "GH-WHT-RENT-COMMERCIAL",
        "GH-WHT-DIVIDEND",
    }


def test_ghana_tax_catalog_model_validation_fails_closed_for_invalid_rates_and_dates():
    tax_code = TaxCode.objects.filter(code="GH-VAT-STD").first()
    with pytest.raises(ValidationError, match="Rate must be between"):
        TaxComponent.objects.create(
            tax_code=tax_code,
            code="INVALID-RATE",
            name="Invalid rate",
            rate=Decimal("100.0001"),
            sequence=99,
        )
    with pytest.raises(ValidationError, match="Effective end cannot precede"):
        WithholdingRule.objects.create(
            preset_version=tax_code.preset_version,
            code="INVALID-DATES",
            name="Invalid dates",
            residency="RESIDENT",
            transaction_category="GOODS",
            rate=Decimal("3.0000"),
            effective_from=tax_code.effective_from.replace(year=2027),
            effective_to=tax_code.effective_from,
        )


def test_ghana_accounting_catalog_api_is_module_gated_read_only_and_filterable(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="GH-ACCOUNTING-CATALOG", country_code="GH")
    actor = _finance(institution, user_factory, membership_factory)
    api_client.force_authenticate(actor)
    disabled = api_client.get(reverse("v1:tax-code-list"))
    assert disabled.status_code == 403
    assert disabled.json()["code"] == "module_disabled"

    _enable_accounting(institution)
    commercial = AccountingPresetVersion.objects.get(
        accounting_preset__code="GH-COMMERCIAL"
    )
    tax_codes = api_client.get(
        reverse("v1:tax-code-list"), {"preset_version": str(commercial.id)}
    )
    assert tax_codes.status_code == 200
    assert tax_codes.json()["data"]["count"] == 6
    standard = next(
        item for item in tax_codes.json()["data"]["results"] if item["code"] == "GH-VAT-STD"
    )
    component_response = api_client.get(
        reverse("v1:tax-component-list"), {"tax_code": standard["id"]}
    )
    assert component_response.status_code == 200
    assert [item["code"] for item in component_response.json()["data"]["results"]] == [
        "VAT",
        "NHIL",
        "GETFUND",
    ]
    withholding = api_client.get(
        reverse("v1:withholding-rule-list"),
        {"preset_version": str(commercial.id), "is_vat_withholding_rule": "true"},
    )
    assert withholding.status_code == 200
    assert withholding.json()["data"]["count"] == 1
    assert withholding.json()["data"]["results"][0]["rate"] == "7.0000"
    assert api_client.post(reverse("v1:tax-code-list"), {}, format="json").status_code == 405


@pytest.mark.postgresql
def test_postgresql_enforces_tax_component_identity_constraints():
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL-specific Ghana accounting constraint coverage")
    tax_code = TaxCode.objects.get(
        preset_version__accounting_preset__code="GH-COMMERCIAL", code="GH-VAT-STD"
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        TaxComponent.objects.bulk_create(
            [
                TaxComponent(
                    tax_code=tax_code,
                    code="PG-DUPLICATE",
                    name="One",
                    rate=Decimal("1.0000"),
                    sequence=90,
                ),
                TaxComponent(
                    tax_code=tax_code,
                    code="PG-DUPLICATE",
                    name="Two",
                    rate=Decimal("2.0000"),
                    sequence=91,
                ),
            ]
        )
