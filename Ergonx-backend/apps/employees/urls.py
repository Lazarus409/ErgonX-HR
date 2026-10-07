from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.employees.views import EmergencyContactViewSet, EmployeeViewSet, EmploymentViewSet, SelfServiceDocumentDetailView, SelfServiceDocumentsView, SelfServiceEmergencyContactDetailView, SelfServiceEmergencyContactsView, SelfServiceProfileView

router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")
router.register("emergency-contacts", EmergencyContactViewSet, basename="emergency-contact")
router.register("employments", EmploymentViewSet, basename="employment")

urlpatterns = [
    path("employees/me/profile/", SelfServiceProfileView.as_view()),
    path("employees/me/emergency-contacts/", SelfServiceEmergencyContactsView.as_view()),
    path("employees/me/emergency-contacts/<uuid:pk>/", SelfServiceEmergencyContactDetailView.as_view()),
    path("employees/me/documents/", SelfServiceDocumentsView.as_view()),
    path("employees/me/documents/<uuid:pk>/", SelfServiceDocumentDetailView.as_view()),
] + router.urls
