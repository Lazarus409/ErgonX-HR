from rest_framework import viewsets

from common.permissions import TenantContextPermission, TenantRBACPermission


class TenantModelViewSet(viewsets.ModelViewSet):
    permission_classes = [TenantContextPermission, TenantRBACPermission]
    required_module = "CORE_HR"
    permission_resource = None
    required_permission = None
    search_fields = ()
    ordering_fields = ("created_at", "updated_at")
    ordering = ("-created_at",)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.model.objects.none()
        return self.model.objects.for_institution(self.request.institution)

    def get_required_permission(self):
        if self.required_permission is not None:
            return self.required_permission
        action_suffix = {
            "list": "view",
            "retrieve": "view",
            "create": "create",
            "update": "update",
            "partial_update": "update",
            "destroy": "delete",
        }.get(self.action)
        if action_suffix is None or self.permission_resource is None:
            return None
        return f"{self.permission_resource}.{action_suffix}"

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution)

    def perform_destroy(self, instance):
        if hasattr(instance, "is_active"):
            instance.is_active = False
            instance.save(update_fields=("is_active", "updated_at"))
            return
        super().perform_destroy(instance)
