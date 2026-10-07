from rest_framework.routers import DefaultRouter

from apps.documents.views import DocumentViewSet, ImageAssetViewSet

router = DefaultRouter()
router.register("documents", DocumentViewSet, basename="document")
router.register("images", ImageAssetViewSet, basename="image")
urlpatterns = router.urls
