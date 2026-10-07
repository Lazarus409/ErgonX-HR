from django.urls import path

from apps.notifications.views import (
    NotificationBulkActionView,
    NotificationListView,
    NotificationMarkAllReadView,
    NotificationMarkReadView,
    NotificationPreferencesView,
)

urlpatterns = [
    path("notifications/", NotificationListView.as_view(), name="notification-list"),
    path("notifications/bulk/", NotificationBulkActionView.as_view(), name="notification-bulk"),
    path("notifications/preferences/", NotificationPreferencesView.as_view(), name="notification-preferences"),
    path("notifications/mark-all-read/", NotificationMarkAllReadView.as_view(), name="notification-mark-all-read"),
    path("notifications/<uuid:notification_id>/mark-read/", NotificationMarkReadView.as_view(), name="notification-mark-read"),
]
