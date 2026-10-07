from django.conf import settings
from django.db import models

from apps.institutions.models import Institution
from common.models import TenantManager, TenantOwnedModel, TenantQuerySet


class AuditLogImmutable(Exception):
    """Audit records are append-only."""


class AuditLogQuerySet(TenantQuerySet):
    def update(self, **kwargs):
        # Deleting a user nulls the actor through on_delete=SET_NULL; nothing else may change.
        if set(kwargs) == {"actor"} and kwargs["actor"] is None:
            return super().update(**kwargs)
        raise AuditLogImmutable("Audit records cannot be changed.")

    def delete(self):
        raise AuditLogImmutable("Audit records cannot be deleted.")


class AuditLogManager(TenantManager.from_queryset(AuditLogQuerySet)):
    pass


class AuditLog(TenantOwnedModel):
    institution = models.ForeignKey(
        Institution,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    action = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=150, blank=True)
    entity_id = models.UUIDField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    objects = AuditLogManager()

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("institution", "created_at")),
            models.Index(fields=("institution", "action")),
            models.Index(fields=("entity_type", "entity_id")),
        ]

    def __str__(self):
        return f"{self.action} at {self.created_at}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise AuditLogImmutable("Audit records cannot be changed.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AuditLogImmutable("Audit records cannot be deleted.")

    @property
    def timestamp(self):
        """Canonical audit event time; backed by immutable BaseModel.created_at."""
        return self.created_at
