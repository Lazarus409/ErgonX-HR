from rest_framework.routers import DefaultRouter
from apps.reports.library import AnalyticsLibraryViewSet
from apps.reports.views import ReportsViewSet

router = DefaultRouter()
router.register("reports", ReportsViewSet, basename="report")
router.register("report-library", AnalyticsLibraryViewSet, basename="report-library")
urlpatterns = router.urls
