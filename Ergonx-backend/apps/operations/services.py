from datetime import date

from django.db import transaction
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.attendance.models import AttendanceRecord
from apps.notifications.models import Notification
from apps.employees.models import Employee
from apps.operations.models import BackgroundJob, ImportJob, ImportRowResult


@transaction.atomic
def enqueue_background_job(*, job_type, institution=None, initiated_by=None, metadata=None):
    return BackgroundJob.objects.create(job_type=job_type, institution=institution, initiated_by=initiated_by, metadata=metadata or {})


@transaction.atomic
def claim_next_background_job(*, job_types=None):
    queryset = BackgroundJob.objects.select_for_update(skip_locked=True).filter(status=BackgroundJob.Status.QUEUED)
    if job_types:
        queryset = queryset.filter(job_type__in=job_types)
    job = queryset.order_by("created_at").first()
    if job is None:
        return None
    job.status = BackgroundJob.Status.RUNNING
    job.started_at = timezone.now()
    job.save(update_fields=("status", "started_at", "updated_at"))
    return job


def complete_background_job(job, *, result_reference=""):
    job.status = BackgroundJob.Status.SUCCEEDED
    job.progress = 100
    job.result_reference = result_reference
    job.completed_at = timezone.now()
    job.save(update_fields=("status", "progress", "result_reference", "completed_at", "updated_at"))
    return job


def fail_background_job(job, *, error_summary):
    job.status = BackgroundJob.Status.FAILED
    job.error_summary = str(error_summary)[:5000]
    job.completed_at = timezone.now()
    job.save(update_fields=("status", "error_summary", "completed_at", "updated_at"))
    return job


def process_pending_notifications(*, limit=100):
    """Mark in-app delivery complete; email transport can be registered by a worker later."""
    delivered = 0
    for notification in Notification.objects.filter(status=Notification.Status.PENDING, channel=Notification.Channel.IN_APP).order_by("created_at")[:limit]:
        notification.status = Notification.Status.SENT
        notification.sent_at = timezone.now()
        notification.save(update_fields=("status", "sent_at", "updated_at"))
        delivered += 1
    return delivered


@transaction.atomic
def commit_employee_import(*, import_job):
    """Commits pre-validated employee rows; file parsing stays in a domain validator."""
    import_job = ImportJob.objects.select_for_update().get(pk=import_job.pk)
    if import_job.import_type != "EMPLOYEE" or import_job.status != ImportJob.Status.COMMITTING:
        raise ValueError("Only committing EMPLOYEE imports can be processed.")
    imported = skipped = 0
    for row in import_job.row_results.select_for_update().filter(status=ImportRowResult.Status.VALID).order_by("row_number"):
        values = row.normalized_data
        number = str(values["employee_number"]).strip().upper()
        if Employee.objects.filter(institution=import_job.institution, employee_number=number).exists():
            row.status = ImportRowResult.Status.SKIPPED
            row.errors = ["Employee number already exists."]
            row.save(update_fields=("status", "errors", "updated_at"))
            skipped += 1
            continue
        Employee.objects.create(
            institution=import_job.institution, employee_number=number,
            first_name=values["first_name"], last_name=values["last_name"],
            middle_name=values.get("middle_name", ""), personal_email=values.get("personal_email", ""),
            work_email=values.get("work_email", ""), phone=values.get("phone", ""),
            hire_date=date.fromisoformat(values["hire_date"]) if isinstance(values["hire_date"], str) else values["hire_date"],
            gender=values.get("gender", Employee.Gender.PREFER_NOT_TO_SAY), status=values.get("status", Employee.Status.ACTIVE),
        )
        row.status = ImportRowResult.Status.IMPORTED
        row.save(update_fields=("status", "updated_at"))
        imported += 1
    import_job.status = ImportJob.Status.COMPLETED
    import_job.completed_at = timezone.now()
    import_job.valid_rows = imported
    import_job.invalid_rows = skipped + import_job.row_results.filter(status=ImportRowResult.Status.INVALID).count()
    import_job.save(update_fields=("status", "completed_at", "valid_rows", "invalid_rows", "updated_at"))
    return imported


def _attendance_import_datetime(value):
    """Accept an ISO datetime or a blank optional import column."""
    if value in (None, ""):
        return None
    if hasattr(value, "tzinfo"):
        return value
    parsed = parse_datetime(str(value))
    if parsed is None:
        raise ValueError("Use an ISO-8601 check-in/check-out date-time.")
    return parsed


@transaction.atomic
def commit_attendance_import(*, import_job):
    """Commit a validated ATTENDANCE import with a fixed, tenant-safe row schema.

    Required normalized columns are ``employee_number``, ``attendance_date``,
    and ``status``. Optional columns are ``check_in``, ``check_out``,
    ``worked_minutes``, ``late_minutes``, ``early_departure_minutes``,
    ``overtime_minutes``, and ``notes``. An attendance date is deliberately
    considered already represented when *any* record exists for that employee
    and date, including a scheduled record, so a file cannot create a second
    unscheduled attendance record for the same employee-day.
    """
    import_job = ImportJob.objects.select_for_update().get(pk=import_job.pk)
    if import_job.import_type != "ATTENDANCE" or import_job.status != ImportJob.Status.COMMITTING:
        raise ValueError("Only committing ATTENDANCE imports can be processed.")

    imported = skipped = 0
    valid_statuses = set(AttendanceRecord.Status.values)
    rows = import_job.row_results.select_for_update().filter(
        status=ImportRowResult.Status.VALID
    ).order_by("row_number")
    for row in rows:
        values = row.normalized_data
        try:
            employee_number = str(values["employee_number"]).strip().upper()
            attendance_date = (
                values["attendance_date"]
                if isinstance(values["attendance_date"], date)
                else parse_date(str(values["attendance_date"]))
            )
            status = str(values["status"]).strip().upper()
            if not employee_number or attendance_date is None:
                raise ValueError("employee_number and attendance_date are required.")
            if status not in valid_statuses:
                raise ValueError("status is not a supported attendance status.")
            employee = Employee.objects.filter(
                institution=import_job.institution,
                employee_number=employee_number,
            ).first()
            if employee is None:
                raise ValueError("Employee number was not found in this institution.")
            if AttendanceRecord.objects.filter(
                institution=import_job.institution,
                employee=employee,
                attendance_date=attendance_date,
            ).exists():
                raise ValueError("Attendance already exists for this employee and date.")

            record = AttendanceRecord(
                institution=import_job.institution,
                employee=employee,
                attendance_date=attendance_date,
                check_in=_attendance_import_datetime(values.get("check_in")),
                check_out=_attendance_import_datetime(values.get("check_out")),
                worked_minutes=int(values.get("worked_minutes", 0) or 0),
                late_minutes=int(values.get("late_minutes", 0) or 0),
                early_departure_minutes=int(values.get("early_departure_minutes", 0) or 0),
                overtime_minutes=int(values.get("overtime_minutes", 0) or 0),
                status=status,
                source=AttendanceRecord.Source.IMPORT,
                notes=str(values.get("notes", "") or ""),
            )
            record.full_clean()
            record.save()
        except (DjangoValidationError, KeyError, TypeError, ValueError) as exc:
            row.status = ImportRowResult.Status.SKIPPED
            row.errors = ["; ".join(exc.messages) if isinstance(exc, DjangoValidationError) else str(exc)]
            row.save(update_fields=("status", "errors", "updated_at"))
            skipped += 1
            continue
        row.status = ImportRowResult.Status.IMPORTED
        row.save(update_fields=("status", "updated_at"))
        imported += 1

    import_job.status = ImportJob.Status.COMPLETED
    import_job.completed_at = timezone.now()
    import_job.valid_rows = imported
    import_job.invalid_rows = skipped + import_job.row_results.filter(
        status=ImportRowResult.Status.INVALID
    ).count()
    import_job.save(update_fields=(
        "status", "completed_at", "valid_rows", "invalid_rows", "updated_at"
    ))
    return imported
