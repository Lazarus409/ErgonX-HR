from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.compensation.models import EmployeeCompensation, SalaryStructure
from apps.documents.models import Document
from apps.payroll.models import (
    EmployeeTaxReliefClaim,
    PayrollItem,
    PayrollRecord,
    PayrollRun,
)
from apps.payroll.selectors import (
    active_payroll_preset_versions_for_institution,
    approved_tax_relief_claims_for_employee,
    effective_compliance_deadlines_for_period,
    effective_contribution_rule,
    effective_special_income_rule,
    eligible_employees_for_payroll_run,
    finalized_employee_payroll_items_ytd,
    finalized_employee_payroll_records_ytd,
    payroll_records_with_items,
)
from apps.payroll.services import (
    configure_payroll,
    create_payroll_period,
    create_payroll_run,
)


pytestmark = pytest.mark.django_db


def _employee_with_compensation(
    institution,
    employee_factory,
    *,
    employee_number,
):
    employee = employee_factory(
        institution,
        employee_number=employee_number,
    )
    structure = SalaryStructure.objects.create(
        institution=institution,
        name=f"Structure {employee_number}",
        code=f"STR-{employee_number}",
    )
    EmployeeCompensation.objects.create(
        institution=institution,
        employee=employee,
        salary_structure=structure,
        base_salary=Decimal("3000.00"),
        currency="GHS",
        effective_from=date(2026, 1, 1),
    )
    return employee


def _configure_ghana(institution, actor, version):
    configure_payroll(
        institution=institution,
        actor=actor,
        country_code="GH",
        currency="GHS",
        payroll_frequency="MONTHLY",
        payroll_setup_mode="PRESET",
        selected_payroll_preset_version=version,
    )


def _period_and_run(institution, actor, *, month, key):
    start_date = date(2026, month, 1)
    end_date = date(2026, month, 31 if month == 8 else 30)
    period = create_payroll_period(
        institution=institution,
        actor=actor,
        name=end_date.strftime("%B %Y"),
        start_date=start_date,
        end_date=end_date,
        pay_date=end_date,
    )
    run = create_payroll_run(
        institution=institution,
        payroll_period=period,
        actor=actor,
        idempotency_key=key,
    )
    return period, run


def test_payroll_selectors_apply_effective_dates_and_tenant_scope(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory(code="HOME")
    other = institution_factory(code="OTHER")
    foreign_country = institution_factory(
        code="FOREIGN",
        country_code="US",
        default_currency="USD",
    )
    actor = user_factory()
    membership_factory(
        user=actor,
        institution=institution,
        role_code="HR_ADMIN",
    )
    version = active_payroll_preset_versions_for_institution(
        institution=institution,
        as_of=date(2026, 9, 30),
    ).get(version_code="GH-2026.1")
    _configure_ghana(institution, actor, version)
    employee = _employee_with_compensation(
        institution,
        employee_factory,
        employee_number="HOME001",
    )
    other_employee = _employee_with_compensation(
        other,
        employee_factory,
        employee_number="OTHER001",
    )
    _, payroll_run = _period_and_run(
        institution,
        actor,
        month=9,
        key="selector-current",
    )

    assert not active_payroll_preset_versions_for_institution(
        institution=foreign_country,
        as_of=date(2026, 9, 30),
    ).exists()
    assert list(
        eligible_employees_for_payroll_run(
            institution=institution,
            payroll_run=payroll_run,
        )
    ) == [employee]
    assert effective_contribution_rule(
        institution=institution,
        payroll_run=payroll_run,
        code="GH_MANDATORY_PENSION",
    ).preset_version_id == version.id
    assert effective_special_income_rule(
        institution=institution,
        payroll_run=payroll_run,
        income_type="BONUS",
    ).code == "GH_BONUS_TAX"
    assert set(
        effective_compliance_deadlines_for_period(
            institution=institution,
            payroll_period=payroll_run.payroll_period,
        ).values_list("code", flat=True)
    ) == {"GRA_PAYE_MONTHLY_RETURN", "PENSION_MONTHLY_REMITTANCE"}

    tenant_guarded_calls = (
        lambda: eligible_employees_for_payroll_run(
            institution=other,
            payroll_run=payroll_run,
        ),
        lambda: approved_tax_relief_claims_for_employee(
            institution=other,
            employee=employee,
            preset_version=version,
            tax_year=2026,
        ),
        lambda: finalized_employee_payroll_records_ytd(
            institution=other,
            payroll_run=payroll_run,
            employee=other_employee,
        ),
        lambda: effective_special_income_rule(
            institution=other,
            payroll_run=payroll_run,
            income_type="BONUS",
        ),
        lambda: effective_contribution_rule(
            institution=other,
            payroll_run=payroll_run,
            code="GH_MANDATORY_PENSION",
        ),
        lambda: effective_compliance_deadlines_for_period(
            institution=other,
            payroll_period=payroll_run.payroll_period,
        ),
        lambda: payroll_records_with_items(
            institution=other,
            payroll_run=payroll_run,
        ),
    )
    for call in tenant_guarded_calls:
        with pytest.raises(ValidationError, match="another institution"):
            call()


def test_payroll_selectors_return_only_approved_reliefs_and_prior_finalized_ytd(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory(code="YTD")
    actor = user_factory()
    membership_factory(
        user=actor,
        institution=institution,
        role_code="HR_ADMIN",
    )
    version = active_payroll_preset_versions_for_institution(
        institution=institution,
        as_of=date(2026, 9, 30),
    ).get(version_code="GH-2026.1")
    _configure_ghana(institution, actor, version)
    employee = _employee_with_compensation(
        institution,
        employee_factory,
        employee_number="YTD001",
    )
    _, prior_run = _period_and_run(
        institution,
        actor,
        month=8,
        key="selector-prior",
    )
    prior_record = PayrollRecord.objects.create(
        institution=institution,
        payroll_run=prior_run,
        employee=employee,
        gross_pay=Decimal("3000.00"),
        taxable_income=Decimal("2835.00"),
        total_deductions=Decimal("350.00"),
        employee_contributions=Decimal("165.00"),
        employer_contributions=Decimal("390.00"),
        net_pay=Decimal("2485.00"),
        currency="GHS",
    )
    prior_item = PayrollItem.objects.create(
        payroll_record=prior_record,
        component_code_snapshot="BONUS",
        component_name_snapshot="Bonus",
        source=PayrollItem.Source.COMPENSATION,
        amount=Decimal("250.00"),
        metadata={"effect": "EARNING", "taxable": True},
    )
    PayrollRun.objects.filter(pk=prior_run.pk).update(
        status=PayrollRun.Status.FINALIZED,
        finalized_at=timezone.now(),
    )
    _, current_run = _period_and_run(
        institution,
        actor,
        month=9,
        key="selector-current-ytd",
    )

    relief_definition = version.relief_definitions.order_by("code").first()
    evidence = Document.objects.create(
        institution=institution,
        uploaded_by=actor,
        file_reference="selector-tests/relief.pdf",
        original_filename="relief.pdf",
        content_type="application/pdf",
        size_bytes=128,
    )
    approved_claim = EmployeeTaxReliefClaim.objects.create(
        institution=institution,
        employee=employee,
        relief_definition=relief_definition,
        tax_year=2026,
        claimed_amount=Decimal("100.00"),
        approved_amount=Decimal("100.00"),
        evidence=evidence,
        status=EmployeeTaxReliefClaim.Status.APPROVED,
        approved_by=actor,
        approved_at=timezone.now(),
    )

    assert list(
        approved_tax_relief_claims_for_employee(
            institution=institution,
            employee=employee,
            preset_version=version,
            tax_year=2026,
        )
    ) == [approved_claim]
    assert list(
        finalized_employee_payroll_records_ytd(
            institution=institution,
            payroll_run=current_run,
            employee=employee,
        )
    ) == [prior_record]
    assert list(
        finalized_employee_payroll_items_ytd(
            institution=institution,
            payroll_run=current_run,
            employee=employee,
        )
    ) == [prior_item]

    records = list(
        payroll_records_with_items(
            institution=institution,
            payroll_run=prior_run,
        )
    )
    assert records == [prior_record]
    assert list(records[0].items.all()) == [prior_item]
