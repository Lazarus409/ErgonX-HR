"""Payroll run exceptions, validation and activity for the Payroll workspace / run detail concepts."""
from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.payroll.models import PayrollRecord, PayrollRunException
from apps.payroll.services import (
    calculate_payroll_run,
    configure_payroll,
    create_payroll_period,
    create_payroll_run,
    revalidate_payroll_run,
    submit_payroll_run_for_review,
    update_payroll_exception,
)
from tests.test_payroll import _employee_with_pay, _enable_payroll, _preset_with_generic_rules

pytestmark = pytest.mark.django_db


@pytest.fixture
def calculated(institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory()
    _enable_payroll(institution)
    hr = user_factory(email="hr.payroll.exc@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    paid = _employee_with_pay(institution, employee_factory, organization_factory, assignment_dimensions_factory, employee_number="EMP100")
    # Active with a current employment but no compensation: not in the run.
    unpaid = employee_factory(institution, employee_number="EMP200")
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    from apps.employees.models import Employment

    Employment.objects.create(
        institution=institution, employee=unpaid, department=department, position=position, grade=grade,
        location=location, employment_type=Employment.EmploymentType.PERMANENT, start_date=date(2026, 1, 1),
    )
    version, _ = _preset_with_generic_rules()
    configure_payroll(
        institution=institution, actor=hr, country_code="GH", currency="GHS", payroll_frequency="MONTHLY",
        payroll_setup_mode="PRESET", selected_payroll_preset_version=version,
    )
    period = create_payroll_period(
        institution=institution, actor=hr, name="October 2026", start_date=date(2026, 10, 1),
        end_date=date(2026, 10, 31), pay_date=date(2026, 10, 31),
    )
    run = create_payroll_run(institution=institution, payroll_period=period, actor=hr, idempotency_key="oct-2026")
    run = calculate_payroll_run(payroll_run=run, actor=hr)
    return {"institution": institution, "hr": hr, "run": run, "paid": paid, "unpaid": unpaid}


def test_calculation_detects_medium_and_low_exceptions(calculated):
    codes = {(item.code, item.employee_id): item.severity for item in calculated["run"].exceptions.all()}
    assert codes[(PayrollRunException.Code.NOT_IN_RUN, calculated["unpaid"].id)] == "MEDIUM"
    assert codes[(PayrollRunException.Code.MISSING_PAYROLL_PROFILE, calculated["paid"].id)] == "LOW"
    assert not any(severity == "HIGH" for severity in codes.values())


def test_high_severity_blocks_review_until_resolved(calculated):
    run, hr = calculated["run"], calculated["hr"]
    PayrollRecord.objects.filter(payroll_run=run).update(net_pay=Decimal("0"))
    revalidate_payroll_run(payroll_run=run, actor=hr)
    high = run.exceptions.get(code=PayrollRunException.Code.NON_POSITIVE_NET_PAY)
    assert high.status == "OPEN"
    with pytest.raises(ValidationError):
        submit_payroll_run_for_review(payroll_run=run, actor=hr)
    with pytest.raises(ValidationError):
        update_payroll_exception(exception=high, actor=hr, status="ACKNOWLEDGED", note="ok")
    with pytest.raises(ValidationError):
        update_payroll_exception(exception=high, actor=hr, status="RESOLVED", note=" ")
    update_payroll_exception(exception=high, actor=hr, status="RESOLVED", note="Unpaid leave month confirmed")
    # Zeroing net pay also leaves a reconciliation discrepancy (another HIGH item).
    assert run.exceptions.filter(code=PayrollRunException.Code.RECONCILIATION_DISCREPANCY, status="OPEN").exists()
    with pytest.raises(ValidationError):
        submit_payroll_run_for_review(payroll_run=run, actor=hr)
    for item in run.exceptions.filter(severity="HIGH", status="OPEN"):
        update_payroll_exception(exception=item, actor=hr, status="RESOLVED", note="Reviewed with finance")
    run = submit_payroll_run_for_review(payroll_run=run, actor=hr)
    assert run.status == "UNDER_REVIEW"


def test_revalidation_auto_resolves_and_keeps_manual_decisions(calculated):
    run, hr = calculated["run"], calculated["hr"]
    low = run.exceptions.get(code=PayrollRunException.Code.MISSING_PAYROLL_PROFILE)
    update_payroll_exception(exception=low, actor=hr, status="ACKNOWLEDGED", note="Profile being collected")
    PayrollRecord.objects.filter(payroll_run=run).update(net_pay=Decimal("0"))
    revalidate_payroll_run(payroll_run=run, actor=hr)
    PayrollRecord.objects.filter(payroll_run=run).update(net_pay=Decimal("100"))
    revalidate_payroll_run(payroll_run=run, actor=hr)
    auto = run.exceptions.get(code=PayrollRunException.Code.NON_POSITIVE_NET_PAY)
    assert auto.status == "RESOLVED" and auto.resolution_note.startswith("No longer detected")
    low.refresh_from_db()
    assert low.status == "ACKNOWLEDGED"


def test_run_api_exposes_reference_counts_exceptions_and_activity(api_client, calculated):
    run, hr = calculated["run"], calculated["hr"]
    api_client.force_authenticate(hr)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(calculated["institution"].id))
    base = f"/api/v1/payroll-runs/{run.id}/"
    detail = api_client.get(base).json()["data"]
    assert detail["reference"] == "PR-202610-01"
    assert detail["period_name"] == "October 2026"
    assert detail["exception_counts"]["open"] == detail["exception_counts"]["total"] >= 2

    listed = api_client.get(base + "exceptions/")
    assert listed.status_code == 200
    item = next(row for row in listed.json()["data"] if row["code"] == "NOT_IN_RUN")
    updated = api_client.post(base + f"exceptions/{item['id']}/", {"status": "ACKNOWLEDGED", "note": "Joins payroll next month"}, format="json")
    assert updated.status_code == 200, updated.content
    assert updated.json()["data"]["status"] == "ACKNOWLEDGED"

    validated = api_client.post(base + "validate/")
    assert validated.status_code == 200, validated.content
    activity = api_client.get(base + "activity/")
    assert activity.status_code == 200
    actions = [row["action"] for row in activity.json()["data"]]
    assert "payroll.exception.updated" in actions and "payroll.run.validated" in actions and "payroll.run.calculated" in actions
