from datetime import date, datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.urls import reverse

from apps.attendance.models import AttendanceRecord, OvertimeRecord
from apps.attendance.services import (
    classify_attendance_date,
    clock_in,
    clock_out,
    decide_adjustment,
    decide_overtime,
    request_adjustment,
)
from apps.employees.models import Employment
from apps.institutions.models import InstitutionModule, UserActivityEvent
from apps.leave.models import LeaveRequest, LeaveType
from apps.scheduling.models import (
    FlexibleWorkRule,
    RotationPattern,
    RotationStep,
    ScheduleAssignment,
    Shift,
    ShiftPattern,
    ShiftPatternDay,
    WorkSchedule,
)
from apps.scheduling.services import (
    change_current_schedule_assignment,
    schedule_expectation,
)


pytestmark = pytest.mark.django_db


def _employee_with_employment(
    institution,
    *,
    user,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    employee = employee_factory(institution, user=user)
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    Employment.objects.create(
        institution=institution,
        employee=employee,
        department=department,
        position=position,
        grade=grade,
        location=location,
        employment_type=Employment.EmploymentType.PERMANENT,
        start_date=date(2026, 1, 1),
    )
    return employee


def _fixed_schedule(institution, *, code="DAY", start=time(9), end=time(17)):
    shift = Shift.objects.create(
        institution=institution,
        name=f"{code} Shift",
        code=code,
        start_time=start,
        end_time=end,
        break_minutes=60,
        grace_period_minutes=10,
    )
    schedule = WorkSchedule.objects.create(
        institution=institution,
        name=f"{code} Schedule",
        code=code,
        schedule_type=WorkSchedule.ScheduleType.FIXED,
        effective_from=date(2026, 1, 1),
        timezone="Africa/Accra",
        fixed_shift=shift,
    )
    return shift, schedule


def test_scheduling_and_attendance_share_attendance_module_gate(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory()
    user = user_factory()
    membership_factory(
        user=user, institution=institution, role_code="HR_ADMIN", is_primary=True
    )
    api_client.force_authenticate(user=user)

    disabled_schedule = api_client.get(reverse("v1:shift-list"))
    disabled_attendance = api_client.get(reverse("v1:attendance-record-list"))
    InstitutionModule.objects.filter(
        institution=institution,
        module_code=InstitutionModule.ModuleCode.ATTENDANCE,
    ).update(is_enabled=True)
    enabled_schedule = api_client.get(reverse("v1:shift-list"))
    enabled_attendance = api_client.get(reverse("v1:attendance-record-list"))

    assert disabled_schedule.status_code == 403
    assert disabled_attendance.status_code == 403
    assert enabled_schedule.status_code == 200
    assert enabled_attendance.status_code == 200


def test_attendance_calendar_exposes_date_ranged_records(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    InstitutionModule.objects.filter(
        institution=institution,
        module_code=InstitutionModule.ModuleCode.ATTENDANCE,
    ).update(is_enabled=True)
    employee = employee_factory(institution)
    for attendance_date in (date(2026, 9, 14), date(2026, 9, 15)):
        AttendanceRecord.objects.create(
            institution=institution,
            employee=employee,
            attendance_date=attendance_date,
            status=AttendanceRecord.Status.ABSENT,
            source=AttendanceRecord.Source.API,
        )
    api_client.force_authenticate(user=hr)

    response = api_client.get(
        reverse("v1:attendance-record-calendar"),
        {"date_from": "2026-09-15", "date_to": "2026-09-15"},
    )

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["attendance_date"] == "2026-09-15"


def test_schedule_assignment_change_preserves_history(
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
    employee = _employee_with_employment(
        institution,
        user=None,
        employee_factory=employee_factory,
        organization_factory=organization_factory,
        assignment_dimensions_factory=assignment_dimensions_factory,
    )
    _, first_schedule = _fixed_schedule(institution, code="FIRST")
    _, second_schedule = _fixed_schedule(
        institution, code="SECOND", start=time(8), end=time(16)
    )
    first = change_current_schedule_assignment(
        institution=institution,
        employee=employee,
        work_schedule=first_schedule,
        effective_from=date(2026, 1, 1),
        is_current=True,
        assigned_by=hr,
    )
    second = change_current_schedule_assignment(
        institution=institution,
        employee=employee,
        work_schedule=second_schedule,
        effective_from=date(2026, 9, 1),
        is_current=True,
        assigned_by=hr,
    )
    first.refresh_from_db()

    assert ScheduleAssignment.objects.filter(employee=employee).count() == 2
    assert first.is_current is False
    assert first.effective_to == date(2026, 8, 31)
    assert second.is_current is True


def test_shift_pattern_resolves_working_and_off_days(institution_factory):
    institution = institution_factory()
    shift, _ = _fixed_schedule(institution)
    pattern = ShiftPattern.objects.create(
        institution=institution,
        name="Two day pattern",
        code="TWO_DAY",
        cycle_length_days=2,
    )
    ShiftPatternDay.objects.create(
        institution=institution,
        shift_pattern=pattern,
        day_index=0,
        shift=shift,
        is_off_day=False,
    )
    ShiftPatternDay.objects.create(
        institution=institution,
        shift_pattern=pattern,
        day_index=1,
        is_off_day=True,
    )
    schedule = WorkSchedule.objects.create(
        institution=institution,
        name="Pattern Schedule",
        code="PATTERN",
        schedule_type=WorkSchedule.ScheduleType.SHIFT_PATTERN,
        effective_from=date(2026, 9, 1),
        shift_pattern=pattern,
    )
    assignment = ScheduleAssignment(
        institution=institution,
        work_schedule=schedule,
        effective_from=date(2026, 9, 1),
    )

    assert schedule_expectation(assignment, date(2026, 9, 1))["off_day"] is False
    assert schedule_expectation(assignment, date(2026, 9, 2))["off_day"] is True


def test_rotating_overnight_and_flexible_schedules_resolve(institution_factory):
    institution = institution_factory()
    night = Shift.objects.create(
        institution=institution,
        name="Night",
        code="NIGHT",
        start_time=time(22),
        end_time=time(6),
        crosses_midnight=True,
        break_minutes=60,
    )
    rotation = RotationPattern.objects.create(
        institution=institution, name="Night rotation", code="NIGHT_ROTATION"
    )
    RotationStep.objects.create(
        institution=institution,
        rotation_pattern=rotation,
        sequence=1,
        shift=night,
        duration_days=2,
    )
    rotating = WorkSchedule.objects.create(
        institution=institution,
        name="Rotating",
        code="ROTATING",
        schedule_type=WorkSchedule.ScheduleType.ROTATING,
        effective_from=date(2026, 9, 1),
        rotation_pattern=rotation,
    )
    rotating_assignment = ScheduleAssignment(
        institution=institution,
        work_schedule=rotating,
        effective_from=date(2026, 9, 1),
    )
    expected = schedule_expectation(rotating_assignment, date(2026, 9, 1))

    assert expected["end"].date() == date(2026, 9, 2)
    assert expected["required_minutes"] == 420

    rule = FlexibleWorkRule.objects.create(
        institution=institution,
        name="Flexible day",
        earliest_start=time(7),
        latest_start=time(9),
        earliest_end=time(15),
        latest_end=time(18),
        required_minutes=480,
    )
    flexible = WorkSchedule.objects.create(
        institution=institution,
        name="Flexible",
        code="FLEXIBLE",
        schedule_type=WorkSchedule.ScheduleType.FLEXIBLE,
        effective_from=date(2026, 9, 1),
        flexible_rule=rule,
    )
    flexible_assignment = ScheduleAssignment(
        institution=institution,
        work_schedule=flexible,
        effective_from=date(2026, 9, 1),
    )

    assert schedule_expectation(flexible_assignment, date(2026, 9, 1))[
        "required_minutes"
    ] == 480


def test_cross_tenant_schedule_configuration_is_rejected(
    institution_factory, employee_factory, user_factory, membership_factory
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    hr = user_factory()
    membership_factory(user=hr, institution=institution_a, role_code="HR_ADMIN")
    employee = employee_factory(institution_a)
    _, foreign_schedule = _fixed_schedule(institution_b)

    with pytest.raises(ValidationError):
        ScheduleAssignment.objects.create(
            institution=institution_a,
            employee=employee,
            work_schedule=foreign_schedule,
            effective_from=date(2026, 9, 1),
            assigned_by=hr,
        )


def test_schedule_aware_attendance_and_approval_flow(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    hr = user_factory(email="hr-attendance@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee_user = user_factory(email="clock@example.com")
    membership_factory(
        user=employee_user, institution=institution, role_code="EMPLOYEE"
    )
    employee = _employee_with_employment(
        institution,
        user=employee_user,
        employee_factory=employee_factory,
        organization_factory=organization_factory,
        assignment_dimensions_factory=assignment_dimensions_factory,
    )
    _, schedule = _fixed_schedule(institution)
    change_current_schedule_assignment(
        institution=institution,
        employee=employee,
        work_schedule=schedule,
        effective_from=date(2026, 1, 1),
        is_current=True,
        assigned_by=hr,
    )
    zone = ZoneInfo("Africa/Accra")

    record = clock_in(
        employee=employee,
        actor=employee_user,
        at=datetime(2026, 9, 14, 9, 15, tzinfo=zone),
        source=AttendanceRecord.Source.PWA,
    )
    record = clock_out(
        attendance_record=record,
        actor=employee_user,
        at=datetime(2026, 9, 14, 18, 0, tzinfo=zone),
    )

    assert record.status == AttendanceRecord.Status.LATE
    assert record.late_minutes == 5
    assert record.worked_minutes == 465
    assert record.overtime_minutes == 45

    overtime = OvertimeRecord.objects.get(attendance_record=record)
    overtime = decide_overtime(
        overtime_record=overtime,
        actor=hr,
        approve=True,
        approved_minutes=30,
    )
    assert overtime.status == OvertimeRecord.Status.APPROVED
    assert overtime.approved_minutes == 30

    adjustment = request_adjustment(
        institution=institution,
        attendance_record=record,
        actor=employee_user,
        reason="Clock-in correction",
        proposed_values={"check_in": "2026-09-14T09:00:00+00:00"},
    )
    assert UserActivityEvent.objects.filter(
        institution=institution,
        user=employee_user,
        activity_code="attendance.adjust",
        entity_id=adjustment.id,
    ).count() == 1
    adjustment = decide_adjustment(
        adjustment=adjustment, actor=hr, approve=True
    )
    record.refresh_from_db()

    assert adjustment.status == adjustment.Status.APPROVED
    assert record.late_minutes == 0
    assert record.worked_minutes == 480
    overtime.refresh_from_db()
    assert overtime.calculated_minutes == 60
    assert overtime.approved_minutes == 0
    assert overtime.status == OvertimeRecord.Status.PENDING


def test_approved_leave_blocks_clock_in(
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
    employee_user = user_factory()
    membership_factory(
        user=employee_user, institution=institution, role_code="EMPLOYEE"
    )
    employee = _employee_with_employment(
        institution,
        user=employee_user,
        employee_factory=employee_factory,
        organization_factory=organization_factory,
        assignment_dimensions_factory=assignment_dimensions_factory,
    )
    _, schedule = _fixed_schedule(institution)
    change_current_schedule_assignment(
        institution=institution,
        employee=employee,
        work_schedule=schedule,
        effective_from=date(2026, 1, 1),
        assigned_by=hr,
    )
    leave_type = LeaveType.objects.create(
        institution=institution, name="Annual", code="TEST-ANNUAL"
    )
    LeaveRequest.objects.create(
        institution=institution,
        employee=employee,
        leave_type=leave_type,
        start_date=date(2026, 9, 14),
        end_date=date(2026, 9, 14),
        requested_days=Decimal("1"),
        status=LeaveRequest.Status.APPROVED,
    )

    classified = classify_attendance_date(
        employee=employee,
        attendance_date=date(2026, 9, 14),
        actor=hr,
    )
    assert classified.status == AttendanceRecord.Status.ON_LEAVE

    with pytest.raises(ValidationError, match="approved leave"):
        clock_in(
            employee=employee,
            actor=employee_user,
            at=datetime(2026, 9, 14, 9, 0, tzinfo=ZoneInfo("Africa/Accra")),
        )


@pytest.mark.postgresql
def test_postgresql_schedule_and_attendance_partial_constraints(
    institution_factory, employee_factory, user_factory, membership_factory
):
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL-specific verification runs in the PostgreSQL CI job")
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee = employee_factory(institution)
    _, schedule = _fixed_schedule(institution)
    assignment = ScheduleAssignment.objects.create(
        institution=institution,
        employee=employee,
        work_schedule=schedule,
        effective_from=date(2026, 1, 1),
        assigned_by=hr,
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        ScheduleAssignment.objects.create(
            institution=institution,
            employee=employee,
            work_schedule=schedule,
            effective_from=date(2026, 2, 1),
            assigned_by=hr,
        )

    AttendanceRecord.objects.create(
        institution=institution,
        employee=employee,
        schedule_assignment=assignment,
        attendance_date=date(2026, 9, 14),
        status=AttendanceRecord.Status.PRESENT,
        source=AttendanceRecord.Source.MANUAL,
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        AttendanceRecord.objects.create(
            institution=institution,
            employee=employee,
            schedule_assignment=assignment,
            attendance_date=date(2026, 9, 14),
            status=AttendanceRecord.Status.PRESENT,
            source=AttendanceRecord.Source.MANUAL,
        )
