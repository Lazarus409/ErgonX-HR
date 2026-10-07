"""Saved financial reports: a standard library, custom definitions, versioned runs
and schedules (concepts "Financial reports" and "Financial report detail").

Every run is computed from the posted ledger (or open AR/AP and budgets) at run
time and its result is stored, so earlier versions stay reviewable.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounting.models import Account, FinancialReport, FinancialReportRun, Invoice, VendorBill
from apps.accounting.selectors import balance_sheet, income_statement, trial_balance
from apps.audit.services import record_audit_event
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet

ZERO = Decimal("0.00")
STANDARD_LIBRARY = (
    ("Statement of Financial Position", FinancialReport.ReportType.BALANCE_SHEET, FinancialReport.Category.STANDARD, "A snapshot of assets, liabilities and equity at a point in time."),
    ("Income Statement", FinancialReport.ReportType.INCOME_STATEMENT, FinancialReport.Category.STANDARD, "Income and expenses for the period and the net result."),
    ("Trial Balance", FinancialReport.ReportType.TRIAL_BALANCE, FinancialReport.Category.END_OF_PERIOD, "Debit and credit balances of every account; confirms the ledger balances."),
    ("Receivables Aging", FinancialReport.ReportType.AR_AGING, FinancialReport.Category.MANAGEMENT, "Open customer balances by how long they are overdue."),
    ("Payables Aging", FinancialReport.ReportType.AP_AGING, FinancialReport.Category.MANAGEMENT, "Open vendor balances by how long they are overdue."),
    ("Budget vs Actual", FinancialReport.ReportType.BUDGET_VS_ACTUAL, FinancialReport.Category.MANAGEMENT, "Allocated, committed and actual spend for the fiscal year's budgets."),
)


def _money(value):
    return str(Decimal(value or 0).quantize(Decimal("0.01")))


def ensure_standard_reports(institution):
    if FinancialReport.objects.filter(institution=institution, is_standard=True).exists():
        return
    for name, report_type, category, description in STANDARD_LIBRARY:
        FinancialReport.objects.create(institution=institution, name=name, report_type=report_type, category=category,
                                       description=description, is_standard=True)


def _date(value, fallback):
    if not value:
        return fallback
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({"parameters": f"Invalid date {value!r}; use YYYY-MM-DD."})


def _section(title, rows, sign, comparative_rows=None):
    """Build a statement section from trial-balance rows; sign=+1 for debit-normal, -1 for credit-normal."""
    comparative = {row["account_id"]: row for row in (comparative_rows or [])}
    lines, total, total_comparative = [], ZERO, ZERO
    for row in rows:
        value = sign * (row["debit"] - row["credit"])
        previous = comparative.get(row["account_id"])
        previous_value = sign * (previous["debit"] - previous["credit"]) if previous else ZERO
        total += value
        total_comparative += previous_value
        lines.append({"code": row["code"], "label": row["name"], "current": _money(value), "comparative": _money(previous_value) if comparative_rows is not None else None})
    for account_id, previous in comparative.items():
        if not any(row["account_id"] == account_id for row in rows):
            previous_value = sign * (previous["debit"] - previous["credit"])
            total_comparative += previous_value
            lines.append({"code": previous["code"], "label": previous["name"], "current": _money(0), "comparative": _money(previous_value)})
    return {"title": title, "rows": sorted(lines, key=lambda row: row["code"]), "total": _money(total), "total_comparative": _money(total_comparative) if comparative_rows is not None else None}


def build_report(report, parameters):
    institution = report.institution
    today = timezone.localdate()
    kind = report.report_type
    if kind == FinancialReport.ReportType.BALANCE_SHEET:
        as_of = _date(parameters.get("as_of"), today)
        comparative_as_of = _date(parameters.get("comparative_as_of"), as_of.replace(year=as_of.year - 1)) if parameters.get("comparative", True) else None
        current = balance_sheet(institution=institution, as_of=as_of)
        previous = balance_sheet(institution=institution, as_of=comparative_as_of) if comparative_as_of else None
        equity = _section("Equity", current["equity"], -1, previous["equity"] if previous else None)
        equity["rows"].append({"code": "", "label": "Retained result (income less expenses)", "current": _money(current["retained_result"]), "comparative": _money(previous["retained_result"]) if previous else None})
        equity["total"] = _money(current["total_equity"])
        equity["total_comparative"] = _money(previous["total_equity"]) if previous else None
        sections = [
            _section("Assets", current["assets"], 1, previous["assets"] if previous else None),
            _section("Liabilities", current["liabilities"], -1, previous["liabilities"] if previous else None),
            equity,
        ]
        return {
            "title": "Statement of Financial Position", "subtitle": f"As at {as_of:%d %B %Y}",
            "columns": [f"{as_of:%d %b %Y}"] + ([f"{comparative_as_of:%d %b %Y}"] if comparative_as_of else []),
            "sections": sections,
            "totals": [{"label": "Total liabilities and equity", "current": _money(current["total_liabilities"] + current["total_equity"]),
                        "comparative": _money(previous["total_liabilities"] + previous["total_equity"]) if previous else None}],
            "summary": [{"label": "Total assets", "value": _money(current["total_assets"])}, {"label": "Total liabilities", "value": _money(current["total_liabilities"])},
                        {"label": "Total equity", "value": _money(current["total_equity"])}, {"label": "Balanced", "value": "Yes" if current["balanced"] else "No"}],
            "checks": {"balanced": current["balanced"]},
        }
    if kind in (FinancialReport.ReportType.INCOME_STATEMENT, FinancialReport.ReportType.TRIAL_BALANCE):
        date_to = _date(parameters.get("date_to"), today)
        date_from = _date(parameters.get("date_from"), date_to.replace(month=1, day=1))
        if kind == FinancialReport.ReportType.TRIAL_BALANCE:
            result = trial_balance(institution=institution, date_from=date_from, date_to=date_to)
            return {
                "title": "Trial Balance", "subtitle": f"{date_from:%d %b %Y} – {date_to:%d %b %Y}", "columns": ["Debit", "Credit"],
                "sections": [{"title": "Accounts", "rows": [{"code": row["code"], "label": row["name"], "current": _money(row["debit"]), "comparative": _money(row["credit"])} for row in result["rows"]],
                              "total": _money(result["total_debit"]), "total_comparative": _money(result["total_credit"])}],
                "totals": [],
                "summary": [{"label": "Total debits", "value": _money(result["total_debit"])}, {"label": "Total credits", "value": _money(result["total_credit"])}, {"label": "Balanced", "value": "Yes" if result["balanced"] else "No"}],
                "checks": {"balanced": result["balanced"]},
            }
        span = date_to - date_from
        previous_to = date_from - timedelta(days=1)
        previous_from = previous_to - span
        current = income_statement(institution=institution, date_from=date_from, date_to=date_to)
        previous = income_statement(institution=institution, date_from=previous_from, date_to=previous_to) if parameters.get("comparative", True) else None
        return {
            "title": "Income Statement", "subtitle": f"{date_from:%d %b %Y} – {date_to:%d %b %Y}",
            "columns": ["Current period"] + (["Prior period"] if previous else []),
            "sections": [_section("Income", current["income"], -1, previous["income"] if previous else None), _section("Expenses", current["expenses"], 1, previous["expenses"] if previous else None)],
            "totals": [{"label": "Net result", "current": _money(current["net_income"]), "comparative": _money(previous["net_income"]) if previous else None}],
            "summary": [{"label": "Total income", "value": _money(current["total_income"])}, {"label": "Total expenses", "value": _money(current["total_expenses"])}, {"label": "Net result", "value": _money(current["net_income"])}],
            "checks": {},
        }
    if kind in (FinancialReport.ReportType.AR_AGING, FinancialReport.ReportType.AP_AGING):
        as_of = _date(parameters.get("as_of"), today)
        receivable = kind == FinancialReport.ReportType.AR_AGING
        if receivable:
            from apps.accounting.services import invoice_amount_received

            records = [(item.customer.name, item.due_date, item.total_amount - invoice_amount_received(item))
                       for item in Invoice.objects.filter(institution=institution, status__in=(Invoice.Status.ISSUED, Invoice.Status.PART_PAID)).select_related("customer")]
        else:
            records = [(item.vendor.name, item.due_date, item.amount_payable - sum((payment.amount for payment in item.payments.filter(status="POSTED")), ZERO))
                       for item in VendorBill.objects.filter(institution=institution, status__in=(VendorBill.Status.POSTED, VendorBill.Status.PART_PAID)).select_related("vendor")]
        buckets = ("Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days")
        parties = {}
        for party, due, amount in records:
            days = (as_of - due).days if due else 0
            bucket = buckets[0] if days <= 0 else buckets[1] if days <= 30 else buckets[2] if days <= 60 else buckets[3] if days <= 90 else buckets[4]
            parties.setdefault(party, {name: ZERO for name in buckets})[bucket] += amount
        rows = [{"code": "", "label": party, "current": _money(sum(values.values(), ZERO)), "comparative": None, "buckets": {name: _money(value) for name, value in values.items()}} for party, values in sorted(parties.items())]
        totals = {name: sum((values[name] for values in parties.values()), ZERO) for name in buckets}
        return {
            "title": "Receivables Aging" if receivable else "Payables Aging", "subtitle": f"As at {as_of:%d %B %Y}", "columns": ["Outstanding"],
            "bucket_columns": list(buckets),
            "sections": [{"title": "Customers" if receivable else "Vendors", "rows": rows, "total": _money(sum(totals.values(), ZERO)), "total_comparative": None, "bucket_totals": {name: _money(value) for name, value in totals.items()}}],
            "totals": [],
            "summary": [{"label": name, "value": _money(value)} for name, value in totals.items()],
            "checks": {},
        }
    if kind == FinancialReport.ReportType.BUDGET_VS_ACTUAL:
        from apps.accounting.budgets import budget_figures
        from apps.accounting.models import Budget, FiscalYear

        year = FiscalYear.objects.filter(institution=institution, pk=parameters.get("fiscal_year")).first() if parameters.get("fiscal_year") else FiscalYear.objects.filter(institution=institution).order_by("-start_date").first()
        rows, grand = [], {"allocated": ZERO, "actual": ZERO, "committed": ZERO}
        for budget in Budget.objects.filter(institution=institution, fiscal_year=year).exclude(status=Budget.Status.CLOSED).select_related("department") if year else []:
            _, totals = budget_figures(budget)
            for key in grand:
                grand[key] += totals[key]
            rows.append({"code": budget.code, "label": f"{budget.name} ({budget.department.name if budget.department_id else 'Institution-wide'})", "current": _money(totals["allocated"]), "comparative": _money(totals["actual"])})
        return {
            "title": "Budget vs Actual", "subtitle": year.name if year else "No fiscal year", "columns": ["Allocated", "Actual"],
            "sections": [{"title": "Budgets", "rows": rows, "total": _money(grand["allocated"]), "total_comparative": _money(grand["actual"])}],
            "totals": [{"label": "Variance (allocated − actual)", "current": _money(grand["allocated"] - grand["actual"]), "comparative": None}],
            "summary": [{"label": "Allocated", "value": _money(grand["allocated"])}, {"label": "Committed", "value": _money(grand["committed"])}, {"label": "Actual", "value": _money(grand["actual"])}],
            "checks": {},
        }
    raise ValidationError({"report_type": "Unsupported report type."})


def _visible(report, membership):
    if not report.allowed_roles or membership is None:
        return True
    return membership.role.code in report.allowed_roles or membership.role.permissions.filter(code="accounting.configure").exists()


@transaction.atomic
def run_report(*, report, actor, parameters=None, scheduled=False):
    report = FinancialReport.objects.select_for_update().get(pk=report.pk)
    parameters = {**report.parameters, **(parameters or {})}
    version = (report.runs.aggregate(top=Max("version"))["top"] or 0) + 1
    try:
        result = build_report(report, parameters)
        status, error = FinancialReportRun.Status.COMPLETED, ""
    except ValidationError as exc:
        result, status, error = {}, FinancialReportRun.Status.FAILED, "; ".join(exc.messages)
    run = FinancialReportRun.objects.create(institution=report.institution, report=report, version=version, parameters=parameters,
                                            status=status, result=result, error=error, run_by=actor, scheduled=scheduled)
    if report.schedule_frequency != FinancialReport.Frequency.NONE:
        report.next_run_on = _next_run(report.schedule_frequency, timezone.localdate())
        report.save(update_fields=("next_run_on", "updated_at"))
    record_audit_event(actor=actor, institution=report.institution, entity=report, action="accounting.financial_report.run", metadata={"version": version, "status": status})
    return run


def _next_run(frequency, today):
    months = {"MONTHLY": 1, "QUARTERLY": 3, "YEARLY": 12}[frequency]
    month = today.month - 1 + months
    return date(today.year + month // 12, month % 12 + 1, 1)


def run_due_reports(today=None):
    """Run every scheduled report whose next run date has arrived (for a daily cron)."""
    today = today or timezone.localdate()
    count = 0
    for report in FinancialReport.objects.exclude(schedule_frequency=FinancialReport.Frequency.NONE).filter(next_run_on__lte=today):
        run_report(report=report, actor=report.owner, scheduled=True)
        count += 1
    return count


def _person(user):
    return (user.get_full_name() or user.email) if user else None


class FinancialReportSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    last_run_at = serializers.SerializerMethodField()
    report_type_label = serializers.CharField(source="get_report_type_display", read_only=True)
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    def get_owner_name(self, obj):
        return _person(obj.owner)

    def _last(self, obj):
        return obj.runs.order_by("-version").first()

    def get_status(self, obj):
        last = self._last(obj)
        if last is None:
            return "SCHEDULED" if obj.schedule_frequency != FinancialReport.Frequency.NONE else "DRAFT"
        return last.status

    def get_last_run_at(self, obj):
        last = self._last(obj)
        return last.created_at if last else None

    class Meta:
        model = FinancialReport
        fields = ("id", "code", "name", "report_type", "report_type_label", "category", "category_label", "description", "parameters", "owner",
                  "owner_name", "allowed_roles", "is_standard", "schedule_frequency", "next_run_on", "notes", "status", "last_run_at", "created_at", "updated_at")
        read_only_fields = ("id", "code", "is_standard", "next_run_on", "status", "last_run_at", "created_at", "updated_at")

    def create(self, validated_data):
        validated_data.pop("institution", None)
        validated_data.pop("actor", None)
        request = self.context["request"]
        report = FinancialReport(institution=request.institution, created_by=request.user, updated_by=request.user, owner=validated_data.pop("owner", None) or request.user, **validated_data)
        if report.schedule_frequency != FinancialReport.Frequency.NONE:
            report.next_run_on = _next_run(report.schedule_frequency, timezone.localdate())
        report.full_clean()
        report.save()
        record_audit_event(actor=request.user, institution=report.institution, entity=report, action="accounting.financial_report.created")
        return report

    def update(self, instance, validated_data):
        validated_data.pop("institution", None)
        validated_data.pop("actor", None)
        request = self.context["request"]
        if instance.is_standard:
            # Standard reports keep their identity; only parameters, schedule, notes and access change.
            validated_data = {key: value for key, value in validated_data.items() if key in {"parameters", "schedule_frequency", "notes", "allowed_roles", "owner"}}
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if "schedule_frequency" in validated_data:
            instance.next_run_on = None if instance.schedule_frequency == FinancialReport.Frequency.NONE else _next_run(instance.schedule_frequency, timezone.localdate())
        instance.updated_by = request.user
        instance.full_clean()
        instance.save()
        record_audit_event(actor=request.user, institution=instance.institution, entity=instance, action="accounting.financial_report.updated", metadata={"fields": sorted(validated_data)})
        return instance


class FinancialReportViewSet(TenantModelViewSet):
    model = FinancialReport
    serializer_class = FinancialReportSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("report_type", "category", "is_standard")
    search_fields = ("name", "description", "code")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return FinancialReport.objects.none()
        ensure_standard_reports(self.request.institution)
        membership = getattr(self.request, "membership", None)
        ids = [report.id for report in super().get_queryset().select_related("owner") if _visible(report, membership)]
        return FinancialReport.objects.filter(pk__in=ids).select_related("owner")

    def get_required_permission(self):
        return {"create": "financial_report.manage", "partial_update": "financial_report.manage", "run": "financial_report.view"}.get(self.action, "financial_report.view")

    @action(detail=True, methods=("post",), filter_backends=())
    def run(self, request, pk=None):
        run = call_validated_service(run_report, report=self.get_object(), actor=request.user, parameters=request.data.get("parameters") or {})
        return Response(_run_payload(run), status=201)

    @action(detail=True, methods=("get",), filter_backends=())
    def runs(self, request, pk=None):
        report = self.get_object()
        run_id = request.query_params.get("run")
        runs = report.runs.select_related("run_by").order_by("-version")
        selected = runs.filter(pk=run_id).first() if run_id else runs.first()
        from apps.audit.models import AuditLog

        audit = AuditLog.objects.filter(institution=request.institution, entity_id=report.id).select_related("actor").order_by("-created_at")[:30]
        return Response({
            "versions": [{"id": str(run.id), "version": run.version, "status": run.status, "created_at": run.created_at, "run_by": _person(run.run_by), "scheduled": run.scheduled} for run in runs[:30]],
            "run": _run_payload(selected) if selected else None,
            "audit": [{"id": str(entry.id), "action": entry.action, "actor": _person(entry.actor) or "System", "created_at": entry.created_at, "metadata": entry.metadata} for entry in audit],
            "institution": {"name": request.institution.name, "currency": getattr(getattr(request.institution, "accounting_configuration", None), "base_currency", "") or ""},
            "roles": list(request.institution.roles.values_list("code", flat=True)) if hasattr(request.institution, "roles") else [],
        })


def _run_payload(run):
    return {"id": str(run.id), "version": run.version, "status": run.status, "parameters": run.parameters, "result": run.result, "error": run.error,
            "run_by": _person(run.run_by), "created_at": run.created_at, "scheduled": run.scheduled}
