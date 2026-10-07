from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.institutions.models import Institution
from common.models import TenantOwnedModel


class BackgroundJob(TenantOwnedModel):
    class Status(models.TextChoices):
        QUEUED = "QUEUED", "Queued"
        RUNNING = "RUNNING", "Running"
        SUCCEEDED = "SUCCEEDED", "Succeeded"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"

    institution = models.ForeignKey(
        Institution,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="background_jobs",
    )
    job_type = models.CharField(max_length=100)
    initiated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="background_jobs_initiated",
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED)
    progress = models.PositiveSmallIntegerField(default=0)
    result_reference = models.CharField(max_length=500, blank=True)
    error_summary = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=models.Q(progress__lte=100), name="background_job_progress_lte_100"
            )
        ]
        indexes = [models.Index(fields=("institution", "status"))]

    def clean(self):
        if self.initiated_by_id and self.institution_id:
            if not self.initiated_by.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                raise ValidationError(
                    {"initiated_by": "Initiating user must belong to the institution."}
                )


class ImportJob(TenantOwnedModel):
    class Status(models.TextChoices):
        UPLOADED = "UPLOADED", "Uploaded"
        VALIDATING = "VALIDATING", "Validating"
        READY = "READY", "Ready"
        COMMITTING = "COMMITTING", "Committing"
        COMPLETED = "COMPLETED", "Completed"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="import_jobs"
    )
    import_type = models.CharField(max_length=100)
    file_reference = models.CharField(max_length=500)
    initiated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="import_jobs_initiated",
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.UPLOADED)
    total_rows = models.PositiveIntegerField(default=0)
    valid_rows = models.PositiveIntegerField(default=0)
    invalid_rows = models.PositiveIntegerField(default=0)
    error_summary = models.TextField(blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("institution", "status"))]

    def clean(self):
        if self.initiated_by_id and self.institution_id:
            if not self.initiated_by.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                raise ValidationError(
                    {"initiated_by": "Initiating user must belong to the institution."}
                )


class ImportRowResult(TenantOwnedModel):
    class Status(models.TextChoices):
        VALID = "VALID", "Valid"
        INVALID = "INVALID", "Invalid"
        IMPORTED = "IMPORTED", "Imported"
        SKIPPED = "SKIPPED", "Skipped"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="import_row_results"
    )
    import_job = models.ForeignKey(
        ImportJob, on_delete=models.CASCADE, related_name="row_results"
    )
    row_number = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=Status.choices)
    raw_data = models.JSONField(default=dict, blank=True)
    normalized_data = models.JSONField(default=dict, blank=True)
    errors = models.JSONField(default=list, blank=True)
    warnings = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ("import_job", "row_number")
        constraints = [
            models.UniqueConstraint(
                fields=("import_job", "row_number"), name="uniq_row_per_import_job"
            )
        ]

    def clean(self):
        if self.import_job_id and self.import_job.institution_id != self.institution_id:
            raise ValidationError(
                {"import_job": "Import job must belong to the same institution."}
            )


class ExportJob(TenantOwnedModel):
    class Status(models.TextChoices):
        QUEUED = "QUEUED", "Queued"
        RUNNING = "RUNNING", "Running"
        COMPLETED = "COMPLETED", "Completed"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="export_jobs"
    )
    export_type = models.CharField(max_length=100)
    initiated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="export_jobs_initiated",
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED)
    result_reference = models.CharField(max_length=500, blank=True)
    result_content = models.TextField(blank=True)
    error_summary = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("institution", "status"))]

    def clean(self):
        if self.initiated_by_id and self.institution_id:
            if not self.initiated_by.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                raise ValidationError(
                    {"initiated_by": "Initiating user must belong to the institution."}
                )
