"""Training records (ErgonX HR): a course catalogue and employee enrolments.

An enrolment moves PLANNED -> IN_PROGRESS -> COMPLETED (or CANCELLED / NOT_PASSED).
Completing a course whose certificate expires sets ``certificate_expires_on``
from the completion date, so HSSE and other certifications can be followed up
before they lapse.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.employees.models import Employee
from apps.institutions.models import Institution
from common.codes import AutoCodeMixin
from common.models import TenantOwnedModel


class TrainingCourse(AutoCodeMixin, TenantOwnedModel):
    auto_code_field = "code"
    auto_code_prefix = "TRN"
    auto_code_width = 3

    class Category(models.TextChoices):
        SAFETY = "SAFETY", "Health, safety & environment"
        TECHNICAL = "TECHNICAL", "Technical skills"
        COMPLIANCE = "COMPLIANCE", "Compliance & regulatory"
        LEADERSHIP = "LEADERSHIP", "Leadership & management"
        INDUCTION = "INDUCTION", "Induction & onboarding"
        SOFT_SKILLS = "SOFT_SKILLS", "Professional skills"
        OTHER = "OTHER", "Other"

    class DeliveryMode(models.TextChoices):
        CLASSROOM = "CLASSROOM", "Classroom"
        ONLINE = "ONLINE", "Online"
        ON_THE_JOB = "ON_THE_JOB", "On the job"
        BLENDED = "BLENDED", "Blended"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="training_courses")
    code = models.CharField(max_length=30, blank=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    delivery_mode = models.CharField(max_length=20, choices=DeliveryMode.choices, default=DeliveryMode.CLASSROOM)
    provider = models.CharField(max_length=200, blank=True, help_text="Internal team or external training provider.")
    duration_hours = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    # Certificate lifetime; None means the course issues no expiring certificate.
    certificate_validity_months = models.PositiveSmallIntegerField(null=True, blank=True)
    is_mandatory = models.BooleanField(default=False, help_text="Shown as mandatory training for the roles it covers.")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("title",)
        constraints = [models.UniqueConstraint(fields=("institution", "code"), name="uniq_training_course_code")]
        indexes = [models.Index(fields=("institution", "is_active"))]

    def clean(self):
        self.code = (self.code or "").strip().upper()
        self.title = (self.title or "").strip()
        errors = {}
        if not self.title:
            errors["title"] = "Give the course a title."
        if self.certificate_validity_months is not None and not 1 <= self.certificate_validity_months <= 120:
            errors["certificate_validity_months"] = "Certificate validity must be between 1 and 120 months."
        if self.duration_hours is not None and self.duration_hours <= 0:
            errors["duration_hours"] = "Duration must be more than zero hours."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.code} {self.title}".strip()


class TrainingEnrollment(TenantOwnedModel):
    class Status(models.TextChoices):
        PLANNED = "PLANNED", "Planned"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        COMPLETED = "COMPLETED", "Completed"
        NOT_PASSED = "NOT_PASSED", "Not passed"
        CANCELLED = "CANCELLED", "Cancelled"

    OPEN_STATUSES = (Status.PLANNED, Status.IN_PROGRESS)

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="training_enrollments")
    course = models.ForeignKey(TrainingCourse, on_delete=models.PROTECT, related_name="enrollments")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="training_enrollments")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PLANNED)
    planned_start = models.DateField(null=True, blank=True)
    planned_end = models.DateField(null=True, blank=True)
    completed_on = models.DateField(null=True, blank=True)
    score = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    certificate_number = models.CharField(max_length=100, blank=True)
    certificate_expires_on = models.DateField(null=True, blank=True)
    certificate_document = models.ForeignKey("documents.Document", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    notes = models.TextField(blank=True)
    enrolled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ("-planned_start", "-created_at")
        indexes = [
            models.Index(fields=("institution", "status")),
            models.Index(fields=("institution", "certificate_expires_on")),
            models.Index(fields=("employee", "course")),
        ]

    def clean(self):
        errors = {}
        for name in ("course", "employee"):
            related = getattr(self, name, None)
            if related is not None and related.institution_id != self.institution_id:
                errors[name] = "Referenced record must belong to the same institution."
        if self.planned_start and self.planned_end and self.planned_end < self.planned_start:
            errors["planned_end"] = "The end date cannot be before the start date."
        if self.status == self.Status.COMPLETED and not self.completed_on:
            errors["completed_on"] = "Record the completion date."
        if self.score is not None and not 0 <= self.score <= 100:
            errors["score"] = "Score is a percentage between 0 and 100."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.employee} - {self.course}"
