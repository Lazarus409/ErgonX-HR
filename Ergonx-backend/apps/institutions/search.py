from dataclasses import dataclass

from django.db.models import CharField, Q
from django.db.models.functions import Cast

from apps.accounting.models import Account, Budget, Customer, Invoice, JournalEntry, Vendor, VendorBill
from apps.documents.models import Document
from apps.employees.models import Employee
from apps.leave.models import LeaveRequest
from apps.payroll.models import PayrollRecord, PayrollRun
from apps.recruitment.models import Candidate, JobPosting, Offer
from common.scoping import LEAVE_BROAD


@dataclass(frozen=True)
class SearchProvider:
    result_type: str
    module: str
    permission: str
    route_hint: str
    query: callable
    # Providers of employee-linked rows accept ``scope(queryset, employee_field, broad)``.
    employee_scoped: bool = False


def _unscoped(queryset, employee_field, broad=None):
    return queryset


def _employee_results(institution, query, limit, scope=_unscoped):
    rows = scope(Employee.objects.for_institution(institution), "").filter(
        Q(employee_number__iexact=query)
        | Q(employee_number__icontains=query)
        | Q(first_name__icontains=query)
        | Q(last_name__icontains=query)
        | Q(work_email__icontains=query)
    ).order_by("employee_number")[:limit]
    results = []
    for row in rows:
        employment = row.employments.filter(is_current=True).select_related("department", "position", "location").first()
        department = employment.department.name if employment else ""
        position = employment.position.title if employment else ""
        location = employment.location.name if employment and employment.location_id else ""
        results.append({
            "id": str(row.id), "reference": row.employee_number, "title": row.full_name,
            "subtitle": row.work_email or row.personal_email, "status": row.status, "updated_at": row.updated_at,
            "kind": "Employee", "meta": [f"Employee ID: {row.employee_number}", department, location],
            "snippet": f"{row.full_name} is {('a ' + position) if position else 'an employee'}{(' in ' + department) if department else ''}{(' based at ' + location) if location else ''}.",
            "department_id": str(employment.department_id) if employment else None, "location_id": str(employment.location_id) if employment and employment.location_id else None,
        })
    return results


def _job_results(institution, query, limit):
    rows = JobPosting.objects.for_institution(institution).filter(
        Q(code__iexact=query) | Q(code__icontains=query) | Q(title__icontains=query)
    ).order_by("code")[:limit]
    return [
        {"id": str(row.id), "reference": row.code, "title": row.title, "subtitle": "Job posting", "status": row.status, "updated_at": row.updated_at}
        for row in rows
    ]


def _candidate_results(institution, query, limit):
    rows = Candidate.objects.for_institution(institution).filter(
        Q(first_name__icontains=query) | Q(last_name__icontains=query) | Q(email__icontains=query)
    ).order_by("last_name", "first_name")[:limit]
    return [
        {"id": str(row.id), "reference": "", "title": row.full_name, "subtitle": row.email, "status": row.status, "updated_at": row.updated_at}
        for row in rows
    ]


def _offer_results(institution, query, limit):
    rows = Offer.objects.for_institution(institution).select_related("application__candidate").filter(
        Q(application__candidate__first_name__icontains=query)
        | Q(application__candidate__last_name__icontains=query)
        | Q(status__iexact=query)
    ).order_by("-updated_at")[:limit]
    return [
        {"id": str(row.id), "reference": "", "title": f"Offer for {row.application.candidate.full_name}", "subtitle": "Recruitment offer", "status": row.status, "updated_at": row.updated_at}
        for row in rows
    ]


def _payroll_results(institution, query, limit):
    filters = Q(status__iexact=query) | Q(payroll_period__name__icontains=query)
    run_reference = query.upper().removeprefix("PR-")
    if run_reference.isdigit():
        filters |= Q(run_number=int(run_reference))
    rows = PayrollRun.objects.for_institution(institution).filter(filters).select_related("payroll_period").order_by("-started_at")[:limit]
    return [
        {"id": str(row.id), "reference": f"PR-{row.run_number}", "title": f"Payroll: {row.payroll_period.name}", "subtitle": "Payroll run", "status": row.status, "updated_at": row.updated_at}
        for row in rows
    ]


def _leave_request_results(institution, query, limit, scope=_unscoped):
    filters = (
        Q(employee__employee_number__icontains=query)
        | Q(employee__first_name__icontains=query)
        | Q(employee__last_name__icontains=query)
        | Q(leave_type__code__icontains=query)
        | Q(status__iexact=query)
    )
    queryset = scope(LeaveRequest.objects.for_institution(institution), "employee", LEAVE_BROAD)
    if query.upper().startswith("LR-"):
        queryset = queryset.annotate(search_id=Cast("id", output_field=CharField()))
        filters |= Q(search_id__istartswith=query[3:])
    rows = queryset.filter(filters).select_related("employee", "leave_type").order_by("-created_at")[:limit]
    return [
        {"id": str(row.id), "reference": f"LR-{str(row.id)[:8].upper()}", "title": f"{row.leave_type.name} — {row.employee.full_name}", "subtitle": "Leave request", "status": row.status, "updated_at": row.updated_at}
        for row in rows
    ]


def _account_results(institution, query, limit):
    rows = Account.objects.for_institution(institution).filter(
        Q(code__iexact=query) | Q(code__icontains=query) | Q(name__icontains=query)
    ).order_by("code")[:limit]
    return [
        {"id": str(row.id), "reference": row.code, "title": row.name, "subtitle": "Account", "status": "ACTIVE" if row.is_active else "INACTIVE", "updated_at": row.updated_at}
        for row in rows
    ]


def _journal_results(institution, query, limit):
    rows = JournalEntry.objects.for_institution(institution).filter(
        Q(reference__iexact=query) | Q(reference__icontains=query) | Q(description__icontains=query)
    ).order_by("-entry_date")[:limit]
    return [
        {"id": str(row.id), "reference": row.reference, "title": row.description or "Journal entry", "subtitle": "Journal", "status": row.status, "updated_at": row.updated_at}
        for row in rows
    ]


def _invoice_results(institution, query, limit):
    rows = Invoice.objects.for_institution(institution).filter(
        Q(invoice_number__iexact=query) | Q(invoice_number__icontains=query)
    ).order_by("-invoice_date")[:limit]
    return [
        {"id": str(row.id), "reference": row.invoice_number, "title": f"Invoice {row.invoice_number}", "subtitle": "Accounts receivable", "status": row.status, "updated_at": row.updated_at}
        for row in rows
    ]


def _vendor_bill_results(institution, query, limit):
    rows = VendorBill.objects.for_institution(institution).filter(
        Q(bill_number__iexact=query) | Q(bill_number__icontains=query)
    ).order_by("-bill_date")[:limit]
    return [
        {"id": str(row.id), "reference": row.bill_number, "title": f"Vendor bill {row.bill_number}", "subtitle": "Accounts payable", "status": row.status, "updated_at": row.updated_at}
        for row in rows
    ]


def _payroll_record_results(institution, query, limit, scope=_unscoped):
    rows = scope(PayrollRecord.objects.for_institution(institution), "employee").filter(
        Q(employee__employee_number__iexact=query) | Q(employee__first_name__icontains=query) | Q(employee__last_name__icontains=query)
    ).select_related("employee", "payroll_run__payroll_period").order_by("-created_at")[:limit]
    return [
        {"id": str(row.payroll_run_id), "reference": row.employee.employee_number, "title": f"Payroll record – {row.employee.full_name}", "subtitle": "Payroll record",
         "status": row.status, "updated_at": row.updated_at, "kind": "Payroll record",
         "meta": [f"Period: {row.payroll_run.payroll_period.name}", f"Employee ID: {row.employee.employee_number}"],
         "snippet": f"Gross {row.currency} {row.gross_pay:,.2f}, deductions {row.currency} {row.total_deductions:,.2f}, net {row.currency} {row.net_pay:,.2f}."}
        for row in rows
    ]


def _vendor_results(institution, query, limit):
    rows = Vendor.objects.for_institution(institution).filter(Q(name__icontains=query) | Q(vendor_code__icontains=query) | Q(email__icontains=query)).order_by("name")[:limit]
    return [
        {"id": str(row.id), "reference": row.vendor_code, "title": f"Vendor – {row.name}", "subtitle": "Supplier", "status": "ACTIVE" if row.is_active else "INACTIVE",
         "updated_at": row.updated_at, "kind": "Supplier", "meta": [f"Supplier ID: {row.vendor_code}", row.email], "snippet": row.address[:120] if row.address else ""}
        for row in rows
    ]


def _customer_results(institution, query, limit):
    rows = Customer.objects.for_institution(institution).filter(Q(name__icontains=query) | Q(customer_code__icontains=query) | Q(email__icontains=query)).order_by("name")[:limit]
    return [
        {"id": str(row.id), "reference": row.customer_code, "title": f"Customer – {row.name}", "subtitle": "Customer", "status": "ACTIVE" if row.is_active else "INACTIVE",
         "updated_at": row.updated_at, "kind": "Customer", "meta": [f"Customer ID: {row.customer_code}", row.email], "snippet": row.address[:120] if row.address else ""}
        for row in rows
    ]


def _budget_results(institution, query, limit):
    rows = Budget.objects.for_institution(institution).filter(Q(name__icontains=query) | Q(code__icontains=query) | Q(department__name__icontains=query)).select_related("department", "fiscal_year").order_by("-created_at")[:limit]
    return [
        {"id": str(row.id), "reference": row.code, "title": row.name, "subtitle": "Budget", "status": row.status, "updated_at": row.updated_at, "kind": "Budget",
         "meta": [row.department.name if row.department_id else "Institution-wide", row.fiscal_year.name], "snippet": row.description[:120]}
        for row in rows
    ]


def _document_results(institution, query, limit):
    rows = Document.objects.for_institution(institution).filter(is_active=True).filter(Q(original_filename__icontains=query) | Q(category__icontains=query)).order_by("-created_at")[:limit]
    return [
        {"id": str(row.id), "reference": row.category, "title": row.original_filename, "subtitle": "Document", "status": row.classification, "updated_at": row.updated_at,
         "kind": "Document", "meta": [row.category.replace("_", " ").title() if row.category else "Uncategorised", f"{max(1, row.size_bytes // 1024)} KB"], "snippet": ""}
        for row in rows
    ]


SEARCH_PROVIDERS = (
    SearchProvider("EMPLOYEE", "CORE_HR", "employee.view", "/hr/employees/{id}", _employee_results, employee_scoped=True),
    SearchProvider("JOB_POSTING", "RECRUITMENT", "job_posting.view", "/recruitment/job-postings/{id}", _job_results),
    SearchProvider("CANDIDATE", "RECRUITMENT", "candidate.view", "/recruitment/candidates/{id}", _candidate_results),
    SearchProvider("OFFER", "RECRUITMENT", "offer.view", "/recruitment/offers/{id}", _offer_results),
    SearchProvider("PAYROLL_RUN", "PAYROLL", "payroll.view", "/payroll/runs/{id}", _payroll_results),
    SearchProvider("LEAVE_REQUEST", "LEAVE", "leave.view", "/leave/requests/{id}", _leave_request_results, employee_scoped=True),
    SearchProvider("PAYROLL_RECORD", "PAYROLL", "payroll.view", "/payroll/runs/{id}", _payroll_record_results, employee_scoped=True),
    SearchProvider("ACCOUNT", "ACCOUNTING", "account.view", "/accounting/journals", _account_results),
    SearchProvider("JOURNAL", "ACCOUNTING", "journal.view", "/accounting/journals/{id}", _journal_results),
    SearchProvider("INVOICE", "ACCOUNTING", "invoice.view", "/accounting/receivables/invoices/{id}", _invoice_results),
    SearchProvider("VENDOR_BILL", "ACCOUNTING", "vendor_bill.view", "/accounting/payables/bills/{id}", _vendor_bill_results),
    SearchProvider("VENDOR", "ACCOUNTING", "vendor.view", "/accounting/payables", _vendor_results),
    SearchProvider("CUSTOMER", "ACCOUNTING", "customer.view", "/accounting/receivables/customers", _customer_results),
    SearchProvider("BUDGET", "ACCOUNTING", "budget.view", "/accounting/budgets/{id}", _budget_results),
    SearchProvider("DOCUMENT", "CORE_HR", "document.view", "/documents", _document_results),
)

# Result groups shown on the global search page (concept "Global search results").
GROUPS = {
    "EMPLOYEE": "PEOPLE", "CANDIDATE": "PEOPLE", "PAYROLL_RUN": "PAYROLL", "PAYROLL_RECORD": "PAYROLL", "LEAVE_REQUEST": "PEOPLE",
    "JOB_POSTING": "RECRUITMENT", "OFFER": "RECRUITMENT", "ACCOUNT": "ACCOUNTING", "JOURNAL": "ACCOUNTING", "INVOICE": "ACCOUNTING",
    "VENDOR_BILL": "ACCOUNTING", "VENDOR": "ACCOUNTING", "CUSTOMER": "ACCOUNTING", "BUDGET": "ACCOUNTING", "DOCUMENT": "DOCUMENTS",
}


def _score(query, row):
    needle = query.lower()
    reference = (row.get("reference") or "").lower()
    title = (row.get("title") or "").lower()
    if reference == needle:
        return 100
    if title.startswith(needle) or any(part.startswith(needle) for part in title.split()):
        return 80
    if needle in title:
        return 60
    if needle in reference:
        return 50
    return 20


def universal_search(*, institution, permission_codes, query, result_types=(), module=None, limit=20, scope=_unscoped,
                     since=None, department=None, location=None, sort="relevance", per_provider=None):
    enabled_modules = set(institution.modules.filter(is_enabled=True).values_list("module_code", flat=True)) | {"CORE_HR"}
    requested_types = set(result_types)
    results = []
    for provider in SEARCH_PROVIDERS:
        if requested_types and provider.result_type not in requested_types:
            continue
        if module and provider.module != module:
            continue
        if provider.module not in enabled_modules or provider.permission not in permission_codes:
            continue
        fetch = per_provider or limit
        rows = provider.query(institution, query, fetch, scope) if provider.employee_scoped else provider.query(institution, query, fetch)
        for row in rows:
            if since and row.get("updated_at") and row["updated_at"] < since:
                continue
            if department and provider.result_type == "EMPLOYEE" and row.get("department_id") != department:
                continue
            if location and provider.result_type == "EMPLOYEE" and row.get("location_id") != location:
                continue
            if (department or location) and provider.result_type != "EMPLOYEE":
                continue
            row.setdefault("kind", row.get("subtitle", ""))
            row.setdefault("meta", [row.get("reference") or ""])
            row.setdefault("snippet", "")
            row["meta"] = [item for item in row["meta"] if item]
            results.append({"type": provider.result_type, "module": provider.module, "group": GROUPS.get(provider.result_type, "OTHER"),
                            "route_hint": provider.route_hint.format(id=row["id"]), "score": _score(query, row), **row})
    if sort == "newest":
        results.sort(key=lambda row: row.get("updated_at") or 0, reverse=True)
    elif sort == "relevance":
        results.sort(key=lambda row: -row["score"])
    return results[:limit]
