from apps.organization.models import Department, Grade, Location, Position
from apps.organization.serializers import (
    DepartmentSerializer,
    GradeSerializer,
    LocationSerializer,
    PositionSerializer,
)
from common.viewsets import TenantModelViewSet


class DepartmentViewSet(TenantModelViewSet):
    model = Department
    serializer_class = DepartmentSerializer
    permission_resource = "organization"
    search_fields = ("name", "code")
    ordering_fields = ("name", "code", "created_at", "updated_at")

    def get_queryset(self):
        return super().get_queryset().select_related("parent", "head")


class PositionViewSet(TenantModelViewSet):
    model = Position
    serializer_class = PositionSerializer
    permission_resource = "organization"
    search_fields = ("title", "code", "department__name")
    ordering_fields = ("title", "code", "created_at", "updated_at")

    def get_queryset(self):
        return super().get_queryset().select_related("department")


class GradeViewSet(TenantModelViewSet):
    model = Grade
    serializer_class = GradeSerializer
    permission_resource = "organization"
    search_fields = ("name", "code")
    ordering_fields = ("level", "name", "code", "created_at", "updated_at")


class LocationViewSet(TenantModelViewSet):
    model = Location
    serializer_class = LocationSerializer
    permission_resource = "organization"
    search_fields = ("name", "code", "city", "country")
    ordering_fields = ("name", "code", "created_at", "updated_at")
