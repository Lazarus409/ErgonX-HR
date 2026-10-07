from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.urls import reverse

from apps.compensation.models import (
    EmployeeCompensation,
    PayComponent,
    SalaryStructure,
    SalaryStructureComponent,
)
from apps.documents.models import Document
from apps.employees.models import Employment
from apps.institutions.models import InstitutionModule
from apps.notifications.models import Notification
from apps.payroll.models import (
    EmployeePayrollProfile,
    PayrollPeriod,
    PayrollPresetVersion,
    SpecialIncomeRule,
    StatutoryThreshold,
)
from apps.payroll.services import (
    approve_payroll_run,
    calculate_payroll_run,
    configure_employee_payroll_profile,
    configure_payroll,
    create_payroll_period,
    create_payroll_run,
    create_tax_relief_claim,
    decide_tax_relief_claim,
    finalize_payroll_run,
    submit_payroll_run_for_review,
    submit_tax_relief_claim,
)


pytestmark = pytest.mark.django_db


def _enable_payroll(institution):
    module = institution.modules.get(module_code=InstitutionModule.ModuleCode.PAYROLL)
    module.is_enabled = True
    module.save(update_fields=("is_enabled", "updated_at"))


def _employee_with_compensation(
    institution,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
    *,
    employee_number="GH001",
    base_salary=Decimal("3000.00"),
    employment_type=Employment.EmploymentType.PERMANENT,
    staff_category=Employment.StaffCategory.OTHER,
):
    employee = employee_factory(institution, employee_number=employee_number)
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    Employment.objects.create(
        institution=institution,
        employee=employee,
        department=department,
        position=position,
        grade=grade,
        location=location,
        employment_type=employment_type,
        staff_category=staff_category,
        start_date=date(2026, 1, 1),
    )
    structure = SalaryStructure.objects.create(
        institution=institution,
        name=f"Structure {employee_number}",
        code=f"STR-{employee_number}",
    )
    compensation = EmployeeCompensation.objects.create(
        institution=institution,
        employee=employee,
        salary_structure=structure,
        base_salary=base_salary,
        currency="GHS",
        effective_from=date(2026, 1, 1),
    )
    return employee, compensation


def _ghana_version():
    return PayrollPresetVersion.objects.select_related("payroll_preset").get(
        payroll_preset__code="GH-PAYROLL", version_code="GH-2026.1"
    )


def _configure_ghana(institution, hr, version):
    return configure_payroll(
        institution=institution,
        actor=hr,
        country_code="GH",
        currency="GHS",
        payroll_frequency="MONTHLY",
        payroll_setup_mode="PRESET",
        selected_payroll_preset_version=version,
    )


def _period_and_run(institution, hr, key="ghana-2026-09"):
    period = create_payroll_period(
        institution=institution,
        actor=hr,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )
    run = create_payroll_run(
        institution=institution,
        payroll_period=period,
        actor=hr,
        idempotency_key=key,
    )
    return period, run


def test_ghana_2026_preset_seed_is_complete_and_source_backed():
    version = _ghana_version()
    resident = version.tax_rules.get(code="GH_PAYE_RESIDENT")
    pension = version.contribution_rules.get(code="GH_MANDATORY_PENSION")

    assert version.status == PayrollPresetVersion.Status.ACTIVE
    assert version.source_metadata["evaluator"] == "GHANA_2026"
    assert len(version.source_metadata["authority_sources"]) == 5
    assert list(resident.bands.values_list("band_amount", "rate")) == [
        (Decimal("490.00"), Decimal("0.0000")),
        (Decimal("110.00"), Decimal("5.0000")),
        (Decimal("130.00"), Decimal("10.0000")),
        (Decimal("3166.67"), Decimal("17.5000")),
        (Decimal("16000.00"), Decimal("25.0000")),
        (Decimal("30520.00"), Decimal("30.0000")),
        (None, Decimal("35.0000")),
    ]
    assert pension.employee_rate == Decimal("5.5000")
    assert pension.employer_rate == Decimal("13.0000")
    assert pension.minimum_basis == Decimal("587.80")
    assert pension.maximum_basis == Decimal("69000.00")
    assert sum(pension.allocations.values_list("rate", flat=True)) == Decimal("18.5000")
    assert version.relief_definitions.count() == 7
    assert version.compliance_deadlines.count() == 2
    assert StatutoryThreshold.objects.get(
        preset_version=version, code="NATIONAL_DAILY_MINIMUM_WAGE"
    ).amount == Decimal("21.77")
    overtime = SpecialIncomeRule.objects.get(
        preset_version=version, code="GH_OVERTIME_TAX"
    )
    assert overtime.requires_validation is True
    assert overtime.eligibility_json["validation_status"] == "PENDING_LEGAL_REVIEW"


def test_ghana_setup_choices_and_employee_tax_residency_are_explicit(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory(country_code="GH", default_currency="GHS")
    _enable_payroll(institution)
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)
    employee = employee_factory(institution)
    api_client.force_authenticate(hr)

    choices = api_client.get(reverse("v1:payroll-configuration-choices"))
    profile = api_client.post(
        reverse("v1:employee-payroll-profile-list"),
        {
            "employee": str(employee.id),
            "tax_residency": "RESIDENT",
            "tax_identification_number": "GHA-TEST-001",
        },
        format="json",
    )

    assert choices.status_code == 200
    assert choices.data["choices"][0]["version_code"] == "GH-2026.1"
    assert choices.data["choices"][0]["recommended"] is True
    assert choices.data["choices"][-1]["mode"] == "CUSTOM"
    assert "No country statutory rules" in choices.data["choices"][-1][
        "compliance_warning"
    ]
    assert profile.status_code == 201
    assert EmployeePayrollProfile.objects.get(employee=employee).tax_residency == "RESIDENT"


def test_employee_role_cannot_manage_payroll_profiles(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory(country_code="GH", default_currency="GHS")
    _enable_payroll(institution)
    employee_user = user_factory()
    membership_factory(
        user=employee_user,
        institution=institution,
        role_code="EMPLOYEE",
        is_primary=True,
    )
    employee = employee_factory(institution, user=employee_user)
    api_client.force_authenticate(employee_user)

    listing = api_client.get(reverse("v1:employee-payroll-profile-list"))
    creation = api_client.post(
        reverse("v1:employee-payroll-profile-list"),
        {
            "employee": str(employee.id),
            "tax_residency": "RESIDENT",
        },
        format="json",
    )

    assert listing.status_code == 403
    assert listing.json()["code"] == "permission_denied"
    assert creation.status_code == 403
    assert creation.json()["code"] == "permission_denied"


def test_ghana_resident_paye_pension_deadlines_and_finalization_reminders(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee, _ = _employee_with_compensation(
        institution,
        employee_factory,
        organization_factory,
        assignment_dimensions_factory,
    )
    version = _ghana_version()
    _configure_ghana(institution, hr, version)
    configure_employee_payroll_profile(
        institution=institution,
        employee=employee,
        actor=hr,
        tax_residency="RESIDENT",
    )
    period, run = _period_and_run(institution, hr)

    run = calculate_payroll_run(payroll_run=run, actor=hr)
    record = run.records.get(employee=employee)

    assert record.gross_pay == Decimal("3000.00")
    assert record.taxable_income == Decimal("3000.00")
    assert record.employee_contributions == Decimal("165.00")
    assert record.employer_contributions == Decimal("390.00")
    assert record.total_deductions == Decimal("386.88")
    assert record.net_pay == Decimal("2448.12")
    assert record.items.get(
        component_code_snapshot="GH_PAYE_RESIDENT"
    ).metadata["basis"] == "2835.00"

    run = submit_payroll_run_for_review(payroll_run=run, actor=hr)
    approver = user_factory()
    membership_factory(user=approver, institution=institution, role_code="FINANCE_MANAGER")
    run = approve_payroll_run(payroll_run=run, actor=approver)
    finalize_payroll_run(payroll_run=run, actor=hr)
    # Every payroll finalizer is reminded (the approver too); check HR's set.
    reminders = Notification.objects.filter(
        institution=institution,
        user=hr,
        notification_type="PAYROLL_COMPLIANCE_DEADLINE",
    ).order_by("metadata__due_date")
    assert list(reminders.values_list("metadata__due_date", flat=True)) == [
        "2026-10-14",
        "2026-10-15",
    ]
    period.refresh_from_db()
    assert period.status == PayrollPeriod.Status.CLOSED


def test_ghana_non_resident_uses_flat_rate_and_missing_profile_fails_closed(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee, _ = _employee_with_compensation(
        institution,
        employee_factory,
        organization_factory,
        assignment_dimensions_factory,
    )
    version = _ghana_version()
    _configure_ghana(institution, hr, version)
    _, run = _period_and_run(institution, hr, "missing-profile")

    with pytest.raises(ValidationError, match="explicit tax residency"):
        calculate_payroll_run(payroll_run=run, actor=hr)
    run.refresh_from_db()
    assert run.status == run.Status.DRAFT
    assert not run.records.exists()

    configure_employee_payroll_profile(
        institution=institution,
        employee=employee,
        actor=hr,
        tax_residency="NON_RESIDENT",
    )
    calculate_payroll_run(payroll_run=run, actor=hr)
    record = run.records.get(employee=employee)
    assert record.employee_contributions == Decimal("165.00")
    assert record.total_deductions == Decimal("708.75")
    assert record.net_pay == Decimal("2126.25")


def test_ghana_approved_relief_and_bonus_are_applied_with_ytd_metadata(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee, compensation = _employee_with_compensation(
        institution,
        employee_factory,
        organization_factory,
        assignment_dimensions_factory,
    )
    bonus = PayComponent.objects.create(
        institution=institution,
        name="Bonus",
        code="BONUS",
        component_type=PayComponent.ComponentType.EARNING,
        calculation_type=PayComponent.CalculationType.FIXED,
        taxable=True,
    )
    SalaryStructureComponent.objects.create(
        institution=institution,
        salary_structure=compensation.salary_structure,
        pay_component=bonus,
        default_amount=Decimal("1000.00"),
    )
    version = _ghana_version()
    _configure_ghana(institution, hr, version)
    configure_employee_payroll_profile(
        institution=institution,
        employee=employee,
        actor=hr,
        tax_residency="RESIDENT",
    )
    evidence = Document.objects.create(
        institution=institution,
        uploaded_by=hr,
        file_reference="reliefs/marriage.pdf",
        original_filename="marriage.pdf",
        content_type="application/pdf",
        size_bytes=100,
    )
    claim = create_tax_relief_claim(
        institution=institution,
        actor=hr,
        employee=employee,
        relief_definition=version.relief_definitions.get(
            code="MARRIAGE_RESPONSIBILITY"
        ),
        tax_year=2026,
        claimed_amount=Decimal("1200.00"),
        evidence=evidence,
    )
    claim = submit_tax_relief_claim(claim=claim, actor=hr)
    decide_tax_relief_claim(claim=claim, actor=hr, approve=True)
    _, run = _period_and_run(institution, hr, "relief-bonus")

    calculate_payroll_run(payroll_run=run, actor=hr)
    record = run.records.get(employee=employee)
    bonus_tax = record.items.get(component_code_snapshot="GH_BONUS_TAX")
    relief_item = record.items.get(
        component_code_snapshot="GH_RELIEF_MARRIAGE_RESPONSIBILITY"
    )

    assert record.gross_pay == Decimal("4000.00")
    assert bonus_tax.amount == Decimal("50.00")
    assert bonus_tax.metadata["annual_threshold"] == "5400.00"
    assert relief_item.amount == Decimal("1200.00")
    assert record.total_deductions == Decimal("226.88")
    assert record.net_pay == Decimal("3608.12")


def test_ghana_non_resident_bonus_rate_is_loaded_from_versioned_rule_data(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee, compensation = _employee_with_compensation(
        institution,
        employee_factory,
        organization_factory,
        assignment_dimensions_factory,
    )
    bonus = PayComponent.objects.create(
        institution=institution,
        name="Bonus",
        code="BONUS",
        component_type=PayComponent.ComponentType.EARNING,
        calculation_type=PayComponent.CalculationType.FIXED,
        taxable=True,
    )
    SalaryStructureComponent.objects.create(
        institution=institution,
        salary_structure=compensation.salary_structure,
        pay_component=bonus,
        default_amount=Decimal("1000.00"),
    )
    version = _ghana_version()
    bonus_rule = version.special_income_rules.get(code="GH_BONUS_TAX")
    bonus_rule.calculation_json = {
        **bonus_rule.calculation_json,
        "non_resident_rate": "19",
    }
    bonus_rule.save(update_fields=("calculation_json", "updated_at"))
    _configure_ghana(institution, hr, version)
    configure_employee_payroll_profile(
        institution=institution,
        employee=employee,
        actor=hr,
        tax_residency="NON_RESIDENT",
    )
    _, run = _period_and_run(institution, hr, "non-resident-bonus")

    calculate_payroll_run(payroll_run=run, actor=hr)
    record = run.records.get(employee=employee)
    bonus_tax = record.items.get(
        component_code_snapshot="GH_NON_RESIDENT_BONUS_TAX"
    )

    assert bonus_tax.rate == Decimal("19.0000")
    assert bonus_tax.amount == Decimal("190.00")
    assert bonus_tax.metadata["tax_residency"] == "NON_RESIDENT"
    assert record.total_deductions == Decimal("898.75")
    assert record.net_pay == Decimal("2936.25")
