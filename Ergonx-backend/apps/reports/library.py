"""Reports & Analytics library (concept "Reports and analytics").

Lists the dashboards and reports a member may open: the built-in dashboards and
reports (system items), items members saved and shared, and the institution's
saved financial reports. Every entry is limited by the same permissions that guard
its data, so the library never reveals a dashboard or report its reader could not open.
"""
from datetime import date, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from apps.audit.services import record_audit_event
from apps.institutions.models import InstitutionMembership
from apps.institutions.services import effective_permission_codes
from apps.notifications.models import Notification
from apps.reports.models import AnalyticsItem, AnalyticsShare
from common.permissions import TenantContextPermission, TenantRBACPermission
from common.scoping import INSTITUTION, data_scope

PUBLISH_PERMISSION = "report.publish"
INSIGHT_PERMISSIONS = (
    "dashboard.executive.view", "dashboard.hr.view", "dashboard.payroll.view", "dashboard.finance.view",
    "dashboard.leave.view", "dashboard.attendance.view", "candidate.view", "background_job.view",
)
MODULE_LABELS = {
    "CORE_HR": "HR", "LEAVE": "Leave", "ATTENDANCE": "Attendance", "PAYROLL": "Payroll",
    "ACCOUNTING": "Accounting", "RECRUITMENT": "Recruitment", "REPORTS": "Reports",
}
D, R = AnalyticsItem.Kind.DASHBOARD, AnalyticsItem.Kind.REPORT
C = AnalyticsItem.Category


def _report_requirements(name):
    from apps.reports.views import REPORT_PERMISSIONS

    return REPORT_PERMISSIONS[name]


# (kind, source) -> label, module, category, route, description, access rule.
# A dashboard rule is a tuple of permissions (any one opens it). A report rule
# defers to REPORT_PERMISSIONS, the same check the report endpoint applies.
SOURCES = {
    (D, "executive"): ("Executive Dashboard", "REPORTS", C.OPERATIONS, "/dashboard", "Institution-wide workforce, operations and financial position.", ("dashboard.executive.view",)),
    (D, "insights"): ("Insights", "REPORTS", C.OPERATIONS, "/insights", "Trusted cross-module figures limited to what your role may see.", INSIGHT_PERMISSIONS),
    (D, "hr"): ("HR Headcount", "CORE_HR", C.HR, "/hr/dashboard", "Headcount, hires, departments and workforce composition.", ("dashboard.hr.view",)),
    (D, "leave"): ("Leave Overview", "LEAVE", C.HR, "/leave/dashboard", "Leave requests, absence rate and policy compliance.", ("dashboard.leave.view",)),
    (D, "attendance"): ("Attendance Overview", "ATTENDANCE", C.HR, "/attendance/dashboard", "Daily attendance, lateness and adjustments.", ("dashboard.attendance.view",)),
    (D, "payroll"): ("Payroll Workspace", "PAYROLL", C.FINANCE, "/payroll/dashboard", "Payroll runs, costs and exceptions.", ("dashboard.payroll.view",)),
    (D, "finance"): ("Financial Overview", "ACCOUNTING", C.FINANCE, "/accounting/dashboard", "A high-level view of the institution's financial performance and position.", ("dashboard.finance.view",)),
    (D, "recruitment"): ("Recruitment Pipeline", "RECRUITMENT", C.RECRUITMENT, "/recruitment/dashboard", "Requisitions, applications and hiring progress.", ("candidate.view",)),
    (R, "workforce-cost"): ("Workforce Cost", "CORE_HR", C.HR, "/reports/dashboard?report=workforce-cost", "Headcount and pay by employee status.", None),
    (R, "recruitment"): ("Recruitment Activity", "RECRUITMENT", C.RECRUITMENT, "/reports/dashboard?report=recruitment", "Applications by status.", None),
    (R, "leave"): ("Leave Activity", "LEAVE", C.HR, "/reports/dashboard?report=leave", "Leave requests by status and days.", None),
    (R, "attendance"): ("Attendance Summary", "ATTENDANCE", C.HR, "/reports/dashboard?report=attendance", "Attendance records by status.", None),
    (R, "payroll"): ("Payroll Summary", "PAYROLL", C.FINANCE, "/reports/dashboard?report=payroll", "Payroll totals by run status.", None),
    (R, "accounting"): ("Journal Activity", "ACCOUNTING", C.FINANCE, "/reports/dashboard?report=accounting", "Journals by source and status.", None),
    (R, "ap-ar"): ("AP / AR Balances", "ACCOUNTING", C.FINANCE, "/reports/dashboard?report=ap-ar", "Open payables and receivables.", None),
    (R, "expenses"): ("Expenses", "ACCOUNTING", C.OPERATIONS, "/reports/dashboard?report=expenses", "Expenses by status.", None),
}


class Viewer:
    """The requesting member's access, computed once per request."""

    def __init__(self, request):
        self.user = request.user
        self.institution = request.institution
        self.permissions = set(effective_permission_codes(request.membership))
        self.wide = data_scope(request) == INSTITUTION
        self.enabled = set(self.institution.modules.filter(is_enabled=True).values_list("module_code", flat=True)) | {"CORE_HR"}

    def can_open(self, kind, source):
        definition = SOURCES.get((kind, source))
        if definition is None or not self.wide:
            return False
        module, rule = definition[1], definition[5]
        if module != "REPORTS" and module not in self.enabled:
            return False
        if kind == D:
            return bool(self.permissions & set(rule))
        if "report.view" not in self.permissions:
            return False
        return "report.all" in self.permissions or all(self.permissions & set(requirement) for requirement in _report_requirements(source))

    @property
    def can_publish(self):
        return PUBLISH_PERMISSION in self.permissions


def ensure_system_items(institution):
    """Create the built-in library entries once per institution (idempotent)."""
    existing = set(AnalyticsItem.objects.filter(institution=institution, is_system=True).values_list("kind", "source"))
    for (kind, source), (label, _module, category, _route, description, _rule) in SOURCES.items():
        if (kind, source) in existing:
            continue
        try:
            with transaction.atomic():
                AnalyticsItem.objects.create(
                    institution=institution, name=label, description=description, kind=kind, source=source, category=category,
                    is_system=True, status=AnalyticsItem.Status.PUBLISHED, visibility=AnalyticsItem.Visibility.INSTITUTION,
                )
        except IntegrityError:
            pass  # Created concurrently by another request.


def _shared_ids(viewer):
    return set(AnalyticsShare.objects.filter(institution=viewer.institution, user=viewer.user).values_list("item_id", flat=True))


def visible_items(viewer):
    """Library items the viewer may see, with the ids shared with them."""
    ensure_system_items(viewer.institution)
    shared = _shared_ids(viewer)
    items = (
        AnalyticsItem.objects.filter(institution=viewer.institution)
        .filter(
            Q(owner=viewer.user)
            | Q(pk__in=shared, status__in=(AnalyticsItem.Status.PUBLISHED, AnalyticsItem.Status.DRAFT))
            | Q(is_system=True)
            | Q(visibility=AnalyticsItem.Visibility.INSTITUTION, status=AnalyticsItem.Status.PUBLISHED)
        )
        .exclude(Q(status=AnalyticsItem.Status.ARCHIVED) & ~Q(owner=viewer.user))
        .select_related("owner", "last_refreshed_by")
        .prefetch_related("shares__user")
    )
    return [item for item in items if viewer.can_open(item.kind, item.source)], shared


def _person(user):
    if user is None:
        return None
    name = user.get_full_name() or user.email
    initials = "".join(part[0] for part in name.split()[:2]).upper() or name[:2].upper()
    return {"id": str(user.id), "name": name, "initials": initials}


def freshness(refreshed_at, now=None):
    if refreshed_at is None:
        return {"state": "NEVER", "days": None, "label": "Not refreshed yet"}
    days = ((now or timezone.now()) - refreshed_at).days
    if days < 1:
        return {"state": "UP_TO_DATE", "days": 0, "label": "Up to date"}
    return {"state": "STALE", "days": days, "label": f"{days} day{'s' if days != 1 else ''} ago"}


def _can_edit(item, viewer, shared):
    if item.is_system:
        return False
    if item.owner_id == viewer.user.id:
        return True
    return item.id in shared and any(share.user_id == viewer.user.id and share.can_edit for share in item.shares.all())


def serialize_item(item, viewer, shared):
    label, module, _category, route, _description, _rule = SOURCES[(item.kind, item.source)]
    editable = _can_edit(item, viewer, shared)
    owner_is_viewer = item.owner_id == viewer.user.id
    return {
        "id": str(item.id),
        "origin": "library",
        "code": item.code,
        "name": item.name,
        "description": item.description,
        "kind": item.kind,
        "source": item.source,
        "source_label": label,
        "module": module,
        "module_label": MODULE_LABELS[module],
        "category": item.category,
        "category_label": item.get_category_display(),
        "filters": item.filters,
        "owner": _person(item.owner),
        "is_system": item.is_system,
        "status": item.status,
        "visibility": item.visibility,
        "schedule": item.schedule,
        "next_run_on": item.next_run_on,
        "last_refreshed_at": item.last_refreshed_at,
        "last_refreshed_by": _person(item.last_refreshed_by),
        "last_row_count": item.last_row_count,
        "freshness": freshness(item.last_refreshed_at),
        "href": _href(item, route),
        "shared_with": [{**_person(share.user), "can_edit": share.can_edit} for share in item.shares.all()] if (owner_is_viewer or editable) else [],
        "shared_with_me": item.id in shared,
        "can_edit": editable,
        "can_share": owner_is_viewer and not item.is_system,
        "can_publish": editable and viewer.can_publish,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _href(item, route):
    if item.kind != R or not item.filters:
        return route
    params = "&".join(f"{key}={value}" for key, value in item.filters.items() if key in {"status", "date_from", "date_to"} and value)
    return f"{route}&{params}" if params else route


def financial_report_entries(viewer):
    """The institution's saved financial reports, shown read-only (they are managed in Accounting)."""
    if "ACCOUNTING" not in viewer.enabled or "financial_report.view" not in viewer.permissions or not viewer.wide:
        return []
    from apps.accounting.models import FinancialReport
    from apps.accounting.reporting import _visible, ensure_standard_reports

    ensure_standard_reports(viewer.institution)
    membership = InstitutionMembership.objects.filter(institution=viewer.institution, user=viewer.user, status=InstitutionMembership.Status.ACTIVE).select_related("role").first()
    entries = []
    for report in FinancialReport.objects.filter(institution=viewer.institution).select_related("owner").prefetch_related("runs__run_by"):
        if not _visible(report, membership):
            continue
        runs = sorted(report.runs.all(), key=lambda run: run.version, reverse=True)
        last = runs[0] if runs else None
        entries.append({
            "id": str(report.id),
            "origin": "financial_report",
            "code": report.code,
            "name": report.name,
            "description": report.description,
            "kind": R,
            "source": report.report_type,
            "source_label": report.get_report_type_display(),
            "module": "ACCOUNTING",
            "module_label": "Accounting",
            "category": C.FINANCE,
            "category_label": "Finance",
            "filters": report.parameters,
            "owner": _person(report.owner),
            "is_system": report.is_standard,
            "status": AnalyticsItem.Status.PUBLISHED if last else AnalyticsItem.Status.DRAFT,
            "visibility": AnalyticsItem.Visibility.INSTITUTION if not report.allowed_roles else AnalyticsItem.Visibility.SHARED,
            "schedule": report.schedule_frequency,
            "next_run_on": report.next_run_on,
            "last_refreshed_at": last.created_at if last else None,
            "last_refreshed_by": _person(last.run_by) if last else None,
            "last_row_count": None,
            "freshness": freshness(last.created_at if last else None),
            "href": f"/accounting/reports/{report.id}",
            "shared_with": [],
            "shared_with_me": False,
            "can_edit": False,
            "can_share": False,
            "can_publish": False,
            "created_at": report.created_at,
            "updated_at": report.updated_at,
        })
    return entries


def _section(entry, viewer_id):
    owner = entry["owner"]["id"] if entry["owner"] else None
    if owner == viewer_id:
        return "mine"
    if entry["shared_with_me"]:
        return "shared"
    return "institution"


def library_counts(entries, viewer_id):
    counts = {"all": len(entries), "dashboards": {"mine": 0, "shared": 0, "institution": 0}, "reports": {"mine": 0, "shared": 0, "institution": 0, "scheduled": 0}, "categories": {}}
    for entry in entries:
        group = counts["dashboards" if entry["kind"] == D else "reports"]
        group[_section(entry, viewer_id)] += 1
        if entry["kind"] == R and entry["schedule"] not in ("NONE", "", None):
            group["scheduled"] += 1
        counts["categories"][entry["category"]] = counts["categories"].get(entry["category"], 0) + 1
    return counts


def _next_run(schedule, today):
    if schedule == AnalyticsItem.Schedule.DAILY:
        return today + timedelta(days=1)
    if schedule == AnalyticsItem.Schedule.WEEKLY:
        return today + timedelta(days=7)
    if schedule == AnalyticsItem.Schedule.MONTHLY:
        return date(today.year + today.month // 12, today.month % 12 + 1, 1)
    return None


def refresh_item(item, actor, *, scheduled=False):
    """Re-run a report (recording its row count) or mark a live dashboard as viewed now."""
    from apps.reports.services import build_report_rows

    row_count = None
    if item.kind == R:
        filters = {key: item.filters.get(key) for key in ("status", "date_from", "date_to")}
        row_count = len(build_report_rows(item.institution, item.source, **filters))
    AnalyticsItem.objects.filter(pk=item.pk).update(
        last_refreshed_at=timezone.now(), last_refreshed_by=actor, last_row_count=row_count,
        **({"next_run_on": _next_run(item.schedule, timezone.localdate())} if scheduled else {}),
    )
    if not item.is_system:
        record_audit_event(actor=actor, institution=item.institution, entity=item, action="reports.analytics_item.refreshed", metadata={"rows": row_count, "scheduled": scheduled})
    item.refresh_from_db()
    return item


def run_due_items(today=None):
    """Refresh every scheduled saved report that is due and tell its owner and shared readers (daily cron)."""
    today = today or timezone.localdate()
    count = 0
    for item in AnalyticsItem.objects.exclude(schedule=AnalyticsItem.Schedule.NONE).filter(next_run_on__lte=today, is_system=False).exclude(status=AnalyticsItem.Status.ARCHIVED).select_related("owner", "institution"):
        refresh_item(item, item.owner, scheduled=True)
        route = SOURCES[(item.kind, item.source)][3]
        for user in [item.owner, *[share.user for share in item.shares.select_related("user")]]:
            if user is None:
                continue
            Notification.objects.create(
                institution=item.institution, user=user, notification_type="ANALYTICS_REFRESHED",
                title=f"{item.name} was refreshed", message=f"Your scheduled {item.get_kind_display().lower()} {item.name} has fresh data.",
                channel=Notification.Channel.IN_APP, metadata={"href": _href(item, route), "item_id": str(item.id)},
            )
        count += 1
    return count


class AnalyticsItemWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150)
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    kind = serializers.ChoiceField(choices=AnalyticsItem.Kind.choices)
    source = serializers.CharField(max_length=40)
    category = serializers.ChoiceField(choices=AnalyticsItem.Category.choices, required=False)
    filters = serializers.DictField(required=False)
    status = serializers.ChoiceField(choices=AnalyticsItem.Status.choices, required=False)
    visibility = serializers.ChoiceField(choices=AnalyticsItem.Visibility.choices, required=False)
    schedule = serializers.ChoiceField(choices=AnalyticsItem.Schedule.choices, required=False)

    def validate_filters(self, value):
        allowed = {"status", "date_from", "date_to"}
        unknown = set(value) - allowed
        if unknown:
            raise serializers.ValidationError(f"Unsupported filter(s): {', '.join(sorted(unknown))}.")
        return {key: str(item) for key, item in value.items() if item not in (None, "")}


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
class AnalyticsLibraryViewSet(ViewSet):
    """`/report-library/`: the Reports & Analytics catalogue."""

    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "REPORTS"

    def get_required_permission(self):
        return "report.view"

    def _item(self, viewer, pk):
        items, shared = visible_items(viewer)
        for item in items:
            if str(item.id) == str(pk):
                return item, shared
        raise NotFound("This dashboard or report was not found.")

    @extend_schema(responses={200: OpenApiTypes.OBJECT}, description="Every dashboard and report the caller may open, with sidebar counts.", operation_id="report_library_list")
    def list(self, request):
        viewer = Viewer(request)
        items, shared = visible_items(viewer)
        entries = [serialize_item(item, viewer, shared) for item in items] + financial_report_entries(viewer)
        entries.sort(key=lambda entry: (entry["last_refreshed_at"] is None, -(entry["last_refreshed_at"].timestamp() if entry["last_refreshed_at"] else 0), entry["name"]))
        return Response({"results": entries, "counts": library_counts(entries, str(request.user.id)), "can_publish": viewer.can_publish})

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def retrieve(self, request, pk=None):
        viewer = Viewer(request)
        item, shared = self._item(viewer, pk)
        return Response(serialize_item(item, viewer, shared))

    @extend_schema(request=AnalyticsItemWriteSerializer, responses={201: OpenApiTypes.OBJECT})
    def create(self, request):
        viewer = Viewer(request)
        data = AnalyticsItemWriteSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        if not viewer.can_open(values["kind"], values["source"]):
            raise PermissionDenied("Your role cannot open that dashboard or report.")
        self._check_publication(viewer, values.get("visibility"), values.get("status"))
        category = values.get("category") or SOURCES[(values["kind"], values["source"])][2]
        item = AnalyticsItem(
            institution=request.institution, owner=request.user, name=values["name"], description=values.get("description", ""),
            kind=values["kind"], source=values["source"], category=category, filters=values.get("filters", {}),
            status=values.get("status", AnalyticsItem.Status.DRAFT), visibility=values.get("visibility", AnalyticsItem.Visibility.PRIVATE),
            schedule=values.get("schedule", AnalyticsItem.Schedule.NONE),
        )
        if item.kind == D:
            item.schedule = AnalyticsItem.Schedule.NONE  # Dashboards are live; only reports are scheduled.
        item.next_run_on = _next_run(item.schedule, timezone.localdate())
        self._save(item)
        record_audit_event(actor=request.user, institution=item.institution, entity=item, action="reports.analytics_item.created", metadata={"kind": item.kind, "source": item.source})
        return Response(serialize_item(item, viewer, set()), status=201)

    @extend_schema(request=AnalyticsItemWriteSerializer, responses={200: OpenApiTypes.OBJECT})
    def partial_update(self, request, pk=None):
        viewer = Viewer(request)
        item, shared = self._item(viewer, pk)
        if not _can_edit(item, viewer, shared):
            raise PermissionDenied("Only the owner or an editor can change this item.")
        data = AnalyticsItemWriteSerializer(data={"name": item.name, "kind": item.kind, "source": item.source, **request.data}, partial=True)
        data.is_valid(raise_exception=True)
        values = {key: value for key, value in data.validated_data.items() if key in request.data}
        if "source" in values or "kind" in values:
            if not viewer.can_open(values.get("kind", item.kind), values.get("source", item.source)):
                raise PermissionDenied("Your role cannot open that dashboard or report.")
        if "visibility" in values or "status" in values:
            self._check_publication(viewer, values.get("visibility", item.visibility), values.get("status", item.status), current=item)
        before = {key: getattr(item, key) for key in values}
        for key, value in values.items():
            setattr(item, key, value)
        if item.kind == D:
            item.schedule = AnalyticsItem.Schedule.NONE
        if "schedule" in values:
            item.next_run_on = _next_run(item.schedule, timezone.localdate())
        self._save(item)
        record_audit_event(
            actor=request.user, institution=item.institution, entity=item, action="reports.analytics_item.updated",
            metadata={"fields": sorted(values), "before": {key: str(value) for key, value in before.items()}},
        )
        item.refresh_from_db()
        return Response(serialize_item(item, viewer, shared))

    @staticmethod
    def _check_publication(viewer, visibility, status, current=None):
        institution_wide = visibility == AnalyticsItem.Visibility.INSTITUTION
        was_institution_wide = current is not None and current.visibility == AnalyticsItem.Visibility.INSTITUTION and current.status == AnalyticsItem.Status.PUBLISHED
        if institution_wide and status == AnalyticsItem.Status.PUBLISHED and not was_institution_wide and not viewer.can_publish:
            raise PermissionDenied("Publishing to everyone needs the report.publish permission.")

    @staticmethod
    def _save(item):
        from django.core.exceptions import ValidationError as DjangoValidationError

        try:
            item.save()
        except DjangoValidationError as exc:
            raise ValidationError(exc.message_dict) from exc

    @extend_schema(responses={200: OpenApiTypes.OBJECT}, description="Re-run a report, or record that a live dashboard was opened.")
    @action(detail=True, methods=("post",))
    def refresh(self, request, pk=None):
        viewer = Viewer(request)
        item, shared = self._item(viewer, pk)
        refresh_item(item, request.user)
        return Response(serialize_item(item, viewer, shared))

    @extend_schema(responses={201: OpenApiTypes.OBJECT}, description="Save a private copy the caller owns.")
    @action(detail=True, methods=("post",))
    def duplicate(self, request, pk=None):
        viewer = Viewer(request)
        item, _shared = self._item(viewer, pk)
        copy = AnalyticsItem(
            institution=item.institution, owner=request.user, name=f"{item.name} (copy)"[:150], description=item.description, kind=item.kind,
            source=item.source, category=item.category, filters=item.filters, status=AnalyticsItem.Status.DRAFT, visibility=AnalyticsItem.Visibility.PRIVATE,
        )
        self._save(copy)
        record_audit_event(actor=request.user, institution=copy.institution, entity=copy, action="reports.analytics_item.created", metadata={"copied_from": str(item.id)})
        return Response(serialize_item(copy, viewer, set()), status=201)

    @extend_schema(responses={200: OpenApiTypes.OBJECT}, description="Share with members ({user_id, can_edit}) or stop sharing ({user_id, remove: true}).")
    @action(detail=True, methods=("post",))
    def share(self, request, pk=None):
        viewer = Viewer(request)
        item, shared = self._item(viewer, pk)
        if item.is_system or item.owner_id != request.user.id:
            raise PermissionDenied("Only the owner can share this item.")
        user_id = request.data.get("user_id")
        membership = InstitutionMembership.objects.filter(institution=request.institution, user_id=user_id, status=InstitutionMembership.Status.ACTIVE).select_related("user").first() if user_id else None
        if membership is None or membership.user_id == request.user.id:
            raise ValidationError({"user_id": "Choose another active member of this institution."})
        if request.data.get("remove"):
            AnalyticsShare.objects.filter(item=item, user=membership.user).delete()
            action_code = "reports.analytics_item.unshared"
        else:
            if not membership.role.permissions.filter(code="report.view").exists():
                raise ValidationError({"user_id": "This member's role cannot open Reports & Analytics."})
            AnalyticsShare.objects.update_or_create(
                item=item, user=membership.user,
                defaults={"institution": request.institution, "can_edit": bool(request.data.get("can_edit")), "shared_by": request.user},
            )
            if item.visibility == AnalyticsItem.Visibility.PRIVATE:
                AnalyticsItem.objects.filter(pk=item.pk).update(visibility=AnalyticsItem.Visibility.SHARED)
            action_code = "reports.analytics_item.shared"
            route = SOURCES[(item.kind, item.source)][3]
            name = request.user.get_full_name() or request.user.email
            Notification.objects.create(
                institution=request.institution, user=membership.user, notification_type="ANALYTICS_SHARED",
                title=f"{name} shared {item.name}", message=f"{name} shared the {item.get_kind_display().lower()} {item.name} with you.",
                channel=Notification.Channel.IN_APP, metadata={"href": _href(item, route), "item_id": str(item.id)},
            )
        record_audit_event(actor=request.user, institution=item.institution, entity=item, action=action_code, metadata={"user_id": str(membership.user_id), "can_edit": bool(request.data.get("can_edit"))})
        item.refresh_from_db()
        return Response(serialize_item(item, viewer, shared))

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    @action(detail=True, methods=("get",))
    def activity(self, request, pk=None):
        from apps.audit.models import AuditLog

        viewer = Viewer(request)
        item, _shared = self._item(viewer, pk)
        entries = AuditLog.objects.filter(institution=request.institution, entity_id=item.id).select_related("actor").order_by("-created_at")[:50]
        return Response([
            {"id": str(entry.id), "action": entry.action, "actor": _person(entry.actor), "created_at": entry.created_at, "metadata": entry.metadata}
            for entry in entries
        ])

    @extend_schema(responses={200: OpenApiTypes.OBJECT}, description="Sources the caller may save and members they may share with.")
    @action(detail=False, methods=("get",), url_path="options")
    def form_options(self, request):
        viewer = Viewer(request)
        sources = [
            {"kind": kind, "source": source, "label": label, "module": module, "module_label": MODULE_LABELS[module], "category": category, "description": description}
            for (kind, source), (label, module, category, _route, description, _rule) in SOURCES.items()
            if viewer.can_open(kind, source)
        ]
        members = (
            InstitutionMembership.objects.filter(institution=request.institution, status=InstitutionMembership.Status.ACTIVE, role__permissions__code="report.view")
            .exclude(user=request.user).select_related("user", "role").distinct()
        )
        return Response({
            "sources": sources,
            "members": [{**_person(membership.user), "email": membership.user.email, "role": membership.role.name} for membership in members],
            "can_publish": viewer.can_publish,
        })
