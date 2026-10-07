import csv
import io
from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import Count, Sum

from apps.accounting.models import Expense, Invoice, JournalEntry, VendorBill
from apps.attendance.models import AttendanceRecord
from apps.employees.models import Employee, Employment
from apps.leave.models import LeaveRequest
from apps.payroll.models import PayrollRecord
from apps.recruitment.models import Application
from common.scoping import ATTENDANCE_BROAD, LEAVE_BROAD


REPORT_TYPES = {
    "workforce-cost",
    "leave",
    "attendance",
    "payroll",
    "accounting",
    "ap-ar",
    "expenses",
    "recruitment",
}

# The summary columns that identify a row, in order. A drill-down names a row by
# these values (``group``) and lists the records that were counted in it.
GROUP_FIELDS = {
    "workforce-cost": ("status",),
    "leave": ("status",),
    "attendance": ("status",),
    "payroll": ("payroll_run__status",),
    "accounting": ("source", "status"),
    "ap-ar": ("area",),
    "expenses": ("status",),
    "recruitment": ("status",),
}

DETAIL_LIMIT = 1000


def normalize_report_type(export_type):
    value = export_type.strip().lower().replace("report_", "").replace("_", "-")
    if value not in REPORT_TYPES:
        raise ValueError(f"Unsupported report export type: {export_type!r}.")
    return value


def _date_range(date_from, date_to):
    try:
        start = date.fromisoformat(date_from) if date_from else None
        end = date.fromisoformat(date_to) if date_to else None
    except ValueError as exc:
        raise ValueError("date_from and date_to must use YYYY-MM-DD format.") from exc
    if start and end and start > end:
        raise ValueError("date_from cannot be after date_to.")
    return start, end


def _payroll_records(institution, start, end):
    records = PayrollRecord.objects.filter(institution=institution)
    if start:
        records = records.filter(payroll_run__payroll_period__end_date__gte=start)
    if end:
        records = records.filter(payroll_run__payroll_period__start_date__lte=end)
    return records


def _open_ap_ar(institution, start, end):
    bills = VendorBill.objects.filter(institution=institution, status__in=(VendorBill.Status.POSTED, VendorBill.Status.PART_PAID))
    invoices = Invoice.objects.filter(institution=institution, status__in=(Invoice.Status.ISSUED, Invoice.Status.PART_PAID))
    if start:
        bills = bills.filter(due_date__gte=start)
        invoices = invoices.filter(due_date__gte=start)
    if end:
        bills = bills.filter(bill_date__lte=end)
        invoices = invoices.filter(invoice_date__lte=end)
    return bills, invoices


def _filtered(institution, report_type, *, status, start, end):
    """The records a report counts, with the report's filters applied."""
    if report_type == "workforce-cost":
        employees = Employee.objects.for_institution(institution)
        return employees.filter(status=status) if status else employees
    if report_type == "leave":
        records = LeaveRequest.objects.filter(institution=institution)
        if start:
            records = records.filter(end_date__gte=start)
        if end:
            records = records.filter(start_date__lte=end)
    elif report_type == "attendance":
        records = AttendanceRecord.objects.filter(institution=institution)
        if start:
            records = records.filter(attendance_date__gte=start)
        if end:
            records = records.filter(attendance_date__lte=end)
    elif report_type == "payroll":
        records = _payroll_records(institution, start, end)
        return records.filter(payroll_run__status=status) if status else records
    elif report_type == "accounting":
        records = JournalEntry.objects.filter(institution=institution)
        if start:
            records = records.filter(entry_date__gte=start)
        if end:
            records = records.filter(entry_date__lte=end)
    elif report_type == "expenses":
        records = Expense.objects.filter(institution=institution)
        if start:
            records = records.filter(expense_date__gte=start)
        if end:
            records = records.filter(expense_date__lte=end)
    else:
        records = Application.objects.filter(institution=institution)
        if start:
            records = records.filter(applied_at__date__gte=start)
        if end:
            records = records.filter(applied_at__date__lte=end)
    return records.filter(status=status) if status else records


def build_report_rows(institution, report_type, *, status=None, date_from=None, date_to=None):
    """Build tenant-scoped report rows for both API and queued exports."""
    report_type = normalize_report_type(report_type)
    start, end = _date_range(date_from, date_to)
    if report_type == "ap-ar":
        bills, invoices = _open_ap_ar(institution, start, end)
        return [{"area": "AP", "open_amount": bills.aggregate(total=Sum("amount_payable"))["total"] or Decimal("0")}, {"area": "AR", "open_amount": invoices.aggregate(total=Sum("total_amount"))["total"] or Decimal("0")}]
    records = _filtered(institution, report_type, status=status, start=start, end=end)
    if report_type == "workforce-cost":
        rows = list(records.values("status").annotate(employee_count=Count("id")).order_by("status"))
        payroll = _payroll_records(institution, start, end).aggregate(gross=Sum("gross_pay"), net=Sum("net_pay"))
        rows.append({"status": "PAYROLL_TOTAL", "employee_count": "", "gross_pay": payroll["gross"] or Decimal("0"), "net_pay": payroll["net"] or Decimal("0")})
        return rows
    if report_type == "leave":
        return list(records.values("status").annotate(request_count=Count("id"), requested_days=Sum("requested_days")).order_by("status"))
    if report_type == "attendance":
        return list(records.values("status").annotate(record_count=Count("id"), late_minutes=Sum("late_minutes"), overtime_minutes=Sum("overtime_minutes")).order_by("status"))
    if report_type == "payroll":
        return list(records.values("payroll_run__status").annotate(employee_count=Count("id"), gross_pay=Sum("gross_pay"), deductions=Sum("total_deductions"), net_pay=Sum("net_pay")).order_by("payroll_run__status"))
    if report_type == "accounting":
        return list(records.values("source", "status").annotate(journal_count=Count("id")).order_by("source", "status"))
    if report_type == "expenses":
        return list(records.values("status").annotate(expense_count=Count("id"), amount=Sum("amount")).order_by("status"))
    return list(records.values("status").annotate(application_count=Count("id")).order_by("status"))


def _departments(institution, employee_ids):
    """Current department name per employee, for the people listed in a drill-down."""
    return dict(
        Employment.objects.filter(institution=institution, employee_id__in=set(employee_ids), is_current=True)
        .order_by("-start_date")
        .values_list("employee_id", "department__name")
    )


def _minutes(value):
    return f"{value // 60}h {value % 60:02d}m" if value else "0m"


def _time(value, zone):
    return value.astimezone(zone).strftime("%H:%M") if value else ""


def _zone(institution):
    try:
        return ZoneInfo(institution.timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _unscoped(queryset, employee_field, **options):
    return queryset


def _employee_rows(institution, items, build):
    """Rows about people: name, number and department first, then the record's own columns."""
    departments = _departments(institution, [item.employee_id for item in items])
    return [
        {
            "employee": item.employee.full_name,
            "employee_number": item.employee.employee_number,
            "department": departments.get(item.employee_id) or "",
            **build(item),
        }
        for item in items
    ]


def build_report_details(institution, report_type, group, *, status=None, date_from=None, date_to=None, scope=_unscoped):
    """List the records behind one summary row, e.g. the employees counted as ABSENT.

    ``scope(queryset, employee_field, **options)`` narrows people-linked records
    to what the requester may see (see common.scoping.scope_to_employees).
    """
    report_type = normalize_report_type(report_type)
    start, end = _date_range(date_from, date_to)
    fields = GROUP_FIELDS[report_type]
    group = list(group or [])
    if len(group) != len(fields) or not all(group):
        raise ValueError(f"Choose a row to open: this report is grouped by {', '.join(fields)}.")
    key = dict(zip(fields, group))

    if report_type == "ap-ar":
        bills, invoices = _open_ap_ar(institution, start, end)
        if key["area"] == "AP":
            items = bills.select_related("vendor").order_by("due_date")[:DETAIL_LIMIT]
            return [{"vendor": bill.vendor.name, "bill_number": bill.bill_number, "bill_date": bill.bill_date, "due_date": bill.due_date, "status": bill.status, "amount_payable": bill.amount_payable, "currency": bill.currency} for bill in items]
        if key["area"] == "AR":
            items = invoices.select_related("customer").order_by("due_date")[:DETAIL_LIMIT]
            return [{"customer": invoice.customer.name, "invoice_number": invoice.invoice_number, "invoice_date": invoice.invoice_date, "due_date": invoice.due_date, "status": invoice.status, "total_amount": invoice.total_amount, "currency": invoice.currency} for invoice in items]
        raise ValueError("Unknown AP/AR area.")

    if report_type == "workforce-cost" and key["status"] == "PAYROLL_TOTAL":
        records = scope(_payroll_records(institution, start, end), "employee", allow_team=False).select_related("employee", "payroll_run__payroll_period")
        items = list(records.order_by("-payroll_run__payroll_period__start_date", "employee__last_name")[:DETAIL_LIMIT])
        return _employee_rows(institution, items, lambda record: {"period": record.payroll_run.payroll_period.name, "gross_pay": record.gross_pay, "net_pay": record.net_pay, "currency": record.currency})

    records = _filtered(institution, report_type, status=status, start=start, end=end).filter(**key)
    if report_type == "workforce-cost":
        records = scope(records, "")
    elif report_type == "leave":
        records = scope(records, "employee", broad=LEAVE_BROAD)
    elif report_type == "attendance":
        records = scope(records, "employee", broad=ATTENDANCE_BROAD)
    elif report_type == "payroll":
        records = scope(records, "employee", allow_team=False)
    if report_type == "workforce-cost":
        items = list(records.order_by("last_name", "first_name")[:DETAIL_LIMIT])
        departments = _departments(institution, [item.id for item in items])
        return [{"employee": item.full_name, "employee_number": item.employee_number, "department": departments.get(item.id) or "", "hire_date": item.hire_date, "work_email": item.work_email, "status": item.status} for item in items]
    if report_type == "leave":
        items = list(records.select_related("employee", "leave_type").order_by("-start_date")[:DETAIL_LIMIT])
        return _employee_rows(institution, items, lambda item: {"leave_type": item.leave_type.name, "start_date": item.start_date, "end_date": item.end_date, "days": item.requested_days, "status": item.status})
    if report_type == "attendance":
        zone = _zone(institution)
        items = list(records.select_related("employee").order_by("-attendance_date", "employee__last_name")[:DETAIL_LIMIT])
        return _employee_rows(institution, items, lambda item: {"date": item.attendance_date, "check_in": _time(item.check_in, zone), "check_out": _time(item.check_out, zone), "worked": _minutes(item.worked_minutes), "late": _minutes(item.late_minutes), "overtime": _minutes(item.overtime_minutes)})
    if report_type == "payroll":
        items = list(records.select_related("employee", "payroll_run__payroll_period").order_by("-payroll_run__payroll_period__start_date", "employee__last_name")[:DETAIL_LIMIT])
        return _employee_rows(institution, items, lambda item: {"period": item.payroll_run.payroll_period.name, "gross_pay": item.gross_pay, "deductions": item.total_deductions, "net_pay": item.net_pay, "currency": item.currency})
    if report_type == "accounting":
        items = records.order_by("-entry_date")[:DETAIL_LIMIT]
        return [{"journal_number": item.journal_number, "entry_date": item.entry_date, "description": item.description, "reference": item.reference or "", "status": item.status} for item in items]
    if report_type == "expenses":
        items = records.select_related("account", "created_by").order_by("-expense_date")[:DETAIL_LIMIT]
        return [{"expense_date": item.expense_date, "description": item.description, "account": f"{item.account.code} {item.account.name}", "amount": item.amount, "currency": item.currency, "submitted_by": item.created_by.get_full_name() or item.created_by.email, "status": item.status} for item in items]
    items = records.select_related("candidate", "job_posting", "current_stage").order_by("-applied_at")[:DETAIL_LIMIT]
    return [{"candidate": " ".join(part for part in (item.candidate.first_name, item.candidate.last_name) if part), "email": item.candidate.email, "job_posting": item.job_posting.title, "stage": item.current_stage.name if item.current_stage else "", "applied_on": item.applied_at.date() if item.applied_at else "", "status": item.status} for item in items]


def rows_to_csv(rows):
    fieldnames = list(dict.fromkeys(key for row in rows for key in row)) or ["empty"]
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()
