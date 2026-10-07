from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.employees.models import Employee
from apps.institutions.models import Institution
from apps.scheduling.models import ScheduleAssignment
from common.models import TenantOwnedModel


class AttendanceRecord(TenantOwnedModel):
    class Status(models.TextChoices):
        PRESENT = "PRESENT", "Present"
        ABSENT = "ABSENT", "Absent"
        LATE = "LATE", "Late"
        ON_LEAVE = "ON_LEAVE", "On leave"
        HOLIDAY = "HOLIDAY", "Holiday"
        OFF_DAY = "OFF_DAY", "Off day"
        REMOTE = "REMOTE", "Remote"

    class Source(models.TextChoices):
        WEB = "WEB", "Web"
        PWA = "PWA", "PWA"
        MANUAL = "MANUAL", "Manual"
        IMPORT = "IMPORT", "Import"
        DEVICE = "DEVICE", "Device"
        API = "API", "API"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="attendance_records"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="attendance_records"
    )
    schedule_assignment = models.ForeignKey(
        ScheduleAssignment,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="attendance_records",
    )
    attendance_date = models.DateField()
    check_in = models.DateTimeField(null=True, blank=True)
    check_out = models.DateTimeField(null=True, blank=True)
    worked_minutes = models.PositiveIntegerField(default=0)
    late_minutes = models.PositiveIntegerField(default=0)
    early_departure_minutes = models.PositiveIntegerField(default=0)
    overtime_minutes = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices)
    source = models.CharField(max_length=10, choices=Source.choices)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ("-attendance_date", "employee")
        constraints = [
            models.UniqueConstraint(
                fields=("employee", "attendance_date", "schedule_assignment"),
                condition=models.Q(schedule_assignment__isnull=False),
                name="uniq_attendance_employee_date_schedule",
            ),
            models.UniqueConstraint(
                fields=("employee", "attendance_date"),
                condition=models.Q(schedule_assignment__isnull=True),
                name="uniq_attendance_employee_date_unscheduled",
            ),
            models.CheckConstraint(
                condition=models.Q(check_out__isnull=True)
                | models.Q(check_in__isnull=False, check_out__gt=models.F("check_in")),
                name="attendance_checkout_after_checkin",
            ),
        ]
        indexes = [
            models.Index(fields=("institution", "attendance_date")),
            models.Index(fields=("institution", "status", "attendance_date")),
        ]

    def clean(self):
        errors = {}
        if self.employee_id and self.employee.institution_id != self.institution_id:
            errors["employee"] = "Employee must belong to the same institution."
        if self.schedule_assignment_id:
            if self.schedule_assignment.institution_id != self.institution_id:
                errors["schedule_assignment"] = "Schedule assignment belongs to another institution."
            elif self.employee_id and self.schedule_assignment.employee_id != self.employee_id:
                errors["schedule_assignment"] = "Schedule assignment belongs to another employee."
            elif self.attendance_date and (
                self.attendance_date < self.schedule_assignment.effective_from
                or (
                    self.schedule_assignment.effective_to
                    and self.attendance_date > self.schedule_assignment.effective_to
                )
            ):
                errors["schedule_assignment"] = "Schedule assignment is not effective on this date."
        if self.check_out and not self.check_in:
            errors["check_out"] = "Check-out requires a check-in."
        if self.check_in and self.check_out and self.check_out <= self.check_in:
            errors["check_out"] = "Check-out must follow check-in."
        if errors:
            raise ValidationError(errors)


class AttendanceAdjustment(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        RETURNED = "RETURNED", "Changes requested"

    class AdjustmentType(models.TextChoices):
        MISSED_CLOCK_IN = "MISSED_CLOCK_IN", "Missed clock-in"
        MISSED_CLOCK_OUT = "MISSED_CLOCK_OUT", "Missed clock-out"
        ADD_MISSED_HOURS = "ADD_MISSED_HOURS", "Add missed hours"
        TIME_CORRECTION = "TIME_CORRECTION", "Time correction"
        NOTE_ONLY = "NOTE_ONLY", "Note correction"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="attendance_adjustments"
    )
    attendance_record = models.ForeignKey(
        AttendanceRecord, on_delete=models.PROTECT, related_name="adjustments"
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="attendance_adjustments_requested",
    )
    reason = models.TextField()
    old_values = models.JSONField(default=dict)
    proposed_values = models.JSONField(default=dict)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.DRAFT
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="attendance_adjustments_decided",
    )
    acted_at = models.DateTimeField(null=True, blank=True)
    adjustment_type = models.CharField(
        max_length=20, choices=AdjustmentType.choices, default=AdjustmentType.TIME_CORRECTION
    )
    evidence = models.ForeignKey(
        "documents.Document",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="attendance_adjustments",
    )
    decision_note = models.TextField(blank=True)
    # Reviewer the adjustment was delegated to (any attendance approver may still decide).
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="attendance_adjustments_assigned",
    )
    changes_requested_at = models.DateTimeField(null=True, blank=True)
    resubmitted_at = models.DateTimeField(null=True, blank=True)

    @property
    def reference(self):
        return f"ADJ-{str(self.pk)[:8].upper()}" if self.pk else ""

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("institution", "status"))]

    def clean(self):
        errors = {}
        if self.attendance_record_id and self.attendance_record.institution_id != self.institution_id:
            errors["attendance_record"] = "Attendance record belongs to another institution."
        if self.evidence_id and self.evidence.institution_id != self.institution_id:
            errors["evidence"] = "Evidence must belong to the same institution."
        for field_name in ("requested_by", "approved_by", "assigned_to"):
            user = getattr(self, field_name, None)
            if user and self.institution_id and not user.memberships.filter(
                institution_id=self.institution_id, status="ACTIVE"
            ).exists():
                errors[field_name] = "User must be an active institution member."
        if errors:
            raise ValidationError(errors)


class OvertimeRecord(TenantOwnedModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="overtime_records"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="overtime_records"
    )
    attendance_record = models.ForeignKey(
        AttendanceRecord, on_delete=models.PROTECT, related_name="overtime_records"
    )
    calculated_minutes = models.PositiveIntegerField(default=0)
    approved_minutes = models.PositiveIntegerField(default=0)
    rate_multiplier = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("1.00")
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="overtime_records_decided",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-attendance_record__attendance_date",)
        constraints = [
            models.UniqueConstraint(
                fields=("attendance_record",), name="uniq_overtime_per_attendance"
            ),
            models.CheckConstraint(
                condition=models.Q(approved_minutes__lte=models.F("calculated_minutes")),
                name="overtime_approved_not_above_calculated",
            ),
            models.CheckConstraint(
                condition=models.Q(rate_multiplier__gt=0),
                name="overtime_rate_multiplier_positive",
            ),
        ]
        indexes = [models.Index(fields=("institution", "status"))]

    def clean(self):
        errors = {}
        if self.employee_id and self.employee.institution_id != self.institution_id:
            errors["employee"] = "Employee must belong to the same institution."
        if self.attendance_record_id:
            if self.attendance_record.institution_id != self.institution_id:
                errors["attendance_record"] = "Attendance record belongs to another institution."
            elif self.employee_id and self.attendance_record.employee_id != self.employee_id:
                errors["attendance_record"] = "Attendance record belongs to another employee."
        if self.approved_by_id and not self.approved_by.memberships.filter(
            institution_id=self.institution_id, status="ACTIVE"
        ).exists():
            errors["approved_by"] = "Approver must be an active institution member."
        if self.approved_minutes > self.calculated_minutes:
            errors["approved_minutes"] = "Approved overtime cannot exceed calculated overtime."
        if errors:
            raise ValidationError(errors)

