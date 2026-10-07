import uuid

from django.db import models


class BaseModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class TenantQuerySet(models.QuerySet):
    def for_institution(self, institution):
        if institution is None:
            return self.none()
        return self.filter(institution=institution)


class TenantManager(models.Manager.from_queryset(TenantQuerySet)):
    pass


class TenantOwnedModel(BaseModel):
    objects = TenantManager()

    def save(self, *args, **kwargs):
        if not kwargs.get("raw", False):
            # Cross-table tenant constraints cannot generally be expressed as SQL
            # CHECK constraints. Always execute model-level invariant validation.
            self.full_clean(validate_constraints=False)
        super().save(*args, **kwargs)

    class Meta:
        abstract = True
