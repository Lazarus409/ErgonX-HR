from rest_framework.routers import DefaultRouter

from apps.performance.views import CompetencyViewSet, PerformanceReviewViewSet, ReviewCycleViewSet

router = DefaultRouter()
router.register("performance-competencies", CompetencyViewSet, basename="performance-competency")
router.register("review-cycles", ReviewCycleViewSet, basename="review-cycle")
router.register("performance-reviews", PerformanceReviewViewSet, basename="performance-review")
urlpatterns = router.urls
