from datetime import date
from decimal import Decimal

from django.db import migrations


def seed_ghana_payroll_2026(apps, schema_editor):
    PayrollPreset = apps.get_model("payroll", "PayrollPreset")
    PayrollPresetVersion = apps.get_model("payroll", "PayrollPresetVersion")
    TaxRule = apps.get_model("payroll", "TaxRule")
    TaxBand = apps.get_model("payroll", "TaxBand")
    ContributionRule = apps.get_model("payroll", "ContributionRule")
    ContributionAllocation = apps.get_model("payroll", "ContributionAllocation")
    SpecialIncomeRule = apps.get_model("payroll", "SpecialIncomeRule")
    TaxReliefDefinition = apps.get_model("payroll", "TaxReliefDefinition")
    StatutoryThreshold = apps.get_model("payroll", "StatutoryThreshold")
    ComplianceDeadline = apps.get_model("payroll", "ComplianceDeadline")

    preset, _ = PayrollPreset.objects.update_or_create(
        code="GH-PAYROLL",
        defaults={
            "country_code": "GH",
            "name": "Ghana Payroll",
            "description": "Versioned Ghana statutory payroll configuration.",
            "is_system_managed": True,
        },
    )
    version, _ = PayrollPresetVersion.objects.update_or_create(
        payroll_preset=preset,
        version_code="GH-2026.1",
        defaults={
            "effective_from": date(2026, 1, 1),
            "effective_to": None,
            "status": "DRAFT",
            "source_metadata": {
                "evaluator": "GHANA_2026",
                "currency": "GHS",
                "payroll_frequency": "MONTHLY",
                "recommended_for_country": True,
                "verified_at": "2026-09-11",
                "authority_sources": [
                    {
                        "authority": "Ghana Revenue Authority",
                        "url": "https://gra.gov.gh/domestic-tax/tax-types/paye/",
                        "covers": [
                            "PAYE",
                            "BONUS",
                            "OVERTIME",
                            "CASUAL_WORKERS",
                            "FILING_DEADLINE",
                        ],
                    },
                    {
                        "authority": "Ghana Revenue Authority",
                        "url": "https://gra.gov.gh/domestic-tax/personal-tax-relief/",
                        "covers": ["PERSONAL_RELIEFS"],
                    },
                    {
                        "authority": "Social Security and National Insurance Trust",
                        "url": "https://www.ssnit.org.gh/wp-content/uploads/2026/01/Public-Notice-Min-Max-Insurable.pdf",
                        "covers": ["2026_INSURABLE_EARNINGS"],
                    },
                    {
                        "authority": "Fair Wages and Salaries Commission",
                        "url": "https://fairwages.gov.gh/wp-content/uploads/2025/11/2026-National-Daily-Minimum-Wage.pdf",
                        "covers": ["2026_MINIMUM_WAGE"],
                    },
                    {
                        "authority": "National Pensions Regulatory Authority",
                        "url": "https://npra.gov.gh/assets/documents/Pension-Digest-Issue-2.pdf",
                        "covers": ["MANDATORY_PENSION_RATES", "TIER_ALLOCATIONS"],
                    },
                ],
                "validation_flags": {
                    "overtime_annual_income_threshold": (
                        "PENDING_LEGAL_REVIEW: GRA public guidance still states GHS 18,000."
                    )
                },
            },
        },
    )

    resident_tax, _ = TaxRule.objects.update_or_create(
        preset_version=version,
        code="GH_PAYE_RESIDENT",
        defaults={
            "name": "Ghana resident monthly PAYE",
            "method": "PROGRESSIVE",
            "residency": "RESIDENT",
            "rate": None,
            "threshold": None,
            "basis": "TAXABLE_INCOME",
            "sequence": 100,
            "active": True,
        },
    )
    bands = (
        (1, "490.00", "0.0000"),
        (2, "110.00", "5.0000"),
        (3, "130.00", "10.0000"),
        (4, "3166.67", "17.5000"),
        (5, "16000.00", "25.0000"),
        (6, "30520.00", "30.0000"),
        (7, None, "35.0000"),
    )
    for sequence, band_amount, rate in bands:
        TaxBand.objects.update_or_create(
            tax_rule=resident_tax,
            sequence=sequence,
            defaults={
                "lower_bound": None,
                "upper_bound": None,
                "band_amount": Decimal(band_amount) if band_amount else None,
                "rate": Decimal(rate),
            },
        )
    TaxRule.objects.update_or_create(
        preset_version=version,
        code="GH_PAYE_NON_RESIDENT",
        defaults={
            "name": "Ghana non-resident employment income tax",
            "method": "FLAT",
            "residency": "NON_RESIDENT",
            "rate": Decimal("25.0000"),
            "threshold": None,
            "basis": "TAXABLE_INCOME",
            "sequence": 110,
            "active": True,
        },
    )

    pension, _ = ContributionRule.objects.update_or_create(
        preset_version=version,
        code="GH_MANDATORY_PENSION",
        effective_from=date(2026, 1, 1),
        defaults={
            "name": "Ghana mandatory Tier 1 and Tier 2 pension",
            "basis": "BASE_SALARY",
            "employee_rate": Decimal("5.5000"),
            "employer_rate": Decimal("13.0000"),
            "minimum_basis": Decimal("587.80"),
            "maximum_basis": Decimal("69000.00"),
            "effective_to": None,
        },
    )
    ContributionAllocation.objects.update_or_create(
        contribution_rule=pension,
        code="TIER_1_SSNIT",
        defaults={
            "name": "Tier 1 remittance through SSNIT",
            "rate": Decimal("13.5000"),
            "destination_type": "STATUTORY_AUTHORITY",
            "destination_reference": "SSNIT (11% basic pension; 2.5% NHIA transfer)",
        },
    )
    ContributionAllocation.objects.update_or_create(
        contribution_rule=pension,
        code="TIER_2_OCCUPATIONAL",
        defaults={
            "name": "Tier 2 mandatory occupational pension",
            "rate": Decimal("5.0000"),
            "destination_type": "REGISTERED_TRUSTEE",
            "destination_reference": "Institution-selected licensed Tier 2 trustee",
        },
    )

    SpecialIncomeRule.objects.update_or_create(
        preset_version=version,
        code="GH_BONUS_TAX",
        effective_from=date(2026, 1, 1),
        defaults={
            "name": "Ghana annual bonus concession",
            "income_type": "BONUS",
            "eligibility_json": {"tax_residency": ["RESIDENT", "NON_RESIDENT"]},
            "calculation_json": {
                "component_codes": ["BONUS"],
                "annual_salary_multiplier": "12",
                "annual_threshold_rate": "15",
                "concession_rate": "5",
                "non_resident_rate": "20",
            },
            "effective_to": None,
            "requires_validation": False,
        },
    )
    SpecialIncomeRule.objects.update_or_create(
        preset_version=version,
        code="GH_OVERTIME_TAX",
        effective_from=date(2026, 1, 1),
        defaults={
            "name": "Ghana qualifying junior staff overtime tax",
            "income_type": "OVERTIME",
            "eligibility_json": {
                "staff_category": ["JUNIOR"],
                "annual_income_limit": "18000.00",
                "validation_status": "PENDING_LEGAL_REVIEW",
            },
            "calculation_json": {
                "monthly_basic_threshold_rate": "50",
                "lower_rate": "5",
                "upper_rate": "10",
                "non_resident_rate": "20",
            },
            "effective_to": None,
            "requires_validation": True,
        },
    )
    SpecialIncomeRule.objects.update_or_create(
        preset_version=version,
        code="GH_CASUAL_WORKER_TAX",
        effective_from=date(2026, 1, 1),
        defaults={
            "name": "Ghana casual worker withholding tax",
            "income_type": "CASUAL",
            "eligibility_json": {"employment_type": ["CASUAL"]},
            "calculation_json": {"rate": "5"},
            "effective_to": None,
            "requires_validation": False,
        },
    )

    reliefs = (
        (
            "MARRIAGE_RESPONSIBILITY",
            "Marriage / responsibility relief",
            "FIXED_ANNUAL",
            "1200.00",
            None,
            None,
            {"tax_residency": ["RESIDENT"]},
        ),
        (
            "CHILD_EDUCATION",
            "Child education relief",
            "FIXED_PER_DEPENDENT",
            "600.00",
            3,
            None,
            {"tax_residency": ["RESIDENT"]},
        ),
        (
            "DISABILITY",
            "Disability relief",
            "PERCENTAGE_INCOME",
            None,
            None,
            "25.0000",
            {"tax_residency": ["RESIDENT"]},
        ),
        (
            "OLD_AGE",
            "Old age relief",
            "FIXED_ANNUAL",
            "1500.00",
            None,
            None,
            {"tax_residency": ["RESIDENT"], "minimum_age": 60},
        ),
        (
            "AGED_DEPENDENT_RELATIVE",
            "Aged dependent relative relief",
            "FIXED_PER_DEPENDENT",
            "1000.00",
            2,
            None,
            {"tax_residency": ["RESIDENT"]},
        ),
        (
            "EDUCATIONAL_TRAINING",
            "Educational / professional training relief",
            "FIXED_ANNUAL",
            "2000.00",
            None,
            None,
            {"tax_residency": ["RESIDENT"]},
        ),
        (
            "MORTGAGE_INTEREST",
            "Qualifying mortgage interest relief",
            "ACTUAL_AMOUNT",
            None,
            None,
            None,
            {"tax_residency": ["RESIDENT"], "principal_residence_only": True},
        ),
    )
    for code, name, method, default_amount, max_count, percentage, eligibility in reliefs:
        TaxReliefDefinition.objects.update_or_create(
            preset_version=version,
            code=code,
            defaults={
                "name": name,
                "calculation_method": method,
                "default_amount": (
                    Decimal(default_amount) if default_amount is not None else None
                ),
                "max_count": max_count,
                "percentage": Decimal(percentage) if percentage is not None else None,
                "eligibility_json": eligibility,
                "requires_evidence": True,
            },
        )

    thresholds = (
        ("SSNIT_MIN_INSURABLE_EARNINGS", "Minimum insurable earnings", "587.80", "MONTHLY", None),
        ("SSNIT_MAX_INSURABLE_EARNINGS", "Maximum insurable earnings", "69000.00", "MONTHLY", None),
        ("NATIONAL_DAILY_MINIMUM_WAGE", "2026 national daily minimum wage", "21.77", "DAILY", date(2026, 12, 31)),
        ("BONUS_ANNUAL_THRESHOLD", "Bonus concession threshold", "15.00", "PERCENT_OF_ANNUAL_BASIC", None),
        ("OVERTIME_QUALIFYING_ANNUAL_INCOME", "Overtime qualifying annual income", "18000.00", "ANNUAL", None),
    )
    for code, name, amount, unit, effective_to in thresholds:
        StatutoryThreshold.objects.update_or_create(
            preset_version=version,
            code=code,
            effective_from=date(2026, 1, 1),
            defaults={
                "name": name,
                "amount": Decimal(amount),
                "unit": unit,
                "effective_to": effective_to,
            },
        )

    ComplianceDeadline.objects.update_or_create(
        preset_version=version,
        code="GRA_PAYE_MONTHLY_RETURN",
        effective_from=date(2026, 1, 1),
        defaults={
            "authority": "Ghana Revenue Authority",
            "event_type": "PAYE_MONTHLY_RETURN_AND_PAYMENT",
            "calculation_rule": {"anchor": "FOLLOWING_MONTH"},
            "offset_days": None,
            "day_of_month": 15,
            "effective_to": None,
        },
    )
    ComplianceDeadline.objects.update_or_create(
        preset_version=version,
        code="PENSION_MONTHLY_REMITTANCE",
        effective_from=date(2026, 1, 1),
        defaults={
            "authority": "SSNIT / Registered Tier 2 Trustee",
            "event_type": "PENSION_CONTRIBUTION_REMITTANCE",
            "calculation_rule": {"anchor": "PERIOD_END"},
            "offset_days": 14,
            "day_of_month": None,
            "effective_to": None,
        },
    )
    PayrollPresetVersion.objects.filter(pk=version.pk).update(status="ACTIVE")


class Migration(migrations.Migration):
    dependencies = [("payroll", "0002_employeepayrollprofile")]

    operations = [
        migrations.RunPython(seed_ghana_payroll_2026, migrations.RunPython.noop)
    ]
