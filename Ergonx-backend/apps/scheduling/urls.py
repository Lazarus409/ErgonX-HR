from rest_framework.routers import DefaultRouter

from apps.scheduling.views import (
    FlexibleWorkRuleViewSet,
    RotationPatternViewSet,
    RotationStepViewSet,
    ScheduleAssignmentViewSet,
    ShiftPatternDayViewSet,
    ShiftPatternViewSet,
    ShiftViewSet,
    WorkScheduleViewSet,
)


router = DefaultRouter()
router.register("shifts", ShiftViewSet, basename="shift")
router.register("shift-patterns", ShiftPatternViewSet, basename="shift-pattern")
router.register("shift-pattern-days", ShiftPatternDayViewSet, basename="shift-pattern-day")
router.register("rotation-patterns", RotationPatternViewSet, basename="rotation-pattern")
router.register("rotation-steps", RotationStepViewSet, basename="rotation-step")
router.register("flexible-work-rules", FlexibleWorkRuleViewSet, basename="flexible-work-rule")
router.register("work-schedules", WorkScheduleViewSet, basename="work-schedule")
router.register("schedule-assignments", ScheduleAssignmentViewSet, basename="schedule-assignment")

urlpatterns = router.urls
