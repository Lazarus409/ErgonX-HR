from django.urls import path

from apps.accounts.views import AccountProfileView, AuthBootstrapView, InstitutionAccessRequestDecisionView, InstitutionAccessRequestView, InstitutionAdminInvitationAcceptanceView, InstitutionAdminInvitationActionView, InstitutionAdminInvitationView, InvitationAcceptanceView, LoginView, LogoutView, MFASettingsView, SessionListView, SignInActivityView, SessionRevokeOthersView, SessionRevokeView, MeView, PasswordChangeView, PasswordResetConfirmView, PasswordResetRequestView, RefreshView, SelfServiceRegistrationView

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("security/mfa/", MFASettingsView.as_view(), name="mfa-settings"),
    path("register/", SelfServiceRegistrationView.as_view(), name="register"),
    path("institution-admin-invitations/", InstitutionAdminInvitationView.as_view(), name="institution-admin-invitation"),
    path("institution-admin-invitations/<uuid:pk>/<str:action>/", InstitutionAdminInvitationActionView.as_view(), name="institution-admin-invitation-action"),
    path("institution-admin-invitations/<str:token>/", InstitutionAdminInvitationAcceptanceView.as_view(), name="institution-admin-invitation-acceptance"),
    path("institution-access-requests/", InstitutionAccessRequestView.as_view(), name="institution-access-request"),
    path("institution-access-requests/<uuid:pk>/<str:decision>/", InstitutionAccessRequestDecisionView.as_view(), name="institution-access-request-decision"),
    path("refresh/", RefreshView.as_view(), name="refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("sessions/", SessionListView.as_view(), name="sessions"),
    path("security/activity/", SignInActivityView.as_view(), name="sign-in-activity"),
    path("sessions/revoke-others/", SessionRevokeOthersView.as_view(), name="sessions-revoke-others"),
    path("sessions/<uuid:pk>/revoke/", SessionRevokeView.as_view(), name="session-revoke"),
    path("me/", MeView.as_view(), name="me"),
    path("profile/", AccountProfileView.as_view(), name="account-profile"),
    path("profile/password/", PasswordChangeView.as_view(), name="account-password-change"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path("bootstrap/", AuthBootstrapView.as_view(), name="auth-bootstrap"),
    path("invitations/<str:token>/", InvitationAcceptanceView.as_view(), name="invitation-acceptance"),
]
