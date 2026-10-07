"""Attendance Adjustment Review + HR Attendance concepts."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from django.core.exceptions import ValidationError

from apps.attendance.models import AttendanceAdjustment, AttendanceRecord
from apps.attendance.services import (
    adjustment_review_context,
    clock_in,
    decide_adjustment,
    delegate_adjustment,
    request_adjustment,
    resubmit_adjustment,
    return_adjustment,
)
from apps.institutions.models import InstitutionModule
from apps.notifications.models import Notification
from apps.scheduling.services import change_current_schedule_assignment
from tests.test_scheduling_attendance import _employee_with_employment, _fixed_schedule

pytestmark = pytest.mark.django_db
ZONE = ZoneInfo("Africa/Accra")


@pytest.fixture
def flow(institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory()
    InstitutionModule.objects.filter(institution=institution, module_code=InstitutionModule.ModuleCode.ATTENDANCE).update(is_enabled=True)
    hr = user_factory(email="hr.adj@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    director = user_factory(email="director.adj@example.com")
    membership_factory(user=director, institution=institution, role_code="HR_ADMIN")
    staff = user_factory(email="staff.adj@example.com")
    membership_factory(user=staff, institution=institution, role_code="EMPLOYEE")
    employee = _employee_with_employment(
        institution, user=staff, employee_factory=employee_factory,
        organization_factory=organization_factory, assignment_dimensions_factory=assignment_dimensions_factory,
    )
    _, schedule = _fixed_schedule(institution)
    change_current_schedule_assignment(
        institution=institution, employee=employee, work_schedule=schedule,
        effective_from=date(2026, 1, 1), is_current=True, assigned_by=hr,
    )
    record = clock_in(employee=employee, actor=staff, at=datetime(2026, 9, 14, 9, 0, tzinfo=ZONE))
    adjustment = request_adjustment(
        institution=institution, attendance_record=record, actor=staff,
        reason="Network outage prevented clock-out",
        proposed_values={"check_out": "2026-09-14T17:00:00+00:00"},
    )
    return {"institution": institution, "hr": hr, "director": director, "staff": staff, "record": record, "adjustment": adjustment}


def test_type_is_derived_and_reference_is_stable(flow):
    adjustment = flow["adjustment"]
    assert adjustment.adjustment_type == AttendanceAdjustment.AdjustmentType.MISSED_CLOCK_OUT
    assert adjustment.reference.startswith("ADJ-")


def test_review_context_compares_scheduled_recorded_requested(flow):
    context = adjustment_review_context(adjustment=flow["adjustment"], user=flow["hr"])
    assert context["scheduled"]["start"] == "09:00" and context["scheduled"]["minutes"] == 420
    assert context["recorded"]["end"] is None
    assert context["requested"]["minutes"] == 420
    assert context["difference_minutes"] == 420 - context["recorded"]["minutes"]
    codes = {check["code"]: check["status"] for check in context["policy_checks"]}
    assert codes["daily_limit"] == "pass"
    assert codes["leave_overlap"] == "pass"
    assert codes["evidence"] == "fail"  # >1h added without evidence
    assert context["can_decide"] is True
    assert adjustment_review_context(adjustment=flow["adjustment"], user=flow["staff"])["can_decide"] is False


def test_request_changes_then_resubmit_then_approve_with_note(flow):
    adjustment = return_adjustment(adjustment=flow["adjustment"], actor=flow["hr"], comment="Attach the outage notice")
    assert adjustment.status == AttendanceAdjustment.Status.RETURNED
    returned_note = Notification.objects.get(user=flow["staff"], notification_type="ATTENDANCE_ADJUSTMENT_RETURNED")
    assert returned_note.metadata["route_hint"] == f"/me/attendance/adjustments/{adjustment.id}"
    with pytest.raises(ValidationError):
        resubmit_adjustment(adjustment=adjustment, actor=flow["hr"], reason="not mine")
    adjustment = resubmit_adjustment(adjustment=adjustment, actor=flow["staff"], reason="Outage, notice attached")
    assert adjustment.status == AttendanceAdjustment.Status.PENDING and adjustment.resubmitted_at
    adjustment = decide_adjustment(adjustment=adjustment, actor=flow["hr"], approve=True, comment="Verified with IT")
    assert adjustment.decision_note == "Verified with IT"
    record = AttendanceRecord.objects.get(pk=flow["record"].pk)
    assert record.check_out is not None


def test_return_requires_comment_and_employee_cannot_decide_own(flow, membership_factory):
    with pytest.raises(ValidationError):
        return_adjustment(adjustment=flow["adjustment"], actor=flow["hr"], comment=" ")
    with pytest.raises(ValidationError):
        decide_adjustment(adjustment=flow["adjustment"], actor=flow["staff"], approve=True)


def test_delegate_assigns_reviewer(flow):
    adjustment = delegate_adjustment(adjustment=flow["adjustment"], actor=flow["hr"], delegate=flow["director"])
    assert adjustment.assigned_to == flow["director"]
    assert Notification.objects.filter(user=flow["director"], notification_type="ATTENDANCE_ADJUSTMENT_ASSIGNED").exists()
    with pytest.raises(ValidationError):
        delegate_adjustment(adjustment=adjustment, actor=flow["hr"], delegate=flow["staff"])


def test_adjustment_api_actions_and_dashboard(api_client, flow):
    api_client.force_authenticate(flow["hr"])
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(flow["institution"].id))
    base = f"/api/v1/attendance-adjustments/{flow['adjustment'].id}/"
    detail = api_client.get(base)
    assert detail.status_code == 200, detail.content
    body = detail.json()["data"]
    assert body["reference"].startswith("ADJ-") and body["employee_name"] and body["adjustment_type"] == "MISSED_CLOCK_OUT"
    review = api_client.get(base + "review/")
    assert review.status_code == 200, review.content
    delegates = api_client.get(base + "delegates/")
    assert str(flow["director"].id) in {row["id"] for row in delegates.json()["data"]}
    returned = api_client.post(base + "request-changes/", {"comment": "Need evidence"}, format="json")
    assert returned.status_code == 200 and returned.json()["data"]["status"] == "RETURNED"

    dashboard = api_client.get("/api/v1/dashboards/attendance/", {"months": 3})
    assert dashboard.status_code == 200, dashboard.content
    data = dashboard.json()["data"]
    assert data["range_months"] == 3 and len(data["attendance_trend"]) == 3
    for key in ("attendance_rate", "late_arrivals", "missing_punches", "pending_adjustments", "department_rates", "priority_exceptions", "recent_adjustments"):
        assert key in data
    assert any(item["issue"] == "Missing clock-out" for item in data["priority_exceptions"]) or data["missing_punches"] == 0
