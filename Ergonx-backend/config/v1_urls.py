from django.conf import settings
from django.urls import include, path

from apps.institutions.access import AccessRequestView
from apps.institutions.views import UniversalSearchView, SearchEntriesView

# URL modules that exist only for one module. Those of excluded modules
# (settings.ERGONX_EXCLUDED_MODULES) are not mounted at all.
MODULE_URLCONFS = {
    "apps.compensation.urls": "PAYROLL",
    "apps.payroll.urls": "PAYROLL",
    "apps.accounting.urls": "ACCOUNTING",
}

urlpatterns = [
    path("auth/", include("apps.accounts.urls")),
    path("institutions/", include("apps.institutions.urls")),
    path("platform/", include("apps.accounts.platform_urls")),
    path("", include("apps.audit.urls")),
    path("search/", UniversalSearchView.as_view(), name="universal-search"),
    path("search/entries/", SearchEntriesView.as_view(), name="search-entries"),
    path("access-requests/", AccessRequestView.as_view(), name="access-requests"),
]
urlpatterns += [
    path("", include(urlconf))
    for urlconf in (
        "apps.organization.urls",
        "apps.employees.urls",
        "apps.leave.urls",
        "apps.scheduling.urls",
        "apps.attendance.urls",
        "apps.compensation.urls",
        "apps.payroll.urls",
        "apps.accounting.urls",
        "apps.documents.urls",
        "apps.workflows.urls",
        "apps.operations.urls",
        "apps.dashboards.urls",
        "apps.reports.urls",
        "apps.recruitment.urls",
        "apps.notifications.urls",
    )
    if MODULE_URLCONFS.get(urlconf) not in settings.ERGONX_EXCLUDED_MODULES
]
