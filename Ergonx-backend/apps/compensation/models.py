from datetime import date

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.employees.models import Employee
from apps.institutions.models import Institution
from common.codes import AutoCodeMixin
from common.models import TenantOwnedModel


class PayComponent(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "PCM"
    auto_code_width = 3

    class ComponentType(models.TextChoices):
        EARNING = "EARNING", "Earning"
        DEDUCTION = "DEDUCTION", "Deduction"
        EMPLOYER_CONTRIBUTION = "EMPLOYER_CONTRIBUTION", "Employer contribution"

    class CalculationType(models.TextChoices):
        FIXED = "FIXED", "Fixed"
        PERCENTAGE = "PERCENTAGE", "Percentage"

    class CashOrKind(models.TextChoices):
        CASH = "CASH", "Cash"
        KIND = "KIND", "Benefit in kind"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="pay_components"
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    component_type = models.CharField(max_length=24, choices=ComponentType.choices)
    calculation_type = models.CharField(max_length=12, choices=CalculationType.choices)
    taxable = models.BooleanField(default=False)
    pensionable = models.BooleanField(default=False)
    cash_or_kind = models.CharField(
        max_length=8, choices=CashOrKind.choices, default=CashOrKind.CASH
    )
    recurring = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name", "code")
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_pay_component_code_per_institution",
            )
        ]
        indexes = [
            models.Index(fields=("institution", "component_type", "is_active")),
            models.Index(fields=("institution", "code")),
        ]

    def clean(self):
        self.code = self.code.strip().upper()

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.institution.code}: {self.code}"


class SalaryStructure(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "SAL"
    auto_code_width = 3

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="salary_structures"
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name", "code")
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_salary_structure_code_per_institution",
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


class SalaryStructureComponent(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution,
        on_delete=models.CASCADE,
        related_name="salary_structure_components",
    )
    salary_structure = models.ForeignKey(
        SalaryStructure, on_delete=models.CASCADE, related_name="components"
    )
    pay_component = models.ForeignKey(
        PayComponent, on_delete=models.PROTECT, related_name="structure_components"
    )
    default_amount = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True
    )
    default_percentage = models.DecimalField(
        max_digits=9, decimal_places=4, null=True, blank=True
    )
    percentage_base_component = models.ForeignKey(
        PayComponent,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="percentage_dependent_components",
    )
    sequence = models.PositiveIntegerField(default=1)
    is_required = models.BooleanField(default=True)

    class Meta:
        ordering = ("salary_structure", "sequence", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("salary_structure", "pay_component"),
                name="uniq_component_per_salary_structure",
            ),
            models.CheckConstraint(
                condition=Q(default_amount__isnull=True) | Q(default_amount__gte=0),
                name="structure_component_amount_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(default_percentage__isnull=True)
                | Q(default_percentage__gte=0),
                name="structure_component_percentage_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(default_amount__isnull=True)
                | Q(default_percentage__isnull=True),
                name="structure_component_one_default_value",
            ),
            models.CheckConstraint(
                condition=Q(percentage_base_component__isnull=True)
                | Q(default_percentage__isnull=False),
                name="structure_component_base_requires_percentage",
            ),
        ]
        indexes = [
            models.Index(fields=("institution", "salary_structure")),
            models.Index(fields=("salary_structure", "sequence")),
        ]

    def clean(self):
        errors = {}
        relations = {
            "salary_structure": self.salary_structure if self.salary_structure_id else None,
            "pay_component": self.pay_component if self.pay_component_id else None,
            "percentage_base_component": (
                self.percentage_base_component
                if self.percentage_base_component_id
                else None
            ),
        }
        for field, relation in relations.items():
            if relation and relation.institution_id != self.institution_id:
                errors[field] = "Referenced record must belong to the same institution."
        if self.pay_component_id:
            if self.pay_component.calculation_type == PayComponent.CalculationType.FIXED:
                if self.default_percentage is not None or self.percentage_base_component_id:
                    errors["default_percentage"] = (
                        "A fixed component cannot define a percentage or percentage base."
                    )
            elif self.default_amount is not None:
                errors["default_amount"] = (
                    "A percentage component cannot define a fixed amount."
                )
        if self.default_amount is not None and self.default_amount < 0:
            errors["default_amount"] = "Default amount cannot be negative."
        if self.default_percentage is not None and self.default_percentage < 0:
            errors["default_percentage"] = "Default percentage cannot be negative."
        if (
            self.pay_component_id
            and self.percentage_base_component_id == self.pay_component_id
        ):
            errors["percentage_base_component"] = (
                "A component cannot use itself as its percentage base."
            )
        if errors:
            raise ValidationError(errors)


class EmployeeCompensation(TenantOwnedModel):
    class PayBasis(models.TextChoices):
        PAYROLL_PERIOD = "PAYROLL_PERIOD", "Configured payroll period"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="employee_compensations"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="compensation_history"
    )
    salary_structure = models.ForeignKey(
        SalaryStructure, on_delete=models.PROTECT, related_name="employee_compensations"
    )
    base_salary = models.DecimalField(max_digits=18, decimal_places=2)
    pay_basis = models.CharField(
        max_length=32,
        choices=PayBasis.choices,
        default=PayBasis.PAYROLL_PERIOD,
    )
    currency = models.CharField(max_length=3)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    is_current = models.BooleanField(default=True)

    class Meta:
        ordering = ("-effective_from", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("employee",),
                condition=Q(is_current=True),
                name="uniq_current_compensation_per_employee",
            ),
            models.CheckConstraint(
                condition=Q(base_salary__gte=0),
                name="employee_compensation_salary_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True)
                | Q(effective_to__gte=models.F("effective_from")),
                name="employee_compensation_dates_valid",
            ),
            models.CheckConstraint(
                condition=Q(is_current=False) | Q(effective_to__isnull=True),
                name="current_compensation_has_no_end_date",
            ),
        ]
        indexes = [
            models.Index(fields=("institution", "is_current")),
            models.Index(fields=("employee", "effective_from")),
        ]

    def clean(self):
        self.currency = self.currency.strip().upper()
        errors = {}
        if self.employee_id and self.employee.institution_id != self.institution_id:
            errors["employee"] = "Employee must belong to the same institution."
        if (
            self.salary_structure_id
            and self.salary_structure.institution_id != self.institution_id
        ):
            errors["salary_structure"] = (
                "Salary structure must belong to the same institution."
            )
        if self.base_salary is not None and self.base_salary < 0:
            errors["base_salary"] = "Base salary cannot be negative."
        if len(self.currency) != 3 or not self.currency.isalpha():
            errors["currency"] = "Use a three-letter ISO currency code."
        if self.effective_to and self.effective_to < self.effective_from:
            errors["effective_to"] = "Effective end date cannot precede start date."
        if self.is_current and self.effective_to:
            errors["effective_to"] = "Current compensation cannot have an end date."
        if self.employee_id and self.effective_from:
            overlap = EmployeeCompensation.objects.filter(
                employee_id=self.employee_id,
                effective_from__lte=self.effective_to or date.max,
            ).filter(Q(effective_to__isnull=True) | Q(effective_to__gte=self.effective_from))
            if self.pk:
                overlap = overlap.exclude(pk=self.pk)
            if overlap.exists():
                errors["effective_from"] = (
                    "Compensation periods for an employee cannot overlap."
                )
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.currency = self.currency.strip().upper()
        super().save(*args, **kwargs)


class EmployeePayComponent(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="employee_pay_components"
    )
    employee_compensation = models.ForeignKey(
        EmployeeCompensation, on_delete=models.CASCADE, related_name="component_overrides"
    )
    pay_component = models.ForeignKey(
        PayComponent, on_delete=models.PROTECT, related_name="employee_overrides"
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    percentage = models.DecimalField(
        max_digits=9, decimal_places=4, null=True, blank=True
    )
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("employee_compensation", "pay_component", "-effective_from")
        constraints = [
            models.UniqueConstraint(
                fields=("employee_compensation", "pay_component", "effective_from"),
                name="uniq_employee_component_effective_date",
            ),
            models.CheckConstraint(
                condition=Q(amount__isnull=True) | Q(amount__gte=0),
                name="employee_component_amount_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(percentage__isnull=True) | Q(percentage__gte=0),
                name="employee_component_percentage_nonnegative",
            ),
            models.CheckConstraint(
                condition=(
                    Q(amount__isnull=False, percentage__isnull=True)
                    | Q(amount__isnull=True, percentage__isnull=False)
                ),
                name="employee_component_exactly_one_value",
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True)
                | Q(effective_to__gte=models.F("effective_from")),
                name="employee_component_dates_valid",
            ),
            models.CheckConstraint(
                condition=Q(is_active=False) | Q(effective_to__isnull=True),
                name="active_employee_component_has_no_end",
            ),
        ]
        indexes = [
            models.Index(fields=("institution", "is_active")),
            models.Index(
                fields=("employee_compensation", "pay_component", "effective_from")
            ),
        ]

    def clean(self):
        errors = {}
        if (
            self.employee_compensation_id
            and self.employee_compensation.institution_id != self.institution_id
        ):
            errors["employee_compensation"] = (
                "Employee compensation must belong to the same institution."
            )
        if self.pay_component_id and self.pay_component.institution_id != self.institution_id:
            errors["pay_component"] = "Pay component must belong to the same institution."
        if self.pay_component_id:
            if self.pay_component.calculation_type == PayComponent.CalculationType.FIXED:
                if self.amount is None or self.percentage is not None:
                    errors["amount"] = "A fixed component override requires only an amount."
            elif self.percentage is None or self.amount is not None:
                errors["percentage"] = (
                    "A percentage component override requires only a percentage."
                )
        if self.amount is not None and self.amount < 0:
            errors["amount"] = "Amount cannot be negative."
        if self.percentage is not None and self.percentage < 0:
            errors["percentage"] = "Percentage cannot be negative."
        if self.effective_to and self.effective_to < self.effective_from:
            errors["effective_to"] = "Effective end date cannot precede start date."
        if self.is_active and self.effective_to:
            errors["effective_to"] = "An active override cannot have an end date."
        if self.employee_compensation_id and self.effective_from:
            parent = self.employee_compensation
            if self.effective_from < parent.effective_from:
                errors["effective_from"] = (
                    "Override cannot start before its compensation record."
                )
            if parent.effective_to and (
                self.effective_to is None or self.effective_to > parent.effective_to
            ):
                errors["effective_to"] = (
                    "Override cannot extend beyond its compensation record."
                )
        if self.employee_compensation_id and self.pay_component_id and self.effective_from:
            overlap = EmployeePayComponent.objects.filter(
                employee_compensation_id=self.employee_compensation_id,
                pay_component_id=self.pay_component_id,
                effective_from__lte=self.effective_to or date.max,
            ).filter(Q(effective_to__isnull=True) | Q(effective_to__gte=self.effective_from))
            if self.pk:
                overlap = overlap.exclude(pk=self.pk)
            if overlap.exists():
                errors["effective_from"] = "Component override periods cannot overlap."
        if errors:
            raise ValidationError(errors)
