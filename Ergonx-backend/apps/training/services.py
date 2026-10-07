from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_audit_event
from apps.documents.checklist import add_months
from apps.notifications.models import Notification
from apps.training.models import TrainingCourse, TrainingEnrollment

CERTIFICATE_WARNING_DAYS = 60
VALID, EXPIRING, EXPIRED = "VALID", "EXPIRING", "EXPIRED"


def _notify(enrollment, notification_type, title, message):
    user = enrollment.employee.user
    if user is None:
        return
    Notification.objects.create(
        institution=enrollment.institution,
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        channel=Notification.Channel.IN_APP,
        metadata={"training_enrollment_id": str(enrollment.id), "route_hint": "/me/training"},
    )


def _audit(enrollment, actor, action, **metadata):
    record_audit_event(
        actor=actor,
        institution=enrollment.institution,
        entity=enrollment,
        action=f"training.enrollment.{action}",
        metadata={"course": enrollment.course.title, "employee_id": str(enrollment.employee_id), **metadata},
    )


@transaction.atomic
def enroll_employees(*, course, employees, actor, planned_start=None, planned_end=None, notes=""):
    """Enrol each employee once; anyone already planned or in progress on the course is skipped."""
    if not course.is_active:
        raise ValidationError({"course": "This course is no longer offered."})
    created, skipped = [], []
    for employee in employees:
        if TrainingEnrollment.objects.filter(course=course, employee=employee, status__in=TrainingEnrollment.OPEN_STATUSES).exists():
            skipped.append(employee)
            continue
        enrollment = TrainingEnrollment.objects.create(
            institution=course.institution, course=course, employee=employee, planned_start=planned_start,
            planned_end=planned_end, notes=notes, enrolled_by=actor,
        )
        _audit(enrollment, actor, "created", planned_start=str(planned_start or ""))
        when = f" starting {planned_start:%d %b %Y}" if planned_start else ""
        _notify(enrollment, "TRAINING_ENROLLED", "You have been enrolled in training", f"{course.title}{when}.")
        created.append(enrollment)
    return created, skipped


def _locked(enrollment):
    return TrainingEnrollment.objects.select_for_update().select_related("course", "employee").get(pk=enrollment.pk)


@transaction.atomic
def start_enrollment(*, enrollment, actor):
    instance = _locked(enrollment)
    if instance.status == TrainingEnrollment.Status.IN_PROGRESS:
        return instance
    if instance.status != TrainingEnrollment.Status.PLANNED:
        raise ValidationError({"status": "Only planned training can be started."})
    instance.status = TrainingEnrollment.Status.IN_PROGRESS
    if instance.planned_start is None:
        instance.planned_start = timezone.localdate()
    instance.save(update_fields=("status", "planned_start", "updated_at"))
    _audit(instance, actor, "started")
    return instance


@transaction.atomic
def complete_enrollment(*, enrollment, actor, completed_on=None, passed=True, score=None, certificate_number="", certificate_expires_on=None, certificate_document=None, notes=None):
    instance = _locked(enrollment)
    if instance.status not in TrainingEnrollment.OPEN_STATUSES:
        raise ValidationError({"status": "Only planned or in-progress training can be completed."})
    completed_on = completed_on or timezone.localdate()
    if completed_on > timezone.localdate():
        raise ValidationError({"completed_on": "The completion date cannot be in the future."})
    instance.completed_on = completed_on
    instance.score = score
    if passed:
        instance.status = TrainingEnrollment.Status.COMPLETED
        instance.certificate_number = (certificate_number or "").strip()
        validity = instance.course.certificate_validity_months
        instance.certificate_expires_on = certificate_expires_on or (add_months(completed_on, validity) if validity else None)
        instance.certificate_document = certificate_document
    else:
        instance.status = TrainingEnrollment.Status.NOT_PASSED
    if notes is not None:
        instance.notes = notes
    instance.save()
    _audit(instance, actor, "completed" if passed else "not_passed", completed_on=str(completed_on), score=str(score) if score is not None else "")
    if passed:
        expiry = f" Your certificate is valid until {instance.certificate_expires_on:%d %b %Y}." if instance.certificate_expires_on else ""
        _notify(instance, "TRAINING_COMPLETED", "Training completed", f"{instance.course.title} is recorded as completed.{expiry}")
    return instance


@transaction.atomic
def cancel_enrollment(*, enrollment, actor, reason=""):
    instance = _locked(enrollment)
    if instance.status not in TrainingEnrollment.OPEN_STATUSES:
        raise ValidationError({"status": "Only planned or in-progress training can be cancelled."})
    instance.status = TrainingEnrollment.Status.CANCELLED
    if reason:
        instance.notes = f"{instance.notes}\nCancelled: {reason}".strip()
    instance.save(update_fields=("status", "notes", "updated_at"))
    _audit(instance, actor, "cancelled", reason=reason)
    return instance


def certificate_status(expires_on, today):
    if expires_on is None:
        return None
    if expires_on < today:
        return EXPIRED
    if expires_on <= today + timedelta(days=CERTIFICATE_WARNING_DAYS):
        return EXPIRING
    return VALID


def current_certifications(enrollments, today=None):
    """The latest certificate per employee and course, each with its validity status."""
    today = today or timezone.localdate()
    latest = {}
    for enrollment in enrollments.filter(status=TrainingEnrollment.Status.COMPLETED, certificate_expires_on__isnull=False).select_related("course", "employee").order_by("-completed_on"):
        latest.setdefault((enrollment.employee_id, enrollment.course_id), enrollment)
    rows = [
        {
            "enrollment_id": str(item.id),
            "employee_id": str(item.employee_id),
            "employee": item.employee.full_name,
            "employee_number": item.employee.employee_number,
            "course_id": str(item.course_id),
            "course": item.course.title,
            "certificate_number": item.certificate_number,
            "completed_on": item.completed_on,
            "expires_on": item.certificate_expires_on,
            "status": certificate_status(item.certificate_expires_on, today),
        }
        for item in latest.values()
    ]
    return sorted(rows, key=lambda row: row["expires_on"])


def training_overview(institution, enrollments, today=None):
    today = today or timezone.localdate()
    year_start = today.replace(month=1, day=1)
    certifications = current_certifications(enrollments, today)
    return {
        "active_courses": TrainingCourse.objects.for_institution(institution).filter(is_active=True).count(),
        "planned": enrollments.filter(status=TrainingEnrollment.Status.PLANNED).count(),
        "in_progress": enrollments.filter(status=TrainingEnrollment.Status.IN_PROGRESS).count(),
        "completed_this_year": enrollments.filter(status=TrainingEnrollment.Status.COMPLETED, completed_on__gte=year_start).count(),
        "certificates_valid": sum(1 for row in certifications if row["status"] == VALID),
        "certificates_expiring": sum(1 for row in certifications if row["status"] == EXPIRING),
        "certificates_expired": sum(1 for row in certifications if row["status"] == EXPIRED),
        "attention": [row for row in certifications if row["status"] in (EXPIRING, EXPIRED)],
    }
