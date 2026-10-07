from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.documents.models import Document
from apps.employees.models import Employee, Employment
from apps.institutions.models import Institution
from apps.organization.models import Department, Grade, Location
from common.codes import AutoCodeMixin
from common.models import TenantOwnedModel


class LeaveType(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "LVT"
    auto_code_width = 3

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="leave_types"
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    description = models.TextField(blank=True)
    is_paid = models.BooleanField(default=True)
    requires_approval = models.BooleanField(default=True)
    requires_attachment = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_leave_type_code_per_institution",
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


class LeavePolicy(TenantOwnedModel):
    class AccrualMethod(models.TextChoices):
        NONE = "NONE", "None"
        ANNUAL = "ANNUAL", "Annual"
        MONTHLY = "MONTHLY", "Monthly"
        DAILY = "DAILY", "Daily"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="leave_policies"
    )
    leave_type = models.ForeignKey(
        LeaveType, on_delete=models.PROTECT, related_name="policies"
    )
    name = models.CharField(max_length=150)
    annual_entitlement = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal("0")
    )
    accrual_method = models.CharField(
        max_length=10, choices=AccrualMethod.choices, default=AccrualMethod.NONE
    )
    accrual_rate = models.DecimalField(
        max_digits=8, decimal_places=4, default=Decimal("0")
    )
    max_carry_forward = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal("0")
    )
    min_service_days = models.PositiveIntegerField(default=0)
    max_consecutive_days = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True
    )
    allow_negative_balance = models.BooleanField(default=False)
    requires_document = models.BooleanField(default=False)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    eligible_departments = models.ManyToManyField(
        Department,
        through="LeavePolicyDepartmentEligibility",
        related_name="eligible_leave_policies",
        blank=True,
    )
    eligible_grades = models.ManyToManyField(
        Grade,
        through="LeavePolicyGradeEligibility",
        related_name="eligible_leave_policies",
        blank=True,
    )
    eligible_locations = models.ManyToManyField(
        Location,
        through="LeavePolicyLocationEligibility",
        related_name="eligible_leave_policies",
        blank=True,
    )

    class Meta:
        ordering = ("leave_type", "-effective_from", "name")
        indexes = [
            models.Index(fields=("institution", "is_active")),
            models.Index(fields=("institution", "leave_type", "effective_from")),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(effective_to__isnull=True)
                | models.Q(effective_to__gte=models.F("effective_from")),
                name="leave_policy_effective_dates_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(annual_entitlement__gte=0),
                name="leave_policy_entitlement_nonnegative",
            ),
            models.CheckConstraint(
                condition=models.Q(accrual_rate__gte=0),
                name="leave_policy_accrual_nonnegative",
            ),
        ]

    def clean(self):
        errors = {}
        if self.leave_type_id and self.leave_type.institution_id != self.institution_id:
            errors["leave_type"] = "Leave type must belong to the same institution."
        if self.effective_to and self.effective_to < self.effective_from:
            errors["effective_to"] = "Effective end date cannot precede start date."
        if errors:
            raise ValidationError(errors)

    def applies_to(self, employee, employment, on_date):
        if employee.institution_id != self.institution_id:
            return False
        if employment is None or employment.institution_id != self.institution_id:
            return False
        if on_date < self.effective_from or (
            self.effective_to and on_date > self.effective_to
        ):
            return False
        if (on_date - employee.hire_date).days < self.min_service_days:
            return False

        dimension_checks = (
            (self.department_eligibilities, "department_id", employment.department_id),
            (self.grade_eligibilities, "grade_id", employment.grade_id),
            (self.location_eligibilities, "location_id", employment.location_id),
            (
                self.employment_type_eligibilities,
                "employment_type",
                employment.employment_type,
            ),
            (self.gender_eligibilities, "gender", employee.gender),
        )
        for relation, field_name, value in dimension_checks:
            if relation.exists() and not relation.filter(**{field_name: value}).exists():
                return False
        return True

    def __str__(self):
        return f"{self.leave_type.code}: {self.name}"


class PolicyEligibilityBase(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution,
        on_delete=models.CASCADE,
        related_name="%(app_label)s_%(class)s_records",
    )
    policy = models.ForeignKey(LeavePolicy, on_delete=models.CASCADE)

    class Meta:
        abstract = True

    def clean(self):
        if self.policy_id and self.policy.institution_id != self.institution_id:
            raise ValidationError(
                {"policy": "Policy must belong to the same institution."}
            )


class LeavePolicyDepartmentEligibility(PolicyEligibilityBase):
    policy = models.ForeignKey(
        LeavePolicy, on_delete=models.CASCADE, related_name="department_eligibilities"
    )
    department = models.ForeignKey(Department, on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("policy", "department"),
                name="uniq_leave_policy_department",
            )
        ]

    def clean(self):
        super().clean()
        if self.department_id and self.department.institution_id != self.institution_id:
            raise ValidationError(
                {"department": "Department must belong to the same institution."}
            )


class LeavePolicyGradeEligibility(PolicyEligibilityBase):
    policy = models.ForeignKey(
        LeavePolicy, on_delete=models.CASCADE, related_name="grade_eligibilities"
    )
    grade = models.ForeignKey(Grade, on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("policy", "grade"), name="uniq_leave_policy_grade"
            )
        ]

    def clean(self):
        super().clean()
        if self.grade_id and self.grade.institution_id != self.institution_id:
            raise ValidationError(
                {"grade": "Grade must belong to the same institution."}
            )


class LeavePolicyLocationEligibility(PolicyEligibilityBase):
    policy = models.ForeignKey(
        LeavePolicy, on_delete=models.CASCADE, related_name="location_eligibilities"
    )
    location = models.ForeignKey(Location, on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("policy", "location"), name="uniq_leave_policy_location"
            )
        ]

    def clean(self):
        super().clean()
        if self.location_id and self.location.institution_id != self.institution_id:
            raise ValidationError(
                {"location": "Location must belong to the same institution."}
            )


class LeavePolicyEmploymentTypeEligibility(PolicyEligibilityBase):
    policy = models.ForeignKey(
        LeavePolicy,
        on_delete=models.CASCADE,
        related_name="employment_type_eligibilities",
    )
    employment_type = models.CharField(
        max_length=12, choices=Employment.EmploymentType.choices
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("policy", "employment_type"),
                name="uniq_leave_policy_employment_type",
            )
        ]


class LeavePolicyGenderEligibility(PolicyEligibilityBase):
    policy = models.ForeignKey(
        LeavePolicy, on_delete=models.CASCADE, related_name="gender_eligibilities"
    )
    gender = models.CharField(max_length=20, choices=Employee.Gender.choices)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("policy", "gender"), name="uniq_leave_policy_gender"
            )
        ]


class LeaveBalance(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="leave_balances"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="leave_balances"
    )
    leave_type = models.ForeignKey(
        LeaveType, on_delete=models.PROTECT, related_name="balances"
    )
    year = models.PositiveSmallIntegerField()
    opening_balance = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal("0")
    )
    accrued = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal("0")
    )
    used = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0"))
    adjusted = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal("0")
    )

    class Meta:
        ordering = ("-year", "employee", "leave_type")
        constraints = [
            models.UniqueConstraint(
                fields=("employee", "leave_type", "year"),
                name="uniq_employee_leave_balance_year",
            ),
            models.CheckConstraint(
                condition=models.Q(opening_balance__gte=0),
                name="leave_opening_balance_nonnegative",
            ),
            models.CheckConstraint(
                condition=models.Q(accrued__gte=0),
                name="leave_accrued_nonnegative",
            ),
            models.CheckConstraint(
                condition=models.Q(used__gte=0), name="leave_used_nonnegative"
            ),
        ]
        indexes = [models.Index(fields=("institution", "employee", "year"))]

    def clean(self):
        errors = {}
        if self.employee_id and self.employee.institution_id != self.institution_id:
            errors["employee"] = "Employee must belong to the same institution."
        if self.leave_type_id and self.leave_type.institution_id != self.institution_id:
            errors["leave_type"] = "Leave type must belong to the same institution."
        if errors:
            raise ValidationError(errors)

    @property
    def available(self):
        return self.opening_balance + self.accrued + self.adjusted - self.used


class LeaveRequest(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        CANCELLED = "CANCELLED", "Cancelled"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="leave_requests"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="leave_requests"
    )
    leave_type = models.ForeignKey(
        LeaveType, on_delete=models.PROTECT, related_name="requests"
    )
    start_date = models.DateField()
    end_date = models.DateField()
    requested_days = models.DecimalField(max_digits=8, decimal_places=2)
    reason = models.TextField(blank=True)
    attachment = models.ForeignKey(
        Document,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="leave_requests",
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.DRAFT
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    # Set when a reviewer returns the request to the employee for changes.
    changes_requested_at = models.DateTimeField(null=True, blank=True)
    changes_requested_note = models.TextField(blank=True)

    @property
    def reference(self):
        """Stable human reference; matches the universal search format (LR-XXXXXXXX)."""
        return f"LR-{str(self.pk)[:8].upper()}" if self.pk else ""

    class Meta:
        ordering = ("-start_date", "-created_at")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")),
                name="leave_request_dates_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(requested_days__gt=0),
                name="leave_requested_days_positive",
            ),
        ]
        indexes = [
            models.Index(fields=("institution", "status")),
            models.Index(fields=("institution", "employee", "start_date")),
        ]

    def clean(self):
        errors = {}
        if self.employee_id and self.employee.institution_id != self.institution_id:
            errors["employee"] = "Employee must belong to the same institution."
        if self.leave_type_id and self.leave_type.institution_id != self.institution_id:
            errors["leave_type"] = "Leave type must belong to the same institution."
        if self.attachment_id and self.attachment.institution_id != self.institution_id:
            errors["attachment"] = "Attachment must belong to the same institution."
        if self.end_date and self.start_date and self.end_date < self.start_date:
            errors["end_date"] = "End date cannot precede start date."
        if self.start_date and self.end_date and self.start_date.year != self.end_date.year:
            errors["end_date"] = (
                "Cross-year leave must be submitted as separate annual requests."
            )
        if self.requested_days is not None and self.requested_days <= 0:
            errors["requested_days"] = "Requested days must be positive."
        if (
            self.employee_id
            and self.start_date
            and self.end_date
            and self.status in {self.Status.PENDING, self.Status.APPROVED}
        ):
            overlap = LeaveRequest.objects.filter(
                employee_id=self.employee_id,
                status__in=(self.Status.PENDING, self.Status.APPROVED),
                start_date__lte=self.end_date,
                end_date__gte=self.start_date,
            )
            if self.pk:
                overlap = overlap.exclude(pk=self.pk)
            if overlap.exists():
                errors["start_date"] = "This request overlaps existing pending or approved leave."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.employee} / {self.leave_type.code} / {self.start_date}"


class LeaveApproval(TenantOwnedModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        SKIPPED = "SKIPPED", "Skipped"
        RETURNED = "RETURNED", "Changes requested"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="leave_approvals"
    )
    leave_request = models.ForeignKey(
        LeaveRequest, on_delete=models.CASCADE, related_name="approvals"
    )
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="leave_approvals",
    )
    sequence = models.PositiveSmallIntegerField()
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    comment = models.TextField(blank=True)
    acted_at = models.DateTimeField(null=True, blank=True)
    delegated_from = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="delegated_leave_approvals",
    )

    class Meta:
        ordering = ("leave_request", "sequence")
        constraints = [
            models.UniqueConstraint(
                fields=("leave_request", "sequence"),
                name="uniq_leave_approval_sequence",
            )
        ]
        indexes = [models.Index(fields=("institution", "approver", "status"))]

    def clean(self):
        errors = {}
        if (
            self.leave_request_id
            and self.leave_request.institution_id != self.institution_id
        ):
            errors["leave_request"] = "Request must belong to the same institution."
        if self.approver_id and self.institution_id:
            if not self.approver.memberships.filter(
                institution_id=self.institution_id, status="ACTIVE"
            ).exists():
                errors["approver"] = "Approver must be an active institution member."
        if errors:
            raise ValidationError(errors)


class LeaveRequestComment(TenantOwnedModel):
    """Discussion on a leave request between the employee and reviewers."""

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="leave_request_comments"
    )
    leave_request = models.ForeignKey(
        LeaveRequest, on_delete=models.CASCADE, related_name="comments"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="leave_request_comments",
    )
    body = models.TextField(max_length=2000)

    class Meta:
        ordering = ("leave_request", "created_at")
        indexes = [models.Index(fields=("institution", "leave_request", "created_at"))]

    def clean(self):
        if not (self.body or "").strip():
            raise ValidationError({"body": "Comment cannot be empty."})
        if self.leave_request_id and self.leave_request.institution_id != self.institution_id:
            raise ValidationError({"leave_request": "Request must belong to the same institution."})
