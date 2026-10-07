from rest_framework.routers import DefaultRouter

from apps.organization.views import (
    DepartmentViewSet,
    GradeViewSet,
    LocationViewSet,
    PositionViewSet,
)

router = DefaultRouter()
router.register("departments", DepartmentViewSet, basename="department")
router.register("positions", PositionViewSet, basename="position")
router.register("grades", GradeViewSet, basename="grade")
router.register("locations", LocationViewSet, basename="location")

urlpatterns = router.urls
