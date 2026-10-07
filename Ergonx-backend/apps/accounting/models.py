from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.db import models

from apps.employees.models import Employee
from apps.compensation.models import PayComponent
from apps.documents.models import Document
from apps.institutions.models import Institution
from apps.organization.models import Department, Location
from common.codes import AutoCodeMixin
from common.models import BaseModel, TenantOwnedModel


class AccountingPreset(BaseModel):
    code = models.CharField(max_length=80, unique=True)
    country_code = models.CharField(max_length=2)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    institution_type = models.CharField(max_length=40)
    is_system_managed = models.BooleanField(default=True)

    class Meta:
        ordering = ("country_code", "code")

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.country_code = self.country_code.strip().upper()
        super().save(*args, **kwargs)


class AccountingPresetVersion(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ACTIVE = "ACTIVE", "Active"
        RETIRED = "RETIRED", "Retired"

    accounting_preset = models.ForeignKey(
        AccountingPreset, on_delete=models.CASCADE, related_name="versions"
    )
    version_code = models.CharField(max_length=80)
    localization_version = models.CharField(max_length=80, blank=True)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    reporting_framework = models.CharField(max_length=80)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    source_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("accounting_preset", "-effective_from")
        constraints = [
            models.UniqueConstraint(
                fields=("accounting_preset", "version_code"),
                name="uniq_accounting_preset_version",
            )
        ]

    def clean(self):
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValidationError({"effective_to": "Effective end cannot precede start."})


class GhanaLocalizationVersion(BaseModel):
    """Versioned, global Ghana statutory configuration provenance."""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ACTIVE = "ACTIVE", "Active"
        RETIRED = "RETIRED", "Retired"

    code = models.CharField(max_length=80, unique=True)
    version = models.CharField(max_length=40)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    default_currency = models.CharField(max_length=3)
    tax_authority = models.CharField(max_length=150)
    source_metadata = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)

    class Meta:
        ordering = ("-effective_from", "code")
        constraints = [
            models.UniqueConstraint(
                fields=("version", "effective_from"),
                name="uniq_ghana_localization_version_effective_date",
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True) | Q(effective_to__gte=models.F("effective_from")),
                name="ghana_localization_dates_valid",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        self.version = self.version.strip()
        self.default_currency = self.default_currency.strip().upper()
        errors = {}
        if len(self.default_currency) != 3 or not self.default_currency.isalpha():
            errors["default_currency"] = "Use a three-letter ISO currency code."
        if self.effective_to and self.effective_to < self.effective_from:
            errors["effective_to"] = "Effective end cannot precede start."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)


class PayrollAccountMappingTemplate(BaseModel):
    accounting_preset_version = models.ForeignKey(AccountingPresetVersion, on_delete=models.CASCADE, related_name="payroll_account_mapping_templates")
    payroll_component_code = models.CharField(max_length=50)
    debit_account_mapping_code = models.CharField(max_length=80, null=True, blank=True)
    credit_account_mapping_code = models.CharField(max_length=80, null=True, blank=True)
    description = models.TextField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=("accounting_preset_version", "payroll_component_code"), name="uniq_payroll_mapping_template_component")]

    def clean(self):
        self.payroll_component_code = self.payroll_component_code.strip().upper()
        if not self.debit_account_mapping_code and not self.credit_account_mapping_code:
            raise ValidationError("At least one debit or credit mapping is required.")


class TaxCode(BaseModel):
    preset_version = models.ForeignKey(
        AccountingPresetVersion, on_delete=models.CASCADE, related_name="tax_codes"
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    tax_treatment = models.CharField(max_length=40)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("preset_version", "code", "effective_from")
        constraints = [
            models.UniqueConstraint(
                fields=("preset_version", "code", "effective_from"),
                name="uniq_tax_code_effective_date",
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True) | Q(effective_to__gte=models.F("effective_from")),
                name="tax_code_dates_valid",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        self.tax_treatment = self.tax_treatment.strip().upper()
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValidationError({"effective_to": "Effective end cannot precede start."})

    def save(self, *args, **kwargs):
        self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)


class TaxComponent(BaseModel):
    tax_code = models.ForeignKey(TaxCode, on_delete=models.CASCADE, related_name="components")
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    rate = models.DecimalField(max_digits=7, decimal_places=4)
    input_account_mapping_code = models.CharField(max_length=100, null=True, blank=True)
    output_account_mapping_code = models.CharField(max_length=100, null=True, blank=True)
    sequence = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ("tax_code", "sequence", "code")
        constraints = [
            models.UniqueConstraint(
                fields=("tax_code", "code"), name="uniq_tax_component_code_per_tax_code"
            ),
            models.UniqueConstraint(
                fields=("tax_code", "sequence"), name="uniq_tax_component_sequence_per_tax_code"
            ),
            models.CheckConstraint(
                condition=Q(rate__gte=0) & Q(rate__lte=100),
                name="tax_component_rate_percent_valid",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        self.input_account_mapping_code = (
            self.input_account_mapping_code.strip().upper()
            if self.input_account_mapping_code
            else None
        )
        self.output_account_mapping_code = (
            self.output_account_mapping_code.strip().upper()
            if self.output_account_mapping_code
            else None
        )
        if self.rate is not None and not 0 <= self.rate <= 100:
            raise ValidationError({"rate": "Rate must be between 0 and 100 percent."})

    def save(self, *args, **kwargs):
        self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)


class WithholdingRule(BaseModel):
    preset_version = models.ForeignKey(
        AccountingPresetVersion, on_delete=models.CASCADE, related_name="withholding_rules"
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    residency = models.CharField(max_length=30)
    transaction_category = models.CharField(max_length=80)
    rate = models.DecimalField(max_digits=7, decimal_places=4)
    threshold = models.DecimalField(max_digits=20, decimal_places=2, null=True, blank=True)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    is_vat_withholding_rule = models.BooleanField(default=False)
    requires_confirmation = models.BooleanField(default=False)

    class Meta:
        ordering = ("preset_version", "code", "effective_from")
        constraints = [
            models.UniqueConstraint(
                fields=("preset_version", "code", "effective_from"),
                name="uniq_withholding_rule_effective_date",
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True) | Q(effective_to__gte=models.F("effective_from")),
                name="withholding_rule_dates_valid",
            ),
            models.CheckConstraint(
                condition=Q(rate__gte=0) & Q(rate__lte=100),
                name="withholding_rule_rate_percent_valid",
            ),
            models.CheckConstraint(
                condition=Q(threshold__isnull=True) | Q(threshold__gte=0),
                name="withholding_rule_threshold_valid",
            ),
        ]

    def clean(self):
        self.code = self.code.strip().upper()
        self.residency = self.residency.strip().upper()
        self.transaction_category = self.transaction_category.strip().upper()
        errors = {}
        if self.rate is not None and not 0 <= self.rate <= 100:
            errors["rate"] = "Rate must be between 0 and 100 percent."
        if self.threshold is not None and self.threshold < 0:
            errors["threshold"] = "Threshold cannot be negative."
        if self.effective_to and self.effective_to < self.effective_from:
            errors["effective_to"] = "Effective end cannot precede start."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)


class InstitutionAccountingConfiguration(TenantOwnedModel):
    class SetupMode(models.TextChoices):
        PRESET = "PRESET", "Preset"
        CUSTOM = "CUSTOM", "Custom"

    institution = models.OneToOneField(
        Institution, on_delete=models.CASCADE, related_name="accounting_configuration"
    )
    country_code = models.CharField(max_length=2)
    base_currency = models.CharField(max_length=3)
    accounting_setup_mode = models.CharField(max_length=10, choices=SetupMode.choices)
    selected_accounting_preset_version = models.ForeignKey(
        AccountingPresetVersion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="institution_configurations",
    )
    reporting_framework = models.CharField(max_length=80)
    tax_identification_number = models.CharField(max_length=80, blank=True)
    vat_registered = models.BooleanField(default=False)
    is_vat_withholding_agent = models.BooleanField(default=False)
    statutory_profile_metadata = models.JSONField(default=dict, blank=True)
    fiscal_year_start_month = models.PositiveSmallIntegerField(default=1)
    is_configured = models.BooleanField(default=False)
    configured_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="accounting_configurations_set",
    )
    configured_at = models.DateTimeField()

    def clean(self):
        self.country_code = self.country_code.strip().upper()
        self.base_currency = self.base_currency.strip().upper()
        errors = {}
        if len(self.country_code) != 2 or not self.country_code.isalpha():
            errors["country_code"] = "Use a two-letter ISO country code."
        if len(self.base_currency) != 3 or not self.base_currency.isalpha():
            errors["base_currency"] = "Use a three-letter ISO currency code."
        if not 1 <= self.fiscal_year_start_month <= 12:
            errors["fiscal_year_start_month"] = "Use a month from 1 through 12."
        version = self.selected_accounting_preset_version
        if self.accounting_setup_mode == self.SetupMode.PRESET:
            if version is None:
                errors["selected_accounting_preset_version"] = "Preset mode requires a version."
            elif version.status != AccountingPresetVersion.Status.ACTIVE:
                errors["selected_accounting_preset_version"] = "Selected version must be active."
            elif version.accounting_preset.country_code != self.country_code:
                errors["selected_accounting_preset_version"] = (
                    "Selected preset must match the configured country."
                )
        elif version is not None:
            errors["selected_accounting_preset_version"] = (
                "Custom mode cannot select an accounting preset version."
            )
        if self.configured_by_id and not self.configured_by.memberships.filter(
            institution_id=self.institution_id, status="ACTIVE"
        ).exists():
            errors["configured_by"] = "Configurer must be an active institution member."
        if errors:
            raise ValidationError(errors)


class Account(TenantOwnedModel):
    class AccountType(models.TextChoices):
        ASSET = "ASSET", "Asset"
        LIABILITY = "LIABILITY", "Liability"
        EQUITY = "EQUITY", "Equity"
        INCOME = "INCOME", "Income"
        EXPENSE = "EXPENSE", "Expense"

    class NormalBalance(models.TextChoices):
        DEBIT = "DEBIT", "Debit"
        CREDIT = "CREDIT", "Credit"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="accounts"
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=150)
    account_type = models.CharField(max_length=12, choices=AccountType.choices)
    parent = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="children"
    )
    normal_balance = models.CharField(max_length=6, choices=NormalBalance.choices)
    is_postable = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    # Durable provenance (BQ-09 / ERD-005): which system role this account plays
    # (CASH, TRADE_PAYABLES, EMPLOYEE_PAYABLE, ...). Set from the applied preset
    # and overridable by the institution; account codes can change freely.
    system_mapping_code = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        ordering = ("code",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"), name="uniq_account_code_per_institution"
            ),
            models.UniqueConstraint(
                fields=("institution", "system_mapping_code"),
                condition=models.Q(system_mapping_code__isnull=False),
                name="uniq_account_mapping_per_institution",
            ),
        ]
        indexes = [models.Index(fields=("institution", "account_type", "is_active"))]

    def clean(self):
        errors = {}
        if self.parent_id:
            if self.parent_id == self.id:
                errors["parent"] = "An account cannot be its own parent."
            elif self.parent.institution_id != self.institution_id:
                errors["parent"] = "Parent account belongs to another institution."
            else:
                ancestor = self.parent
                while ancestor is not None:
                    if ancestor.id == self.id:
                        errors["parent"] = "Account hierarchy cannot contain a cycle."
                        break
                    ancestor = ancestor.parent
        mapping = (self.system_mapping_code or "").strip().upper()
        if mapping and Account.objects.filter(institution_id=self.institution_id, system_mapping_code=mapping).exclude(pk=self.pk).exists():
            errors["system_mapping_code"] = f"Another account is already mapped to {mapping}."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.system_mapping_code = (self.system_mapping_code or "").strip().upper() or None
        super().save(*args, **kwargs)


class ChartOfAccountsTemplate(BaseModel):
    preset_version = models.ForeignKey(
        AccountingPresetVersion,
        on_delete=models.CASCADE,
        related_name="coa_templates",
    )
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ("preset_version", "name")
        constraints = [
            models.UniqueConstraint(
                fields=("preset_version", "name"),
                name="uniq_coa_template_name_per_version",
            )
        ]


class AccountTemplate(BaseModel):
    coa_template = models.ForeignKey(
        ChartOfAccountsTemplate,
        on_delete=models.CASCADE,
        related_name="account_templates",
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=150)
    account_type = models.CharField(max_length=12, choices=Account.AccountType.choices)
    parent_template = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="child_templates",
    )
    normal_balance = models.CharField(
        max_length=6, choices=Account.NormalBalance.choices
    )
    is_postable = models.BooleanField(default=True)
    system_mapping_code = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        ordering = ("coa_template", "code")
        constraints = [
            models.UniqueConstraint(
                fields=("coa_template", "code"),
                name="uniq_account_template_code",
            ),
            models.UniqueConstraint(
                fields=("coa_template", "system_mapping_code"),
                condition=models.Q(system_mapping_code__isnull=False),
                name="uniq_account_template_mapping_code",
            ),
        ]

    def clean(self):
        errors = {}
        if self.parent_template_id:
            if self.parent_template_id == self.id:
                errors["parent_template"] = "An account template cannot be its own parent."
            elif self.parent_template.coa_template_id != self.coa_template_id:
                errors["parent_template"] = (
                    "Parent account template belongs to another chart template."
                )
            else:
                ancestor = self.parent_template
                while ancestor is not None:
                    if ancestor.id == self.id:
                        errors["parent_template"] = (
                            "Account template hierarchy cannot contain a cycle."
                        )
                        break
                    ancestor = ancestor.parent_template
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.system_mapping_code = (
            self.system_mapping_code.strip().upper()
            if self.system_mapping_code
            else None
        )
        self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)


class PayComponentAccountMapping(TenantOwnedModel):
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="pay_component_account_mappings")
    pay_component = models.ForeignKey(PayComponent, on_delete=models.PROTECT, related_name="account_mappings")
    debit_account = models.ForeignKey(Account, on_delete=models.PROTECT, null=True, blank=True, related_name="payroll_debit_mappings")
    credit_account = models.ForeignKey(Account, on_delete=models.PROTECT, null=True, blank=True, related_name="payroll_credit_mappings")
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("institution", "pay_component", "effective_from"), name="uniq_pay_component_mapping_effective_date")]

    def clean(self):
        errors = {}
        if self.effective_to and self.effective_to < self.effective_from: errors["effective_to"] = "Effective end cannot precede start."
        for field in ("pay_component", "debit_account", "credit_account"):
            record = getattr(self, field, None)
            if record and record.institution_id != self.institution_id: errors[field] = "Referenced record belongs to another institution."
        if not self.debit_account_id and not self.credit_account_id: errors["debit_account"] = "At least one debit or credit account is required."
        if errors: raise ValidationError(errors)


class FiscalYear(TenantOwnedModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        CLOSED = "CLOSED", "Closed"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="fiscal_years"
    )
    name = models.CharField(max_length=100)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=6, choices=Status.choices, default=Status.OPEN)

    class Meta:
        ordering = ("-start_date",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "name"), name="uniq_fiscal_year_name_per_institution"
            ),
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")),
                name="fiscal_year_dates_valid",
            ),
        ]

    def clean(self):
        errors = {}
        if self.end_date < self.start_date:
            errors["end_date"] = "End date cannot precede start date."
        overlap = FiscalYear.objects.filter(
            institution_id=self.institution_id,
            start_date__lte=self.end_date,
            end_date__gte=self.start_date,
        )
        if self.pk:
            overlap = overlap.exclude(pk=self.pk)
        if overlap.exists():
            errors["start_date"] = "Fiscal years cannot overlap."
        if errors:
            raise ValidationError(errors)


class AccountingPeriod(TenantOwnedModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        CLOSED = "CLOSED", "Closed"
        LOCKED = "LOCKED", "Locked"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="accounting_periods"
    )
    fiscal_year = models.ForeignKey(
        FiscalYear, on_delete=models.PROTECT, related_name="periods"
    )
    name = models.CharField(max_length=100)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=6, choices=Status.choices, default=Status.OPEN)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="accounting_periods_closed",
    )
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-start_date",)
        constraints = [
            models.UniqueConstraint(
                fields=("fiscal_year", "start_date", "end_date"),
                name="uniq_accounting_period_dates",
            ),
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")),
                name="accounting_period_dates_valid",
            ),
        ]
        indexes = [models.Index(fields=("institution", "status", "start_date"))]

    def clean(self):
        errors = {}
        if self.fiscal_year_id and self.fiscal_year.institution_id != self.institution_id:
            errors["fiscal_year"] = "Fiscal year belongs to another institution."
        elif (
            self.fiscal_year_id
            and self.fiscal_year.status == FiscalYear.Status.CLOSED
            and self.status == self.Status.OPEN
        ):
            errors["fiscal_year"] = "Open periods cannot belong to a closed fiscal year."
        if self.end_date < self.start_date:
            errors["end_date"] = "End date cannot precede start date."
        if self.fiscal_year_id and (
            self.start_date < self.fiscal_year.start_date
            or self.end_date > self.fiscal_year.end_date
        ):
            errors["start_date"] = "Period must fall within its fiscal year."
        overlap = AccountingPeriod.objects.filter(
            fiscal_year_id=self.fiscal_year_id,
            start_date__lte=self.end_date,
            end_date__gte=self.start_date,
        )
        if self.pk:
            overlap = overlap.exclude(pk=self.pk)
        if overlap.exists():
            errors["start_date"] = "Accounting periods cannot overlap."
        if self.closed_by_id and not self.closed_by.memberships.filter(
            institution_id=self.institution_id, status="ACTIVE"
        ).exists():
            errors["closed_by"] = "Closer must be an active institution member."
        if errors:
            raise ValidationError(errors)


class JournalEntry(TenantOwnedModel):
    class Source(models.TextChoices):
        MANUAL = "MANUAL", "Manual"
        PAYROLL = "PAYROLL", "Payroll"
        AP = "AP", "Accounts payable"
        AR = "AR", "Accounts receivable"
        EXPENSE = "EXPENSE", "Expense"
        CASH = "CASH", "Cash"
        SYSTEM = "SYSTEM", "System"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING_APPROVAL = "PENDING_APPROVAL", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        POSTED = "POSTED", "Posted"
        REVERSED = "REVERSED", "Reversed"
        VOID = "VOID", "Void"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="journal_entries"
    )
    journal_number = models.CharField(max_length=50)
    accounting_period = models.ForeignKey(
        AccountingPeriod, on_delete=models.PROTECT, related_name="journal_entries"
    )
    entry_date = models.DateField()
    description = models.TextField()
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    reference = models.CharField(max_length=100, null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="journals_created"
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="journals_approved",
    )
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="journals_posted",
    )
    posted_at = models.DateTimeField(null=True, blank=True)
    reversal_of = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="reversals"
    )

    class Meta:
        ordering = ("-entry_date", "-journal_number")
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "journal_number"),
                name="uniq_journal_number_per_institution",
            ),
            models.UniqueConstraint(
                fields=("reversal_of",),
                condition=models.Q(reversal_of__isnull=False),
                name="uniq_reversal_per_journal",
            ),
        ]
        indexes = [models.Index(fields=("institution", "status", "entry_date"))]

    def clean(self):
        errors = {}
        if self.accounting_period_id:
            if self.accounting_period.institution_id != self.institution_id:
                errors["accounting_period"] = "Period belongs to another institution."
            elif not (
                self.accounting_period.start_date
                <= self.entry_date
                <= self.accounting_period.end_date
            ):
                errors["entry_date"] = "Entry date must fall within the accounting period."
        if self.reversal_of_id and self.reversal_of.institution_id != self.institution_id:
            errors["reversal_of"] = "Reversed journal belongs to another institution."
        for field in ("created_by", "approved_by", "posted_by"):
            user = getattr(self, field, None)
            if user and not user.memberships.filter(
                institution_id=self.institution_id, status="ACTIVE"
            ).exists():
                errors[field] = "User must be an active institution member."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.pk and JournalEntry.objects.filter(
            pk=self.pk, status__in=(self.Status.POSTED, self.Status.REVERSED)
        ).exists():
            raise ValidationError({"status": "Posted journals are immutable."})
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status in (self.Status.POSTED, self.Status.REVERSED):
            raise ValidationError({"status": "Posted journals cannot be deleted."})
        return super().delete(*args, **kwargs)


class JournalLine(BaseModel):
    journal_entry = models.ForeignKey(
        JournalEntry, on_delete=models.CASCADE, related_name="lines"
    )
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="journal_lines")
    description = models.TextField(blank=True)
    debit = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    credit = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    department = models.ForeignKey(
        Department, on_delete=models.PROTECT, null=True, blank=True, related_name="journal_lines"
    )
    location = models.ForeignKey(
        Location, on_delete=models.PROTECT, null=True, blank=True, related_name="journal_lines"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, null=True, blank=True, related_name="journal_lines"
    )
    cost_centre = models.CharField(max_length=100, null=True, blank=True)
    project = models.CharField(max_length=100, null=True, blank=True)
    fund = models.CharField(max_length=100, null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("created_at",)
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(debit__gt=0, credit=0)
                    | models.Q(credit__gt=0, debit=0)
                ),
                name="journal_line_exactly_one_side_positive",
            )
        ]
        indexes = [models.Index(fields=("account", "created_at"))]

    @property
    def institution_id(self):
        return self.journal_entry.institution_id

    def clean(self):
        errors = {}
        if (self.debit > 0) == (self.credit > 0):
            errors["debit"] = "Exactly one of debit or credit must be positive."
        if self.debit < 0 or self.credit < 0:
            errors["debit"] = "Debit and credit cannot be negative."
        institution_id = self.journal_entry.institution_id
        relations = {
            "account": self.account if self.account_id else None,
            "department": self.department if self.department_id else None,
            "location": self.location if self.location_id else None,
            "employee": self.employee if self.employee_id else None,
        }
        for field, relation in relations.items():
            if relation and relation.institution_id != institution_id:
                errors[field] = "Referenced record belongs to another institution."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.journal_entry.status in (
            JournalEntry.Status.POSTED,
            JournalEntry.Status.REVERSED,
        ):
            raise ValidationError({"journal_entry": "Posted journal lines are immutable."})
        self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.journal_entry.status in (
            JournalEntry.Status.POSTED,
            JournalEntry.Status.REVERSED,
        ):
            raise ValidationError({"journal_entry": "Posted journal lines are immutable."})
        return super().delete(*args, **kwargs)


class Vendor(AutoCodeMixin, TenantOwnedModel):
    auto_code_field = "vendor_code"
    auto_code_prefix = "VEN"
    auto_code_width = 4

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="vendors"
    )
    name = models.CharField(max_length=150)
    vendor_code = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    address = models.TextField(blank=True)
    country_code = models.CharField(max_length=2, blank=True)
    tax_identification_number = models.CharField(max_length=80, blank=True)
    tax_residency = models.CharField(max_length=30, blank=True)
    taxpayer_type = models.CharField(max_length=50, blank=True)
    vat_registered = models.BooleanField(default=False)
    withholding_category = models.CharField(max_length=80, blank=True)
    statutory_profile_metadata = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("vendor_code",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "vendor_code"),
                name="uniq_vendor_code_per_institution",
            )
        ]
        indexes = [models.Index(fields=("institution", "is_active", "name"))]

    def clean(self):
        self.vendor_code = self.vendor_code.strip().upper()
        self.country_code = self.country_code.strip().upper()
        self.tax_residency = self.tax_residency.strip().upper()
        self.taxpayer_type = self.taxpayer_type.strip().upper()
        self.withholding_category = self.withholding_category.strip().upper()
        if self.country_code and (len(self.country_code) != 2 or not self.country_code.isalpha()):
            raise ValidationError({"country_code": "Use a two-letter ISO country code."})


class VendorBill(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        POSTED = "POSTED", "Posted"
        PART_PAID = "PART_PAID", "Part paid"
        PAID = "PAID", "Paid"
        VOID = "VOID", "Void"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="vendor_bills"
    )
    vendor = models.ForeignKey(Vendor, on_delete=models.PROTECT, related_name="bills")
    bill_number = models.CharField(max_length=80)
    bill_date = models.DateField()
    due_date = models.DateField()
    currency = models.CharField(max_length=3)
    subtotal = models.DecimalField(max_digits=20, decimal_places=2, default=Decimal("0"))
    tax_total = models.DecimalField(max_digits=20, decimal_places=2, default=Decimal("0"))
    withholding_total = models.DecimalField(
        max_digits=20, decimal_places=2, default=Decimal("0")
    )
    total_amount = models.DecimalField(
        max_digits=20, decimal_places=2, default=Decimal("0")
    )
    amount_payable = models.DecimalField(
        max_digits=20, decimal_places=2, default=Decimal("0")
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    accounting_period = models.ForeignKey(
        AccountingPeriod, on_delete=models.PROTECT, related_name="vendor_bills"
    )
    journal_entry = models.ForeignKey(
        JournalEntry,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="vendor_bills",
    )
    # Approval trail, rejection, hold and payment scheduling (concept "Accounts payable").
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="vendor_bills_submitted")
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="vendor_bills_approved")
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="vendor_bills_rejected")
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    on_hold = models.BooleanField(default=False)
    hold_reason = models.TextField(blank=True)
    scheduled_payment_date = models.DateField(null=True, blank=True)
    scheduled_payment_method = models.CharField(max_length=16, blank=True)

    class Meta:
        ordering = ("-bill_date", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "vendor", "bill_number"),
                name="uniq_vendor_bill_number_per_vendor",
            ),
            models.CheckConstraint(
                condition=Q(due_date__gte=models.F("bill_date")),
                name="vendor_bill_due_date_valid",
            ),
            models.CheckConstraint(
                condition=(
                    Q(subtotal__gte=0)
                    & Q(tax_total__gte=0)
                    & Q(withholding_total__gte=0)
                    & Q(total_amount__gte=0)
                    & Q(amount_payable__gte=0)
                ),
                name="vendor_bill_amounts_non_negative",
            ),
        ]
        indexes = [models.Index(fields=("institution", "status", "bill_date"))]

    def clean(self):
        self.bill_number = self.bill_number.strip().upper()
        self.currency = self.currency.strip().upper()
        errors = {}
        if len(self.currency) != 3 or not self.currency.isalpha():
            errors["currency"] = "Use a three-letter ISO currency code."
        if self.due_date < self.bill_date:
            errors["due_date"] = "Due date cannot precede bill date."
        if self.vendor_id and self.vendor.institution_id != self.institution_id:
            errors["vendor"] = "Vendor belongs to another institution."
        if self.accounting_period_id:
            if self.accounting_period.institution_id != self.institution_id:
                errors["accounting_period"] = "Period belongs to another institution."
            elif not (
                self.accounting_period.start_date
                <= self.bill_date
                <= self.accounting_period.end_date
            ):
                errors["bill_date"] = "Bill date must fall within the accounting period."
        if self.journal_entry_id:
            if self.journal_entry.institution_id != self.institution_id:
                errors["journal_entry"] = "Journal belongs to another institution."
            elif self.journal_entry.source != JournalEntry.Source.AP:
                errors["journal_entry"] = "Vendor bill journal must use the AP source."
        if any(
            value < 0
            for value in (
                self.subtotal,
                self.tax_total,
                self.withholding_total,
                self.total_amount,
                self.amount_payable,
            )
        ):
            errors["subtotal"] = "Bill amounts cannot be negative."
        if errors:
            raise ValidationError(errors)

    # Operational flags that may change after posting without touching the ledger.
    OPERATIONAL_FIELDS = {"on_hold", "hold_reason", "scheduled_payment_date", "scheduled_payment_method", "updated_at"}

    def save(self, *args, **kwargs):
        update_fields = kwargs.get("update_fields")
        operational_only = update_fields is not None and set(update_fields) <= self.OPERATIONAL_FIELDS
        if self.pk and not operational_only and VendorBill.objects.filter(
            pk=self.pk, status__in=(self.Status.POSTED, self.Status.PAID)
        ).exists():
            raise ValidationError({"status": "Posted or paid bills are immutable."})
        super().save(*args, **kwargs)


class VendorBillLine(BaseModel):
    vendor_bill = models.ForeignKey(
        VendorBill, on_delete=models.CASCADE, related_name="lines"
    )
    description = models.TextField()
    expense_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="vendor_bill_lines"
    )
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    unit_price = models.DecimalField(max_digits=20, decimal_places=4)
    tax_code = models.ForeignKey(
        TaxCode,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="vendor_bill_lines",
    )
    withholding_rule = models.ForeignKey(
        WithholdingRule,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="vendor_bill_lines",
    )
    line_total = models.DecimalField(max_digits=20, decimal_places=2, default=Decimal("0"))

    class Meta:
        ordering = ("created_at",)
        constraints = [
            models.CheckConstraint(
                condition=Q(quantity__gt=0) & Q(unit_price__gte=0) & Q(line_total__gte=0),
                name="vendor_bill_line_amounts_valid",
            )
        ]

    @property
    def institution_id(self):
        return self.vendor_bill.institution_id

    def clean(self):
        errors = {}
        bill = self.vendor_bill
        if self.expense_account_id:
            if self.expense_account.institution_id != bill.institution_id:
                errors["expense_account"] = "Expense account belongs to another institution."
            elif self.expense_account.account_type != Account.AccountType.EXPENSE:
                errors["expense_account"] = "Expense account must be an expense account."
        configuration = getattr(bill.institution, "accounting_configuration", None)
        preset_version_id = getattr(configuration, "selected_accounting_preset_version_id", None)
        for field, record in (
            ("tax_code", self.tax_code if self.tax_code_id else None),
            ("withholding_rule", self.withholding_rule if self.withholding_rule_id else None),
        ):
            if record is None:
                continue
            if not preset_version_id or record.preset_version_id != preset_version_id:
                errors[field] = "Tax configuration must match the selected accounting preset."
            elif record.effective_from > bill.bill_date or (
                record.effective_to and record.effective_to < bill.bill_date
            ):
                errors[field] = "Tax configuration is not effective on the bill date."
            elif field == "tax_code" and not record.is_active:
                errors[field] = "Tax code is inactive."
        if self.quantity <= 0:
            errors["quantity"] = "Quantity must be positive."
        if self.unit_price < 0 or self.line_total < 0:
            errors["unit_price"] = "Line amounts cannot be negative."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.vendor_bill.status != VendorBill.Status.DRAFT:
            raise ValidationError({"vendor_bill": "Only draft bill lines can be edited."})
        self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.vendor_bill.status != VendorBill.Status.DRAFT:
            raise ValidationError({"vendor_bill": "Only draft bill lines can be edited."})
        return super().delete(*args, **kwargs)


class Customer(AutoCodeMixin, TenantOwnedModel):
    auto_code_field = "customer_code"
    auto_code_prefix = "CUS"
    auto_code_width = 4

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="customers"
    )
    name = models.CharField(max_length=150)
    customer_code = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    address = models.TextField(blank=True)
    country_code = models.CharField(max_length=2, blank=True)
    tax_identification_number = models.CharField(max_length=80, blank=True)
    tax_residency = models.CharField(max_length=30, blank=True)
    taxpayer_type = models.CharField(max_length=50, blank=True)
    vat_registered = models.BooleanField(default=False)
    withholding_category = models.CharField(max_length=80, blank=True)
    statutory_profile_metadata = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("customer_code",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "customer_code"),
                name="uniq_customer_code_per_institution",
            )
        ]

    def clean(self):
        self.customer_code = self.customer_code.strip().upper()
        self.country_code = self.country_code.strip().upper()
        self.tax_residency = self.tax_residency.strip().upper()
        self.taxpayer_type = self.taxpayer_type.strip().upper()
        self.withholding_category = self.withholding_category.strip().upper()
        if self.country_code and (len(self.country_code) != 2 or not self.country_code.isalpha()):
            raise ValidationError({"country_code": "Use a two-letter ISO country code."})


class Invoice(AutoCodeMixin, TenantOwnedModel):
    auto_code_field = "invoice_number"
    auto_code_prefix = "INV"
    auto_code_width = 6
    auto_code_year_from = "invoice_date"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ISSUED = "ISSUED", "Issued"
        PART_PAID = "PART_PAID", "Part paid"
        PAID = "PAID", "Paid"
        VOID = "VOID", "Void"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="invoices"
    )
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="invoices")
    invoice_number = models.CharField(max_length=80, blank=True)
    invoice_date = models.DateField()
    due_date = models.DateField()
    currency = models.CharField(max_length=3)
    subtotal = models.DecimalField(max_digits=20, decimal_places=2, default=Decimal("0"))
    tax_total = models.DecimalField(max_digits=20, decimal_places=2, default=Decimal("0"))
    total_amount = models.DecimalField(max_digits=20, decimal_places=2, default=Decimal("0"))
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    accounting_period = models.ForeignKey(
        AccountingPeriod, on_delete=models.PROTECT, related_name="invoices"
    )
    journal_entry = models.ForeignKey(
        JournalEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="invoices"
    )
    external_tax_reference = models.CharField(max_length=100, null=True, blank=True)
    # Collections (concept "Accounts receivable"): holds/disputes, delivery and notes.
    on_hold = models.BooleanField(default=False)
    hold_reason = models.TextField(blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    sent_to = models.EmailField(blank=True)
    notes = models.TextField(blank=True, max_length=2000)

    OPERATIONAL_FIELDS = {"on_hold", "hold_reason", "sent_at", "sent_to", "updated_at"}

    class Meta:
        ordering = ("-invoice_date", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "invoice_number"), name="uniq_invoice_number_per_institution"
            ),
            models.CheckConstraint(
                condition=Q(due_date__gte=models.F("invoice_date")), name="invoice_due_date_valid"
            ),
            models.CheckConstraint(
                condition=Q(subtotal__gte=0) & Q(tax_total__gte=0) & Q(total_amount__gte=0),
                name="invoice_amounts_non_negative",
            ),
        ]

    def clean(self):
        self.invoice_number = self.invoice_number.strip().upper()
        self.currency = self.currency.strip().upper()
        errors = {}
        if len(self.currency) != 3 or not self.currency.isalpha():
            errors["currency"] = "Use a three-letter ISO currency code."
        if self.due_date < self.invoice_date:
            errors["due_date"] = "Due date cannot precede invoice date."
        if self.customer_id and self.customer.institution_id != self.institution_id:
            errors["customer"] = "Customer belongs to another institution."
        if self.accounting_period_id and self.accounting_period.institution_id != self.institution_id:
            errors["accounting_period"] = "Period belongs to another institution."
        if self.journal_entry_id:
            if self.journal_entry.institution_id != self.institution_id:
                errors["journal_entry"] = "Journal belongs to another institution."
            elif self.journal_entry.source != JournalEntry.Source.AR:
                errors["journal_entry"] = "Invoice journal must use the AR source."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        update_fields = kwargs.get("update_fields")
        operational_only = update_fields is not None and set(update_fields) <= self.OPERATIONAL_FIELDS
        if self.pk and not operational_only and Invoice.objects.filter(
            pk=self.pk, status__in=(self.Status.ISSUED, self.Status.PART_PAID, self.Status.PAID)
        ).exists():
            raise ValidationError({"status": "Issued or settled invoices are immutable."})
        super().save(*args, **kwargs)


class InvoiceLine(BaseModel):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="lines")
    description = models.TextField()
    income_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="invoice_lines"
    )
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    unit_price = models.DecimalField(max_digits=20, decimal_places=4)
    tax_code = models.ForeignKey(
        TaxCode, on_delete=models.PROTECT, null=True, blank=True, related_name="invoice_lines"
    )
    line_total = models.DecimalField(max_digits=20, decimal_places=2, default=Decimal("0"))

    class Meta:
        ordering = ("created_at",)
        constraints = [
            models.CheckConstraint(
                condition=Q(quantity__gt=0) & Q(unit_price__gte=0) & Q(line_total__gte=0),
                name="invoice_line_amounts_valid",
            )
        ]

    def clean(self):
        errors = {}
        if self.income_account_id:
            if self.income_account.institution_id != self.invoice.institution_id:
                errors["income_account"] = "Income account belongs to another institution."
            elif self.income_account.account_type != Account.AccountType.INCOME:
                errors["income_account"] = "Income account must be an income account."
        if self.tax_code_id:
            configuration = getattr(self.invoice.institution, "accounting_configuration", None)
            if not getattr(configuration, "selected_accounting_preset_version_id", None) or (
                self.tax_code.preset_version_id != configuration.selected_accounting_preset_version_id
            ):
                errors["tax_code"] = "Tax code must match the selected accounting preset."
            elif not self.tax_code.is_active or self.tax_code.effective_from > self.invoice.invoice_date or (
                self.tax_code.effective_to and self.tax_code.effective_to < self.invoice.invoice_date
            ):
                errors["tax_code"] = "Tax code is not effective on the invoice date."
        if self.quantity <= 0 or self.unit_price < 0 or self.line_total < 0:
            errors["quantity"] = "Invoice line amounts must be non-negative and quantity positive."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.invoice.status != Invoice.Status.DRAFT:
            raise ValidationError({"invoice": "Only draft invoice lines can be edited."})
        self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.invoice.status != Invoice.Status.DRAFT:
            raise ValidationError({"invoice": "Only draft invoice lines can be edited."})
        return super().delete(*args, **kwargs)


class BankAccount(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="bank_accounts"
    )
    name = models.CharField(max_length=150)
    bank_name = models.CharField(max_length=150)
    masked_account_number = models.CharField(max_length=80)
    currency = models.CharField(max_length=3)
    ledger_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="bank_accounts"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "name"), name="uniq_bank_account_name_per_institution"
            ),
            models.UniqueConstraint(
                fields=("institution", "ledger_account"),
                name="uniq_bank_ledger_account_per_institution",
            ),
        ]
        indexes = [models.Index(fields=("institution", "is_active", "name"))]

    def clean(self):
        self.currency = self.currency.strip().upper()
        errors = {}
        if len(self.currency) != 3 or not self.currency.isalpha():
            errors["currency"] = "Use a three-letter ISO currency code."
        if not self.masked_account_number.strip():
            errors["masked_account_number"] = "A masked account identifier is required."
        if self.ledger_account_id:
            if self.ledger_account.institution_id != self.institution_id:
                errors["ledger_account"] = "Ledger account belongs to another institution."
            elif self.ledger_account.account_type != Account.AccountType.ASSET:
                errors["ledger_account"] = "Bank ledger account must be an asset account."
            elif not self.ledger_account.is_active or not self.ledger_account.is_postable:
                errors["ledger_account"] = "Bank ledger account must be active and postable."
        if errors:
            raise ValidationError(errors)


class Payment(AutoCodeMixin, TenantOwnedModel):
    auto_code_field = "payment_number"
    auto_code_prefix = "PAY"
    auto_code_width = 6
    auto_code_year_from = "payment_date"

    class Status(models.TextChoices):
        POSTED = "POSTED", "Posted"
        VOID = "VOID", "Void"

    class Method(models.TextChoices):
        CASH = "CASH", "Cash"
        BANK_TRANSFER = "BANK_TRANSFER", "Bank transfer"
        CHEQUE = "CHEQUE", "Cheque"
        CARD = "CARD", "Card"
        MOBILE_MONEY = "MOBILE_MONEY", "Mobile money"
        OTHER = "OTHER", "Other"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="payments"
    )
    payment_number = models.CharField(max_length=80, blank=True)
    payment_date = models.DateField()
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    currency = models.CharField(max_length=3)
    payment_method = models.CharField(max_length=16, choices=Method.choices)
    bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payments",
    )
    vendor_bill = models.ForeignKey(
        VendorBill,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payments",
    )
    journal_entry = models.ForeignKey(
        JournalEntry,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payments",
    )
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.POSTED)

    class Meta:
        ordering = ("-payment_date", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "payment_number"),
                name="uniq_payment_number_per_institution",
            ),
            models.CheckConstraint(condition=Q(amount__gt=0), name="payment_amount_positive"),
        ]
        indexes = [models.Index(fields=("institution", "status", "payment_date"))]

    def clean(self):
        self.payment_number = self.payment_number.strip().upper()
        self.currency = self.currency.strip().upper()
        errors = {}
        if len(self.currency) != 3 or not self.currency.isalpha():
            errors["currency"] = "Use a three-letter ISO currency code."
        if self.amount is None or self.amount <= 0:
            errors["amount"] = "Payment amount must be positive."
        if self.bank_account_id:
            if self.bank_account.institution_id != self.institution_id:
                errors["bank_account"] = "Bank account belongs to another institution."
            elif not self.bank_account.is_active:
                errors["bank_account"] = "Bank account is inactive."
            elif self.bank_account.currency != self.currency:
                errors["currency"] = "Payment currency must match the bank account."
        elif self.payment_method != self.Method.CASH:
            errors["bank_account"] = "A bank account is required for non-cash payments."
        if self.vendor_bill_id and self.vendor_bill.institution_id != self.institution_id:
            errors["vendor_bill"] = "Vendor bill belongs to another institution."
        if self.journal_entry_id:
            if self.journal_entry.institution_id != self.institution_id:
                errors["journal_entry"] = "Journal belongs to another institution."
            elif self.journal_entry.source != JournalEntry.Source.CASH:
                errors["journal_entry"] = "Payment journal must use the CASH source."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.pk and Payment.objects.filter(pk=self.pk, status__in=(self.Status.POSTED, self.Status.VOID)).exists():
            raise ValidationError({"status": "Posted or voided payments are immutable."})
        super().save(*args, **kwargs)


class Receipt(AutoCodeMixin, TenantOwnedModel):
    auto_code_field = "receipt_number"
    auto_code_prefix = "RCT"
    auto_code_width = 6
    auto_code_year_from = "receipt_date"

    class Status(models.TextChoices):
        POSTED = "POSTED", "Posted"
        VOID = "VOID", "Void"

    class Method(models.TextChoices):
        CASH = "CASH", "Cash"
        BANK_TRANSFER = "BANK_TRANSFER", "Bank transfer"
        CHEQUE = "CHEQUE", "Cheque"
        CARD = "CARD", "Card"
        MOBILE_MONEY = "MOBILE_MONEY", "Mobile money"
        OTHER = "OTHER", "Other"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="receipts"
    )
    receipt_number = models.CharField(max_length=80, blank=True)
    receipt_date = models.DateField()
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    currency = models.CharField(max_length=3)
    payment_method = models.CharField(max_length=16, choices=Method.choices)
    bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="receipts",
    )
    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="receipts",
    )
    journal_entry = models.ForeignKey(
        JournalEntry,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="receipts",
    )
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.POSTED)

    class Meta:
        ordering = ("-receipt_date", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "receipt_number"),
                name="uniq_receipt_number_per_institution",
            ),
            models.CheckConstraint(condition=Q(amount__gt=0), name="receipt_amount_positive"),
        ]
        indexes = [models.Index(fields=("institution", "status", "receipt_date"))]

    def clean(self):
        self.receipt_number = self.receipt_number.strip().upper()
        self.currency = self.currency.strip().upper()
        errors = {}
        if len(self.currency) != 3 or not self.currency.isalpha():
            errors["currency"] = "Use a three-letter ISO currency code."
        if self.amount is None or self.amount <= 0:
            errors["amount"] = "Receipt amount must be positive."
        if self.bank_account_id:
            if self.bank_account.institution_id != self.institution_id:
                errors["bank_account"] = "Bank account belongs to another institution."
            elif not self.bank_account.is_active:
                errors["bank_account"] = "Bank account is inactive."
            elif self.bank_account.currency != self.currency:
                errors["currency"] = "Receipt currency must match the bank account."
        elif self.payment_method != self.Method.CASH:
            errors["bank_account"] = "A bank account is required for non-cash receipts."
        if self.invoice_id and self.invoice.institution_id != self.institution_id:
            errors["invoice"] = "Invoice belongs to another institution."
        if self.journal_entry_id:
            if self.journal_entry.institution_id != self.institution_id:
                errors["journal_entry"] = "Journal belongs to another institution."
            elif self.journal_entry.source != JournalEntry.Source.CASH:
                errors["journal_entry"] = "Receipt journal must use the CASH source."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.pk and Receipt.objects.filter(pk=self.pk, status__in=(self.Status.POSTED, self.Status.VOID)).exists():
            raise ValidationError({"status": "Posted or voided receipts are immutable."})
        super().save(*args, **kwargs)


class BankStatementLine(TenantOwnedModel):
    """An imported bank movement reconciled to one posted cash journal."""

    class Status(models.TextChoices):
        UNMATCHED = "UNMATCHED", "Unmatched"
        MATCHED = "MATCHED", "Matched"
        EXCEPTION = "EXCEPTION", "Exception"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="bank_statement_lines"
    )
    bank_account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT, related_name="statement_lines"
    )
    statement_date = models.DateField()
    external_id = models.CharField(max_length=120)
    reference = models.CharField(max_length=150, blank=True)
    description = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    currency = models.CharField(max_length=3)
    journal_entry = models.OneToOneField(
        JournalEntry,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="bank_statement_match",
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.UNMATCHED
    )
    reconciled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="bank_statement_lines_reconciled",
    )
    reconciled_at = models.DateTimeField(null=True, blank=True)
    exception_note = models.TextField(blank=True)

    class Meta:
        ordering = ("-statement_date", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("bank_account", "external_id"),
                name="uniq_bank_statement_external_id",
            ),
            models.CheckConstraint(
                condition=Q(amount__gt=0) | Q(amount__lt=0),
                name="bank_statement_amount_nonzero",
            ),
        ]
        indexes = [
            models.Index(fields=("institution", "status", "statement_date")),
            models.Index(fields=("bank_account", "statement_date")),
        ]

    def clean(self):
        self.external_id = self.external_id.strip().upper()
        self.currency = self.currency.strip().upper()
        errors = {}
        if not self.external_id:
            errors["external_id"] = "A bank-supplied external identifier is required."
        if len(self.currency) != 3 or not self.currency.isalpha():
            errors["currency"] = "Use a three-letter ISO currency code."
        if self.bank_account_id:
            if self.bank_account.institution_id != self.institution_id:
                errors["bank_account"] = "Bank account belongs to another institution."
            elif self.bank_account.currency != self.currency:
                errors["currency"] = "Statement currency must match the bank account."
        if self.journal_entry_id:
            if self.journal_entry.institution_id != self.institution_id:
                errors["journal_entry"] = "Journal belongs to another institution."
            elif self.journal_entry.status != JournalEntry.Status.POSTED:
                errors["journal_entry"] = "Only posted journals can be reconciled."
        if self.status == self.Status.MATCHED and not self.journal_entry_id:
            errors["journal_entry"] = "A matched statement line requires a journal."
        if self.status != self.Status.MATCHED and self.journal_entry_id:
            errors["status"] = "Only matched statement lines can carry a journal."
        if self.reconciled_by_id and not self.reconciled_by.memberships.filter(
            institution_id=self.institution_id, status="ACTIVE"
        ).exists():
            errors["reconciled_by"] = "Reconciler must be an active institution member."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)


class VATWithholdingCertificate(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ISSUED = "ISSUED", "Issued"
        VOID = "VOID", "Void"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="vat_withholding_certificates")
    vendor_bill = models.ForeignKey(VendorBill, on_delete=models.PROTECT, related_name="vat_withholding_certificates")
    withholding_rule = models.ForeignKey(WithholdingRule, on_delete=models.PROTECT, related_name="vat_withholding_certificates")
    certificate_number = models.CharField(max_length=100)
    certificate_date = models.DateField()
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.DRAFT)
    issued_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="vat_withholding_certificates_issued")
    issued_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="vat_withholding_certificates_voided")
    voided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("institution", "certificate_number"), name="uniq_vat_withholding_certificate_number"),
        ]

    def clean(self):
        self.certificate_number = self.certificate_number.strip().upper()
        errors = {}
        if self.amount is None or self.amount <= 0:
            errors["amount"] = "Certificate amount must be positive."
        if self.vendor_bill_id and self.vendor_bill.institution_id != self.institution_id:
            errors["vendor_bill"] = "Vendor bill belongs to another institution."
        if self.withholding_rule_id:
            if self.withholding_rule.preset_version_id != getattr(getattr(self.institution, "accounting_configuration", None), "selected_accounting_preset_version_id", None):
                errors["withholding_rule"] = "Withholding rule must match the selected accounting preset."
            elif not self.withholding_rule.is_vat_withholding_rule:
                errors["withholding_rule"] = "Certificate requires a VAT withholding rule."
        if errors:
            raise ValidationError(errors)


class GhanaComplianceReminder(TenantOwnedModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        COMPLETED = "COMPLETED", "Completed"
        WAIVED = "WAIVED", "Waived"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="ghana_compliance_reminders")
    code = models.CharField(max_length=80)
    title = models.CharField(max_length=200)
    authority = models.CharField(max_length=150, default="Ghana Revenue Authority")
    due_date = models.DateField()
    statutory_reference = models.URLField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    completed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="ghana_compliance_reminders_completed")
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("institution", "code", "due_date"), name="uniq_ghana_compliance_reminder")]
        ordering = ("due_date", "code")


class ExpenseCategory(TenantOwnedModel):
    """What a claim line is for. Claimants pick a category, never a GL account (E-04)."""

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="expense_categories")
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=150)
    expense_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="expense_categories")
    # Policy (E-05): a line above max_amount fails; above receipt_required_over it needs a receipt.
    max_amount = models.DecimalField(max_digits=20, decimal_places=2, null=True, blank=True)
    receipt_required_over = models.DecimalField(max_digits=20, decimal_places=2, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)
        constraints = [models.UniqueConstraint(fields=("institution", "code"), name="uniq_expense_category_code")]

    def clean(self):
        self.code = (self.code or "").strip().upper()
        errors = {}
        if self.expense_account_id:
            if self.expense_account.institution_id != self.institution_id:
                errors["expense_account"] = "Account belongs to another institution."
            elif self.expense_account.account_type != Account.AccountType.EXPENSE:
                errors["expense_account"] = "Choose an expense account."
        for field in ("max_amount", "receipt_required_over"):
            value = getattr(self, field)
            if value is not None and value < 0:
                errors[field] = "Must not be negative."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return self.name


class Expense(TenantOwnedModel):
    """An expense claim (header). Legacy single-line expenses keep ``account`` and ``amount``."""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Submitted"
        RETURNED = "RETURNED", "Returned for changes"
        FINANCE_REVIEW = "FINANCE_REVIEW", "Finance review"
        APPROVED = "APPROVED", "Approved"
        POSTED = "POSTED", "Posted"
        SETTLED = "SETTLED", "Settled"
        REJECTED = "REJECTED", "Rejected"
        REVERSED = "REVERSED", "Reversed"

    class PaymentMethod(models.TextChoices):
        # Reimbursable: posted to the employee payable and settled later (BQ-03).
        REIMBURSABLE = "REIMBURSABLE", "Reimburse the claimant"
        # Petty cash: already paid out of cash; posting credits the CASH mapping.
        PETTY_CASH = "PETTY_CASH", "Paid from petty cash"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="expenses")
    claimant = models.ForeignKey(Employee, on_delete=models.PROTECT, null=True, blank=True, related_name="expense_claims")
    expense_date = models.DateField()
    account = models.ForeignKey(Account, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses")
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    currency = models.CharField(max_length=3)
    description = models.TextField()
    payment_method = models.CharField(max_length=12, choices=PaymentMethod.choices, default=PaymentMethod.PETTY_CASH)
    attachment = models.ForeignKey(Document, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="expenses_created")
    submitted_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)
    finance_reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses_finance_reviewed")
    finance_reviewed_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses_approved")
    journal_entry = models.ForeignKey(JournalEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses")
    # Settlement recorded (never "money sent"; there is no payment rail).
    settlement_account = models.ForeignKey(Account, on_delete=models.PROTECT, null=True, blank=True, related_name="expense_settlements")
    settlement_date = models.DateField(null=True, blank=True)
    settlement_reference = models.CharField(max_length=120, blank=True)
    settlement_journal = models.ForeignKey(JournalEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="settled_expenses")
    settled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses_settled")
    reversal_journal = models.ForeignKey(JournalEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="reversed_expenses")
    reversed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses_reversed")

    # Fields that may still change once a claim is POSTED: settlement and reversal.
    POSTED_MUTABLE = frozenset({
        "status", "settlement_account", "settlement_date", "settlement_reference", "settlement_journal",
        "settled_by", "reversal_journal", "reversed_by", "updated_at",
    })

    class Meta:
        ordering = ("-expense_date", "-created_at")
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="expense_amount_positive")]
        indexes = [models.Index(fields=("institution", "status", "expense_date"))]

    def clean(self):
        self.currency = self.currency.strip().upper()
        errors = {}
        if len(self.currency) != 3 or not self.currency.isalpha():
            errors["currency"] = "Use a three-letter ISO currency code."
        if self.account_id:
            if self.account.institution_id != self.institution_id:
                errors["account"] = "Expense account belongs to another institution."
            elif self.account.account_type != Account.AccountType.EXPENSE:
                errors["account"] = "Account must be an expense account."
        if self.claimant_id and self.claimant.institution_id != self.institution_id:
            errors["claimant"] = "Claimant belongs to another institution."
        if self.attachment_id and self.attachment.institution_id != self.institution_id:
            errors["attachment"] = "Attachment belongs to another institution."
        for field in ("created_by", "approved_by", "finance_reviewed_by", "settled_by", "reversed_by"):
            user = getattr(self, field, None)
            if user and not user.memberships.filter(institution_id=self.institution_id, status="ACTIVE").exists():
                errors[field] = "User must be an active institution member."
        for field in ("journal_entry", "settlement_journal", "reversal_journal"):
            journal = getattr(self, field, None)
            if journal is not None and journal.institution_id != self.institution_id:
                errors[field] = "Journal belongs to another institution."
        if self.journal_entry_id and self.journal_entry.source != JournalEntry.Source.EXPENSE:
            errors["journal_entry"] = "Expense journal must use the EXPENSE source."
        if self.settlement_account_id and self.settlement_account.institution_id != self.institution_id:
            errors["settlement_account"] = "Settlement account belongs to another institution."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.pk:
            stored = Expense.objects.filter(pk=self.pk).values_list("status", flat=True).first()
            if stored in (self.Status.REJECTED, self.Status.SETTLED, self.Status.REVERSED):
                raise ValidationError({"status": "Rejected, settled or reversed expenses are immutable."})
            if stored == self.Status.POSTED:
                update_fields = kwargs.get("update_fields")
                if update_fields is None or not set(update_fields) <= self.POSTED_MUTABLE:
                    raise ValidationError({"status": "Posted expenses change only through settlement or reversal."})
        super().save(*args, **kwargs)


class ExpenseLine(TenantOwnedModel):
    """One item on a claim (E-02). Finance may recode ``account`` during review."""

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="expense_lines")
    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name="lines")
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT, related_name="lines")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="expense_lines")
    expense_date = models.DateField()
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    receipts = models.ManyToManyField(Document, blank=True, related_name="expense_lines")
    sequence = models.PositiveSmallIntegerField(default=1)

    class Meta:
        ordering = ("expense", "sequence", "created_at")
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="expense_line_amount_positive")]

    def clean(self):
        errors = {}
        for field in ("expense", "category", "account"):
            related = getattr(self, field, None)
            if related is not None and related.institution_id != self.institution_id:
                errors[field] = "Belongs to another institution."
        if self.account_id and self.account.account_type != Account.AccountType.EXPENSE:
            errors["account"] = "Account must be an expense account."
        if errors:
            raise ValidationError(errors)


class ExpenseApproval(TenantOwnedModel):
    """A manager-stage approval step on a claim, resolved by the approval engine (E-08)."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        RETURNED = "RETURNED", "Returned"
        REJECTED = "REJECTED", "Rejected"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="expense_approvals")
    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name="approvals")
    sequence = models.PositiveSmallIntegerField()
    step_name = models.CharField(max_length=150)
    approver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="expense_approval_steps")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    comment = models.TextField(blank=True)
    acted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("expense", "sequence")
        constraints = [models.UniqueConstraint(fields=("expense", "sequence"), name="uniq_expense_approval_sequence")]


class JournalEntryNote(TenantOwnedModel):
    """Reviewer and preparer notes on a journal (concept "Journal entry detail")."""

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="journal_notes")
    journal_entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name="notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="journal_notes")
    body = models.TextField(max_length=4000)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("institution", "journal_entry"))]


class InvoiceReminder(TenantOwnedModel):
    """A planned or completed collection follow-up on an invoice."""

    class Channel(models.TextChoices):
        EMAIL = "EMAIL", "Email"
        PHONE = "PHONE", "Phone call"
        LETTER = "LETTER", "Letter"
        VISIT = "VISIT", "Visit"

    class Status(models.TextChoices):
        SCHEDULED = "SCHEDULED", "Scheduled"
        DONE = "DONE", "Done"
        CANCELLED = "CANCELLED", "Cancelled"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="invoice_reminders")
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="reminders")
    remind_on = models.DateField()
    channel = models.CharField(max_length=8, choices=Channel.choices, default=Channel.EMAIL)
    note = models.TextField(blank=True, max_length=2000)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.SCHEDULED)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="invoice_reminders")
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("remind_on", "created_at")
        indexes = [models.Index(fields=("institution", "status", "remind_on"))]


class BankReconciliationSession(TenantOwnedModel):
    """One bank account reconciled against its statement for a period (concept "Bank reconciliation")."""

    class Status(models.TextChoices):
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        COMPLETED = "COMPLETED", "Reconciled"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="bank_reconciliation_sessions")
    bank_account = models.ForeignKey(BankAccount, on_delete=models.PROTECT, related_name="reconciliation_sessions")
    period_start = models.DateField()
    period_end = models.DateField()
    statement_opening_balance = models.DecimalField(max_digits=20, decimal_places=2, null=True, blank=True)
    statement_closing_balance = models.DecimalField(max_digits=20, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.IN_PROGRESS)
    started_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="reconciliations_started")
    completed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="reconciliations_completed")
    completed_at = models.DateTimeField(null=True, blank=True)
    last_imported_at = models.DateTimeField(null=True, blank=True)
    last_imported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ("-period_end", "-created_at")
        constraints = [
            models.UniqueConstraint(fields=("bank_account", "period_start", "period_end"), name="uniq_reconciliation_session_period"),
            models.CheckConstraint(condition=Q(period_end__gte=models.F("period_start")), name="reconciliation_session_period_valid"),
        ]

    def clean(self):
        if self.bank_account_id and self.bank_account.institution_id != self.institution_id:
            raise ValidationError({"bank_account": "Bank account belongs to another institution."})
        if self.period_end and self.period_start and self.period_end < self.period_start:
            raise ValidationError({"period_end": "Period end cannot precede its start."})


class Budget(AutoCodeMixin, TenantOwnedModel):
    """A departmental or institution-wide budget for a fiscal year (concept "Budgets")."""

    auto_code_field = "code"
    auto_code_prefix = "BUD"
    auto_code_width = 4
    auto_code_year_from = "today"

    class BudgetType(models.TextChoices):
        OPERATING = "OPERATING", "Operating"
        CAPITAL = "CAPITAL", "Capital"
        PROJECT = "PROJECT", "Project"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING_APPROVAL = "PENDING_APPROVAL", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        RETURNED = "RETURNED", "Changes requested"
        CLOSED = "CLOSED", "Closed"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="budgets")
    code = models.CharField(max_length=50, blank=True)
    name = models.CharField(max_length=150)
    fiscal_year = models.ForeignKey(FiscalYear, on_delete=models.PROTECT, related_name="budgets")
    department = models.ForeignKey(Department, on_delete=models.PROTECT, null=True, blank=True, related_name="budgets")
    budget_type = models.CharField(max_length=10, choices=BudgetType.choices, default=BudgetType.OPERATING)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="budgets_owned")
    description = models.TextField(blank=True, max_length=2000)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="budgets_created")
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="budgets_submitted")
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="budgets_approved")
    approved_at = models.DateTimeField(null=True, blank=True)
    approval_note = models.TextField(blank=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [models.UniqueConstraint(fields=("institution", "code"), name="uniq_budget_code_per_institution")]
        indexes = [models.Index(fields=("institution", "fiscal_year", "status"))]

    def clean(self):
        errors = {}
        for name in ("fiscal_year", "department"):
            obj = getattr(self, name, None)
            if obj and obj.institution_id != self.institution_id:
                errors[name] = "Referenced record must belong to the same institution."
        if self.owner_id and not self.owner.memberships.filter(institution_id=self.institution_id, status="ACTIVE").exists():
            errors["owner"] = "Owner must be an active institution member."
        if errors:
            raise ValidationError(errors)


class BudgetLine(TenantOwnedModel):
    class Category(models.TextChoices):
        PERSONNEL = "PERSONNEL", "Personnel"
        OPERATING = "OPERATING", "Operating expenses"
        SUPPLIES = "SUPPLIES", "Supplies & materials"
        TRAVEL = "TRAVEL", "Travel"
        CAPITAL = "CAPITAL", "Capital equipment"
        TRANSFERS = "TRANSFERS", "Transfers"
        OTHER = "OTHER", "Other"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="budget_lines")
    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name="lines")
    category = models.CharField(max_length=10, choices=Category.choices)
    account = models.ForeignKey(Account, on_delete=models.PROTECT, null=True, blank=True, related_name="budget_lines")
    description = models.CharField(max_length=200, blank=True)
    initiative = models.CharField(max_length=120, blank=True)
    allocated = models.DecimalField(max_digits=20, decimal_places=2)

    class Meta:
        ordering = ("category", "created_at")
        constraints = [models.CheckConstraint(condition=Q(allocated__gte=0), name="budget_line_allocated_nonnegative")]

    def clean(self):
        if self.account_id and self.account.institution_id != self.institution_id:
            raise ValidationError({"account": "Account belongs to another institution."})
        if self.account_id and self.account.account_type not in (Account.AccountType.EXPENSE, Account.AccountType.ASSET):
            raise ValidationError({"account": "Budget lines track expense or capital (asset) accounts."})


class BudgetNote(TenantOwnedModel):
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="budget_notes")
    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name="notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="budget_notes")
    body = models.TextField(max_length=4000)

    class Meta:
        ordering = ("-created_at",)


class FinancialReport(AutoCodeMixin, TenantOwnedModel):
    """A saved financial report definition (concepts "Financial reports" and "Financial report detail")."""

    auto_code_field = "code"
    auto_code_prefix = "RPT"
    auto_code_width = 4
    auto_code_year_from = "today"

    class ReportType(models.TextChoices):
        BALANCE_SHEET = "BALANCE_SHEET", "Statement of financial position"
        INCOME_STATEMENT = "INCOME_STATEMENT", "Income statement"
        TRIAL_BALANCE = "TRIAL_BALANCE", "Trial balance"
        AR_AGING = "AR_AGING", "Receivables aging"
        AP_AGING = "AP_AGING", "Payables aging"
        BUDGET_VS_ACTUAL = "BUDGET_VS_ACTUAL", "Budget vs actual"

    class Category(models.TextChoices):
        STANDARD = "STANDARD", "Standard reports"
        MANAGEMENT = "MANAGEMENT", "Management reports"
        COMPLIANCE = "COMPLIANCE", "Compliance reports"
        AUDIT = "AUDIT", "Audit reports"
        END_OF_PERIOD = "END_OF_PERIOD", "End of period"
        CUSTOM = "CUSTOM", "Custom reports"

    class Frequency(models.TextChoices):
        NONE = "NONE", "Not scheduled"
        MONTHLY = "MONTHLY", "Monthly"
        QUARTERLY = "QUARTERLY", "Quarterly"
        YEARLY = "YEARLY", "Yearly"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="financial_reports")
    code = models.CharField(max_length=50, blank=True)
    name = models.CharField(max_length=150)
    report_type = models.CharField(max_length=20, choices=ReportType.choices)
    category = models.CharField(max_length=16, choices=Category.choices, default=Category.CUSTOM)
    description = models.TextField(blank=True, max_length=2000)
    parameters = models.JSONField(default=dict, blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="financial_reports_owned")
    allowed_roles = models.JSONField(default=list, blank=True)
    is_standard = models.BooleanField(default=False)
    schedule_frequency = models.CharField(max_length=10, choices=Frequency.choices, default=Frequency.NONE)
    next_run_on = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, max_length=4000)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ("name",)
        constraints = [models.UniqueConstraint(fields=("institution", "code"), name="uniq_financial_report_code")]


class FinancialReportRun(TenantOwnedModel):
    class Status(models.TextChoices):
        COMPLETED = "COMPLETED", "Completed"
        FAILED = "FAILED", "Failed"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="financial_report_runs")
    report = models.ForeignKey(FinancialReport, on_delete=models.CASCADE, related_name="runs")
    version = models.PositiveIntegerField()
    parameters = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices)
    result = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    run_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    scheduled = models.BooleanField(default=False)

    class Meta:
        ordering = ("-created_at",)
        constraints = [models.UniqueConstraint(fields=("report", "version"), name="uniq_financial_report_run_version")]


class BatchJob(TenantOwnedModel):
    """One governed bulk operation over many records (concept "Bulk actions and batch governance").

    Bulk actions run the same service each record's own button uses, one record per savepoint,
    so a failure on one record never rolls back the others and every change keeps its audit event.
    """

    class Status(models.TextChoices):
        QUEUED = "QUEUED", "Queued"
        PROCESSING = "PROCESSING", "Processing"
        COMPLETED = "COMPLETED", "Completed"
        PARTIAL = "PARTIAL", "Partial success"
        FAILED = "FAILED", "Failed"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="batch_jobs")
    resource = models.CharField(max_length=40)
    operation = models.CharField(max_length=40)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED)
    reason = models.CharField(max_length=500, blank=True)
    total_items = models.PositiveIntegerField(default=0)
    succeeded = models.PositiveIntegerField(default=0)
    failed = models.PositiveIntegerField(default=0)
    total_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    results = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="batch_jobs")
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("institution", "resource", "-created_at"))]
