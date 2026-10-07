from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from common.models import BaseModel, TenantOwnedModel


class Institution(BaseModel):
    class InstitutionType(models.TextChoices):
        PRIVATE = "PRIVATE", "Private / Commercial"
        SME = "SME", "SME"
        GOVERNMENT = "GOVERNMENT", "Government / Public Sector"
        NGO = "NGO", "NGO / Nonprofit"
        EDUCATION = "EDUCATION", "Educational Institution"
        HEALTHCARE = "HEALTHCARE", "Healthcare Institution"
        OTHER = "OTHER", "Other"

    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50, unique=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    address = models.TextField(blank=True)
    country_code = models.CharField(max_length=2, default="GH")
    default_currency = models.CharField(max_length=3, default="GHS")
    timezone = models.CharField(max_length=64, default="Africa/Accra")
    institution_type = models.CharField(
        max_length=20, choices=InstitutionType.choices, default=InstitutionType.PRIVATE
    )
    executive_title = models.CharField(max_length=80, default="Executive", blank=True)
    # Captured when the first administrator creates the organization.
    website = models.URLField(max_length=255, blank=True)
    employee_size = models.CharField(
        max_length=10,
        blank=True,
        choices=(("1-50", "1–50 employees"), ("51-200", "51–200 employees"), ("201-1000", "201–1,000 employees"), ("1000+", "More than 1,000 employees")),
    )
    logo = models.CharField(max_length=500, blank=True)
    is_active = models.BooleanField(default=True)
    # Set by a platform administrator; an inactive institution refuses all tenant requests.
    suspended_at = models.DateTimeField(null=True, blank=True)
    suspension_reason = models.TextField(blank=True)

    class Meta:
        ordering = ("name",)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.country_code = self.country_code.strip().upper()
        self.default_currency = self.default_currency.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Permission(BaseModel):
    class Classification(models.TextChoices):
        NORMAL = "NORMAL", "Normal"
        PRIVILEGED = "PRIVILEGED", "Privileged"
        PLATFORM_ONLY = "PLATFORM_ONLY", "Platform only"

    code = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=150)
    module_code = models.CharField(max_length=50, default="CORE_HR")
    description = models.TextField(blank=True)
    classification = models.CharField(
        max_length=20, choices=Classification.choices, default=Classification.NORMAL
    )

    class Meta:
        ordering = ("code",)

    def __str__(self):
        return self.code


class Role(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="roles",
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    class DataScope(models.TextChoices):
        INSTITUTION = "INSTITUTION", "Whole institution"
        DEPARTMENT = "DEPARTMENT", "Own record and departments the member heads"
        SELF = "SELF", "Own records only"

    is_system_role = models.BooleanField(default=False)
    is_custom = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    # Whose records the role works with, and whether it may change anything
    # beyond self-service. Set per role (Wave 2, BQ-11), not inferred from codes.
    data_scope = models.CharField(max_length=12, choices=DataScope.choices, default=DataScope.INSTITUTION)
    is_read_only = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="institution_roles_created",
    )
    permissions = models.ManyToManyField(Permission, related_name="roles", blank=True)

    class Meta:
        ordering = ("institution", "name")
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"), name="uniq_role_code_per_institution"
            ),
            models.UniqueConstraint(
                fields=("code",),
                condition=models.Q(institution__isnull=True),
                name="uniq_global_role_code",
            ),
        ]
        indexes = [models.Index(fields=("institution", "is_active"))]

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    def clean(self):
        self.code = self.code.strip().upper()
        if self.is_system_role and self.is_custom:
            raise ValidationError({"is_custom": "A system role cannot be a custom role."})
        if self.created_by_id and self.institution_id:
            if not self.created_by.memberships.filter(institution_id=self.institution_id).exists():
                raise ValidationError(
                    {"created_by": "Role creator must belong to the same institution."}
                )

    def __str__(self):
        scope = self.institution.code if self.institution_id else "GLOBAL"
        return f"{scope}: {self.name}"


class InstitutionMembership(TenantOwnedModel):
    class Status(models.TextChoices):
        INVITED = "INVITED", "Invited"
        ACTIVE = "ACTIVE", "Active"
        SUSPENDED = "SUSPENDED", "Suspended"
        INACTIVE = "INACTIVE", "Inactive"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="memberships")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.INVITED)
    is_primary = models.BooleanField(default=False)
    joined_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "institution"), name="uniq_user_institution_membership"
            ),
            models.UniqueConstraint(
                fields=("user",),
                condition=models.Q(is_primary=True, status="ACTIVE"),
                name="uniq_active_primary_membership_per_user",
            ),
        ]
        indexes = [
            models.Index(fields=("institution", "status")),
            models.Index(fields=("user", "status")),
        ]

    def clean(self):
        errors = {}
        if self.role_id and self.institution_id:
            if self.role.institution_id != self.institution_id:
                errors["role"] = "The role must belong to the membership institution."
        if self.ended_at and self.joined_at and self.ended_at < self.joined_at:
            errors["ended_at"] = "End date cannot precede join date."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.user} @ {self.institution}"


class InstitutionInvitation(TenantOwnedModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted"
        EXPIRED = "EXPIRED", "Expired"
        REVOKED = "REVOKED", "Revoked"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="invitations")
    email = models.EmailField()
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="invitations")
    # Present only for employee self-service invitations.  Keeping the link on
    # the invitation makes acceptance unambiguous and prevents an accepted
    # account from being attached to the wrong employee record.
    employee = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="self_service_invitations",
    )
    token_hash = models.CharField(max_length=128, unique=True)
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="institution_invitations")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=("institution", "email", "status"))]


class InstitutionModule(TenantOwnedModel):
    class ModuleCode(models.TextChoices):
        CORE_HR = "CORE_HR", "Core HR"
        LEAVE = "LEAVE", "Leave"
        ATTENDANCE = "ATTENDANCE", "Attendance"
        PAYROLL = "PAYROLL", "Payroll"
        ACCOUNTING = "ACCOUNTING", "Accounting"
        RECRUITMENT = "RECRUITMENT", "Recruitment"
        REPORTS = "REPORTS", "Reports"

    class ConfigurationStatus(models.TextChoices):
        NOT_CONFIGURED = "NOT_CONFIGURED", "Not configured"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        READY = "READY", "Ready"
        BLOCKED = "BLOCKED", "Blocked"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="modules"
    )
    module_code = models.CharField(max_length=20, choices=ModuleCode.choices)
    is_enabled = models.BooleanField(default=False)
    enabled_at = models.DateTimeField(null=True, blank=True)
    enabled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="enabled_institution_modules",
    )
    configuration_status = models.CharField(
        max_length=20,
        choices=ConfigurationStatus.choices,
        default=ConfigurationStatus.NOT_CONFIGURED,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "module_code"),
                name="uniq_module_per_institution",
            )
        ]
        indexes = [models.Index(fields=("institution", "is_enabled"))]

    def clean(self):
        if self.enabled_by_id and self.institution_id:
            if not self.enabled_by.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                raise ValidationError(
                    {"enabled_by": "Enabling user must belong to the same institution."}
                )

    def __str__(self):
        return f"{self.institution.code}: {self.module_code}"


class InstitutionOnboarding(BaseModel):
    class Status(models.TextChoices):
        NOT_STARTED = "NOT_STARTED", "Not started"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        BLOCKED = "BLOCKED", "Blocked"
        READY = "READY", "Ready"

    institution = models.OneToOneField(
        Institution, on_delete=models.CASCADE, related_name="onboarding"
    )
    current_step = models.CharField(max_length=100, default="ORGANIZATION_SETUP")
    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.NOT_STARTED
    )
    completion_percentage = models.PositiveSmallIntegerField(default=0)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="completed_institution_onboarding",
    )
    validation_summary = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(completion_percentage__lte=100),
                name="onboarding_completion_lte_100",
            )
        ]

    def clean(self):
        if self.completed_by_id and self.institution_id:
            if not self.completed_by.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                raise ValidationError(
                    {"completed_by": "Completing user must belong to the institution."}
                )

    def save(self, *args, **kwargs):
        if not kwargs.get("raw", False):
            self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.institution.code}: {self.status}"


class InstitutionOnboardingStep(TenantOwnedModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        COMPLETED = "COMPLETED", "Completed"
        SKIPPED = "SKIPPED", "Skipped"
        BLOCKED = "BLOCKED", "Blocked"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="onboarding_steps"
    )
    code = models.CharField(max_length=64)
    sequence = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    required_module = models.CharField(max_length=20, blank=True)
    blocker_code = models.CharField(max_length=100, blank=True)
    blocker_message = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # Distinguishes a deliberate administrator deferral from a step that was
    # automatically skipped because its module was disabled.
    is_admin_skipped = models.BooleanField(default=False)

    class Meta:
        ordering = ("sequence", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"), name="uniq_onboarding_step_per_institution"
            ),
            models.UniqueConstraint(
                fields=("institution", "sequence"), name="uniq_onboarding_step_sequence"
            ),
        ]
        indexes = [models.Index(fields=("institution", "status"))]


class UserPreference(TenantOwnedModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="preferences"
    )
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="user_preferences"
    )
    preference_key = models.CharField(max_length=100)
    value_json = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "institution", "preference_key"),
                name="uniq_user_preference_per_institution",
            )
        ]
        indexes = [models.Index(fields=("institution", "user"))]

    def clean(self):
        self.preference_key = self.preference_key.strip().lower()
        if self.user_id and self.institution_id and not self.user.memberships.filter(
            institution_id=self.institution_id
        ).exists():
            raise ValidationError({"user": "User must belong to the selected institution."})

    def save(self, *args, **kwargs):
        self.preference_key = self.preference_key.strip().lower()
        super().save(*args, **kwargs)


class UserActivityEvent(TenantOwnedModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="activity_events"
    )
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="user_activity_events"
    )
    activity_code = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=150, blank=True)
    entity_id = models.UUIDField(null=True, blank=True)
    occurred_at = models.DateTimeField()

    class Meta:
        ordering = ("-occurred_at",)
        indexes = [
            models.Index(fields=("institution", "user", "activity_code")),
            models.Index(fields=("institution", "user", "occurred_at")),
        ]

    def clean(self):
        if self.user_id and self.institution_id and not self.user.memberships.filter(
            institution_id=self.institution_id
        ).exists():
            raise ValidationError({"user": "User must belong to the selected institution."})


class ReferenceSequence(TenantOwnedModel):
    class ResetPolicy(models.TextChoices):
        NEVER = "NEVER", "Never"
        YEARLY = "YEARLY", "Yearly"
        MONTHLY = "MONTHLY", "Monthly"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="reference_sequences"
    )
    namespace = models.CharField(max_length=50)
    prefix = models.CharField(max_length=32)
    current_value = models.PositiveBigIntegerField(default=0)
    padding = models.PositiveSmallIntegerField(default=6)
    reset_policy = models.CharField(
        max_length=10, choices=ResetPolicy.choices, default=ResetPolicy.NEVER
    )
    last_reset_key = models.CharField(max_length=20, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "namespace"),
                name="uniq_reference_sequence_per_institution_namespace",
            ),
            models.CheckConstraint(
                condition=models.Q(padding__gte=1) & models.Q(padding__lte=12),
                name="reference_sequence_padding_range",
            ),
        ]
        indexes = [models.Index(fields=("institution", "namespace"))]

    def clean(self):
        self.namespace = self.namespace.strip().upper()
        self.prefix = self.prefix.strip().upper()
        if not self.prefix:
            raise ValidationError({"prefix": "A reference prefix is required."})

    def save(self, *args, **kwargs):
        self.namespace = self.namespace.strip().upper()
        self.prefix = self.prefix.strip().upper()
        super().save(*args, **kwargs)


class SystemFeatureFlag(BaseModel):
    code = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    is_enabled = models.BooleanField(default=False)
    rollout_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("code",)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.code


class InstitutionFeatureOverride(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="feature_overrides"
    )
    feature_flag = models.ForeignKey(
        SystemFeatureFlag, on_delete=models.PROTECT, related_name="institution_overrides"
    )
    is_enabled = models.BooleanField()
    reason = models.TextField(blank=True)
    set_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="feature_overrides_set",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "feature_flag"),
                name="uniq_feature_override_per_institution",
            )
        ]
        indexes = [models.Index(fields=("institution", "is_enabled"))]

    def clean(self):
        if self.set_by_id and self.institution_id:
            if not self.set_by.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                raise ValidationError(
                    {"set_by": "Setting user must belong to the same institution."}
                )


class InstitutionSetting(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="settings"
    )
    key = models.CharField(max_length=150)
    value = models.JSONField(default=dict, blank=True)
    is_sensitive = models.BooleanField(default=False)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="institution_settings_updated",
    )

    class Meta:
        ordering = ("key",)
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "key"), name="uniq_setting_key_per_institution"
            )
        ]

    def clean(self):
        if self.updated_by_id and self.institution_id:
            if not self.updated_by.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                raise ValidationError(
                    {"updated_by": "Updating user must belong to the same institution."}
                )

    def save(self, *args, **kwargs):
        self.key = self.key.strip().lower()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.institution.code}: {self.key}"


class SearchEntry(TenantOwnedModel):
    """A user's recent or saved global search (concept "Global search results")."""

    class Kind(models.TextChoices):
        RECENT = "RECENT", "Recent"
        SAVED = "SAVED", "Saved"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="search_entries")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="search_entries")
    kind = models.CharField(max_length=6, choices=Kind.choices)
    query = models.CharField(max_length=200)
    name = models.CharField(max_length=120, blank=True)
    filters = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-updated_at",)
        indexes = [models.Index(fields=("institution", "user", "kind", "updated_at"))]
