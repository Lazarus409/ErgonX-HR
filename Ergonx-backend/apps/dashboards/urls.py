from rest_framework.routers import DefaultRouter

from apps.dashboards.views import DashboardViewSet, HomeViewSet

router = DefaultRouter()
router.register("dashboards", DashboardViewSet, basename="dashboard")
router.register("home", HomeViewSet, basename="home")
urlpatterns = router.urls
