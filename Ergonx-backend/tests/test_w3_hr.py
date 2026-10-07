"""Wave 3: permission-based landing, employee audit, leave checks that cannot run, finalized-pay guard."""

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from apps.attendance.models import AttendanceAdjustment
from apps.attendance.services import clock_in, decide_adjustment, request_adjustment
from apps.audit.models import AuditLog
from apps.employees.models import Employee
from apps.institutions.models import InstitutionModule
from apps.institutions.services import default_landing, sync_system_role_permissions
from apps.leave.models import LeaveRequest, LeaveType
from apps.leave.services import leave_review_context
from apps.payroll.models import PayrollPeriod, PayrollRun
from apps.scheduling.services import change_current_schedule_assignment
from common.exceptions import CodedValidationError
from tests.test_scheduling_attendance import _employee_with_employment, _fixed_schedule

pytestmark = pytest.mark.django_db
ZONE = ZoneInfo("Africa/Accra")


def _bootstrap(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return api_client.get("/api/v1/auth/bootstrap/").json()["data"]


@pytest.mark.parametrize(
    ("role_code", "landing"),
    [("INSTITUTION_ADMIN", "EXECUTIVE"), ("HR_ADMIN", "INSIGHTS"), ("AUDITOR", "INSIGHTS"), ("EMPLOYEE", "ME")],
)
def test_landing_follows_effective_permissions(api_client, institution_factory, user_factory, membership_factory, role_code, landing):
    institution = institution_factory()
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code=role_code, is_primary=True)
    assert _bootstrap(api_client, user, institution)["default_landing"] == landing


def test_auditor_loses_the_executive_dashboard_on_role_sync(institution_factory):
    institution = institution_factory()
    auditor = institution.roles.get(code="AUDITOR")
    from apps.institutions.models import Permission

    auditor.permissions.add(Permission.objects.get(code="dashboard.executive.view"))
    sync_system_role_permissions()
    assert not auditor.permissions.filter(code="dashboard.executive.view").exists()


def test_landing_helper_rules():
    assert default_landing(["dashboard.executive.view", "home.view"]) == "EXECUTIVE"
    assert default_landing(["home.view", "leave.request"]) == "ME"
    assert default_landing(["home.view", "employee.view"]) == "INSIGHTS"


def test_employee_changes_are_audited_with_personal_details_masked(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)
    api_client.force_authenticate(hr)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))

    created = api_client.post("/api/v1/employees/", {
        "employee_number": "EMP-AUD", "first_name": "Abena", "last_name": "Boateng",
        "hire_date": "2026-01-05", "phone": "+233200000001",
    }, format="json")
    assert created.status_code == 201, created.content
    employee_id = created.json()["data"]["id"]
    event = AuditLog.objects.get(action="employee.created", entity_id=employee_id)
    assert event.metadata["changes"]["first_name"] == [None, "Abena"]
    assert event.metadata["changes"]["phone"] == ["[changed]", "[changed]"]

    updated = api_client.patch(f"/api/v1/employees/{employee_id}/", {"last_name": "Mensah", "phone": "+233200000002"}, format="json")
    assert updated.status_code == 200, updated.content
    change = AuditLog.objects.get(action="employee.updated", entity_id=employee_id).metadata["changes"]
    assert change["last_name"] == ["Boateng", "Mensah"]
    assert change["phone"] == ["[changed]", "[changed]"]
    assert "+233200000002" not in str(change)

    assert api_client.delete(f"/api/v1/employees/{employee_id}/").status_code == 204
    assert Employee.objects.get(pk=employee_id).status == Employee.Status.INACTIVE
    assert AuditLog.objects.get(action="employee.deactivated", entity_id=employee_id).metadata["changes"]["status"][1] == "INACTIVE"


def test_leave_checks_that_cannot_run_are_not_evaluated(institution_factory, user_factory, membership_factory, employee_factory):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee = employee_factory(institution)
    leave_type = LeaveType.objects.create(institution=institution, name="Sabbatical (no policy)", code="w3-no-policy")
    request = LeaveRequest.objects.create(
        institution=institution, employee=employee, leave_type=leave_type,
        start_date=date(2026, 11, 2), end_date=date(2026, 11, 3), requested_days=Decimal("2"),
        status=LeaveRequest.Status.PENDING,
    )

    checks = {check["code"]: check["status"] for check in leave_review_context(leave_request=request, user=hr)["policy_checks"]}

    assert checks["policy"] == "fail"
    assert checks["balance"] == "not_evaluated"
    assert checks["team_overlap"] == "not_evaluated"


@pytest.fixture
def attendance(institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory()
    InstitutionModule.objects.filter(institution=institution, module_code=InstitutionModule.ModuleCode.ATTENDANCE).update(is_enabled=True)
    hr = user_factory(email="hr.pay@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    staff = user_factory(email="staff.pay@example.com")
    membership_factory(user=staff, institution=institution, role_code="EMPLOYEE")
    employee = _employee_with_employment(institution, user=staff, employee_factory=employee_factory, organization_factory=organization_factory, assignment_dimensions_factory=assignment_dimensions_factory)
    _, schedule = _fixed_schedule(institution)
    change_current_schedule_assignment(institution=institution, employee=employee, work_schedule=schedule, effective_from=date(2026, 1, 1), is_current=True, assigned_by=hr)
    record = clock_in(employee=employee, actor=staff, at=datetime(2026, 9, 14, 9, 0, tzinfo=ZONE))
    adjustment = request_adjustment(institution=institution, attendance_record=record, actor=staff, reason="Missed clock-out", proposed_values={"check_out": "2026-09-14T17:00:00+00:00"})
    return {"institution": institution, "hr": hr, "adjustment": adjustment}


def _finalize_september(institution, user):
    period = PayrollPeriod.objects.create(institution=institution, name="Sep 2026", start_date=date(2026, 9, 1), end_date=date(2026, 9, 30), pay_date=date(2026, 9, 30))
    now = timezone.now()
    PayrollRun.objects.create(
        institution=institution, payroll_period=period, run_number=1, status=PayrollRun.Status.FINALIZED,
        started_by=user, started_at=now, approved_by=user, approved_at=now, finalized_by=user, finalized_at=now,
    )


def test_adjustment_inside_finalized_payroll_is_refused(attendance):
    _finalize_september(attendance["institution"], attendance["hr"])
    with pytest.raises(CodedValidationError) as error:
        decide_adjustment(adjustment=attendance["adjustment"], actor=attendance["hr"], approve=True)
    assert error.value.api_code == "payroll_finalized"
    attendance["adjustment"].refresh_from_db()
    assert attendance["adjustment"].status == AttendanceAdjustment.Status.PENDING


def test_adjustment_can_still_be_rejected_after_payroll_is_finalized(attendance):
    _finalize_september(attendance["institution"], attendance["hr"])
    decided = decide_adjustment(adjustment=attendance["adjustment"], actor=attendance["hr"], approve=False, comment="Paid as recorded")
    assert decided.status == AttendanceAdjustment.Status.REJECTED


def test_adjustment_outside_finalized_payroll_is_approved(attendance):
    assert decide_adjustment(adjustment=attendance["adjustment"], actor=attendance["hr"], approve=True).status == AttendanceAdjustment.Status.APPROVED


def test_my_employee_record_includes_a_current_employment_summary(api_client, institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory):
    from tests.test_scheduling_attendance import _employee_with_employment

    institution = institution_factory()
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="EMPLOYEE", is_primary=True)
    _employee_with_employment(institution, user=user, employee_factory=employee_factory, organization_factory=organization_factory, assignment_dimensions_factory=assignment_dimensions_factory)
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    summary = api_client.get("/api/v1/employees/me/").json()["data"]["current_employment"]
    assert summary["department"] and summary["position"] and summary["employment_type"]
