from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.audit.services import record_audit_event
from apps.scheduling.models import ScheduleAssignment, ShiftPatternDay, WorkSchedule


@transaction.atomic
def create_schedule_assignment(**values):
    assignment = ScheduleAssignment(**values)
    assignment.save()
    record_audit_event(
        actor=assignment.assigned_by,
        institution=assignment.institution,
        entity=assignment,
        action="schedule.assignment.created",
    )
    return assignment


@transaction.atomic
def change_current_schedule_assignment(**values):
    employee = values["employee"]
    institution = values["institution"]
    effective_from = values["effective_from"]
    if employee.institution_id != institution.id:
        raise ValidationError(
            {"employee": "Employee must belong to the selected institution."}
        )
    current = (
        ScheduleAssignment.objects.select_for_update()
        .filter(employee=employee, is_current=True)
        .first()
    )
    if current:
        if effective_from <= current.effective_from:
            raise ValidationError(
                {"effective_from": "A replacement schedule must start after the current one."}
            )
        current.is_current = False
        current.effective_to = effective_from - timedelta(days=1)
        current.save(update_fields=("is_current", "effective_to", "updated_at"))
    assignment = ScheduleAssignment(**values)
    assignment.save()
    record_audit_event(
        actor=assignment.assigned_by,
        institution=assignment.institution,
        entity=assignment,
        action="schedule.assignment.changed",
        metadata={"replaced_assignment_id": str(current.id) if current else None},
    )
    return assignment


def schedule_assignment_for(employee, attendance_date):
    return (
        ScheduleAssignment.objects.filter(
            employee=employee,
            effective_from__lte=attendance_date,
        )
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=attendance_date))
        .select_related(
            "work_schedule__fixed_shift",
            "work_schedule__shift_pattern",
            "work_schedule__rotation_pattern",
            "work_schedule__flexible_rule",
        )
        .order_by("-effective_from")
        .first()
    )


def _pattern_shift(pattern, day_offset):
    day_index = day_offset % pattern.cycle_length_days
    pattern_day = (
        ShiftPatternDay.objects.filter(shift_pattern=pattern, day_index=day_index)
        .select_related("shift")
        .first()
    )
    if pattern_day is None or pattern_day.is_off_day:
        return None, True
    return pattern_day.shift, False


def _rotation_shift(rotation, day_offset):
    steps = list(
        rotation.steps.select_related("shift", "shift_pattern").order_by("sequence")
    )
    cycle_length = sum(step.duration_days for step in steps)
    if cycle_length <= 0:
        raise ValidationError({"rotation_pattern": "Rotation has no configured steps."})
    cycle_day = day_offset % cycle_length
    elapsed = 0
    for step in steps:
        if cycle_day < elapsed + step.duration_days:
            if step.shift_id:
                return step.shift, False
            return _pattern_shift(step.shift_pattern, cycle_day - elapsed)
        elapsed += step.duration_days
    raise ValidationError({"rotation_pattern": "Rotation could not resolve the date."})


def schedule_expectation(assignment, attendance_date):
    schedule = assignment.work_schedule
    if attendance_date < schedule.effective_from or (
        schedule.effective_to and attendance_date > schedule.effective_to
    ):
        raise ValidationError({"work_schedule": "Schedule is not effective on this date."})
    day_offset = (attendance_date - assignment.effective_from).days
    shift = None
    off_day = False
    flexible_rule = None

    if schedule.schedule_type == WorkSchedule.ScheduleType.FIXED:
        shift = schedule.fixed_shift
    elif schedule.schedule_type == WorkSchedule.ScheduleType.SHIFT_PATTERN:
        shift, off_day = _pattern_shift(schedule.shift_pattern, day_offset)
    elif schedule.schedule_type == WorkSchedule.ScheduleType.ROTATING:
        shift, off_day = _rotation_shift(schedule.rotation_pattern, day_offset)
    else:
        flexible_rule = schedule.flexible_rule

    try:
        zone = ZoneInfo(schedule.timezone)
    except ZoneInfoNotFoundError as exc:
        raise ValidationError({"timezone": "Unknown schedule timezone."}) from exc

    if off_day:
        return {
            "off_day": True,
            "zone": zone,
            "start": None,
            "end": None,
            "break_minutes": 0,
            "grace_minutes": 0,
            "required_minutes": 0,
            "flexible_rule": None,
        }
    if flexible_rule:
        start = datetime.combine(attendance_date, flexible_rule.earliest_start, zone)
        end = datetime.combine(attendance_date, flexible_rule.latest_end, zone)
        return {
            "off_day": False,
            "zone": zone,
            "start": start,
            "end": end,
            "break_minutes": 0,
            "grace_minutes": 0,
            "required_minutes": flexible_rule.required_minutes,
            "flexible_rule": flexible_rule,
        }
    if shift is None:
        raise ValidationError({"work_schedule": "No shift is configured for this date."})
    start = datetime.combine(attendance_date, shift.start_time, zone)
    end = datetime.combine(attendance_date, shift.end_time, zone)
    if shift.crosses_midnight:
        end += timedelta(days=1)
    return {
        "off_day": False,
        "zone": zone,
        "start": start,
        "end": end,
        "break_minutes": shift.break_minutes,
        "grace_minutes": shift.grace_period_minutes,
        "required_minutes": shift.scheduled_minutes,
        "flexible_rule": None,
    }
