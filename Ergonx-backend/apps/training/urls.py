from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.training.views import MyTrainingView, TrainingCourseViewSet, TrainingEnrollmentViewSet

router = DefaultRouter()
router.register("training-courses", TrainingCourseViewSet, basename="training-course")
router.register("training-enrollments", TrainingEnrollmentViewSet, basename="training-enrollment")
urlpatterns = [
    path("training/my/", MyTrainingView.as_view(), name="my-training"),
    *router.urls,
]
