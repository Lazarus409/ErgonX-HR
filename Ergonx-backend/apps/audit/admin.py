from django.contrib import admin

from apps.audit.models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Read-only: the audit trail is append-only (Wave 0 AUD-01)."""

    list_display = ("created_at", "action", "actor", "institution", "entity_type", "ip_address")
    list_filter = ("action",)
    search_fields = ("action", "entity_type", "actor__email")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
