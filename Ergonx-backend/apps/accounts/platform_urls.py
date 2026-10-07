from django.urls import path

from apps.accounts.platform import (
    PlatformAuditLogView,
    PlatformInstitutionDetailView,
    PlatformInstitutionListView,
    PlatformInstitutionStatusView,
    PlatformOverviewView,
)

urlpatterns = [
    path("overview/", PlatformOverviewView.as_view(), name="platform-overview"),
    path("institutions/", PlatformInstitutionListView.as_view(), name="platform-institution-list"),
    path("institutions/<uuid:pk>/", PlatformInstitutionDetailView.as_view(), name="platform-institution-detail"),
    path("institutions/<uuid:pk>/<str:action>/", PlatformInstitutionStatusView.as_view(), name="platform-institution-status"),
    path("audit/", PlatformAuditLogView.as_view(), name="platform-audit"),
]
