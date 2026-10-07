"""Leave Request Review concept: request changes, delegate, comments, review context, dashboard KPIs."""
from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.audit.models import AuditLog
from apps.leave.models import LeaveApproval, LeaveRequest
from apps.leave.services import (
    add_leave_comment,
    approve_leave_request,
    create_leave_request,
    delegate_leave_approval,
    request_leave_changes,
    submit_leave_request,
    update_leave_request,
)
from apps.notifications.models import Notification
from tests.test_leave import _employee_with_employment, _enable_leave, _leave_configuration

pytestmark = pytest.mark.django_db


@pytest.fixture
def flow(institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory()
    _enable_leave(institution)
    hr = user_factory(email="hr.review@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    director = user_factory(email="director.review@example.com")
    membership_factory(user=director, institution=institution, role_code="DIRECTOR")
    staff = user_factory(email="staff.review@example.com")
    membership_factory(user=staff, institution=institution, role_code="EMPLOYEE")
    employee, _ = _employee_with_employment(
        institution, user=staff, employee_factory=employee_factory,
        organization_factory=organization_factory, assignment_dimensions_factory=assignment_dimensions_factory,
    )
    leave_type, policy = _leave_configuration(institution)
    request = create_leave_request(
        institution=institution, actor=staff, employee=employee, leave_type=leave_type,
        start_date=date(2026, 11, 2), end_date=date(2026, 11, 4), requested_days=Decimal("3"), reason="Trip",
    )
    request = submit_leave_request(leave_request=request, actor=staff)
    return {"institution": institution, "hr": hr, "director": director, "staff": staff, "employee": employee, "request": request, "policy": policy}


def _api(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return api_client


def test_request_changes_returns_draft_and_resubmission_keeps_history(flow):
    request = request_leave_changes(leave_request=flow["request"], actor=flow["hr"], comment="Please shorten to 2 days")
    assert request.status == LeaveRequest.Status.DRAFT
    assert request.changes_requested_note == "Please shorten to 2 days"
    assert request.approvals.get(sequence=1).status == LeaveApproval.Status.RETURNED
    assert Notification.objects.filter(user=flow["staff"], notification_type="LEAVE_CHANGES_REQUESTED").exists()

    request = update_leave_request(leave_request=request, actor=flow["staff"], end_date=date(2026, 11, 3), requested_days=Decimal("2"))
    request = submit_leave_request(leave_request=request, actor=flow["staff"])
    assert request.status == LeaveRequest.Status.PENDING
    sequences = list(request.approvals.order_by("sequence").values_list("sequence", "status"))
    assert sequences[0] == (1, LeaveApproval.Status.RETURNED)
    assert sequences[-1][1] == LeaveApproval.Status.PENDING and sequences[-1][0] > 1


def test_request_changes_needs_reason_and_current_approver(flow):
    with pytest.raises(ValidationError):
        request_leave_changes(leave_request=flow["request"], actor=flow["hr"], comment="  ")
    with pytest.raises(ValidationError):
        request_leave_changes(leave_request=flow["request"], actor=flow["director"], comment="Not mine")


def test_only_drafts_are_editable_by_requester(flow):
    with pytest.raises(ValidationError):
        update_leave_request(leave_request=flow["request"], actor=flow["staff"], reason="changed")


def test_delegate_moves_step_and_new_approver_can_decide(flow):
    request = delegate_leave_approval(leave_request=flow["request"], actor=flow["hr"], delegate=flow["director"], comment="On leave myself")
    step = request.approvals.get(status=LeaveApproval.Status.PENDING)
    assert step.approver == flow["director"]
    assert step.delegated_from == flow["hr"]
    assert request.comments.filter(body__startswith="Delegated:").exists()
    assert AuditLog.objects.filter(entity_id=request.id, action="leave.request.delegated").exists()
    with pytest.raises(ValidationError):
        approve_leave_request(leave_request=request, actor=flow["hr"])
    request = approve_leave_request(leave_request=request, actor=flow["director"])
    assert request.status == LeaveRequest.Status.APPROVED


def test_delegate_rejects_requester_and_non_approvers(flow, user_factory, membership_factory):
    with pytest.raises(ValidationError):
        delegate_leave_approval(leave_request=flow["request"], actor=flow["hr"], delegate=flow["staff"])
    outsider = user_factory(email="plain.review@example.com")
    membership_factory(user=outsider, institution=flow["institution"], role_code="EMPLOYEE")
    with pytest.raises(ValidationError):
        delegate_leave_approval(leave_request=flow["request"], actor=flow["hr"], delegate=outsider)


def test_comments_api_and_review_context(api_client, flow):
    client = _api(api_client, flow["hr"], flow["institution"])
    url = f"/api/v1/leave-requests/{flow['request'].id}/"
    posted = client.post(url + "comments/", {"body": "Cover arranged?"}, format="json")
    assert posted.status_code == 201, posted.content
    listed = client.get(url + "comments/")
    assert listed.status_code == 200
    assert [row["body"] for row in listed.json()["data"]] == ["Cover arranged?"]

    review = client.get(url + "review/")
    assert review.status_code == 200, review.content
    body = review.json()["data"]
    assert body["reference"].startswith("LR-")
    assert body["can_decide"] is True
    assert body["is_requester"] is False
    codes = {check["code"]: check["status"] for check in body["policy_checks"]}
    assert codes["policy"] == "pass"
    assert codes["balance"] == "pass"
    assert "team_overlap" in codes
    assert body["queue"]["total"] == 1

    delegates = client.get(url + "delegates/")
    assert delegates.status_code == 200
    ids = {row["id"] for row in delegates.json()["data"]}
    assert str(flow["director"].id) in ids and str(flow["staff"].id) not in ids

    returned = client.post(url + "request-changes/", {"comment": "Add cover details"}, format="json")
    assert returned.status_code == 200, returned.content
    assert returned.json()["data"]["status"] == "DRAFT"


def test_staff_can_patch_own_draft_but_not_pending(api_client, flow):
    client = _api(api_client, flow["staff"], flow["institution"])
    url = f"/api/v1/leave-requests/{flow['request'].id}/"
    assert client.patch(url, {"reason": "Updated"}, format="json").status_code == 400
    request_leave_changes(leave_request=flow["request"], actor=flow["hr"], comment="Shorter please")
    ok = client.patch(url, {"end_date": "2026-11-03", "requested_days": "2"}, format="json")
    assert ok.status_code == 200, ok.content
    assert ok.json()["data"]["requested_days"] in ("2.00", "2")


def test_leave_dashboard_range_kpis_and_compliance(api_client, flow):
    approve_leave_request(leave_request=flow["request"], actor=flow["hr"])
    client = _api(api_client, flow["hr"], flow["institution"])
    response = client.get("/api/v1/dashboards/leave/", {"months": 12})
    assert response.status_code == 200, response.content
    body = response.json()["data"]
    assert body["range_months"] == 12
    assert len(body["monthly_approved_leave"]) == 12
    for key in ("total_requests", "approved_requests", "average_absence_rate", "compliance"):
        assert key in body
    assert set(body["compliance"]) == {"policy_breaches", "incomplete_leave_records", "upcoming_long_absences"}
