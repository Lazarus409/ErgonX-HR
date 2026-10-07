from apps.scheduling.models import (
    FlexibleWorkRule,
    RotationPattern,
    RotationStep,
    ScheduleAssignment,
    Shift,
    ShiftPattern,
    ShiftPatternDay,
    WorkSchedule,
)
from apps.scheduling.serializers import (
    FlexibleWorkRuleSerializer,
    RotationPatternSerializer,
    RotationStepSerializer,
    ScheduleAssignmentSerializer,
    ShiftPatternDaySerializer,
    ShiftPatternSerializer,
    ShiftSerializer,
    WorkScheduleSerializer,
)
from common.scoping import ATTENDANCE_BROAD, scope_to_employees
from common.viewsets import TenantModelViewSet


class ScheduleConfigurationViewSet(TenantModelViewSet):
    required_module = "ATTENDANCE"

    def get_required_permission(self):
        if self.action in {"list", "retrieve"}:
            return "schedule.view"
        return "schedule.manage"


class ShiftViewSet(ScheduleConfigurationViewSet):
    model = Shift
    serializer_class = ShiftSerializer
    search_fields = ("name", "code")
    ordering_fields = ("name", "code", "start_time", "created_at", "updated_at")


class ShiftPatternViewSet(ScheduleConfigurationViewSet):
    model = ShiftPattern
    serializer_class = ShiftPatternSerializer
    search_fields = ("name", "code")
    ordering_fields = ("name", "code", "created_at", "updated_at")


class ShiftPatternDayViewSet(ScheduleConfigurationViewSet):
    model = ShiftPatternDay
    serializer_class = ShiftPatternDaySerializer
    filterset_fields = ("shift_pattern", "shift", "is_off_day")
    ordering_fields = ("day_index", "created_at", "updated_at")


class RotationPatternViewSet(ScheduleConfigurationViewSet):
    model = RotationPattern
    serializer_class = RotationPatternSerializer
    search_fields = ("name", "code")


class RotationStepViewSet(ScheduleConfigurationViewSet):
    model = RotationStep
    serializer_class = RotationStepSerializer
    filterset_fields = ("rotation_pattern", "shift_pattern", "shift")
    ordering_fields = ("sequence", "created_at", "updated_at")


class FlexibleWorkRuleViewSet(ScheduleConfigurationViewSet):
    model = FlexibleWorkRule
    serializer_class = FlexibleWorkRuleSerializer
    search_fields = ("name",)


class WorkScheduleViewSet(ScheduleConfigurationViewSet):
    model = WorkSchedule
    serializer_class = WorkScheduleSerializer
    filterset_fields = ("schedule_type", "is_active")
    search_fields = ("name", "code")
    ordering_fields = ("name", "effective_from", "created_at", "updated_at")


class ScheduleAssignmentViewSet(ScheduleConfigurationViewSet):
    model = ScheduleAssignment
    serializer_class = ScheduleAssignmentSerializer
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("employee", "work_schedule", "is_current")
    ordering_fields = ("effective_from", "effective_to", "created_at", "updated_at")

    def get_queryset(self):
        queryset = super().get_queryset().select_related("employee", "work_schedule", "assigned_by")
        return scope_to_employees(queryset, self.request, broad=ATTENDANCE_BROAD)

    def perform_create(self, serializer):
        serializer.save(
            institution=self.request.institution,
            assigned_by=self.request.user,
        )

