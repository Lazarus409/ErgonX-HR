from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.institutions.models import Institution
from common.models import TenantOwnedModel


class Notification(TenantOwnedModel):
    class Channel(models.TextChoices):
        IN_APP = "IN_APP", "In app"
        EMAIL = "EMAIL", "Email"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SENT = "SENT", "Sent"
        FAILED = "FAILED", "Failed"
        READ = "READ", "Read"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="notifications"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    notification_type = models.CharField(max_length=100)
    title = models.CharField(max_length=200)
    message = models.TextField()
    channel = models.CharField(max_length=10, choices=Channel.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    read_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    # Archived notifications leave the inbox but are kept (Notification Center, S056).
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("institution", "status")),
            models.Index(fields=("user", "read_at")),
        ]

    def clean(self):
        if self.user_id and self.institution_id:
            if not self.user.memberships.filter(institution_id=self.institution_id).exists():
                raise ValidationError(
                    {"user": "Notification user must belong to the same institution."}
                )

    def __str__(self):
        return self.title
