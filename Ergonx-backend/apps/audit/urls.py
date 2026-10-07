from django.urls import path

from apps.audit.history import RecordHistoryView
from apps.audit.views import AuditLogListView, AuditSummaryView

urlpatterns = [
    path("audit/", AuditLogListView.as_view(), name="audit-log-list"),
    path("audit/summary/", AuditSummaryView.as_view(), name="audit-summary"),
    path("record-history/<str:record_type>/<uuid:pk>/", RecordHistoryView.as_view(), name="record-history"),
]
