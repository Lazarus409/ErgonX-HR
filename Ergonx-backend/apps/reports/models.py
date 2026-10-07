from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.institutions.models import Institution
from common.codes import AutoCodeMixin
from common.models import TenantOwnedModel


class AnalyticsItem(AutoCodeMixin, TenantOwnedModel):
    """A dashboard or report in the Reports & Analytics library (concept "Reports and analytics").

    ``source`` names the live dashboard or built-in report it opens; the item adds
    ownership, sharing, publication status, category, saved filters and a refresh
    schedule. System items mirror the built-in dashboards and reports and cannot be
    edited or shared individually.
    """

    auto_code_field = "code"
    auto_code_prefix = "ANL"
    auto_code_width = 4

    class Kind(models.TextChoices):
        DASHBOARD = "DASHBOARD", "Dashboard"
        REPORT = "REPORT", "Report"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PUBLISHED = "PUBLISHED", "Published"
        ARCHIVED = "ARCHIVED", "Archived"

    class Visibility(models.TextChoices):
        PRIVATE = "PRIVATE", "Only me"
        SHARED = "SHARED", "Specific people"
        INSTITUTION = "INSTITUTION", "Everyone with access"

    class Category(models.TextChoices):
        FINANCE = "FINANCE", "Finance"
        HR = "HR", "HR"
        OPERATIONS = "OPERATIONS", "Operations"
        RECRUITMENT = "RECRUITMENT", "Recruitment"
        CUSTOM = "CUSTOM", "Custom"

    class Schedule(models.TextChoices):
        NONE = "NONE", "Not scheduled"
        DAILY = "DAILY", "Daily"
        WEEKLY = "WEEKLY", "Weekly"
        MONTHLY = "MONTHLY", "Monthly"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="analytics_items")
    code = models.CharField(max_length=50, blank=True)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True, max_length=2000)
    kind = models.CharField(max_length=10, choices=Kind.choices)
    source = models.CharField(max_length=40)
    filters = models.JSONField(default=dict, blank=True)
    category = models.CharField(max_length=12, choices=Category.choices, default=Category.CUSTOM)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="analytics_items_owned")
    is_system = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    visibility = models.CharField(max_length=12, choices=Visibility.choices, default=Visibility.PRIVATE)
    schedule = models.CharField(max_length=8, choices=Schedule.choices, default=Schedule.NONE)
    next_run_on = models.DateField(null=True, blank=True)
    last_refreshed_at = models.DateTimeField(null=True, blank=True)
    last_refreshed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    last_row_count = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(fields=("institution", "code"), condition=~models.Q(code=""), name="uniq_analytics_item_code"),
            models.UniqueConstraint(fields=("institution", "kind", "source"), condition=models.Q(is_system=True), name="uniq_system_analytics_item"),
        ]
        indexes = [models.Index(fields=("institution", "status")), models.Index(fields=("institution", "owner"))]

    def clean(self):
        from apps.reports.library import SOURCES

        errors = {}
        if (self.kind, self.source) not in SOURCES:
            errors["source"] = "Choose a dashboard or report that ErgonX provides."
        if self.is_system and self.owner_id:
            errors["owner"] = "Built-in items have no owner."
        if not self.is_system and not self.owner_id:
            errors["owner"] = "A saved item needs an owner."
        if self.visibility == self.Visibility.INSTITUTION and self.status == self.Status.DRAFT and not self.is_system:
            errors["visibility"] = "Publish the item before sharing it with the institution."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return self.name


class AnalyticsShare(TenantOwnedModel):
    """A person an owner shared a saved dashboard or report with."""

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="analytics_shares")
    item = models.ForeignKey(AnalyticsItem, on_delete=models.CASCADE, related_name="shares")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="analytics_shares")
    can_edit = models.BooleanField(default=False)
    shared_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=("item", "user"), name="uniq_analytics_share")]

    def clean(self):
        if self.item_id and self.item.institution_id != self.institution_id:
            raise ValidationError({"item": "Item belongs to another institution."})
