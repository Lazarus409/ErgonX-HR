"""Budgets and budget-versus-actual (concepts "Budgets" and "Budget detail").

Actuals are posted journal lines on each budget line's account within the
budget's fiscal year (restricted to the budget's department when it has one).
Committed spend is approved or pending vendor bills not yet posted, on the same
expense accounts and fiscal year.
"""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounting.models import (
    Account,
    Budget,
    BudgetLine,
    BudgetNote,
    FiscalYear,
    JournalEntry,
    JournalLine,
    VendorBill,
    VendorBillLine,
)
from apps.audit.services import record_audit_event
from apps.organization.models import Department
from common.serializers import call_validated_service
from apps.accounting.views import RecordAttachmentsMixin
from common.viewsets import TenantModelViewSet

ZERO = Decimal("0.00")
POSTED = (JournalEntry.Status.POSTED, JournalEntry.Status.REVERSED)


def _money(value):
    return Decimal(value or 0).quantize(Decimal("0.01"))


def _can(actor, institution, code):
    return actor.memberships.filter(institution=institution, status="ACTIVE", role__permissions__code=code).exists()


def _person(user):
    return (user.get_full_name() or user.email) if user else None


def line_figures(line):
    budget = line.budget
    year = budget.fiscal_year
    actual = committed = ZERO
    if line.account_id:
        lines = JournalLine.objects.filter(
            account_id=line.account_id, journal_entry__institution_id=budget.institution_id, journal_entry__status__in=POSTED,
            journal_entry__entry_date__gte=year.start_date, journal_entry__entry_date__lte=year.end_date,
        )
        if budget.department_id:
            lines = lines.filter(department_id=budget.department_id)
        totals = lines.aggregate(debit=Sum("debit"), credit=Sum("credit"))
        actual = _money(Decimal(totals["debit"] or 0) - Decimal(totals["credit"] or 0))
        if not budget.department_id:
            committed = _money(VendorBillLine.objects.filter(
                expense_account_id=line.account_id, vendor_bill__institution_id=budget.institution_id,
                vendor_bill__status__in=(VendorBill.Status.PENDING, VendorBill.Status.APPROVED),
                vendor_bill__bill_date__gte=year.start_date, vendor_bill__bill_date__lte=year.end_date,
            ).aggregate(total=Sum("line_total"))["total"])
    allocated = _money(line.allocated)
    return {"allocated": allocated, "committed": committed, "actual": actual, "remaining": _money(allocated - committed - actual), "variance": _money(allocated - actual)}


def budget_figures(budget):
    rows = []
    totals = {"allocated": ZERO, "committed": ZERO, "actual": ZERO, "remaining": ZERO, "variance": ZERO}
    for line in budget.lines.select_related("account"):
        figures = line_figures(line)
        for key in totals:
            totals[key] += figures[key]
        rows.append({"line": line, **figures})
    return rows, {key: _money(value) for key, value in totals.items()}


def _status_for(figures):
    if not figures["allocated"]:
        return "NO_ALLOCATION"
    used = (figures["actual"] + figures["committed"]) / figures["allocated"]
    return "OVER_BUDGET" if used > 1 else "AT_RISK" if used >= Decimal("0.9") else "ON_TRACK"


@transaction.atomic
def submit_budget(*, budget, actor):
    budget = Budget.objects.select_for_update().get(pk=budget.pk)
    if not _can(actor, budget.institution, "budget.manage"):
        raise ValidationError({"actor": "You cannot submit budgets."})
    if budget.status not in (Budget.Status.DRAFT, Budget.Status.RETURNED):
        raise ValidationError({"status": "Only draft or returned budgets can be submitted."})
    if not budget.lines.exists():
        raise ValidationError({"lines": "Add at least one budget line before submitting."})
    budget.status = Budget.Status.PENDING_APPROVAL
    budget.submitted_by = actor
    budget.submitted_at = timezone.now()
    budget.save(update_fields=("status", "submitted_by", "submitted_at", "updated_at"))
    record_audit_event(actor=actor, institution=budget.institution, entity=budget, action="accounting.budget.submitted")
    return budget


@transaction.atomic
def decide_budget(*, budget, actor, approve, note=""):
    budget = Budget.objects.select_for_update().get(pk=budget.pk)
    if not _can(actor, budget.institution, "budget.approve"):
        raise ValidationError({"actor": "Only budget approvers can decide budgets."})
    if budget.status != Budget.Status.PENDING_APPROVAL:
        raise ValidationError({"status": "Only budgets pending approval can be decided."})
    if budget.submitted_by_id == actor.id:
        raise ValidationError({"actor": "Budgets must be approved by someone other than the submitter."})
    if not approve and not (note or "").strip():
        raise ValidationError({"note": "Explain what needs to change."})
    budget.status = Budget.Status.APPROVED if approve else Budget.Status.RETURNED
    budget.approval_note = (note or "").strip()
    fields = ["status", "approval_note", "updated_at"]
    if approve:
        budget.approved_by, budget.approved_at = actor, timezone.now()
        fields += ["approved_by", "approved_at"]
    budget.save(update_fields=fields)
    record_audit_event(actor=actor, institution=budget.institution, entity=budget,
                       action="accounting.budget.approved" if approve else "accounting.budget.returned", metadata={"note": budget.approval_note})
    return budget


def _editable(budget):
    if budget.status in (Budget.Status.PENDING_APPROVAL, Budget.Status.CLOSED):
        raise ValidationError({"status": "Budgets pending approval or closed cannot be edited."})


class BudgetLineSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source="account.code", read_only=True, default=None)
    account_name = serializers.CharField(source="account.name", read_only=True, default=None)

    class Meta:
        model = BudgetLine
        fields = ("id", "category", "account", "account_code", "account_name", "description", "initiative", "allocated")
        read_only_fields = ("id",)


class BudgetSerializer(serializers.ModelSerializer):
    lines = BudgetLineSerializer(many=True, required=False)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    fiscal_year_name = serializers.CharField(source="fiscal_year.name", read_only=True)
    period_start = serializers.DateField(source="fiscal_year.start_date", read_only=True)
    period_end = serializers.DateField(source="fiscal_year.end_date", read_only=True)
    owner_name = serializers.SerializerMethodField()
    totals = serializers.SerializerMethodField()

    def get_owner_name(self, obj):
        return _person(obj.owner)

    def get_totals(self, obj):
        _, totals = budget_figures(obj)
        return {key: str(value) for key, value in {**totals}.items()} | {"health": _status_for(totals)}

    class Meta:
        model = Budget
        fields = (
            "id", "code", "name", "fiscal_year", "fiscal_year_name", "period_start", "period_end", "department", "department_name",
            "budget_type", "owner", "owner_name", "description", "status", "version", "lines", "totals", "approval_note",
            "submitted_at", "approved_at", "created_at", "updated_at",
        )
        read_only_fields = ("id", "code", "status", "version", "approval_note", "submitted_at", "approved_at", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["fiscal_year"].queryset = FiscalYear.objects.for_institution(institution)
            self.fields["department"].queryset = Department.objects.for_institution(institution)
            self.fields["lines"].child.fields["account"].queryset = Account.objects.for_institution(institution)

    def _write_lines(self, budget, lines):
        budget.lines.all().delete()
        for values in lines:
            line = BudgetLine(institution=budget.institution, budget=budget, **values)
            line.full_clean()
            line.save()

    @transaction.atomic
    def create(self, validated_data):
        lines = validated_data.pop("lines", [])
        validated_data.pop("institution", None)
        validated_data.pop("actor", None)
        request = self.context["request"]
        budget = Budget(institution=request.institution, created_by=request.user, **validated_data)
        budget.full_clean()
        budget.save()
        self._write_lines(budget, lines)
        record_audit_event(actor=request.user, institution=budget.institution, entity=budget, action="accounting.budget.created")
        return budget

    @transaction.atomic
    def update(self, instance, validated_data):
        _editable(instance)
        validated_data.pop("institution", None)
        validated_data.pop("actor", None)
        lines = validated_data.pop("lines", None)
        request = self.context["request"]
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if instance.status in (Budget.Status.APPROVED, Budget.Status.RETURNED):
            # Changing an approved budget starts a new version that needs approval again.
            if instance.status == Budget.Status.APPROVED:
                instance.version += 1
            instance.status = Budget.Status.DRAFT
            instance.approved_by = None
            instance.approved_at = None
        instance.full_clean()
        instance.save()
        if lines is not None:
            self._write_lines(instance, lines)
        record_audit_event(actor=request.user, institution=instance.institution, entity=instance, action="accounting.budget.updated", metadata={"version": instance.version})
        return instance


class BudgetViewSet(RecordAttachmentsMixin, TenantModelViewSet):
    attachment_entity_type = "accounting.Budget"
    model = Budget
    serializer_class = BudgetSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("fiscal_year", "department", "status", "budget_type")
    search_fields = ("name", "code", "department__name")
    ordering_fields = ("name", "created_at")

    def get_queryset(self):
        return super().get_queryset().select_related("fiscal_year", "department", "owner").prefetch_related("lines__account")

    def get_required_permission(self):
        return {
            "create": "budget.manage", "partial_update": "budget.manage", "submit": "budget.manage", "notes": "budget.view",
            "approve": "budget.approve", "return_for_changes": "budget.approve", "attachments": "budget.manage",
        }.get(self.action, "budget.view")

    @action(detail=True, methods=("post",), filter_backends=())
    def submit(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(submit_budget, budget=self.get_object(), actor=request.user)).data)

    @action(detail=True, methods=("post",), filter_backends=())
    def approve(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(decide_budget, budget=self.get_object(), actor=request.user, approve=True, note=str(request.data.get("note", "")))).data)

    @action(detail=True, methods=("post",), filter_backends=(), url_path="return")
    def return_for_changes(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(decide_budget, budget=self.get_object(), actor=request.user, approve=False, note=str(request.data.get("note", "")))).data)

    @action(detail=True, methods=("get",), filter_backends=())
    def detail_view(self, request, pk=None):
        """Breakdown by category and line, initiatives, notes, approvals and audit trail."""
        from apps.audit.models import AuditLog

        budget = self.get_object()
        rows, totals = budget_figures(budget)
        categories = {}
        for row in rows:
            bucket = categories.setdefault(row["line"].category, {"category": row["line"].category, "label": row["line"].get_category_display(), "lines": [], **{k: ZERO for k in ("allocated", "committed", "actual", "remaining", "variance")}})
            for key in ("allocated", "committed", "actual", "remaining", "variance"):
                bucket[key] += row[key]
            bucket["lines"].append({
                "id": str(row["line"].id), "description": row["line"].description, "initiative": row["line"].initiative,
                "account": f"{row['line'].account.code} {row['line'].account.name}" if row["line"].account_id else None,
                **{k: str(row[k]) for k in ("allocated", "committed", "actual", "remaining", "variance")},
            })
        initiatives = {}
        for row in rows:
            name = row["line"].initiative or "Unassigned"
            bucket = initiatives.setdefault(name, {"initiative": name, "allocated": ZERO, "actual": ZERO, "committed": ZERO})
            for key in ("allocated", "actual", "committed"):
                bucket[key] += row[key]
        audit = AuditLog.objects.filter(institution=request.institution, entity_id=budget.id).select_related("actor").order_by("-created_at")[:40]
        return Response({
            "budget": self.get_serializer(budget).data,
            "totals": {k: str(v) for k, v in totals.items()},
            "health": _status_for(totals),
            "categories": [
                {**{k: (str(v) if isinstance(v, Decimal) else v) for k, v in bucket.items()},
                 "percent_of_budget": str(round(bucket["allocated"] * 100 / totals["allocated"], 1)) if totals["allocated"] else "0"}
                for bucket in categories.values()
            ],
            "initiatives": [{k: (str(v) if isinstance(v, Decimal) else v) for k, v in bucket.items()} for bucket in initiatives.values()],
            "notes": [{"id": str(note.id), "author": _person(note.author), "body": note.body, "created_at": note.created_at} for note in budget.notes.select_related("author")],
            "attachments": self._record_context(budget)["attachments"],
            "people": {"created_by": _person(budget.created_by), "submitted_by": _person(budget.submitted_by), "submitted_by_id": str(budget.submitted_by_id) if budget.submitted_by_id else None, "approved_by": _person(budget.approved_by)},
            "audit": [{"id": str(entry.id), "action": entry.action, "actor": _person(entry.actor) or "System", "created_at": entry.created_at, "metadata": entry.metadata} for entry in audit],
        })

    @action(detail=True, methods=("post",), filter_backends=())
    def notes(self, request, pk=None):
        from rest_framework.exceptions import ValidationError as DRFValidationError

        budget = self.get_object()
        body = (request.data.get("body") or "").strip()
        if not body:
            raise DRFValidationError({"body": "Write a note first."})
        note = BudgetNote.objects.create(institution=request.institution, budget=budget, author=request.user, body=body[:4000])
        record_audit_event(actor=request.user, institution=request.institution, entity=budget, action="accounting.budget.note_added")
        return Response({"id": str(note.id), "author": _person(request.user), "body": note.body, "created_at": note.created_at}, status=201)

    @action(detail=False, methods=("get",), filter_backends=())
    def options(self, request):
        """Choices for the budget form, available to anyone who can view budgets."""
        institution = request.institution
        return Response({
            "fiscal_years": [{"id": str(item.id), "name": item.name, "start_date": item.start_date, "end_date": item.end_date}
                             for item in FiscalYear.objects.for_institution(institution).order_by("-start_date")],
            "departments": [{"id": str(item.id), "name": item.name} for item in Department.objects.for_institution(institution).order_by("name")],
            "accounts": [{"id": str(item.id), "code": item.code, "name": item.name, "account_type": item.account_type}
                         for item in Account.objects.for_institution(institution).filter(is_active=True, is_postable=True, account_type__in=(Account.AccountType.EXPENSE, Account.AccountType.ASSET)).order_by("code")],
        })

    @action(detail=False, methods=("get",), filter_backends=())
    def overview(self, request):
        """Folders by department, the category overview and department comparison for one fiscal year."""
        years = FiscalYear.objects.for_institution(request.institution).order_by("-start_date")
        year = years.filter(pk=request.query_params.get("fiscal_year")).first() if request.query_params.get("fiscal_year") else years.first()
        budgets = Budget.objects.for_institution(request.institution).exclude(status=Budget.Status.CLOSED).select_related("department", "fiscal_year")
        if year:
            budgets = budgets.filter(fiscal_year=year)
        department = request.query_params.get("department")
        scoped = budgets.filter(department_id=department) if department else budgets
        categories, comparisons, initiatives = {}, {}, {}
        for budget in budgets:
            rows, totals = budget_figures(budget)
            key = budget.department.name if budget.department_id else "Institution-wide"
            comparison = comparisons.setdefault(key, {"department": key, "department_id": str(budget.department_id) if budget.department_id else None, "allocated": ZERO, "actual": ZERO, "committed": ZERO, "budgets": 0})
            comparison["budgets"] += 1
            for field in ("allocated", "actual", "committed"):
                comparison[field] += totals[field]
            if budget in scoped:
                for row in rows:
                    name = row["line"].initiative or "Unassigned"
                    initiative = initiatives.setdefault(name, {"initiative": name, "allocated": ZERO, "actual": ZERO, "committed": ZERO, "budgets": set()})
                    for field in ("allocated", "actual", "committed"):
                        initiative[field] += row[field]
                    initiative["budgets"].add(budget.name)
                    bucket = categories.setdefault(row["line"].category, {"category": row["line"].category, "label": row["line"].get_category_display(), **{k: ZERO for k in ("allocated", "committed", "actual", "variance")}})
                    for field in ("allocated", "committed", "actual", "variance"):
                        bucket[field] += row[field]
        folders = {}
        for budget in budgets:
            folder = folders.setdefault(str(budget.department_id or "none"), {"id": str(budget.department_id) if budget.department_id else None, "name": budget.department.name if budget.department_id else "Institution-wide", "count": 0})
            folder["count"] += 1
        pending = scoped.filter(status=Budget.Status.PENDING_APPROVAL)
        return Response({
            "fiscal_years": [{"id": str(item.id), "name": item.name, "start_date": item.start_date, "end_date": item.end_date} for item in years],
            "fiscal_year": str(year.id) if year else None,
            "folders": sorted(folders.values(), key=lambda row: row["name"]),
            "total_budgets": budgets.count(),
            "categories": [{**{k: (str(v) if isinstance(v, Decimal) else v) for k, v in bucket.items()}, "status": _status_for(bucket)} for bucket in categories.values()],
            "initiatives": [{"initiative": row["initiative"], "allocated": str(row["allocated"]), "actual": str(row["actual"]), "committed": str(row["committed"]), "budgets": sorted(row["budgets"])} for row in initiatives.values()],
            "comparisons": [{**{k: (str(v) if isinstance(v, Decimal) else v) for k, v in row.items()}} for row in comparisons.values()],
            "budgets": [
                {"id": str(item.id), "code": item.code, "name": item.name, "department": item.department.name if item.department_id else "Institution-wide",
                 "status": item.status, "budget_type": item.budget_type, **{k: str(v) for k, v in budget_figures(item)[1].items()}}
                for item in scoped.order_by("name")
            ],
            "pending_approvals": [{"id": str(item.id), "name": item.name, "submitted_at": item.submitted_at} for item in pending[:5]],
        })
