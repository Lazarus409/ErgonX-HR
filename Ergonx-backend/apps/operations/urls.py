from rest_framework.routers import DefaultRouter

from apps.operations.views import BackgroundJobViewSet, ExportJobViewSet, ImportJobViewSet, ImportRowResultViewSet

router = DefaultRouter()
router.register("import-jobs", ImportJobViewSet, basename="import-job")
router.register("import-row-results", ImportRowResultViewSet, basename="import-row-result")
router.register("export-jobs", ExportJobViewSet, basename="export-job")
router.register("background-jobs", BackgroundJobViewSet, basename="background-job")
urlpatterns = router.urls
