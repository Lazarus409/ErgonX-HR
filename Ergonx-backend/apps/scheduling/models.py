from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.employees.models import Employee
from apps.institutions.models import Institution
from common.codes import AutoCodeMixin
from common.models import TenantOwnedModel


class Shift(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "SHF"
    auto_code_width = 3

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="shifts"
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    crosses_midnight = models.BooleanField(default=False)
    break_minutes = models.PositiveIntegerField(default=0)
    grace_period_minutes = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"), name="uniq_shift_code_per_institution"
            )
        ]
        indexes = [models.Index(fields=("institution", "is_active"))]

    def clean(self):
        self.code = self.code.strip().upper()
        errors = {}
        if self.start_time and self.end_time:
            inferred_overnight = self.end_time <= self.start_time
            if inferred_overnight != self.crosses_midnight:
                errors["crosses_midnight"] = (
                    "Crosses-midnight must match the relationship between start and end time."
                )
            start = datetime.combine(timezone.now().date(), self.start_time)
            end = datetime.combine(timezone.now().date(), self.end_time)
            if self.crosses_midnight:
                end += timedelta(days=1)
            if self.break_minutes >= int((end - start).total_seconds() // 60):
                errors["break_minutes"] = "Break must be shorter than the shift."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    @property
    def scheduled_minutes(self):
        start = datetime.combine(timezone.now().date(), self.start_time)
        end = datetime.combine(timezone.now().date(), self.end_time)
        if self.crosses_midnight:
            end += timedelta(days=1)
        return max(0, int((end - start).total_seconds() // 60) - self.break_minutes)

    def __str__(self):
        return f"{self.institution.code}: {self.name}"


class ShiftPattern(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "SPT"
    auto_code_width = 3

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="shift_patterns"
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    cycle_length_days = models.PositiveSmallIntegerField()
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_shift_pattern_code_per_institution",
            ),
            models.CheckConstraint(
                condition=models.Q(cycle_length_days__gt=0),
                name="shift_pattern_cycle_positive",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)


class ShiftPatternDay(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="shift_pattern_days"
    )
    shift_pattern = models.ForeignKey(
        ShiftPattern, on_delete=models.CASCADE, related_name="days"
    )
    day_index = models.PositiveSmallIntegerField()
    shift = models.ForeignKey(
        Shift, on_delete=models.PROTECT, null=True, blank=True, related_name="pattern_days"
    )
    is_off_day = models.BooleanField(default=False)

    class Meta:
        ordering = ("shift_pattern", "day_index")
        constraints = [
            models.UniqueConstraint(
                fields=("shift_pattern", "day_index"),
                name="uniq_shift_pattern_day_index",
            ),
            models.CheckConstraint(
                condition=(models.Q(is_off_day=True, shift__isnull=True))
                | (models.Q(is_off_day=False, shift__isnull=False)),
                name="shift_pattern_day_configuration_valid",
            ),
        ]

    def clean(self):
        errors = {}
        if self.shift_pattern_id and self.shift_pattern.institution_id != self.institution_id:
            errors["shift_pattern"] = "Pattern must belong to the same institution."
        if self.shift_id and self.shift.institution_id != self.institution_id:
            errors["shift"] = "Shift must belong to the same institution."
        if self.shift_pattern_id and self.day_index >= self.shift_pattern.cycle_length_days:
            errors["day_index"] = "Day index must be within the pattern cycle."
        if self.is_off_day == bool(self.shift_id):
            errors["shift"] = "Off days must have no shift; working days require one."
        if errors:
            raise ValidationError(errors)


class RotationPattern(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "ROT"
    auto_code_width = 3

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="rotation_patterns"
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_rotation_pattern_code_per_institution",
            )
        ]

    def clean(self):
        self.code = self.code.strip().upper()

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)


class RotationStep(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="rotation_steps"
    )
    rotation_pattern = models.ForeignKey(
        RotationPattern, on_delete=models.CASCADE, related_name="steps"
    )
    sequence = models.PositiveSmallIntegerField()
    shift_pattern = models.ForeignKey(
        ShiftPattern,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="rotation_steps",
    )
    shift = models.ForeignKey(
        Shift,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="rotation_steps",
    )
    duration_days = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ("rotation_pattern", "sequence")
        constraints = [
            models.UniqueConstraint(
                fields=("rotation_pattern", "sequence"),
                name="uniq_rotation_step_sequence",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(shift_pattern__isnull=False, shift__isnull=True)
                    | models.Q(shift_pattern__isnull=True, shift__isnull=False)
                ),
                name="rotation_step_exactly_one_source",
            ),
            models.CheckConstraint(
                condition=models.Q(duration_days__gt=0),
                name="rotation_step_duration_positive",
            ),
        ]

    def clean(self):
        errors = {}
        relations = {
            "rotation_pattern": self.rotation_pattern if self.rotation_pattern_id else None,
            "shift_pattern": self.shift_pattern if self.shift_pattern_id else None,
            "shift": self.shift if self.shift_id else None,
        }
        for field, relation in relations.items():
            if relation and relation.institution_id != self.institution_id:
                errors[field] = "Referenced schedule record must belong to the same institution."
        if bool(self.shift_pattern_id) == bool(self.shift_id):
            errors["shift"] = "Exactly one of shift_pattern or shift is required."
        if errors:
            raise ValidationError(errors)


class FlexibleWorkRule(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="flexible_work_rules"
    )
    name = models.CharField(max_length=150)
    earliest_start = models.TimeField()
    latest_start = models.TimeField()
    earliest_end = models.TimeField()
    latest_end = models.TimeField()
    required_minutes = models.PositiveIntegerField()
    core_start = models.TimeField(null=True, blank=True)
    core_end = models.TimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.CheckConstraint(
                condition=models.Q(required_minutes__gt=0),
                name="flexible_required_minutes_positive",
            )
        ]

    def clean(self):
        errors = {}
        if self.earliest_start and self.latest_start and self.latest_start < self.earliest_start:
            errors["latest_start"] = "Latest start cannot precede earliest start."
        if self.earliest_end and self.latest_end and self.latest_end < self.earliest_end:
            errors["latest_end"] = "Latest end cannot precede earliest end."
        if bool(self.core_start) != bool(self.core_end):
            errors["core_end"] = "Core start and end must be provided together."
        if self.core_start and self.core_end and self.core_end <= self.core_start:
            errors["core_end"] = "Core end must follow core start."
        if errors:
            raise ValidationError(errors)


class WorkSchedule(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "SCH"
    auto_code_width = 3

    class ScheduleType(models.TextChoices):
        FIXED = "FIXED", "Fixed"
        SHIFT_PATTERN = "SHIFT_PATTERN", "Shift pattern"
        ROTATING = "ROTATING", "Rotating"
        FLEXIBLE = "FLEXIBLE", "Flexible"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="work_schedules"
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    schedule_type = models.CharField(max_length=16, choices=ScheduleType.choices)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    timezone = models.CharField(max_length=64, default="Africa/Accra")
    is_active = models.BooleanField(default=True)
    fixed_shift = models.ForeignKey(
        Shift,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="fixed_schedules",
    )
    shift_pattern = models.ForeignKey(
        ShiftPattern,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="work_schedules",
    )
    rotation_pattern = models.ForeignKey(
        RotationPattern,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="work_schedules",
    )
    flexible_rule = models.ForeignKey(
        FlexibleWorkRule,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="work_schedules",
    )

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_work_schedule_code_per_institution",
            ),
            models.CheckConstraint(
                condition=models.Q(effective_to__isnull=True)
                | models.Q(effective_to__gte=models.F("effective_from")),
                name="work_schedule_effective_dates_valid",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        schedule_type="FIXED",
                        fixed_shift__isnull=False,
                        shift_pattern__isnull=True,
                        rotation_pattern__isnull=True,
                        flexible_rule__isnull=True,
                    )
                    | models.Q(
                        schedule_type="SHIFT_PATTERN",
                        fixed_shift__isnull=True,
                        shift_pattern__isnull=False,
                        rotation_pattern__isnull=True,
                        flexible_rule__isnull=True,
                    )
                    | models.Q(
                        schedule_type="ROTATING",
                        fixed_shift__isnull=True,
                        shift_pattern__isnull=True,
                        rotation_pattern__isnull=False,
                        flexible_rule__isnull=True,
                    )
                    | models.Q(
                        schedule_type="FLEXIBLE",
                        fixed_shift__isnull=True,
                        shift_pattern__isnull=True,
                        rotation_pattern__isnull=True,
                        flexible_rule__isnull=False,
                    )
                ),
                name="work_schedule_configuration_valid",
            ),
        ]
        indexes = [models.Index(fields=("institution", "is_active"))]

    def clean(self):
        self.code = self.code.strip().upper()
        errors = {}
        references = {
            self.ScheduleType.FIXED: ("fixed_shift", self.fixed_shift_id),
            self.ScheduleType.SHIFT_PATTERN: ("shift_pattern", self.shift_pattern_id),
            self.ScheduleType.ROTATING: ("rotation_pattern", self.rotation_pattern_id),
            self.ScheduleType.FLEXIBLE: ("flexible_rule", self.flexible_rule_id),
        }
        selected = [name for name, value in references.values() if value]
        expected = references.get(self.schedule_type)
        if expected is None or selected != [expected[0]]:
            errors["schedule_type"] = "Exactly the matching schedule configuration is required."
        for field_name in ("fixed_shift", "shift_pattern", "rotation_pattern", "flexible_rule"):
            relation = getattr(self, field_name, None)
            if relation and relation.institution_id != self.institution_id:
                errors[field_name] = "Configuration must belong to the same institution."
        if self.effective_to and self.effective_to < self.effective_from:
            errors["effective_to"] = "Effective end date cannot precede start date."
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError:
            errors["timezone"] = "Unknown IANA timezone."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)


class ScheduleAssignment(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="schedule_assignments"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="schedule_assignments"
    )
    work_schedule = models.ForeignKey(
        WorkSchedule, on_delete=models.PROTECT, related_name="assignments"
    )
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    is_current = models.BooleanField(default=True)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="schedule_assignments_created",
    )

    class Meta:
        ordering = ("-effective_from", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("employee",),
                condition=models.Q(is_current=True),
                name="uniq_current_schedule_per_employee",
            ),
            models.CheckConstraint(
                condition=models.Q(effective_to__isnull=True)
                | models.Q(effective_to__gte=models.F("effective_from")),
                name="schedule_assignment_dates_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(is_current=False) | models.Q(effective_to__isnull=True),
                name="current_schedule_has_no_end_date",
            ),
        ]
        indexes = [
            models.Index(fields=("institution", "is_current")),
            models.Index(fields=("employee", "effective_from")),
        ]

    def clean(self):
        errors = {}
        if self.employee_id and self.employee.institution_id != self.institution_id:
            errors["employee"] = "Employee must belong to the same institution."
        if self.work_schedule_id and self.work_schedule.institution_id != self.institution_id:
            errors["work_schedule"] = "Schedule must belong to the same institution."
        if self.assigned_by_id and self.institution_id:
            if not self.assigned_by.memberships.filter(
                institution_id=self.institution_id, status="ACTIVE"
            ).exists():
                errors["assigned_by"] = "Assigning user must be an active institution member."
        if self.effective_to and self.effective_to < self.effective_from:
            errors["effective_to"] = "Effective end date cannot precede start date."
        if self.is_current and self.effective_to:
            errors["effective_to"] = "A current assignment cannot have an end date."
        if errors:
            raise ValidationError(errors)

