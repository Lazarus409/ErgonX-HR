from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.institutions.models import Institution
from common.models import TenantOwnedModel


class Document(TenantOwnedModel):
    class Classification(models.TextChoices):
        INTERNAL = "INTERNAL", "Internal"
        CONFIDENTIAL = "CONFIDENTIAL", "Confidential"
        RESTRICTED = "RESTRICTED", "Restricted"

    institution = models.ForeignKey(
        Institution, on_delete=models.PROTECT, related_name="documents"
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_documents",
    )
    file_reference = models.CharField(max_length=500, blank=True)
    stored_file = models.FileField(upload_to="documents/%Y/%m/", blank=True, null=True)
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=150)
    size_bytes = models.PositiveBigIntegerField()
    category = models.CharField(max_length=100, blank=True)
    classification = models.CharField(
        max_length=20,
        choices=Classification.choices,
        default=Classification.CONFIDENTIAL,
    )
    checksum = models.CharField(max_length=128, blank=True)
    entity_type = models.CharField(max_length=150, blank=True)
    entity_id = models.UUIDField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("institution", "is_active")),
            models.Index(fields=("institution", "category")),
            models.Index(fields=("entity_type", "entity_id")),
        ]

    def clean(self):
        if self.uploaded_by_id and self.institution_id:
            if not self.uploaded_by.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                raise ValidationError(
                    {"uploaded_by": "Uploader must belong to the same institution."}
                )

    def __str__(self):
        return self.original_filename


class ImageAsset(TenantOwnedModel):
    """Private tenant-scoped profile/employee/institution image storage."""

    class OwnerType(models.TextChoices):
        USER = "USER", "User"
        EMPLOYEE = "EMPLOYEE", "Employee"
        INSTITUTION = "INSTITUTION", "Institution"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="image_assets")
    owner_type = models.CharField(max_length=20, choices=OwnerType.choices)
    owner_id = models.UUIDField()
    stored_file = models.FileField(upload_to="images/%Y/%m/", max_length=500)
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size_bytes = models.PositiveBigIntegerField()
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("institution", "owner_type", "owner_id"), condition=models.Q(is_active=True), name="uniq_active_image_owner")]
        indexes = [models.Index(fields=("institution", "owner_type", "owner_id", "is_active"))]

    def __str__(self):
        return f"{self.owner_type} image {self.owner_id}"


# Documents attached to an employee record use this entity type, whether HR or
# the employee uploaded them (see apps.documents.checklist).
EMPLOYEE_ENTITY_TYPE = "EMPLOYEE"


class DocumentRequirement(TenantOwnedModel):
    """A document every (or some) employee must have on file, e.g. a Ghana Card.

    An employee meets the requirement with an active document attached to their
    record whose category matches ``document_category`` (case-insensitive).
    """

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="document_requirements")
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    document_category = models.CharField(max_length=100)
    # Empty means every employment type; otherwise e.g. ["PERMANENT", "CONTRACT"].
    employment_types = models.JSONField(default=list, blank=True)
    # A renewable document (e.g. medical fitness) expires this many months after upload.
    validity_months = models.PositiveSmallIntegerField(null=True, blank=True)
    is_mandatory = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("sort_order", "name")
        constraints = [
            models.UniqueConstraint(fields=("institution", "name"), name="uniq_document_requirement_name"),
        ]

    def clean(self):
        from apps.employees.models import Employment

        self.name = self.name.strip()
        self.document_category = self.document_category.strip()
        errors = {}
        if not self.document_category:
            errors["document_category"] = "Name the document category that satisfies this requirement."
        allowed = set(Employment.EmploymentType.values)
        if not isinstance(self.employment_types, list) or any(value not in allowed for value in self.employment_types):
            errors["employment_types"] = f"Use employment types from: {', '.join(sorted(allowed))}."
        if self.validity_months is not None and not 1 <= self.validity_months <= 120:
            errors["validity_months"] = "Validity must be between 1 and 120 months."
        if errors:
            raise ValidationError(errors)

    def applies_to(self, employment_type):
        return not self.employment_types or employment_type in self.employment_types

    def __str__(self):
        return self.name


class DocumentRequirementWaiver(TenantOwnedModel):
    """HR has excused one employee from one requirement, with a reason."""

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="document_requirement_waivers")
    requirement = models.ForeignKey(DocumentRequirement, on_delete=models.CASCADE, related_name="waivers")
    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="document_requirement_waivers")
    reason = models.TextField()
    waived_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(fields=("requirement", "employee"), name="uniq_document_waiver_per_employee"),
        ]

    def clean(self):
        errors = {}
        if not (self.reason or "").strip():
            errors["reason"] = "Explain why this employee is excused."
        for name in ("requirement", "employee"):
            related = getattr(self, name, None)
            if related is not None and related.institution_id != self.institution_id:
                errors[name] = "Referenced record must belong to the same institution."
        if errors:
            raise ValidationError(errors)
