from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.audit.services import record_audit_event
from apps.institutions.services import record_user_activity
from apps.attendance.models import AttendanceAdjustment, AttendanceRecord, OvertimeRecord
from apps.employees.models import Employment
from apps.institutions.models import InstitutionMembership
from apps.scheduling.services import schedule_assignment_for, schedule_expectation
from common.exceptions import CodedValidationError


def _membership(actor, institution):
    membership = (
        actor.memberships.filter(
            institution=institution, status=InstitutionMembership.Status.ACTIVE
        )
        .select_related("role")
        .prefetch_related("role__permissions")
        .first()
    )
    if membership is None:
        raise ValidationError({"actor": "Actor must be an active institution member."})
    return membership


def _can_manage(actor, employee):
    membership = _membership(actor, employee.institution)
    if employee.user_id == actor.id:
        return True
    if membership.role.permissions.filter(code="attendance.manage").exists():
        return True
    raise ValidationError({"actor": "Actor cannot manage this employee's attendance."})


def _local_date(employee, at):
    try:
        zone = ZoneInfo(employee.institution.timezone)
    except ZoneInfoNotFoundError as exc:
        raise ValidationError({"timezone": "Institution timezone is invalid."}) from exc
    return at.astimezone(zone).date()


def _approved_leave_exists(employee, attendance_date):
    from apps.leave.models import LeaveRequest

    return LeaveRequest.objects.filter(
        employee=employee,
        status=LeaveRequest.Status.APPROVED,
        start_date__lte=attendance_date,
        end_date__gte=attendance_date,
    ).exists()


def _remote_employee(employee, attendance_date):
    employment = (
        Employment.objects.filter(
            employee=employee,
            start_date__lte=attendance_date,
        )
        .filter(
            models.Q(end_date__isnull=True) | models.Q(end_date__gte=attendance_date)
        )
        .select_related("location")
        .order_by("-is_current", "-start_date")
        .first()
    )
    return bool(employment and employment.location.is_remote)


def _minutes_between(later, earlier):
    return max(0, int((later - earlier).total_seconds() // 60))


def _recalculate(record):
    if not record.check_in:
        record.worked_minutes = 0
        record.late_minutes = 0
        record.early_departure_minutes = 0
        record.overtime_minutes = 0
        return record

    expectation = (
        schedule_expectation(record.schedule_assignment, record.attendance_date)
        if record.schedule_assignment_id
        else None
    )
    local_in = record.check_in
    local_out = record.check_out
    if expectation:
        local_in = record.check_in.astimezone(expectation["zone"])
        if record.check_out:
            local_out = record.check_out.astimezone(expectation["zone"])

        if expectation["off_day"]:
            record.status = AttendanceRecord.Status.OFF_DAY
            record.late_minutes = 0
            record.early_departure_minutes = 0
        else:
            flexible = expectation["flexible_rule"]
            late_threshold = expectation["start"] + timedelta(
                minutes=expectation["grace_minutes"]
            )
            early_threshold = expectation["end"]
            if flexible:
                late_threshold = datetime.combine(
                    record.attendance_date, flexible.latest_start, expectation["zone"]
                )
                early_threshold = datetime.combine(
                    record.attendance_date, flexible.earliest_end, expectation["zone"]
                )
            record.late_minutes = _minutes_between(local_in, late_threshold)
            record.early_departure_minutes = (
                _minutes_between(early_threshold, local_out) if local_out else 0
            )
            if _remote_employee(record.employee, record.attendance_date):
                record.status = AttendanceRecord.Status.REMOTE
            elif record.late_minutes:
                record.status = AttendanceRecord.Status.LATE
            else:
                record.status = AttendanceRecord.Status.PRESENT

    if record.check_out:
        gross_minutes = _minutes_between(record.check_out, record.check_in)
        break_minutes = expectation["break_minutes"] if expectation else 0
        record.worked_minutes = max(0, gross_minutes - break_minutes)
        required = expectation["required_minutes"] if expectation else record.worked_minutes
        record.overtime_minutes = max(0, record.worked_minutes - required)
        if expectation and expectation["off_day"]:
            record.overtime_minutes = record.worked_minutes
    return record


def _sync_overtime(record):
    overtime = OvertimeRecord.objects.filter(attendance_record=record).first()
    if record.overtime_minutes:
        if overtime is None:
            overtime = OvertimeRecord(
                institution=record.institution,
                employee=record.employee,
                attendance_record=record,
            )
        overtime.calculated_minutes = record.overtime_minutes
        overtime.approved_minutes = 0
        overtime.status = OvertimeRecord.Status.PENDING
        overtime.approved_by = None
        overtime.approved_at = None
        overtime.save()
    elif overtime:
        overtime.calculated_minutes = 0
        overtime.approved_minutes = 0
        overtime.status = OvertimeRecord.Status.REJECTED
        overtime.approved_by = None
        overtime.approved_at = None
        overtime.save()


@transaction.atomic
def clock_in(*, employee, actor, at=None, source=AttendanceRecord.Source.WEB):
    _can_manage(actor, employee)
    at = at or timezone.now()
    attendance_date = _local_date(employee, at)
    if _approved_leave_exists(employee, attendance_date):
        raise ValidationError({"attendance_date": "Employee is on approved leave."})
    assignment = schedule_assignment_for(employee, attendance_date)
    if assignment is None:
        raise ValidationError({"schedule_assignment": "No schedule covers this date."})
    record, _ = AttendanceRecord.objects.select_for_update().get_or_create(
        institution=employee.institution,
        employee=employee,
        attendance_date=attendance_date,
        schedule_assignment=assignment,
        defaults={
            "status": AttendanceRecord.Status.PRESENT,
            "source": source,
        },
    )
    if record.check_in:
        raise ValidationError({"check_in": "Employee is already checked in for this date."})
    record.check_in = at
    record.source = source
    _recalculate(record)
    record.save()
    record_audit_event(
        actor=actor,
        institution=record.institution,
        entity=record,
        action="attendance.clocked_in",
        metadata={"source": source},
    )
    return record


@transaction.atomic
def clock_out(*, attendance_record, actor, at=None):
    # PostgreSQL cannot apply FOR UPDATE to the nullable side of the
    # schedule_assignment outer join. Lock only the attendance row and allow
    # related objects to load separately inside the same transaction.
    attendance_record = AttendanceRecord.objects.select_for_update().get(
        pk=attendance_record.pk
    )
    _can_manage(actor, attendance_record.employee)
    if attendance_record.check_in is None:
        raise ValidationError({"check_out": "Cannot check out before checking in."})
    if attendance_record.check_out is not None:
        raise ValidationError({"check_out": "Employee is already checked out."})
    attendance_record.check_out = at or timezone.now()
    _recalculate(attendance_record)
    attendance_record.save()
    _sync_overtime(attendance_record)
    record_audit_event(
        actor=actor,
        institution=attendance_record.institution,
        entity=attendance_record,
        action="attendance.clocked_out",
        metadata={"worked_minutes": attendance_record.worked_minutes},
    )
    return attendance_record


@transaction.atomic
def classify_attendance_date(*, employee, attendance_date, actor):
    membership = _membership(actor, employee.institution)
    if not membership.role.permissions.filter(code="attendance.manage").exists():
        raise ValidationError({"actor": "Actor cannot classify attendance."})
    assignment = schedule_assignment_for(employee, attendance_date)
    if assignment is None:
        raise ValidationError({"schedule_assignment": "No schedule covers this date."})
    expectation = schedule_expectation(assignment, attendance_date)
    if _approved_leave_exists(employee, attendance_date):
        status = AttendanceRecord.Status.ON_LEAVE
    elif expectation["off_day"]:
        status = AttendanceRecord.Status.OFF_DAY
    else:
        status = AttendanceRecord.Status.ABSENT
    record, created = AttendanceRecord.objects.get_or_create(
        institution=employee.institution,
        employee=employee,
        attendance_date=attendance_date,
        schedule_assignment=assignment,
        defaults={"status": status, "source": AttendanceRecord.Source.API},
    )
    if not created and not record.check_in:
        record.status = status
        record.save(update_fields=("status", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=record.institution,
        entity=record,
        action="attendance.date_classified",
        metadata={"status": record.status},
    )
    return record


@transaction.atomic
def _derive_type(attendance_record, proposed_values):
    Type = AttendanceAdjustment.AdjustmentType
    if set(proposed_values) <= {"notes"}:
        return Type.NOTE_ONLY
    if "check_in" in proposed_values and not attendance_record.check_in:
        return Type.MISSED_CLOCK_IN
    if "check_out" in proposed_values and not attendance_record.check_out:
        return Type.MISSED_CLOCK_OUT
    return Type.TIME_CORRECTION


def _validate_evidence(evidence, institution):
    if evidence is not None and evidence.institution_id != institution.id:
        raise ValidationError({"evidence": "Evidence must belong to the same institution."})


def request_adjustment(*, institution, attendance_record, actor, reason, proposed_values, evidence=None, adjustment_type=None):
    _can_manage(actor, attendance_record.employee)
    _validate_evidence(evidence, institution)
    if attendance_record.institution_id != institution.id:
        raise ValidationError(
            {"attendance_record": "Attendance record belongs to another institution."}
        )
    allowed_fields = {"check_in", "check_out", "notes"}
    unexpected = set(proposed_values) - allowed_fields
    if unexpected:
        raise ValidationError(
            {"proposed_values": f"Unsupported attendance fields: {', '.join(sorted(unexpected))}."}
        )
    old_values = {
        "check_in": attendance_record.check_in.isoformat() if attendance_record.check_in else None,
        "check_out": attendance_record.check_out.isoformat() if attendance_record.check_out else None,
        "notes": attendance_record.notes,
    }
    adjustment = AttendanceAdjustment(
        institution=institution,
        attendance_record=attendance_record,
        requested_by=actor,
        reason=reason,
        old_values=old_values,
        proposed_values=proposed_values,
        status=AttendanceAdjustment.Status.PENDING,
        evidence=evidence,
        adjustment_type=adjustment_type or _derive_type(attendance_record, proposed_values),
    )
    adjustment.full_clean()
    adjustment.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=adjustment,
        action="attendance.adjustment.requested",
    )
    record_user_activity(
        actor=actor,
        institution=institution,
        activity_code="attendance.adjust",
        entity=adjustment,
    )
    return adjustment


def _coerce_datetime(value, field_name):
    if value is None or isinstance(value, datetime):
        return value
    parsed = parse_datetime(value)
    if parsed is None:
        raise ValidationError({"proposed_values": f"{field_name} must be ISO-8601."})
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def ensure_pay_not_finalized(institution, day):
    """Refuse changes that would alter pay already finalized for ``day`` (LC-ATT-01).

    Approved attendance feeds overtime pay; once the payroll covering a date
    is finalized, that date's attendance can no longer change pay silently.
    """
    from apps.payroll.models import PayrollRun

    if PayrollRun.objects.filter(
        institution=institution,
        status=PayrollRun.Status.FINALIZED,
        payroll_period__start_date__lte=day,
        payroll_period__end_date__gte=day,
    ).exists():
        raise CodedValidationError(
            {"attendance_date": f"Payroll covering {day.isoformat()} is finalized. Record a correction in a later payroll instead."},
            api_code="payroll_finalized",
        )


@transaction.atomic
def decide_adjustment(*, adjustment, actor, approve, comment=""):
    adjustment = AttendanceAdjustment.objects.select_for_update().select_related(
        "attendance_record__employee"
    ).get(pk=adjustment.pk)
    membership = _membership(actor, adjustment.institution)
    if not membership.role.permissions.filter(code="attendance.approve").exists():
        raise ValidationError({"actor": "Actor cannot decide attendance adjustments."})
    if adjustment.status != AttendanceAdjustment.Status.PENDING:
        raise ValidationError({"status": "Only pending adjustments can be decided."})
    if approve:
        ensure_pay_not_finalized(adjustment.institution, adjustment.attendance_record.attendance_date)
        record = AttendanceRecord.objects.select_for_update().get(
            pk=adjustment.attendance_record_id
        )
        for field_name, value in adjustment.proposed_values.items():
            if field_name in {"check_in", "check_out"}:
                value = _coerce_datetime(value, field_name)
            setattr(record, field_name, value)
        _recalculate(record)
        record.save()
        _sync_overtime(record)
        adjustment.status = AttendanceAdjustment.Status.APPROVED
    else:
        adjustment.status = AttendanceAdjustment.Status.REJECTED
    if adjustment.attendance_record.employee.user_id == actor.id:
        raise ValidationError({"actor": "You cannot decide an adjustment to your own attendance."})
    adjustment.approved_by = actor
    adjustment.acted_at = timezone.now()
    adjustment.decision_note = comment or ""
    adjustment.save(update_fields=("status", "approved_by", "acted_at", "decision_note", "updated_at"))
    _notify_adjustment(
        adjustment.requested_by,
        adjustment,
        "ATTENDANCE_ADJUSTMENT_DECIDED",
        f"Attendance adjustment {adjustment.get_status_display().lower()}",
        comment or f"Your attendance adjustment was {adjustment.get_status_display().lower()}.",
    )
    record_audit_event(
        actor=actor,
        institution=adjustment.institution,
        entity=adjustment,
        action="attendance.adjustment.decided",
        metadata={"status": adjustment.status},
    )
    return adjustment


@transaction.atomic
def decide_overtime(*, overtime_record, actor, approve, approved_minutes=None):
    overtime_record = OvertimeRecord.objects.select_for_update().get(pk=overtime_record.pk)
    membership = _membership(actor, overtime_record.institution)
    if not membership.role.permissions.filter(code="attendance.approve").exists():
        raise ValidationError({"actor": "Actor cannot approve overtime."})
    if overtime_record.status != OvertimeRecord.Status.PENDING:
        raise ValidationError({"status": "Only pending overtime can be decided."})
    if overtime_record.employee.user_id == actor.id:
        raise ValidationError({"actor": "You cannot decide your own overtime."})
    if approve:
        ensure_pay_not_finalized(overtime_record.institution, overtime_record.attendance_record.attendance_date)
        overtime_record.status = OvertimeRecord.Status.APPROVED
        overtime_record.approved_minutes = (
            overtime_record.calculated_minutes
            if approved_minutes is None
            else approved_minutes
        )
    else:
        overtime_record.status = OvertimeRecord.Status.REJECTED
        overtime_record.approved_minutes = 0
    overtime_record.approved_by = actor
    overtime_record.approved_at = timezone.now()
    overtime_record.save()
    record_audit_event(
        actor=actor,
        institution=overtime_record.institution,
        entity=overtime_record,
        action="attendance.overtime.decided",
        metadata={
            "status": overtime_record.status,
            "approved_minutes": overtime_record.approved_minutes,
        },
    )
    return overtime_record


def _notify_adjustment(user, adjustment, notification_type, title, message):
    from apps.notifications.models import Notification

    if user is None:
        return
    Notification.objects.create(
        institution=adjustment.institution,
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        channel=Notification.Channel.IN_APP,
        metadata={
            "attendance_adjustment_id": str(adjustment.id),
            # Requesters open their self-service copy; reviewers the attendance workspace.
            "route_hint": (
                f"/me/attendance/adjustments/{adjustment.id}"
                if user.id == adjustment.requested_by_id
                else f"/attendance/adjustments/{adjustment.id}"
            ),
        },
    )


def _has_permission(user, institution, code):
    return user.memberships.filter(
        institution=institution, status=InstitutionMembership.Status.ACTIVE, role__permissions__code=code
    ).exists()


@transaction.atomic
def return_adjustment(*, adjustment, actor, comment=""):
    """Send a pending adjustment back to the requester for changes."""
    adjustment = AttendanceAdjustment.objects.select_for_update().select_related("attendance_record__employee").get(pk=adjustment.pk)
    if not _has_permission(actor, adjustment.institution, "attendance.approve"):
        raise ValidationError({"actor": "Actor cannot review attendance adjustments."})
    if adjustment.status != AttendanceAdjustment.Status.PENDING:
        raise ValidationError({"status": "Only pending adjustments can be returned for changes."})
    if not (comment or "").strip():
        raise ValidationError({"comment": "Explain what needs to change."})
    if adjustment.attendance_record.employee.user_id == actor.id:
        raise ValidationError({"actor": "You cannot review an adjustment to your own attendance."})
    adjustment.status = AttendanceAdjustment.Status.RETURNED
    adjustment.decision_note = comment.strip()
    adjustment.changes_requested_at = timezone.now()
    adjustment.approved_by = actor
    adjustment.save(update_fields=("status", "decision_note", "changes_requested_at", "approved_by", "updated_at"))
    _notify_adjustment(adjustment.requested_by, adjustment, "ATTENDANCE_ADJUSTMENT_RETURNED", "Changes requested on your attendance adjustment", comment.strip())
    record_audit_event(actor=actor, institution=adjustment.institution, entity=adjustment, action="attendance.adjustment.returned")
    return adjustment


EDITABLE_ADJUSTMENT_FIELDS = ("reason", "proposed_values", "evidence", "adjustment_type")


@transaction.atomic
def resubmit_adjustment(*, adjustment, actor, **values):
    """The requester edits a returned adjustment and sends it back for review."""
    adjustment = AttendanceAdjustment.objects.select_for_update().select_related("attendance_record__employee").get(pk=adjustment.pk)
    if adjustment.status != AttendanceAdjustment.Status.RETURNED:
        raise ValidationError({"status": "Only adjustments returned for changes can be resubmitted."})
    if adjustment.requested_by_id != actor.id:
        raise ValidationError({"actor": "Only the requester can resubmit this adjustment."})
    unknown = set(values) - set(EDITABLE_ADJUSTMENT_FIELDS)
    if unknown:
        raise ValidationError({field: "This field cannot be changed." for field in unknown})
    if "proposed_values" in values:
        unexpected = set(values["proposed_values"]) - {"check_in", "check_out", "notes"}
        if unexpected:
            raise ValidationError({"proposed_values": f"Unsupported attendance fields: {', '.join(sorted(unexpected))}."})
    _validate_evidence(values.get("evidence"), adjustment.institution)
    for field, value in values.items():
        setattr(adjustment, field, value)
    adjustment.status = AttendanceAdjustment.Status.PENDING
    adjustment.resubmitted_at = timezone.now()
    adjustment.approved_by = None
    adjustment.full_clean()
    adjustment.save()
    if adjustment.assigned_to_id:
        _notify_adjustment(adjustment.assigned_to, adjustment, "ATTENDANCE_ADJUSTMENT_RESUBMITTED", "Attendance adjustment resubmitted", "An adjustment you returned has been resubmitted for review.")
    record_audit_event(actor=actor, institution=adjustment.institution, entity=adjustment, action="attendance.adjustment.resubmitted")
    return adjustment


@transaction.atomic
def delegate_adjustment(*, adjustment, actor, delegate, comment=""):
    """Assign a pending adjustment to a specific attendance approver."""
    adjustment = AttendanceAdjustment.objects.select_for_update().select_related("attendance_record__employee").get(pk=adjustment.pk)
    institution = adjustment.institution
    if not _has_permission(actor, institution, "attendance.approve"):
        raise ValidationError({"actor": "Actor cannot delegate attendance adjustments."})
    if adjustment.status != AttendanceAdjustment.Status.PENDING:
        raise ValidationError({"status": "Only pending adjustments can be delegated."})
    if delegate is None or delegate.id == adjustment.assigned_to_id:
        raise ValidationError({"delegate": "Choose a different reviewer."})
    if delegate.id == adjustment.attendance_record.employee.user_id:
        raise ValidationError({"delegate": "Employees cannot review their own attendance."})
    if not _has_permission(delegate, institution, "attendance.approve"):
        raise ValidationError({"delegate": "The delegate must be an active member who can approve attendance."})
    previous = adjustment.assigned_to
    adjustment.assigned_to = delegate
    adjustment.full_clean()
    adjustment.save(update_fields=("assigned_to", "updated_at"))
    _notify_adjustment(delegate, adjustment, "ATTENDANCE_ADJUSTMENT_ASSIGNED", "Attendance adjustment assigned to you", comment or "An attendance adjustment was delegated to you for review.")
    record_audit_event(
        actor=actor, institution=institution, entity=adjustment, action="attendance.adjustment.delegated",
        metadata={"from": str(previous.id) if previous else None, "to": str(delegate.id), "comment": comment},
    )
    return adjustment


DAILY_HOURS_LIMIT_MINUTES = 12 * 60
EVIDENCE_THRESHOLD_MINUTES = 60


def _window(check_in, check_out, zone):
    if not check_in:
        return None
    start = check_in.astimezone(zone)
    end = check_out.astimezone(zone) if check_out else None
    return {"start": start.strftime("%H:%M"), "end": end.strftime("%H:%M") if end else None}


def adjustment_review_context(*, adjustment, user):
    """Scheduled vs recorded vs requested hours, policy checks and queue neighbours."""
    from apps.leave.models import LeaveRequest

    record = adjustment.attendance_record
    employee = record.employee
    institution = adjustment.institution
    try:
        zone = ZoneInfo(institution.timezone)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")

    expectation = None
    if record.schedule_assignment_id:
        try:
            expectation = schedule_expectation(record.schedule_assignment, record.attendance_date)
        except ValidationError:
            expectation = None
    scheduled = None
    if expectation and not expectation.get("off_day") and expectation.get("start"):
        scheduled = {
            "start": expectation["start"].strftime("%H:%M"),
            "end": expectation["end"].strftime("%H:%M") if expectation.get("end") else None,
            "minutes": expectation.get("required_minutes"),
        }
    elif expectation and expectation.get("off_day"):
        scheduled = {"start": None, "end": None, "minutes": 0, "off_day": True}

    recorded = _window(record.check_in, record.check_out, zone)
    if recorded is not None:
        recorded["minutes"] = record.worked_minutes

    # Project the requested values through the same calculation used on approval.
    projected = AttendanceRecord(
        institution=record.institution, employee=employee, schedule_assignment=record.schedule_assignment,
        attendance_date=record.attendance_date, check_in=record.check_in, check_out=record.check_out, notes=record.notes,
    )
    for field_name, value in adjustment.proposed_values.items():
        if field_name in {"check_in", "check_out"}:
            try:
                value = _coerce_datetime(value, field_name)
            except ValidationError:
                continue
        setattr(projected, field_name, value)
    try:
        _recalculate(projected)
        requested = _window(projected.check_in, projected.check_out, zone)
        if requested is not None:
            requested["minutes"] = projected.worked_minutes
    except ValidationError:
        requested = None
    difference = (requested or {}).get("minutes", 0) - (recorded or {}).get("minutes", 0) if requested else None

    added = max(difference or 0, 0)
    evidence_required = added > EVIDENCE_THRESHOLD_MINUTES or adjustment.adjustment_type in {
        AttendanceAdjustment.AdjustmentType.MISSED_CLOCK_IN, AttendanceAdjustment.AdjustmentType.ADD_MISSED_HOURS,
    }
    on_leave = LeaveRequest.objects.filter(
        employee=employee, status=LeaveRequest.Status.APPROVED,
        start_date__lte=record.attendance_date, end_date__gte=record.attendance_date,
    ).exists()
    requested_minutes = (requested or {}).get("minutes") or 0
    checks = [
        {"code": "daily_limit", "label": "Daily hours limit", "status": "pass" if requested_minutes <= DAILY_HOURS_LIMIT_MINUTES else "fail",
         "detail": "Within limit" if requested_minutes <= DAILY_HOURS_LIMIT_MINUTES else f"Exceeds {DAILY_HOURS_LIMIT_MINUTES // 60}h"},
        {"code": "evidence", "label": "Required evidence",
         "status": "pass" if adjustment.evidence_id else ("fail" if evidence_required else "pass"),
         "detail": "Provided" if adjustment.evidence_id else ("Missing" if evidence_required else "Not required")},
        {"code": "leave_overlap", "label": "Overlap with leave", "status": "fail" if on_leave else "pass",
         "detail": "Approved leave on this date" if on_leave else "No conflicts"},
    ]

    employment = Employment.objects.filter(employee=employee, is_current=True).select_related("department", "position").first()
    queue = list(
        AttendanceAdjustment.objects.filter(institution=institution, status=AttendanceAdjustment.Status.PENDING)
        .order_by("created_at").values_list("id", flat=True)
    )
    position = queue.index(adjustment.pk) if adjustment.pk in queue else None
    same_employee = list(
        AttendanceAdjustment.objects.filter(institution=institution, attendance_record__employee=employee)
        .order_by("attendance_record__attendance_date", "created_at").values_list("id", flat=True)
    )
    own_index = same_employee.index(adjustment.pk)
    can_review = (
        _has_permission(user, institution, "attendance.approve") and employee.user_id != user.id
    )
    return {
        "reference": adjustment.reference,
        "employee_id": str(employee.id),
        "employee_name": employee.full_name,
        "employee_number": employee.employee_number,
        "department": employment.department.name if employment else None,
        "position": employment.position.title if employment and employment.position_id else None,
        "attendance_date": record.attendance_date,
        "scheduled": scheduled,
        "recorded": recorded,
        "requested": requested,
        "difference_minutes": difference,
        "compliant": all(check["status"] == "pass" for check in checks),
        "policy_checks": checks,
        "queue": {
            "previous_id": queue[position - 1] if position else None,
            "next_id": queue[position + 1] if position is not None and position + 1 < len(queue) else None,
            "position": position + 1 if position is not None else None,
            "total": len(queue),
        },
        "employee_dates": {
            "previous_id": same_employee[own_index - 1] if own_index > 0 else None,
            "next_id": same_employee[own_index + 1] if own_index + 1 < len(same_employee) else None,
        },
        "is_requester": adjustment.requested_by_id == user.id,
        "can_decide": can_review and adjustment.status == AttendanceAdjustment.Status.PENDING,
        "can_delegate": can_review and adjustment.status == AttendanceAdjustment.Status.PENDING,
    }
