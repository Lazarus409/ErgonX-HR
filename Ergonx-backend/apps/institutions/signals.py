import logging

from django.db.models.signals import post_migrate, post_save
from django.dispatch import receiver

from apps.institutions.models import Institution
from apps.institutions.services import bootstrap_institution, ensure_system_permissions, sync_system_role_permissions

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Institution)
def initialize_institution(sender, instance, created, **kwargs):
    if created:
        bootstrap_institution(instance)


@receiver(post_migrate)
def initialize_permissions(sender, **kwargs):
    if sender.label == "institutions":
        ensure_system_permissions()
        # Built-in roles follow the code on every deploy; log any repair.
        for role_code, change in sync_system_role_permissions().items():
            logger.warning("Synced %s role permissions: added %s, removed %s", role_code, change["added"], change["removed"])
