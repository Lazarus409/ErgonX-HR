"""Bounded approval engine (Wave 2): definition choice, approver resolution, return, escalation."""

from datetime import date, timedelta
from decimal import Decimal
from io import StringIO
from uuid import uuid4

import pytest
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.management import call_command
from django.utils import timezone

from apps.employees.models import Employment
from apps.institutions.models import InstitutionModule
from apps.leave.models import LeaveApproval, LeavePolicy, LeaveType
from apps.leave.services import approve_leave_request, create_leave_request, submit_leave_request
from apps.notifications.models import Notification
from apps.organization.models import Department, Grade, Location, Position
from apps.workflows.engine import Trigger, resolve_chain, resolve_definition
from apps.workflows.escalation import OVERDUE_TYPE, run_escalations
from apps.workflows.models import ApprovalRequest, ApprovalWorkflowDefinition, ApprovalWorkflowStep
from apps.workflows.services import decide_approval_request, submit_approval_request
from common.exceptions import CodedValidationError

pytestmark = pytest.mark.django_db

Type = ApprovalWorkflowStep.ApproverType


@pytest.fixture
def org(institution_factory, user_factory, membership_factory, employee_factory):
    institution = institution_factory()
    grade = Grade.objects.create(institution=institution, name="Grade", code="G1", level=1)
    location = Location.objects.create(institution=institution, name="Accra", code="ACC", timezone="Africa/Accra")
    parent = Department.objects.create(institution=institution, name="Operations", code="OPS")
    child = Department.objects.create(institution=institution, name="Field", code="FLD", parent=parent)
    positions = {
        department.id: Position.objects.create(institution=institution, department=department, title=f"{department.name} officer", code=f"P-{department.code}")
        for department in (parent, child)
    }

    def person(email, role_code, department=child, reports_to=None):
        user = user_factory(email=email)
        membership_factory(user=user, institution=institution, role_code=role_code)
        employee = employee_factory(institution, user=user)
        employment = Employment.objects.create(
            institution=institution, employee=employee, department=department, position=positions[department.id],
            grade=grade, location=location, start_date=date(2026, 1, 1), reports_to=reports_to,
            employment_type=Employment.EmploymentType.PERMANENT,
        )
        return user, employee, employment

    return {"institution": institution, "parent": parent, "child": child, "person": person}


def _definition(institution, **values):
    values.setdefault("code", f"WF{uuid4().hex[:6]}")
    values.setdefault("name", "Workflow")
    return ApprovalWorkflowDefinition.objects.create(institution=institution, **values)


def _step(definition, order, **values):
    return ApprovalWorkflowStep.objects.create(
        institution=definition.institution, workflow=definition, order=order, name=f"Step {order}", **values
    )


def test_department_definition_wins_and_amount_band_applies(org):
    institution, child = org["institution"], org["child"]
    general = _definition(institution, trigger=Trigger.EXPENSE_CLAIM)
    department_specific = _definition(institution, trigger=Trigger.EXPENSE_CLAIM, department=child)
    large = _definition(institution, trigger=Trigger.EXPENSE_CLAIM, min_amount=Decimal("1000"))
    _definition(institution, trigger=Trigger.EXPENSE_CLAIM, department=child, is_active=False)

    assert resolve_definition(institution, Trigger.EXPENSE_CLAIM, department=child) == department_specific
    assert resolve_definition(institution, Trigger.EXPENSE_CLAIM) == general
    assert resolve_definition(institution, Trigger.EXPENSE_CLAIM, amount=Decimal("5000")) in (general, large)
    assert resolve_definition(institution, Trigger.BUDGET) is None


def test_amount_band_excludes_out_of_range_definitions(org):
    institution = org["institution"]
    small = _definition(institution, trigger=Trigger.VENDOR_BILL, max_amount=Decimal("999.99"))
    large = _definition(institution, trigger=Trigger.VENDOR_BILL, min_amount=Decimal("1000"))

    assert resolve_definition(institution, Trigger.VENDOR_BILL, amount=Decimal("50")) == small
    assert resolve_definition(institution, Trigger.VENDOR_BILL, amount=Decimal("1000")) == large
    with pytest.raises(ValidationError):
        bad = ApprovalWorkflowDefinition(institution=institution, code="BAD", name="Bad", trigger=Trigger.VENDOR_BILL, min_amount=Decimal("10"), max_amount=Decimal("1"))
        bad.full_clean()


def test_legacy_leave_definition_is_found_by_entity_type(org):
    legacy = _definition(org["institution"], entity_type="leave.LeaveRequest", workflow_type="LEAVE")
    assert resolve_definition(org["institution"], Trigger.LEAVE_REQUEST) == legacy


def test_step_naming_only_a_person_is_a_user_step(org):
    approver, _, _ = org["person"]("named@example.com", "HR_ADMIN")
    definition = _definition(org["institution"], trigger=Trigger.BUDGET)
    step = _step(definition, 1, approver_user=approver)
    assert step.approver_type == Type.USER


def test_read_only_roles_cannot_be_approvers(org, user_factory, membership_factory):
    institution = org["institution"]
    definition = _definition(institution, trigger=Trigger.BUDGET)
    auditor = user_factory(email="auditor@example.com")
    membership_factory(user=auditor, institution=institution, role_code="AUDITOR")

    with pytest.raises(ValidationError):
        _step(definition, 1, approver_role=institution.roles.get(code="AUDITOR"))
    with pytest.raises(ValidationError):
        _step(definition, 1, approver_type=Type.USER, approver_user=auditor)
    with pytest.raises(ValidationError):
        _step(definition, 1, approver_type=Type.ROLE)


def test_requester_is_never_their_own_approver_and_chain_fails_closed(org):
    institution = org["institution"]
    hr, _, employment = org["person"]("only-hr@example.com", "HR_ADMIN")
    definition = _definition(institution, trigger=Trigger.BUDGET)
    _step(definition, 1, approver_role=institution.roles.get(code="HR_ADMIN"))

    with pytest.raises(CodedValidationError) as error:
        resolve_chain(definition, institution=institution, requester=hr, employment=employment)
    assert error.value.api_code == "policy_not_applicable"

    other_hr, _, _ = org["person"]("second-hr@example.com", "HR_ADMIN")
    [(_, approver)] = resolve_chain(definition, institution=institution, requester=hr, employment=employment)
    assert approver == other_hr


def test_department_head_step_walks_up_when_requester_is_the_head(org):
    institution, parent, child = org["institution"], org["parent"], org["child"]
    head_user, head_employee, head_employment = org["person"]("head@example.com", "DEPARTMENT_HEAD")
    director, director_employee, _ = org["person"]("director@example.com", "DIRECTOR", department=parent)
    child.head = head_employee
    child.save()
    parent.head = director_employee
    parent.save()
    staff, staff_employee, staff_employment = org["person"]("staff@example.com", "EMPLOYEE")
    definition = _definition(institution, trigger=Trigger.LEAVE_REQUEST)
    _step(definition, 1, approver_type=Type.REQUESTER_DEPARTMENT_HEAD)

    [(_, for_staff)] = resolve_chain(definition, institution=institution, requester=staff, employment=staff_employment, employee_id=staff_employee.id)
    [(_, for_head)] = resolve_chain(definition, institution=institution, requester=head_user, employment=head_employment, employee_id=head_employee.id)

    assert for_staff == head_user
    assert for_head == director


def test_manager_step_resolves_the_line_manager(org):
    institution = org["institution"]
    manager, _, manager_employment = org["person"]("manager@example.com", "EMPLOYEE")
    staff, staff_employee, staff_employment = org["person"]("report@example.com", "EMPLOYEE", reports_to=manager_employment)
    definition = _definition(institution, trigger=Trigger.ATTENDANCE_ADJUSTMENT)
    _step(definition, 1, approver_type=Type.REQUESTER_MANAGER)

    [(_, approver)] = resolve_chain(definition, institution=institution, requester=staff, employment=staff_employment, employee_id=staff_employee.id)
    assert approver == manager
    with pytest.raises(CodedValidationError):
        resolve_chain(definition, institution=institution, requester=manager, employment=manager_employment)


def test_generic_request_notifies_steps_blocks_self_decision_and_supports_return(org):
    institution = org["institution"]
    requester, _, _ = org["person"]("requester@example.com", "HR_ADMIN")
    reviewer, _, _ = org["person"]("reviewer@example.com", "DIRECTOR")
    other_hr, _, _ = org["person"]("other-hr@example.com", "HR_ADMIN")
    definition = _definition(institution, trigger=Trigger.BUDGET, name="Budget approval")
    _step(definition, 1, approver_role=institution.roles.get(code="HR_ADMIN"))
    _step(definition, 2, approver_user=reviewer)

    request = submit_approval_request(institution=institution, workflow=definition, entity_type="finance.Budget", entity_id=uuid4(), requested_by=requester)
    with pytest.raises(PermissionDenied):
        decide_approval_request(request=request, actor=requester, action="APPROVE")

    assert Notification.objects.filter(user=other_hr, notification_type="APPROVAL_STEP_ASSIGNED").exists()
    assert not Notification.objects.filter(user=requester, notification_type="APPROVAL_STEP_ASSIGNED").exists()

    request = decide_approval_request(request=request, actor=other_hr, action="APPROVE")
    assert request.current_step.order == 2
    assert Notification.objects.filter(user=reviewer, notification_type="APPROVAL_STEP_ASSIGNED").exists()

    with pytest.raises(ValidationError):
        decide_approval_request(request=request, actor=reviewer, action="RETURN", comments="  ")
    request = decide_approval_request(request=request, actor=reviewer, action="RETURN", comments="Split the travel line")
    assert request.status == ApprovalRequest.Status.RETURNED
    assert request.current_step is None
    decided = Notification.objects.get(user=requester, notification_type="APPROVAL_DECIDED")
    assert decided.message == "Split the travel line"


def test_generic_submit_refuses_employment_based_steps(org):
    requester, _, _ = org["person"]("generic@example.com", "HR_ADMIN")
    definition = _definition(org["institution"], trigger=Trigger.JOB_REQUISITION)
    _step(definition, 1, approver_type=Type.REQUESTER_MANAGER)
    with pytest.raises(ValidationError):
        submit_approval_request(institution=org["institution"], workflow=definition, entity_type="recruitment.JobRequisition", entity_id=uuid4(), requested_by=requester)


def test_overdue_generic_request_escalates_once(org):
    institution = org["institution"]
    requester, _, _ = org["person"]("late-requester@example.com", "EMPLOYEE")
    approver, _, _ = org["person"]("late-approver@example.com", "HR_ADMIN")
    director, _, _ = org["person"]("late-director@example.com", "DIRECTOR")
    definition = _definition(institution, trigger=Trigger.BUDGET, escalation_role=institution.roles.get(code="DIRECTOR"))
    _step(definition, 1, approver_role=institution.roles.get(code="HR_ADMIN"), due_after_hours=24)
    request = submit_approval_request(institution=institution, workflow=definition, entity_type="finance.Budget", entity_id=uuid4(), requested_by=requester)

    assert run_escalations(now=timezone.now())["generic"] == 0
    later = timezone.now() + timedelta(hours=25)
    assert run_escalations(now=later)["generic"] == 1
    assert run_escalations(now=later)["generic"] == 0

    notified = set(Notification.objects.filter(notification_type=OVERDUE_TYPE).values_list("user_id", flat=True))
    assert notified == {approver.id, director.id}
    request.refresh_from_db()
    assert request.status == ApprovalRequest.Status.PENDING


def _leave_setup(institution):
    InstitutionModule.objects.filter(institution=institution, module_code=InstitutionModule.ModuleCode.LEAVE).update(is_enabled=True)
    leave_type = LeaveType.objects.create(institution=institution, name="Annual Leave", code="engine-annual")
    LeavePolicy.objects.create(institution=institution, leave_type=leave_type, name="Annual", annual_entitlement=Decimal("20"), effective_from=date(2026, 1, 1))
    return leave_type


def _submit_leave(institution, user, employee, leave_type):
    request = create_leave_request(
        institution=institution, actor=user, employee=employee, leave_type=leave_type,
        start_date=date(2026, 11, 2), end_date=date(2026, 11, 3), requested_days=Decimal("2"),
    )
    return submit_leave_request(leave_request=request, actor=user)


def test_leave_uses_department_specific_workflow(org):
    institution, child = org["institution"], org["child"]
    general_approver, _, _ = org["person"]("general@example.com", "HR_ADMIN")
    field_approver, _, _ = org["person"]("field@example.com", "DIRECTOR")
    staff, staff_employee, _ = org["person"]("leave-staff@example.com", "EMPLOYEE")
    _step(_definition(institution, trigger=Trigger.LEAVE_REQUEST), 1, approver_user=general_approver)
    _step(_definition(institution, trigger=Trigger.LEAVE_REQUEST, department=child), 1, approver_user=field_approver)

    leave = _submit_leave(institution, staff, staff_employee, _leave_setup(institution))

    assert list(leave.approvals.values_list("approver", flat=True)) == [field_approver.id]


def test_leave_second_step_is_not_overdue_before_its_turn(org):
    institution = org["institution"]
    first, _, _ = org["person"]("first@example.com", "HR_ADMIN")
    second, _, _ = org["person"]("second@example.com", "DIRECTOR")
    staff, staff_employee, _ = org["person"]("waiting@example.com", "EMPLOYEE")
    definition = _definition(institution, trigger=Trigger.LEAVE_REQUEST)
    _step(definition, 1, approver_user=first, due_after_hours=48)
    _step(definition, 2, approver_user=second, due_after_hours=24)
    leave = _submit_leave(institution, staff, staff_employee, _leave_setup(institution))

    # 30 hours on: step 1 is inside its 48 hours and step 2 has not started.
    assert run_escalations(now=timezone.now() + timedelta(hours=30))["leave"] == 0

    approve_leave_request(leave_request=leave, actor=first)
    step_two = LeaveApproval.objects.get(leave_request=leave, sequence=2)
    assert run_escalations(now=timezone.now() + timedelta(hours=1))["leave"] == 0
    assert run_escalations(now=timezone.now() + timedelta(hours=25))["leave"] == 1
    assert Notification.objects.get(notification_type=OVERDUE_TYPE).metadata["leave_approval_id"] == str(step_two.id)


def test_reminder_command_reports_counts():
    out = StringIO()
    call_command("send_approval_reminders", stdout=out)
    assert "Escalated 0 approval request step(s) and 0 leave approval step(s)." in out.getvalue()
