from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.institutions.views import CurrentInstitutionView, InstitutionInvitationViewSet, InstitutionModuleViewSet, InstitutionOnboardingStepActionView, InstitutionOnboardingView, InstitutionSettingsView, LocaleCataloguesView, MembershipViewSet, MyMembershipsView, MyPreferencesView, PermissionCatalogView, RoleViewSet

router = DefaultRouter()
router.register("roles", RoleViewSet, basename="role")
router.register("members", MembershipViewSet, basename="membership")
router.register("invitations", InstitutionInvitationViewSet, basename="institution-invitation")
router.register("modules", InstitutionModuleViewSet, basename="institution-module")

# Search is mounted once, at /api/v1/search/ (W0-API-03).
urlpatterns = [
    path("current/", CurrentInstitutionView.as_view(), name="current"),
    path("memberships/", MyMembershipsView.as_view(), name="memberships"),
    path("permissions/", PermissionCatalogView.as_view(), name="permission-catalog"),
    path("preferences/", MyPreferencesView.as_view(), name="my-preferences"),
    path("settings/", InstitutionSettingsView.as_view(), name="institution-settings"),
    path("locale-catalogues/", LocaleCataloguesView.as_view(), name="locale-catalogues"),
    path("onboarding/", InstitutionOnboardingView.as_view(), name="institution-onboarding"),
    path("onboarding/<str:step_code>/<str:action_name>/", InstitutionOnboardingStepActionView.as_view(), name="institution-onboarding-step-action"),
]

urlpatterns += router.urls
