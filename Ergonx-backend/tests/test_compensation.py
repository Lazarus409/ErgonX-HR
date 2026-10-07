from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.urls import reverse

from apps.audit.models import AuditLog
from apps.compensation.models import (
    EmployeeCompensation,
    EmployeePayComponent,
    PayComponent,
    SalaryStructure,
    SalaryStructureComponent,
)
from apps.compensation.services import (
    change_current_compensation,
    deactivate_employee_pay_component,
    resolve_compensation,
    set_employee_pay_component,
)
from apps.institutions.models import InstitutionModule, Permission


pytestmark = pytest.mark.django_db


def _component(
    institution,
    *,
    code,
    calculation_type=PayComponent.CalculationType.FIXED,
    component_type=PayComponent.ComponentType.EARNING,
):
    return PayComponent.objects.create(
        institution=institution,
        name=code.replace("_", " ").title(),
        code=code,
        component_type=component_type,
        calculation_type=calculation_type,
    )


def _structure(institution, code="STANDARD"):
    return SalaryStructure.objects.create(
        institution=institution,
        name=f"{code.title()} Structure",
        code=code,
    )


def test_compensation_uses_payroll_module_gate_and_seeded_permissions(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)
    api_client.force_authenticate(user=hr)

    disabled = api_client.get(reverse("v1:pay-component-list"))
    module = InstitutionModule.objects.get(
        institution=institution,
        module_code=InstitutionModule.ModuleCode.PAYROLL,
    )
    module.is_enabled = True
    module.save(update_fields=("is_enabled", "updated_at"))
    enabled = api_client.get(reverse("v1:pay-component-list"))

    assert disabled.status_code == 403
    assert enabled.status_code == 200
    assert Permission.objects.get(code="compensation.manage").module_code == "PAYROLL"


def test_salary_structure_component_enforces_calculation_and_tenant_rules(
    institution_factory,
):
    institution = institution_factory(code="HOME")
    foreign_institution = institution_factory(code="FOREIGN")
    structure = _structure(institution)
    fixed = _component(institution, code="ALLOWANCE")
    foreign = _component(foreign_institution, code="FOREIGN_ALLOWANCE")

    with pytest.raises(ValidationError, match="fixed component"):
        SalaryStructureComponent.objects.create(
            institution=institution,
            salary_structure=structure,
            pay_component=fixed,
            default_percentage=Decimal("5"),
        )
    with pytest.raises(ValidationError, match="same institution"):
        SalaryStructureComponent.objects.create(
            institution=institution,
            salary_structure=structure,
            pay_component=foreign,
            default_amount=Decimal("100"),
        )


def test_compensation_change_preserves_effective_dated_history_and_audit(
    institution_factory, employee_factory, user_factory, membership_factory
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee = employee_factory(institution)
    first_structure = _structure(institution, "FIRST")
    second_structure = _structure(institution, "SECOND")

    first = change_current_compensation(
        institution=institution,
        employee=employee,
        salary_structure=first_structure,
        base_salary=Decimal("10000"),
        currency="ghs",
        effective_from=date(2026, 1, 1),
        actor=hr,
    )
    second = change_current_compensation(
        institution=institution,
        employee=employee,
        salary_structure=second_structure,
        base_salary=Decimal("12000"),
        currency="GHS",
        effective_from=date(2026, 7, 1),
        actor=hr,
    )
    first.refresh_from_db()

    assert EmployeeCompensation.objects.filter(employee=employee).count() == 2
    assert first.is_current is False
    assert first.effective_to == date(2026, 6, 30)
    assert second.is_current is True
    assert second.currency == "GHS"
    assert AuditLog.objects.filter(
        institution=institution, action="compensation.employee.changed"
    ).count() == 2


def test_compensation_api_creates_and_resolves_current_record(
    api_client,
    institution_factory,
    employee_factory,
    user_factory,
    membership_factory,
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(
        user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True
    )
    employee = employee_factory(institution)
    structure = _structure(institution)
    allowance = _component(institution, code="API_ALLOWANCE")
    SalaryStructureComponent.objects.create(
        institution=institution,
        salary_structure=structure,
        pay_component=allowance,
        default_amount=Decimal("250"),
    )
    InstitutionModule.objects.filter(
        institution=institution,
        module_code=InstitutionModule.ModuleCode.PAYROLL,
    ).update(is_enabled=True)
    api_client.force_authenticate(user=hr)

    created = api_client.post(
        reverse("v1:employee-compensation-list"),
        {
            "employee": str(employee.id),
            "salary_structure": str(structure.id),
            "base_salary": "5000.00",
            "currency": "ghs",
            "effective_from": "2026-01-01",
        },
        format="json",
    )
    assert created.status_code == 201
    assert created.data["pay_basis"] == "PAYROLL_PERIOD"

    resolved = api_client.get(
        reverse(
            "v1:employee-compensation-resolved",
            kwargs={"pk": created.data["id"]},
        ),
        {"as_of": "2026-02-01"},
    )

    assert resolved.status_code == 200
    assert resolved.data["currency"] == "GHS"
    assert resolved.data["components"][0]["resolved_amount"] == "250.00"


def test_employee_override_history_and_resolved_compensation(
    institution_factory, employee_factory, user_factory, membership_factory
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee = employee_factory(institution)
    structure = _structure(institution)
    allowance = _component(institution, code="ALLOWANCE")
    bonus = _component(
        institution,
        code="BONUS",
        calculation_type=PayComponent.CalculationType.PERCENTAGE,
    )
    deduction = _component(
        institution,
        code="DEDUCTION",
        calculation_type=PayComponent.CalculationType.PERCENTAGE,
        component_type=PayComponent.ComponentType.DEDUCTION,
    )
    SalaryStructureComponent.objects.create(
        institution=institution,
        salary_structure=structure,
        pay_component=allowance,
        default_amount=Decimal("500"),
        sequence=1,
    )
    SalaryStructureComponent.objects.create(
        institution=institution,
        salary_structure=structure,
        pay_component=bonus,
        default_percentage=Decimal("10"),
        percentage_base_component=allowance,
        sequence=2,
    )
    SalaryStructureComponent.objects.create(
        institution=institution,
        salary_structure=structure,
        pay_component=deduction,
        default_percentage=Decimal("5"),
        sequence=3,
    )
    compensation = change_current_compensation(
        institution=institution,
        employee=employee,
        salary_structure=structure,
        base_salary=Decimal("10000"),
        currency="GHS",
        effective_from=date(2026, 1, 1),
        actor=hr,
    )
    first_override = set_employee_pay_component(
        institution=institution,
        employee_compensation=compensation,
        pay_component=allowance,
        amount=Decimal("600"),
        effective_from=date(2026, 2, 1),
        actor=hr,
    )
    second_override = set_employee_pay_component(
        institution=institution,
        employee_compensation=compensation,
        pay_component=allowance,
        amount=Decimal("700"),
        effective_from=date(2026, 3, 1),
        actor=hr,
    )
    first_override.refresh_from_db()
    resolved = resolve_compensation(compensation, date(2026, 4, 1))
    by_code = {component["code"]: component for component in resolved["components"]}

    assert first_override.is_active is False
    assert first_override.effective_to == date(2026, 2, 28)
    assert second_override.is_active is True
    assert by_code["ALLOWANCE"]["resolved_amount"] == Decimal("700.00")
    assert by_code["ALLOWANCE"]["source"] == "EMPLOYEE_OVERRIDE"
    assert by_code["BONUS"]["resolved_amount"] == Decimal("70.00")
    assert by_code["DEDUCTION"]["resolved_amount"] == Decimal("500.00")

    deactivate_employee_pay_component(
        override=second_override,
        actor=hr,
        effective_to=date(2026, 4, 30),
    )
    after_override = resolve_compensation(compensation, date(2026, 5, 1))
    after_by_code = {
        component["code"]: component for component in after_override["components"]
    }
    assert after_by_code["ALLOWANCE"]["resolved_amount"] == Decimal("500.00")
    assert after_by_code["BONUS"]["resolved_amount"] == Decimal("50.00")


def test_employee_compensation_api_is_self_scoped_and_hides_configuration(
    api_client,
    institution_factory,
    employee_factory,
    user_factory,
    membership_factory,
):
    institution = institution_factory()
    hr = user_factory(email="comp-hr@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee_user = user_factory(email="comp-employee@example.com")
    membership_factory(
        user=employee_user,
        institution=institution,
        role_code="EMPLOYEE",
        is_primary=True,
    )
    other_user = user_factory(email="comp-other@example.com")
    membership_factory(user=other_user, institution=institution, role_code="EMPLOYEE")
    employee = employee_factory(institution, user=employee_user)
    other_employee = employee_factory(institution, user=other_user)
    structure = _structure(institution)
    own = change_current_compensation(
        institution=institution,
        employee=employee,
        salary_structure=structure,
        base_salary=Decimal("10000"),
        currency="GHS",
        effective_from=date(2026, 1, 1),
        actor=hr,
    )
    other = change_current_compensation(
        institution=institution,
        employee=other_employee,
        salary_structure=structure,
        base_salary=Decimal("20000"),
        currency="GHS",
        effective_from=date(2026, 1, 1),
        actor=hr,
    )
    InstitutionModule.objects.filter(
        institution=institution,
        module_code=InstitutionModule.ModuleCode.PAYROLL,
    ).update(is_enabled=True)
    api_client.force_authenticate(user=employee_user)

    listing = api_client.get(reverse("v1:employee-compensation-list"))
    own_detail = api_client.get(
        reverse("v1:employee-compensation-detail", kwargs={"pk": own.pk})
    )
    other_detail = api_client.get(
        reverse("v1:employee-compensation-detail", kwargs={"pk": other.pk})
    )
    configuration = api_client.get(reverse("v1:pay-component-list"))

    assert listing.status_code == 200
    assert listing.data["count"] == 1
    assert own_detail.status_code == 200
    assert other_detail.status_code == 404
    assert configuration.status_code == 403


def test_cross_tenant_compensation_is_rejected(
    institution_factory, employee_factory, user_factory, membership_factory
):
    institution = institution_factory(code="HOME")
    other = institution_factory(code="OTHER")
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee = employee_factory(institution)
    foreign_structure = _structure(other)

    with pytest.raises(ValidationError, match="selected institution"):
        change_current_compensation(
            institution=institution,
            employee=employee,
            salary_structure=foreign_structure,
            base_salary=Decimal("10000"),
            currency="GHS",
            effective_from=date(2026, 1, 1),
            actor=hr,
        )


@pytest.mark.postgresql
def test_postgresql_current_compensation_constraint(
    institution_factory, employee_factory
):
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL-specific verification runs in the PostgreSQL CI job")
    institution = institution_factory()
    employee = employee_factory(institution)
    structure = _structure(institution)
    EmployeeCompensation.objects.bulk_create(
        [
            EmployeeCompensation(
                institution=institution,
                employee=employee,
                salary_structure=structure,
                base_salary=Decimal("10000"),
                currency="GHS",
                effective_from=date(2026, 1, 1),
            )
        ]
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        EmployeeCompensation.objects.bulk_create(
            [
                EmployeeCompensation(
                    institution=institution,
                    employee=employee,
                    salary_structure=structure,
                    base_salary=Decimal("12000"),
                    currency="GHS",
                    effective_from=date(2026, 2, 1),
                )
            ]
        )
