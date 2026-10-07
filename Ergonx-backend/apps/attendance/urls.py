from rest_framework.routers import DefaultRouter

from apps.attendance.views import (
    AttendanceAdjustmentViewSet,
    AttendanceRecordViewSet,
    OvertimeRecordViewSet,
)


router = DefaultRouter()
router.register("attendance-records", AttendanceRecordViewSet, basename="attendance-record")
router.register(
    "attendance-adjustments", AttendanceAdjustmentViewSet, basename="attendance-adjustment"
)
router.register("overtime-records", OvertimeRecordViewSet, basename="overtime-record")

urlpatterns = router.urls
