import re

from django.http import HttpResponse
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from apps.reports.services import build_report_details, build_report_rows, rows_to_csv
from apps.institutions.services import effective_permission_codes
from common.permissions import TenantContextPermission, TenantRBACPermission
from common.scoping import ATTENDANCE_BROAD, LEAVE_BROAD, scope_to_employees

# Beyond report.view, a report needs the permissions that already guard its data,
# so a role never reads a summary of records it could not open directly. Each
# entry is a list of requirements; a requirement is met by any one of its codes.
# Leave and attendance need a management permission: leave.view and
# attendance.view alone are self-service (every staff member has them for their
# own records), so they do not open the institution-wide reports.
REPORT_PERMISSIONS = {
    "workforce-cost": (("employee.view",), ("payroll.view",)),
    "recruitment": (("candidate.view",),),
    "leave": (LEAVE_BROAD,),
    "attendance": (ATTENDANCE_BROAD,),
    "payroll": (("payroll.view",),),
    "accounting": (("journal.view",),),
    "ap-ar": (("invoice.view",), ("vendor_bill.view",)),
    "expenses": (("expense.view",),),
}


@extend_schema(responses={200: OpenApiTypes.OBJECT})
class ReportsViewSet(ViewSet):
    permission_classes = (TenantContextPermission, TenantRBACPermission)

    @property
    def required_module(self):
        return {
            "leave": "LEAVE",
            "attendance": "ATTENDANCE",
            "payroll": "PAYROLL",
            "accounting": "ACCOUNTING",
            "ap_ar": "ACCOUNTING",
            "expenses": "ACCOUNTING",
            "recruitment": "RECRUITMENT",
        }.get(self.action)

    def get_required_permission(self):
        return "report.view"

    def _respond(self, request, name):
        granted = set(effective_permission_codes(request.membership))
        # report.all (directors, auditors) opens every report read-only and institution-wide.
        # REPORTS gates every reports surface, as well as the source module (Wave 0 BQ-05).
        if not request.institution.modules.filter(module_code="REPORTS", is_enabled=True).exists():
            raise PermissionDenied("The REPORTS module is disabled.", code="module_disabled")
        sees_all = "report.all" in granted
        if not sees_all and not all(granted & set(requirement) for requirement in REPORT_PERMISSIONS[name]):
            raise PermissionDenied("Your role does not include access to this report.")
        filters = {
            "status": request.query_params.get("status"),
            "date_from": request.query_params.get("date_from"),
            "date_to": request.query_params.get("date_to"),
        }
        # ?group=<value>[&group=<value>] opens one summary row: the records it counted.
        group = request.query_params.getlist("group")
        try:
            if group:
                rows = build_report_details(
                    request.institution,
                    name,
                    group,
                    scope=(lambda queryset, field, **options: queryset) if sees_all else (lambda queryset, field, **options: scope_to_employees(queryset, request, field, **options)),
                    **filters,
                )
            else:
                rows = build_report_rows(request.institution, name, **filters)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        if request.query_params.get("export") != "csv":
            return Response({"report": name, "group": group, "rows": rows} if group else {"report": name, "rows": rows})
        # Group values come from the query string, so only safe characters reach the header.
        filename = re.sub(r"[^a-z0-9-]+", "-", "-".join([name, *group]).lower()).strip("-")
        response = HttpResponse(rows_to_csv(rows), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
        return response

    @action(detail=False, methods=("get",), url_path="workforce-cost")
    def workforce_cost(self, request):
        return self._respond(request, "workforce-cost")

    @action(detail=False, methods=("get",))
    def leave(self, request):
        return self._respond(request, "leave")

    @action(detail=False, methods=("get",))
    def attendance(self, request):
        return self._respond(request, "attendance")

    @action(detail=False, methods=("get",))
    def payroll(self, request):
        return self._respond(request, "payroll")

    @action(detail=False, methods=("get",))
    def accounting(self, request):
        return self._respond(request, "accounting")

    @action(detail=False, methods=("get",), url_path="ap-ar")
    def ap_ar(self, request):
        return self._respond(request, "ap-ar")

    @action(detail=False, methods=("get",))
    def expenses(self, request):
        return self._respond(request, "expenses")

    @action(detail=False, methods=("get",))
    def recruitment(self, request):
        return self._respond(request, "recruitment")
