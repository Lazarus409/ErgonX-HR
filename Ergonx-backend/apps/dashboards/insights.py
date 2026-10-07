"""Cross-module Insights rollups (concept "Insights").

Every section is built only when the institution has the module enabled and the
caller holds the matching dashboard permission with institution-wide scope.
A section the caller cannot see is returned as ``None`` so the page can say
"no data available for your access level" instead of showing zeros.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.db import models
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth

from apps.accounting.models import Account, JournalEntry, JournalLine
from apps.attendance.models import AttendanceRecord
from apps.employees.models import Employee, Employment
from apps.leave.models import LeaveRequest
from apps.operations.models import BackgroundJob, ExportJob, ImportJob
from apps.payroll.models import PayrollRecord, PayrollRun, PayrollRunException
from apps.recruitment.models import Application
from common.scoping import INSTITUTION

RANGE_MONTHS = (3, 6, 12, 24)
AGE_BUCKETS = (("< 25", 0, 25), ("25 - 34", 25, 35), ("35 - 44", 35, 45), ("45 - 54", 45, 55), ("55 - 64", 55, 65), ("65+", 65, 200))
TENURE_BUCKETS = (("< 1 year", 0, 1), ("1 - 3 years", 1, 3), ("3 - 5 years", 3, 5), ("5 - 10 years", 5, 10), ("10+ years", 10, 200))


def _month_start(day):
    return day.replace(day=1)


def _add_months(day, count):
    month = day.month - 1 + count
    return date(day.year + month // 12, month % 12 + 1, 1)


def _month_key(value):
    return (value.date() if hasattr(value, "date") else value).replace(day=1)


def _years_between(start, end):
    return end.year - start.year - ((end.month, end.day) < (start.month, start.day))


def _change_percent(current, previous):
    if not previous:
        return None
    return (Decimal(current) - Decimal(previous)) / Decimal(previous) * Decimal("100")


def _headcount_on(institution, day):
    return (
        Employment.objects.for_institution(institution)
        .filter(start_date__lte=day)
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=day))
        .values("employee_id")
        .distinct()
        .count()
    )


def _share_rows(counts, total, label_key="label"):
    return [
        {label_key: label, "count": count, "percent": (Decimal(count) / Decimal(total) * Decimal("100")).quantize(Decimal("0.1")) if total else None}
        for label, count in counts
    ]


def _bucket(values, buckets):
    counts = {label: 0 for label, _, _ in buckets}
    missing = 0
    for value in values:
        if value is None:
            missing += 1
            continue
        for label, low, high in buckets:
            if low <= value < high:
                counts[label] += 1
                break
    rows = list(counts.items())
    if missing:
        rows.append(("Not recorded", missing))
    return rows


def _workforce(institution, months, today):
    current = (
        Employment.objects.for_institution(institution)
        .filter(is_current=True, employee__status=Employee.Status.ACTIVE)
        .select_related("employee", "department", "location")
    )
    rows = list(current)
    total = len(rows)
    gender_labels = dict(Employee.Gender.choices)
    gender_counts = {}
    for row in rows:
        label = gender_labels.get(row.employee.gender) or "Not recorded"
        gender_counts[label] = gender_counts.get(label, 0) + 1
    type_labels = dict(Employment.EmploymentType.choices)
    type_counts = {}
    for row in rows:
        label = type_labels.get(row.employment_type, row.employment_type or "Not recorded")
        type_counts[label] = type_counts.get(label, 0) + 1

    def ranked(key):
        counts = {}
        for row in rows:
            name = key(row) or "Unassigned"
            counts[name] = counts.get(name, 0) + 1
        return sorted(counts.items(), key=lambda item: (-item[1], item[0]))

    ages = [_years_between(row.employee.date_of_birth, today) if row.employee.date_of_birth else None for row in rows]
    tenures = [_years_between(row.employee.hire_date, today) if row.employee.hire_date else None for row in rows]
    return {
        "as_of": today.isoformat(),
        "total_employees": total,
        "demographics": {
            "gender": _share_rows(sorted(gender_counts.items(), key=lambda item: -item[1]), total),
            "age_range": _share_rows(_bucket(ages, AGE_BUCKETS), total),
            "employment_status": _share_rows(sorted(type_counts.items(), key=lambda item: -item[1]), total),
        },
        "by_department": _share_rows(ranked(lambda row: row.department.name if row.department_id else None), total),
        "by_location": _share_rows(ranked(lambda row: row.location.name if row.location_id else None), total),
        "age_distribution": _share_rows(_bucket(ages, AGE_BUCKETS), total),
        "tenure_distribution": _share_rows(_bucket(tenures, TENURE_BUCKETS), total),
        "headcount_trend": [
            {"month": month.isoformat(), "headcount": _headcount_on(institution, min(_add_months(month, 1) - timedelta(days=1), today))}
            for month in months
        ],
    }


def _monthly_counts(queryset, field, months):
    first = months[0]
    lookup = f"{field}__date__gte" if isinstance(queryset.model._meta.get_field(field), models.DateTimeField) else f"{field}__gte"
    rollup = {
        _month_key(item["month"]): item["count"]
        for item in queryset.filter(**{lookup: first})
        .annotate(month=TruncMonth(field))
        .values("month")
        .annotate(count=Count("id"))
    }
    return [rollup.get(month, 0) for month in months]


def _income_between(institution, start, end):
    totals = JournalLine.objects.filter(
        journal_entry__institution=institution,
        journal_entry__status=JournalEntry.Status.POSTED,
        journal_entry__entry_date__gte=start,
        journal_entry__entry_date__lte=end,
        account__account_type=Account.AccountType.INCOME,
    ).aggregate(debit=Sum("debit"), credit=Sum("credit"))
    return (totals["credit"] or Decimal("0")) - (totals["debit"] or Decimal("0"))


def _payroll_between(institution, start, end):
    return PayrollRecord.objects.filter(
        institution=institution,
        payroll_run__status=PayrollRun.Status.FINALIZED,
        payroll_run__payroll_period__end_date__gte=start,
        payroll_run__payroll_period__end_date__lte=end,
    ).aggregate(total=Sum("gross_pay"))["total"] or Decimal("0")


def _leave_policy_checks(institution, start, end):
    """(passed, total) leave requests starting in the window that meet their leave policy.

    The same rules as the leave dashboard's compliance panel: an applicable
    policy exists, the maximum consecutive days hold, and a required document is attached.
    """
    from django.core.exceptions import ValidationError as DjangoValidationError

    from apps.leave.services import matching_policy

    passed = total = 0
    for item in LeaveRequest.objects.filter(
        institution=institution, status__in=(LeaveRequest.Status.PENDING, LeaveRequest.Status.APPROVED), start_date__gte=start, start_date__lte=end,
    ).select_related("employee", "leave_type"):
        total += 1
        try:
            policy = matching_policy(item)
        except DjangoValidationError:
            continue
        if policy.max_consecutive_days is not None and item.requested_days > policy.max_consecutive_days:
            continue
        if (item.leave_type.requires_attachment or policy.requires_document) and not item.attachment_id:
            continue
        passed += 1
    return passed, total


def _payroll_exception_checks(institution, start, end):
    """(handled, total) payroll run exceptions raised in the window; handled means acknowledged or resolved."""
    raised = PayrollRunException.objects.filter(institution=institution, created_at__date__gte=start, created_at__date__lte=end)
    return raised.exclude(status=PayrollRunException.Status.OPEN).count(), raised.count()


def _compliance(institution, start, end, *, leave, payroll):
    checks = []
    if leave:
        passed, total = _leave_policy_checks(institution, start, end)
        checks.append({"code": "leave_policy", "label": "Leave requests within policy", "passed": passed, "total": total})
    if payroll:
        passed, total = _payroll_exception_checks(institution, start, end)
        checks.append({"code": "payroll_exceptions", "label": "Payroll exceptions handled", "passed": passed, "total": total})
    passed = sum(check["passed"] for check in checks)
    total = sum(check["total"] for check in checks)
    rate = (Decimal(passed) / Decimal(total) * Decimal("100")).quantize(Decimal("0.1")) if total else None
    return rate, checks


def _revenue_by_source(institution, start, end):
    rows = (
        JournalLine.objects.filter(
            journal_entry__institution=institution,
            journal_entry__status=JournalEntry.Status.POSTED,
            journal_entry__entry_date__gte=start,
            journal_entry__entry_date__lte=end,
            account__account_type=Account.AccountType.INCOME,
        )
        .values("account__name")
        .annotate(debit=Sum("debit"), credit=Sum("credit"))
    )
    amounts = sorted(
        ((row["account__name"], (row["credit"] or Decimal("0")) - (row["debit"] or Decimal("0"))) for row in rows),
        key=lambda item: -item[1],
    )
    amounts = [(name, amount) for name, amount in amounts if amount > 0]
    if len(amounts) > 6:
        amounts = amounts[:5] + [("Other income", sum(amount for _, amount in amounts[5:]))]
    total = sum(amount for _, amount in amounts)
    return [
        {"label": name, "amount": amount, "percent": (amount / total * Decimal("100")).quantize(Decimal("0.1")) if total else None}
        for name, amount in amounts
    ]


def insights_payload(*, institution, permission_codes, scope, span, today=None):
    from apps.dashboards.views import _bank_cash_position

    today = today or date.today()
    span = span if span in RANGE_MONTHS else 12
    first_month = _add_months(_month_start(today), -(span - 1))
    months = [_add_months(first_month, index) for index in range(span)]
    previous_start = _add_months(first_month, -span)
    previous_end = first_month - timedelta(days=1)
    enabled = set(institution.modules.filter(is_enabled=True).values_list("module_code", flat=True)) | {"CORE_HR"}
    permissions = set(permission_codes)
    wide = scope == INSTITUTION
    executive = "dashboard.executive.view" in permissions

    def allowed(module, permission):
        return wide and module in enabled and (executive or permission in permissions)

    can_workforce = allowed("CORE_HR", "dashboard.hr.view")
    can_payroll = allowed("PAYROLL", "dashboard.payroll.view")
    can_finance = allowed("ACCOUNTING", "dashboard.finance.view")
    can_recruitment = wide and "RECRUITMENT" in enabled and (executive or "candidate.view" in permissions)
    can_leave = allowed("LEAVE", "dashboard.leave.view")
    can_attendance = allowed("ATTENDANCE", "dashboard.attendance.view")
    can_operations = wide and (executive or "background_job.view" in permissions)

    payload = {
        "currency": institution.default_currency,
        "executive_title": institution.executive_title or "Executive",
        "range_months": span,
        "range_start": first_month.isoformat(),
        "range_end": today.isoformat(),
        "access": {
            "workforce": can_workforce,
            "payroll": can_payroll,
            "finance": can_finance,
            "recruitment": can_recruitment,
            "leave": can_leave,
            "attendance": can_attendance,
            "operations": can_operations,
        },
        "workforce": None,
        "kpis": {"employees": None, "payroll": None, "revenue": None, "revenue_ytd": None, "alerts": None, "compliance": None},
        "revenue_by_source": None,
        "module_trend": None,
        "leave_attendance": None,
    }

    if can_workforce:
        workforce = _workforce(institution, months, today)
        payload["workforce"] = workforce
        previous = _headcount_on(institution, previous_end)
        payload["kpis"]["employees"] = {
            "value": workforce["total_employees"],
            "previous": previous,
            "change_percent": _change_percent(workforce["total_employees"], previous),
        }

    if can_payroll:
        current = _payroll_between(institution, first_month, today)
        previous = _payroll_between(institution, previous_start, previous_end)
        payload["kpis"]["payroll"] = {"value": current, "previous": previous, "change_percent": _change_percent(current, previous)}

    if can_finance:
        current = _income_between(institution, first_month, today)
        previous = _income_between(institution, previous_start, previous_end)
        payload["kpis"]["revenue"] = {
            "value": current,
            "previous": previous,
            "change_percent": _change_percent(current, previous),
            "cash_balance": _bank_cash_position(institution)["balance"],
        }

    if can_finance:
        year_start = date(today.year, 1, 1)
        last_year_today = today.replace(year=today.year - 1) if not (today.month == 2 and today.day == 29) else date(today.year - 1, 2, 28)
        current = _income_between(institution, year_start, today)
        previous = _income_between(institution, date(today.year - 1, 1, 1), last_year_today)
        payload["kpis"]["revenue_ytd"] = {
            "value": current,
            "previous": previous,
            "change_percent": _change_percent(current, previous),
            "cash_balance": payload["kpis"]["revenue"]["cash_balance"],
            "year_start": year_start.isoformat(),
        }
        payload["revenue_by_source"] = _revenue_by_source(institution, first_month, today)

    if can_leave or can_payroll:
        rate, checks = _compliance(institution, first_month, today, leave=can_leave, payroll=can_payroll)
        previous_rate, _previous_checks = _compliance(institution, previous_start, previous_end, leave=can_leave, payroll=can_payroll)
        payload["kpis"]["compliance"] = {
            "value": rate,
            "previous": previous_rate,
            "change_points": (rate - previous_rate) if rate is not None and previous_rate is not None else None,
            "checks": checks,
        }

    if can_operations:
        since = first_month
        breakdown = [
            {"code": "failed_background_jobs", "label": "Failed background jobs", "count": BackgroundJob.objects.filter(institution=institution, status=BackgroundJob.Status.FAILED, created_at__date__gte=since).count()},
            {"code": "failed_imports", "label": "Failed imports", "count": ImportJob.objects.filter(institution=institution, status=ImportJob.Status.FAILED, created_at__date__gte=since).count()},
            {"code": "failed_exports", "label": "Failed exports", "count": ExportJob.objects.filter(institution=institution, status=ExportJob.Status.FAILED, created_at__date__gte=since).count()},
        ]
        if can_payroll:
            breakdown.append({
                "code": "open_payroll_exceptions",
                "label": "Open payroll exceptions",
                "count": PayrollRunException.objects.filter(institution=institution, status=PayrollRunException.Status.OPEN).count(),
            })
        payload["kpis"]["alerts"] = {"value": sum(item["count"] for item in breakdown), "breakdown": breakdown}

    series = []
    if can_workforce:
        series.append({"code": "HR", "label": "HR", "unit": "Employee records", "values": _monthly_counts(Employee.objects.for_institution(institution), "created_at", months)})
    if can_payroll:
        series.append({"code": "PAYROLL", "label": "Payroll", "unit": "Payroll records", "values": _monthly_counts(PayrollRecord.objects.filter(institution=institution), "created_at", months)})
    if can_recruitment:
        series.append({"code": "RECRUITMENT", "label": "Recruitment", "unit": "Applications", "values": _monthly_counts(Application.objects.filter(institution=institution, applied_at__isnull=False), "applied_at", months)})
    if series:
        payload["module_trend"] = {"months": [month.isoformat() for month in months], "series": series}

    if can_leave or can_attendance:
        rows = []
        leave_days = {}
        if can_leave:
            leave_days = {
                _month_key(item["month"]): item["days"] or Decimal("0")
                for item in LeaveRequest.objects.filter(institution=institution, status=LeaveRequest.Status.APPROVED, start_date__gte=first_month, start_date__lte=today)
                .annotate(month=TruncMonth("start_date"))
                .values("month")
                .annotate(days=Sum("requested_days"))
            }
        attendance = {}
        if can_attendance:
            attended = (AttendanceRecord.Status.PRESENT, AttendanceRecord.Status.LATE, AttendanceRecord.Status.REMOTE)
            for item in (
                AttendanceRecord.objects.filter(institution=institution, attendance_date__gte=first_month, attendance_date__lte=today)
                .exclude(status__in=(AttendanceRecord.Status.HOLIDAY, AttendanceRecord.Status.OFF_DAY))
                .annotate(month=TruncMonth("attendance_date"))
                .values("month")
                .annotate(total=Count("id"), attended=Count("id", filter=Q(status__in=attended)))
            ):
                attendance[_month_key(item["month"])] = item
        for month in months:
            record = attendance.get(month)
            rows.append({
                "month": month.isoformat(),
                "leave_days": leave_days.get(month, Decimal("0")) if can_leave else None,
                "attendance_rate": (
                    (Decimal(record["attended"]) / Decimal(record["total"]) * Decimal("100")).quantize(Decimal("0.1"))
                    if record and record["total"]
                    else None
                ) if can_attendance else None,
            })
        payload["leave_attendance"] = rows
    return payload
