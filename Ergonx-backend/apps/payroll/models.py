from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.compensation.models import PayComponent
from apps.documents.models import Document
from apps.employees.models import Employee
from apps.institutions.models import Institution
from common.models import BaseModel, TenantOwnedModel


class ValidatedBaseModel(BaseModel):
    def save(self, *args, **kwargs):
        if not kwargs.get("raw", False):
            self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)

    class Meta:
        abstract = True


class PayrollPreset(ValidatedBaseModel):
    code = models.CharField(max_length=80, unique=True)
    country_code = models.CharField(max_length=2)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    is_system_managed = models.BooleanField(default=True)

    class Meta:
        ordering = ("country_code", "name")

    def clean(self):
        self.code = self.code.strip().upper()
        self.country_code = self.country_code.strip().upper()
        if len(self.country_code) != 2 or not self.country_code.isalpha():
            raise ValidationError({"country_code": "Use a two-letter ISO country code."})

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.country_code = self.country_code.strip().upper()
        super().save(*args, **kwargs)


class PayrollPresetVersion(ValidatedBaseModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ACTIVE = "ACTIVE", "Active"
        RETIRED = "RETIRED", "Retired"

    payroll_preset = models.ForeignKey(
        PayrollPreset, on_delete=models.CASCADE, related_name="versions"
    )
    version_code = models.CharField(max_length=80)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    source_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("payroll_preset", "-effective_from")
        constraints = [
            models.UniqueConstraint(
                fields=("payroll_preset", "version_code"),
                name="uniq_payroll_preset_version_code",
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True)
                | Q(effective_to__gte=models.F("effective_from")),
                name="payroll_preset_version_dates_valid",
            ),
        ]

    def clean(self):
        self.version_code = self.version_code.strip().upper()
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValidationError({"effective_to": "End date cannot precede start date."})

    def save(self, *args, **kwargs):
        self.version_code = self.version_code.strip().upper()
        super().save(*args, **kwargs)


class TaxRule(ValidatedBaseModel):
    class Method(models.TextChoices):
        FLAT = "FLAT", "Flat"
        PROGRESSIVE = "PROGRESSIVE", "Progressive"
        SPECIAL = "SPECIAL", "Special"

    class Basis(models.TextChoices):
        BASE_SALARY = "BASE_SALARY", "Base salary"
        GROSS_PAY = "GROSS_PAY", "Gross pay"
        TAXABLE_INCOME = "TAXABLE_INCOME", "Taxable income"

    preset_version = models.ForeignKey(
        PayrollPresetVersion, on_delete=models.CASCADE, related_name="tax_rules"
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    method = models.CharField(max_length=12, choices=Method.choices)
    residency = models.CharField(max_length=40, default="ANY")
    rate = models.DecimalField(max_digits=9, decimal_places=4, null=True, blank=True)
    threshold = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True
    )
    basis = models.CharField(max_length=20, choices=Basis.choices)
    sequence = models.PositiveIntegerField(default=1)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ("preset_version", "sequence", "code")
        constraints = [
            models.UniqueConstraint(
                fields=("preset_version", "code"), name="uniq_tax_rule_code_per_version"
            ),
            models.CheckConstraint(
                condition=Q(rate__isnull=True) | Q(rate__gte=0),
                name="tax_rule_rate_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(threshold__isnull=True) | Q(threshold__gte=0),
                name="tax_rule_threshold_nonnegative",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        self.residency = self.residency.strip().upper()
        errors = {}
        if self.rate is not None and self.rate < 0:
            errors["rate"] = "Rate cannot be negative."
        if self.threshold is not None and self.threshold < 0:
            errors["threshold"] = "Threshold cannot be negative."
        if self.method == self.Method.FLAT and self.rate is None:
            errors["rate"] = "A flat rule requires a rate."
        if self.method == self.Method.PROGRESSIVE and self.rate is not None:
            errors["rate"] = "Progressive rules use tax-band rates."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.residency = self.residency.strip().upper()
        super().save(*args, **kwargs)


class TaxBand(ValidatedBaseModel):
    tax_rule = models.ForeignKey(TaxRule, on_delete=models.CASCADE, related_name="bands")
    sequence = models.PositiveIntegerField()
    lower_bound = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True
    )
    upper_bound = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True
    )
    band_amount = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True
    )
    rate = models.DecimalField(max_digits=9, decimal_places=4)

    class Meta:
        ordering = ("tax_rule", "sequence")
        constraints = [
            models.UniqueConstraint(
                fields=("tax_rule", "sequence"), name="uniq_tax_band_sequence"
            ),
            models.CheckConstraint(condition=Q(rate__gte=0), name="tax_band_rate_nonnegative"),
            models.CheckConstraint(
                condition=Q(lower_bound__isnull=True) | Q(lower_bound__gte=0),
                name="tax_band_lower_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(upper_bound__isnull=True) | Q(upper_bound__gte=0),
                name="tax_band_upper_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(band_amount__isnull=True) | Q(band_amount__gte=0),
                name="tax_band_amount_nonnegative",
            ),
        ]

    def clean(self):
        errors = {}
        for field in ("lower_bound", "upper_bound", "band_amount", "rate"):
            value = getattr(self, field)
            if value is not None and value < 0:
                errors[field] = "Value cannot be negative."
        if self.upper_bound is not None and self.band_amount is not None:
            errors["band_amount"] = "Use either upper_bound or band_amount, not both."
        if (
            self.lower_bound is not None
            and self.upper_bound is not None
            and self.upper_bound <= self.lower_bound
        ):
            errors["upper_bound"] = "Upper bound must exceed lower bound."
        if errors:
            raise ValidationError(errors)


class ContributionRule(ValidatedBaseModel):
    preset_version = models.ForeignKey(
        PayrollPresetVersion, on_delete=models.CASCADE, related_name="contribution_rules"
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    basis = models.CharField(max_length=20, choices=TaxRule.Basis.choices)
    employee_rate = models.DecimalField(max_digits=9, decimal_places=4)
    employer_rate = models.DecimalField(max_digits=9, decimal_places=4)
    minimum_basis = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True
    )
    maximum_basis = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True
    )
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ("preset_version", "code", "effective_from")
        constraints = [
            models.UniqueConstraint(
                fields=("preset_version", "code", "effective_from"),
                name="uniq_contribution_rule_effective_date",
            ),
            models.CheckConstraint(
                condition=Q(employee_rate__gte=0), name="contribution_employee_rate_nonnegative"
            ),
            models.CheckConstraint(
                condition=Q(employer_rate__gte=0), name="contribution_employer_rate_nonnegative"
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True)
                | Q(effective_to__gte=models.F("effective_from")),
                name="contribution_rule_dates_valid",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        errors = {}
        if self.employee_rate < 0:
            errors["employee_rate"] = "Rate cannot be negative."
        if self.employer_rate < 0:
            errors["employer_rate"] = "Rate cannot be negative."
        if self.minimum_basis is not None and self.minimum_basis < 0:
            errors["minimum_basis"] = "Minimum basis cannot be negative."
        if self.maximum_basis is not None and self.maximum_basis < 0:
            errors["maximum_basis"] = "Maximum basis cannot be negative."
        if (
            self.minimum_basis is not None
            and self.maximum_basis is not None
            and self.maximum_basis < self.minimum_basis
        ):
            errors["maximum_basis"] = "Maximum basis cannot be below minimum basis."
        if self.effective_to and self.effective_to < self.effective_from:
            errors["effective_to"] = "End date cannot precede start date."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)


class ContributionAllocation(ValidatedBaseModel):
    contribution_rule = models.ForeignKey(
        ContributionRule, on_delete=models.CASCADE, related_name="allocations"
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    rate = models.DecimalField(max_digits=9, decimal_places=4)
    destination_type = models.CharField(max_length=80)
    destination_reference = models.CharField(max_length=200)

    class Meta:
        ordering = ("contribution_rule", "code")
        constraints = [
            models.UniqueConstraint(
                fields=("contribution_rule", "code"),
                name="uniq_contribution_allocation_code",
            ),
            models.CheckConstraint(
                condition=Q(rate__gte=0), name="contribution_allocation_rate_nonnegative"
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        if self.rate < 0:
            raise ValidationError({"rate": "Rate cannot be negative."})

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)


class SpecialIncomeRule(ValidatedBaseModel):
    preset_version = models.ForeignKey(
        PayrollPresetVersion, on_delete=models.CASCADE, related_name="special_income_rules"
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    income_type = models.CharField(max_length=80)
    eligibility_json = models.JSONField(default=dict, blank=True)
    calculation_json = models.JSONField(default=dict, blank=True)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    requires_validation = models.BooleanField(default=True)

    class Meta:
        ordering = ("preset_version", "code", "effective_from")
        constraints = [
            models.UniqueConstraint(
                fields=("preset_version", "code", "effective_from"),
                name="uniq_special_income_rule_effective_date",
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True)
                | Q(effective_to__gte=models.F("effective_from")),
                name="special_income_rule_dates_valid",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        self.income_type = self.income_type.strip().upper()
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValidationError({"effective_to": "End date cannot precede start date."})

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.income_type = self.income_type.strip().upper()
        super().save(*args, **kwargs)


class TaxReliefDefinition(ValidatedBaseModel):
    preset_version = models.ForeignKey(
        PayrollPresetVersion, on_delete=models.CASCADE, related_name="relief_definitions"
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    calculation_method = models.CharField(max_length=80)
    default_amount = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True
    )
    max_count = models.PositiveIntegerField(null=True, blank=True)
    percentage = models.DecimalField(
        max_digits=9, decimal_places=4, null=True, blank=True
    )
    eligibility_json = models.JSONField(default=dict, blank=True)
    requires_evidence = models.BooleanField(default=False)

    class Meta:
        ordering = ("preset_version", "code")
        constraints = [
            models.UniqueConstraint(
                fields=("preset_version", "code"),
                name="uniq_tax_relief_definition_code",
            ),
            models.CheckConstraint(
                condition=Q(default_amount__isnull=True) | Q(default_amount__gte=0),
                name="tax_relief_default_amount_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(percentage__isnull=True) | Q(percentage__gte=0),
                name="tax_relief_percentage_nonnegative",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        self.calculation_method = self.calculation_method.strip().upper()
        if self.default_amount is not None and self.default_amount < 0:
            raise ValidationError({"default_amount": "Default amount cannot be negative."})
        if self.percentage is not None and self.percentage < 0:
            raise ValidationError({"percentage": "Percentage cannot be negative."})

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.calculation_method = self.calculation_method.strip().upper()
        super().save(*args, **kwargs)


class StatutoryThreshold(ValidatedBaseModel):
    preset_version = models.ForeignKey(
        PayrollPresetVersion, on_delete=models.CASCADE, related_name="statutory_thresholds"
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    unit = models.CharField(max_length=40)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ("preset_version", "code", "effective_from")
        constraints = [
            models.UniqueConstraint(
                fields=("preset_version", "code", "effective_from"),
                name="uniq_statutory_threshold_effective_date",
            ),
            models.CheckConstraint(
                condition=Q(amount__gte=0), name="statutory_threshold_amount_nonnegative"
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True)
                | Q(effective_to__gte=models.F("effective_from")),
                name="statutory_threshold_dates_valid",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        self.unit = self.unit.strip().upper()
        errors = {}
        if self.amount < 0:
            errors["amount"] = "Amount cannot be negative."
        if self.effective_to and self.effective_to < self.effective_from:
            errors["effective_to"] = "End date cannot precede start date."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.unit = self.unit.strip().upper()
        super().save(*args, **kwargs)


class ComplianceDeadline(ValidatedBaseModel):
    preset_version = models.ForeignKey(
        PayrollPresetVersion, on_delete=models.CASCADE, related_name="compliance_deadlines"
    )
    code = models.CharField(max_length=80)
    authority = models.CharField(max_length=150)
    event_type = models.CharField(max_length=80)
    calculation_rule = models.JSONField(default=dict)
    offset_days = models.IntegerField(null=True, blank=True)
    day_of_month = models.PositiveSmallIntegerField(null=True, blank=True)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ("preset_version", "code", "effective_from")
        constraints = [
            models.UniqueConstraint(
                fields=("preset_version", "code", "effective_from"),
                name="uniq_compliance_deadline_effective_date",
            ),
            models.CheckConstraint(
                condition=Q(day_of_month__isnull=True)
                | (Q(day_of_month__gte=1) & Q(day_of_month__lte=31)),
                name="compliance_deadline_day_valid",
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True)
                | Q(effective_to__gte=models.F("effective_from")),
                name="compliance_deadline_dates_valid",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        self.event_type = self.event_type.strip().upper()
        errors = {}
        if self.day_of_month is not None and not 1 <= self.day_of_month <= 31:
            errors["day_of_month"] = "Day of month must be between 1 and 31."
        if self.effective_to and self.effective_to < self.effective_from:
            errors["effective_to"] = "End date cannot precede start date."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.event_type = self.event_type.strip().upper()
        super().save(*args, **kwargs)


class InstitutionPayrollConfiguration(TenantOwnedModel):
    class Frequency(models.TextChoices):
        WEEKLY = "WEEKLY", "Weekly"
        BIWEEKLY = "BIWEEKLY", "Biweekly"
        SEMIMONTHLY = "SEMIMONTHLY", "Semimonthly"
        MONTHLY = "MONTHLY", "Monthly"

    class SetupMode(models.TextChoices):
        PRESET = "PRESET", "Preset"
        CUSTOM = "CUSTOM", "Custom"

    institution = models.OneToOneField(
        Institution, on_delete=models.CASCADE, related_name="payroll_configuration"
    )
    country_code = models.CharField(max_length=2)
    currency = models.CharField(max_length=3)
    payroll_frequency = models.CharField(max_length=16, choices=Frequency.choices)
    payroll_setup_mode = models.CharField(max_length=10, choices=SetupMode.choices)
    selected_payroll_preset_version = models.ForeignKey(
        PayrollPresetVersion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="institution_configurations",
    )
    pay_day_rule = models.JSONField(default=dict, blank=True)
    rounding_rule = models.JSONField(default=dict, blank=True)
    # Income tax and contribution rules the institution defines itself in CUSTOM
    # mode; see apps.payroll.custom_rules. Always empty in PRESET mode.
    custom_rules = models.JSONField(default=dict, blank=True)
    is_configured = models.BooleanField(default=False)
    configured_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="payroll_configurations_completed",
    )
    configured_at = models.DateTimeField()

    class Meta:
        ordering = ("institution",)

    def clean(self):
        self.country_code = self.country_code.strip().upper()
        self.currency = self.currency.strip().upper()
        errors = {}
        if len(self.country_code) != 2 or not self.country_code.isalpha():
            errors["country_code"] = "Use a two-letter ISO country code."
        if len(self.currency) != 3 or not self.currency.isalpha():
            errors["currency"] = "Use a three-letter ISO currency code."
        if self.payroll_setup_mode == self.SetupMode.PRESET:
            if not self.selected_payroll_preset_version_id:
                errors["selected_payroll_preset_version"] = (
                    "Preset mode requires a selected preset version."
                )
            elif (
                self.selected_payroll_preset_version.payroll_preset.country_code
                != self.country_code
            ):
                errors["selected_payroll_preset_version"] = (
                    "Selected preset must match the configured country."
                )
        elif self.selected_payroll_preset_version_id:
            errors["selected_payroll_preset_version"] = (
                "Custom mode cannot select a payroll preset version."
            )
        if self.configured_by_id and not self.configured_by.memberships.filter(
            institution_id=self.institution_id, status="ACTIVE"
        ).exists():
            errors["configured_by"] = "Configurer must be an active institution member."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.country_code = self.country_code.strip().upper()
        self.currency = self.currency.strip().upper()
        super().save(*args, **kwargs)


class EmployeePayrollProfile(TenantOwnedModel):
    class TaxResidency(models.TextChoices):
        RESIDENT = "RESIDENT", "Resident"
        NON_RESIDENT = "NON_RESIDENT", "Non-resident"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="employee_payroll_profiles"
    )
    employee = models.OneToOneField(
        Employee, on_delete=models.PROTECT, related_name="payroll_profile"
    )
    tax_residency = models.CharField(max_length=16, choices=TaxResidency.choices)
    tax_identification_number = models.CharField(max_length=80, blank=True)

    class Meta:
        ordering = ("employee__employee_number",)
        indexes = [models.Index(fields=("institution", "tax_residency"))]

    def clean(self):
        if self.employee_id and self.employee.institution_id != self.institution_id:
            raise ValidationError(
                {"employee": "Employee must belong to the same institution."}
            )


class EmployeeTaxReliefClaim(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="employee_tax_relief_claims"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="tax_relief_claims"
    )
    relief_definition = models.ForeignKey(
        TaxReliefDefinition, on_delete=models.PROTECT, related_name="employee_claims"
    )
    tax_year = models.PositiveSmallIntegerField()
    claimed_amount = models.DecimalField(max_digits=18, decimal_places=2)
    approved_amount = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0")
    )
    evidence = models.ForeignKey(
        Document,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="tax_relief_claims",
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="tax_relief_claims_decided",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-tax_year", "employee", "relief_definition")
        constraints = [
            models.UniqueConstraint(
                fields=("employee", "relief_definition", "tax_year"),
                name="uniq_employee_tax_relief_claim",
            ),
            models.CheckConstraint(
                condition=Q(claimed_amount__gte=0), name="tax_relief_claim_nonnegative"
            ),
            models.CheckConstraint(
                condition=Q(approved_amount__gte=0), name="tax_relief_approved_nonnegative"
            ),
            models.CheckConstraint(
                condition=Q(approved_amount__lte=models.F("claimed_amount")),
                name="tax_relief_approved_not_above_claimed",
            ),
        ]

    def clean(self):
        errors = {}
        if self.employee_id and self.employee.institution_id != self.institution_id:
            errors["employee"] = "Employee must belong to the same institution."
        if self.institution_id and self.relief_definition_id:
            configuration = getattr(self.institution, "payroll_configuration", None)
            if (
                configuration is None
                or configuration.payroll_setup_mode
                != InstitutionPayrollConfiguration.SetupMode.PRESET
                or configuration.selected_payroll_preset_version_id
                != self.relief_definition.preset_version_id
            ):
                errors["relief_definition"] = (
                    "Relief must belong to the institution's selected payroll preset version."
                )
        if self.evidence_id and self.evidence.institution_id != self.institution_id:
            errors["evidence"] = "Evidence must belong to the same institution."
        if self.approved_by_id and not self.approved_by.memberships.filter(
            institution_id=self.institution_id, status="ACTIVE"
        ).exists():
            errors["approved_by"] = "Approver must be an active institution member."
        if self.claimed_amount < 0:
            errors["claimed_amount"] = "Claimed amount cannot be negative."
        if self.approved_amount < 0 or self.approved_amount > self.claimed_amount:
            errors["approved_amount"] = "Approved amount must be within the claimed amount."
        if self.relief_definition.requires_evidence and not self.evidence_id:
            errors["evidence"] = "This relief requires evidence."
        if errors:
            raise ValidationError(errors)


class PayrollPeriod(TenantOwnedModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        PROCESSING = "PROCESSING", "Processing"
        CLOSED = "CLOSED", "Closed"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="payroll_periods"
    )
    name = models.CharField(max_length=150)
    start_date = models.DateField()
    end_date = models.DateField()
    pay_date = models.DateField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OPEN)

    class Meta:
        ordering = ("-start_date",)
        constraints = [
            models.CheckConstraint(
                condition=Q(end_date__gte=models.F("start_date")),
                name="payroll_period_dates_valid",
            ),
            models.UniqueConstraint(
                fields=("institution", "start_date", "end_date"),
                name="uniq_payroll_period_dates_per_institution",
            ),
        ]
        indexes = [models.Index(fields=("institution", "status", "start_date"))]

    def clean(self):
        errors = {}
        if self.end_date < self.start_date:
            errors["end_date"] = "End date cannot precede start date."
        if self.status in {self.Status.OPEN, self.Status.PROCESSING}:
            overlap = PayrollPeriod.objects.filter(
                institution_id=self.institution_id,
                status__in=(self.Status.OPEN, self.Status.PROCESSING),
                start_date__lte=self.end_date,
                end_date__gte=self.start_date,
            )
            if self.pk:
                overlap = overlap.exclude(pk=self.pk)
            if overlap.exists():
                errors["start_date"] = "Active payroll periods cannot overlap."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.pk:
            previous = PayrollPeriod.objects.filter(pk=self.pk).first()
            if previous and previous.status == self.Status.CLOSED:
                raise ValidationError({"status": "A closed payroll period is immutable."})
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status == self.Status.CLOSED:
            raise ValidationError({"status": "A closed payroll period cannot be deleted."})
        return super().delete(*args, **kwargs)


class PayrollRun(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        CALCULATING = "CALCULATING", "Calculating"
        CALCULATED = "CALCULATED", "Calculated"
        UNDER_REVIEW = "UNDER_REVIEW", "Under review"
        APPROVED = "APPROVED", "Approved"
        FINALIZED = "FINALIZED", "Finalized"
        CANCELLED = "CANCELLED", "Cancelled"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="payroll_runs"
    )
    payroll_period = models.ForeignKey(
        PayrollPeriod, on_delete=models.PROTECT, related_name="runs"
    )
    preset_version = models.ForeignKey(
        PayrollPresetVersion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payroll_runs",
    )
    run_number = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="payroll_runs_started"
    )
    started_at = models.DateTimeField()
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payroll_runs_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    finalized_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payroll_runs_finalized",
    )
    finalized_at = models.DateTimeField(null=True, blank=True)
    statutory_snapshot = models.JSONField(default=dict, blank=True)
    idempotency_key = models.CharField(max_length=100, null=True, blank=True)
    accounting_journal_entry = models.ForeignKey("accounting.JournalEntry", on_delete=models.PROTECT, null=True, blank=True, related_name="payroll_runs")

    class Meta:
        ordering = ("-payroll_period__start_date", "-run_number")
        constraints = [
            models.UniqueConstraint(
                fields=("payroll_period", "run_number"),
                name="uniq_payroll_run_number_per_period",
            ),
            models.UniqueConstraint(
                fields=("institution", "idempotency_key"),
                condition=Q(idempotency_key__isnull=False),
                name="uniq_payroll_run_idempotency_key",
            ),
            models.CheckConstraint(
                condition=Q(run_number__gt=0), name="payroll_run_number_positive"
            ),
        ]
        indexes = [models.Index(fields=("institution", "status", "started_at"))]

    def clean(self):
        errors = {}
        if self.payroll_period_id and self.payroll_period.institution_id != self.institution_id:
            errors["payroll_period"] = "Payroll period belongs to another institution."
        for field in ("started_by", "approved_by", "finalized_by"):
            user = getattr(self, field, None)
            if user and not user.memberships.filter(
                institution_id=self.institution_id, status="ACTIVE"
            ).exists():
                errors[field] = "User must be an active institution member."
        if self.preset_version_id and self.payroll_period_id:
            if self.payroll_period.end_date < self.preset_version.effective_from or (
                self.preset_version.effective_to
                and self.payroll_period.end_date > self.preset_version.effective_to
            ):
                errors["preset_version"] = "Preset version is not effective for this period."
        if self.accounting_journal_entry_id and self.accounting_journal_entry.institution_id != self.institution_id:
            errors["accounting_journal_entry"] = "Accounting journal belongs to another institution."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.pk:
            previous = PayrollRun.objects.filter(pk=self.pk).first()
            if previous and previous.status == self.Status.FINALIZED:
                raise ValidationError({"status": "A finalized payroll run is immutable."})
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status == self.Status.FINALIZED:
            raise ValidationError({"status": "A finalized payroll run cannot be deleted."})
        return super().delete(*args, **kwargs)


class PayrollRecord(TenantOwnedModel):
    class Status(models.TextChoices):
        CALCULATED = "CALCULATED", "Calculated"
        FINALIZED = "FINALIZED", "Finalized"
        ERROR = "ERROR", "Error"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="payroll_records"
    )
    payroll_run = models.ForeignKey(
        PayrollRun, on_delete=models.CASCADE, related_name="records"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="payroll_records"
    )
    gross_pay = models.DecimalField(max_digits=18, decimal_places=2)
    taxable_income = models.DecimalField(max_digits=18, decimal_places=2)
    total_deductions = models.DecimalField(max_digits=18, decimal_places=2)
    employee_contributions = models.DecimalField(max_digits=18, decimal_places=2)
    employer_contributions = models.DecimalField(max_digits=18, decimal_places=2)
    net_pay = models.DecimalField(max_digits=18, decimal_places=2)
    currency = models.CharField(max_length=3)
    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.CALCULATED
    )

    class Meta:
        ordering = ("employee__employee_number",)
        constraints = [
            models.UniqueConstraint(
                fields=("payroll_run", "employee"),
                name="uniq_employee_record_per_payroll_run",
            )
        ]
        indexes = [models.Index(fields=("institution", "status"))]

    def clean(self):
        self.currency = self.currency.strip().upper()
        errors = {}
        if self.payroll_run_id and self.payroll_run.institution_id != self.institution_id:
            errors["payroll_run"] = "Payroll run belongs to another institution."
        if self.employee_id and self.employee.institution_id != self.institution_id:
            errors["employee"] = "Employee belongs to another institution."
        if len(self.currency) != 3 or not self.currency.isalpha():
            errors["currency"] = "Use a three-letter ISO currency code."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.pk and self.payroll_run.status == PayrollRun.Status.FINALIZED:
            raise ValidationError({"payroll_run": "Finalized payroll records are immutable."})
        self.currency = self.currency.strip().upper()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.payroll_run.status == PayrollRun.Status.FINALIZED:
            raise ValidationError({"payroll_run": "Finalized payroll records cannot be deleted."})
        return super().delete(*args, **kwargs)


class PayrollItem(ValidatedBaseModel):
    class Source(models.TextChoices):
        COMPENSATION = "COMPENSATION", "Compensation"
        ATTENDANCE = "ATTENDANCE", "Attendance"
        LEAVE = "LEAVE", "Leave"
        STATUTORY = "STATUTORY", "Statutory"
        ADJUSTMENT = "ADJUSTMENT", "Adjustment"
        MANUAL = "MANUAL", "Manual"

    payroll_record = models.ForeignKey(
        PayrollRecord, on_delete=models.CASCADE, related_name="items"
    )
    pay_component = models.ForeignKey(
        PayComponent,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payroll_items",
    )
    component_code_snapshot = models.CharField(max_length=80)
    component_name_snapshot = models.CharField(max_length=150)
    source = models.CharField(max_length=16, choices=Source.choices)
    quantity = models.DecimalField(
        max_digits=18, decimal_places=4, null=True, blank=True
    )
    rate = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("payroll_record", "created_at")
        indexes = [
            models.Index(fields=("payroll_record", "source")),
            models.Index(fields=("component_code_snapshot",)),
        ]

    def clean(self):
        self.component_code_snapshot = self.component_code_snapshot.strip().upper()
        if self.pay_component_id and (
            self.pay_component.institution_id != self.payroll_record.institution_id
        ):
            raise ValidationError(
                {"pay_component": "Pay component belongs to another institution."}
            )

    def save(self, *args, **kwargs):
        if self.payroll_record.payroll_run.status == PayrollRun.Status.FINALIZED:
            raise ValidationError({"payroll_record": "Finalized payroll items are immutable."})
        self.component_code_snapshot = self.component_code_snapshot.strip().upper()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.payroll_record.payroll_run.status == PayrollRun.Status.FINALIZED:
            raise ValidationError({"payroll_record": "Finalized payroll items cannot be deleted."})
        return super().delete(*args, **kwargs)


class PayrollAdjustment(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        APPLIED = "APPLIED", "Applied"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="payroll_adjustments"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="payroll_adjustments"
    )
    payroll_period = models.ForeignKey(
        PayrollPeriod, on_delete=models.PROTECT, related_name="adjustments"
    )
    pay_component = models.ForeignKey(
        PayComponent, on_delete=models.PROTECT, related_name="payroll_adjustments"
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    reason = models.TextField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="payroll_adjustments_created",
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payroll_adjustments_decided",
    )
    applied_run = models.ForeignKey(
        PayrollRun,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="applied_adjustments",
    )

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=~Q(amount=0), name="payroll_adjustment_amount_nonzero"
            )
        ]
        indexes = [models.Index(fields=("institution", "status", "payroll_period"))]

    def clean(self):
        errors = {}
        relations = {
            "employee": self.employee if self.employee_id else None,
            "payroll_period": self.payroll_period if self.payroll_period_id else None,
            "pay_component": self.pay_component if self.pay_component_id else None,
            "applied_run": self.applied_run if self.applied_run_id else None,
        }
        for field, relation in relations.items():
            if relation and relation.institution_id != self.institution_id:
                errors[field] = "Referenced record belongs to another institution."
        for field in ("created_by", "approved_by"):
            user = getattr(self, field, None)
            if user and not user.memberships.filter(
                institution_id=self.institution_id, status="ACTIVE"
            ).exists():
                errors[field] = "User must be an active institution member."
        if self.amount == 0:
            errors["amount"] = "Adjustment amount cannot be zero."
        if self.applied_run_id and self.payroll_period_id:
            if self.applied_run.payroll_period_id != self.payroll_period_id:
                errors["applied_run"] = "Applied run must belong to the selected period."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.pk:
            previous = PayrollAdjustment.objects.filter(pk=self.pk).first()
            if previous and previous.status == self.Status.APPLIED:
                raise ValidationError({"status": "An applied adjustment is immutable."})
        super().save(*args, **kwargs)


class Payslip(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="payslips"
    )
    payroll_record = models.OneToOneField(
        PayrollRecord, on_delete=models.PROTECT, related_name="payslip"
    )
    generated_at = models.DateTimeField()
    document_reference = models.ForeignKey(
        Document,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payslips",
    )
    checksum = models.CharField(max_length=128, blank=True)

    class Meta:
        ordering = ("-generated_at",)
        indexes = [models.Index(fields=("institution", "generated_at"))]

    def clean(self):
        errors = {}
        if self.payroll_record_id and self.payroll_record.institution_id != self.institution_id:
            errors["payroll_record"] = "Payroll record belongs to another institution."
        if self.payroll_record_id and (
            self.payroll_record.payroll_run.status != PayrollRun.Status.FINALIZED
        ):
            errors["payroll_record"] = "Payslips require a finalized payroll run."
        if self.document_reference_id and (
            self.document_reference.institution_id != self.institution_id
        ):
            errors["document_reference"] = "Document belongs to another institution."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.pk:
            previous = Payslip.objects.filter(pk=self.pk).first()
            if previous:
                immutable_values_changed = any(
                    (
                        self.institution_id != previous.institution_id,
                        self.payroll_record_id != previous.payroll_record_id,
                        self.generated_at != previous.generated_at,
                        self.checksum != previous.checksum,
                    )
                )
                attaching_first_document = (
                    previous.document_reference_id is None
                    and self.document_reference_id is not None
                )
                if immutable_values_changed or not attaching_first_document:
                    raise ValidationError(
                        {"payroll_record": "Generated payslips are immutable."}
                    )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError({"payroll_record": "Generated payslips cannot be deleted."})


class PayrollRunException(TenantOwnedModel):
    """An issue detected on a calculated run that must be handled before review."""

    class Code(models.TextChoices):
        CALCULATION_ERROR = "CALCULATION_ERROR", "Calculation error"
        NON_POSITIVE_NET_PAY = "NON_POSITIVE_NET_PAY", "Non-positive net pay"
        RECONCILIATION_DISCREPANCY = "RECONCILIATION_DISCREPANCY", "Reconciliation discrepancy"
        LARGE_NET_PAY_CHANGE = "LARGE_NET_PAY_CHANGE", "Large net pay change"
        NOT_IN_RUN = "NOT_IN_RUN", "Active employee not in run"
        MISSING_PAYROLL_PROFILE = "MISSING_PAYROLL_PROFILE", "Payroll profile not configured"

    class Severity(models.TextChoices):
        HIGH = "HIGH", "High"
        MEDIUM = "MEDIUM", "Medium"
        LOW = "LOW", "Low"

    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        ACKNOWLEDGED = "ACKNOWLEDGED", "Acknowledged"
        RESOLVED = "RESOLVED", "Resolved"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="payroll_run_exceptions")
    payroll_run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, related_name="exceptions")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, null=True, blank=True, related_name="payroll_run_exceptions")
    code = models.CharField(max_length=32, choices=Code.choices)
    severity = models.CharField(max_length=8, choices=Severity.choices)
    message = models.CharField(max_length=300)
    details = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=14, choices=Status.choices, default=Status.OPEN)
    resolution_note = models.TextField(blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="payroll_exceptions_resolved"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("payroll_run", "status", "severity", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("payroll_run", "code", "employee"), name="uniq_payroll_exception_per_run_code_employee"
            ),
        ]
        indexes = [models.Index(fields=("institution", "payroll_run", "status"))]

    def clean(self):
        errors = {}
        if self.payroll_run_id and self.payroll_run.institution_id != self.institution_id:
            errors["payroll_run"] = "Payroll run belongs to another institution."
        if self.employee_id and self.employee.institution_id != self.institution_id:
            errors["employee"] = "Employee belongs to another institution."
        if errors:
            raise ValidationError(errors)
