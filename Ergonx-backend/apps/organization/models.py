from django.core.exceptions import ValidationError
from django.db import models

from apps.institutions.models import Institution
from common.codes import AutoCodeMixin
from common.models import TenantOwnedModel


class Department(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "DPT"
    auto_code_width = 3

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="departments"
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    description = models.TextField(blank=True)
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="children",
    )
    head = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="headed_departments",
        help_text="Department Head: approves team leave and sees this department's people.",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_department_code_per_institution",
            )
        ]
        indexes = [models.Index(fields=("institution", "is_active"))]

    def clean(self):
        self.code = self.code.strip().upper()
        if self.parent_id and self.parent.institution_id != self.institution_id:
            raise ValidationError({"parent": "Parent department must be in the same institution."})
        if self.parent_id and self.parent_id == self.id:
            raise ValidationError({"parent": "A department cannot be its own parent."})
        if self.head_id and self.head.institution_id != self.institution_id:
            raise ValidationError({"head": "Department head must be an employee of the same institution."})

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.institution.code}: {self.name}"


class Position(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "POS"
    auto_code_width = 3

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="positions"
    )
    department = models.ForeignKey(
        Department, on_delete=models.PROTECT, related_name="positions"
    )
    title = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("title",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_position_code_per_institution",
            )
        ]
        indexes = [
            models.Index(fields=("institution", "department")),
            models.Index(fields=("institution", "is_active")),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        if self.department_id and self.department.institution_id != self.institution_id:
            raise ValidationError({"department": "Department must be in the same institution."})

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.institution.code}: {self.title}"


class Grade(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "GRD"
    auto_code_width = 2

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="grades"
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    level = models.PositiveIntegerField(null=True, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("level", "name")
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_grade_code_per_institution",
            )
        ]
        indexes = [models.Index(fields=("institution", "is_active"))]

    def clean(self):
        self.code = self.code.strip().upper()

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.institution.code}: {self.name}"


class Location(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "LOC"
    auto_code_width = 3

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="locations"
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=2, blank=True)
    timezone = models.CharField(max_length=64, blank=True)
    is_remote = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_location_code_per_institution",
            )
        ]
        indexes = [models.Index(fields=("institution", "is_active"))]

    def clean(self):
        self.code = self.code.strip().upper()
        self.country = self.country.strip().upper()

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.country = self.country.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.institution.code}: {self.name}"
