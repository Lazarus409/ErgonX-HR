"""Record history and lineage (concept "Record history and lineage").

For a supported record this returns its facts, the audit events of the record
and its closely-linked records grouped into lifecycle stages, the predecessor
and successor records it is linked to, and whether it is read-only. Everything
is read from existing audit logs and relations; nothing is stored here.
"""
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from common.permissions import TenantContextPermission

KIND_RULES = (
    ("VOID", ("voided", "cancelled", "rejected", "void")),
    ("REVERSAL", ("reversed", "reversal", "withdrawn", "unmatched", "released", "declined")),
    ("CORRECTION", ("updated", "revised", "returned", "rescheduled", "correct", "edited", "request_changes", "changes_requested")),
    ("ORIGINAL", ("created", "imported", "submitted", "started")),
    ("AUDIT", ("viewed", "exported", "attachment", "document", "note_added", "permission", "downloaded")),
)


def _kind(action):
    tail = action.split(".", 2)[-1].lower()
    for kind, words in KIND_RULES:
        if any(word in tail for word in words):
            return kind
    return "EVENT"


def _label(action):
    return action.split(".")[-1].replace("_", " ").capitalize()


def _person(user):
    return (user.get_full_name() or user.email) if user else None


def _events(institution, entity_ids):
    rows = AuditLog.objects.filter(institution=institution, entity_id__in=[value for value in entity_ids if value]).select_related("actor").order_by("created_at")
    return [
        {"id": str(row.id), "action": row.action, "label": _label(row.action), "actor": _person(row.actor) or "System", "at": row.created_at,
         "kind": _kind(row.action), "entity": row.entity_type, "metadata": row.metadata}
        for row in rows
    ]


def _stage(events, rules, default="Updates"):
    """Group events into ordered stages; rules = [(label, icon, (keywords...))]."""
    stages = {label: {"label": label, "icon": icon, "events": []} for label, icon, _ in rules}
    stages.setdefault(default, {"label": default, "icon": "refresh", "events": []})
    stages.setdefault("Audit events", {"label": "Audit events", "icon": "shield", "events": []})
    for event in events:
        if event["kind"] == "AUDIT":
            stages["Audit events"]["events"].append(event)
            continue
        text = event["action"].lower()
        for label, _, words in rules:
            if any(word in text for word in words):
                stages[label]["events"].append(event)
                break
        else:
            stages[default]["events"].append(event)
    result = []
    for stage in stages.values():
        if stage["events"]:
            stage["start"] = stage["events"][0]["at"]
            stage["end"] = stage["events"][-1]["at"]
        result.append(stage)
    return [stage for stage in result if stage["events"]]


def _link(reference, label, date, href):
    return {"reference": reference, "label": label, "date": date, "href": href}


def application_history(institution, pk):
    from apps.recruitment.models import Application

    app = Application.objects.select_related("candidate", "job_posting__department", "job_posting__position", "job_posting__hiring_manager", "current_stage").filter(institution=institution, pk=pk).first()
    if app is None:
        raise NotFound("Application not found.")
    offer = getattr(app, "offer", None) if hasattr(app, "offer") else None
    employee = offer.hired_employee if offer and offer.hired_employee_id else None
    entity_ids = [app.id, app.candidate_id, *app.interviews.values_list("id", flat=True), offer.id if offer else None, employee.id if employee else None]
    events = _events(institution, entity_ids)
    stages = _stage(events, (
        ("Application", "file", ("application.submitted", "candidate.created", "application.created", "document_added")),
        ("Screening & assessment", "users", ("stage_moved", "scorecard", "interview", "evaluation")),
        ("Offer", "file-text", ("offer.created", "offer.submitted", "offer.approved", "offer.returned", "offer.letter", "offer.extended", "offer.accepted", "offer.declined", "offer.withdrawn")),
        ("Hire & conversion", "user-check", ("hired", "employee.created")),
    ), default="Post-hire changes")
    reference = f"APP-{str(app.id)[:8].upper()}"
    return {
        "record": {"type": "application", "id": str(app.id), "reference": reference, "title": app.candidate.full_name, "status": app.status,
                   "facts": [["Application", reference], ["Position", app.job_posting.position.title], ["Department", app.job_posting.department.name], ["Applied", app.applied_at]],
                   "href": f"/recruitment/candidates/{app.candidate_id}?application={app.id}", "href_label": "View application"},
        "current_state": {"label": "Converted to employee" if employee else app.get_status_display(), "at": offer.accepted_at if employee else app.updated_at,
                          "link": _link(employee.employee_number, "Employee record", None, f"/hr/employees/{employee.id}") if employee else None},
        "stages": stages,
        "lineage": {"predecessors": [], "this": _link(reference, "Recruitment application", app.applied_at or app.created_at, None),
                    "successors": ([_link(f"Offer ({offer.get_status_display()})", "Recruitment offer", offer.created_at, f"/recruitment/offers/{offer.id}")] if offer else [])
                    + ([_link(employee.employee_number, "Employee record", employee.created_at, f"/hr/employees/{employee.id}")] if employee else [])},
        "people": [["Applicant", app.candidate.full_name, None], ["Current employee", f"{employee.full_name} ({employee.employee_number})" if employee else None, f"/hr/employees/{employee.id}" if employee else None],
                   ["Hiring manager", _person(app.job_posting.hiring_manager), None]],
        "read_only": app.status in ("HIRED", "REJECTED", "WITHDRAWN"),
        "read_only_reason": "Closed recruitment applications are immutable to preserve an accurate audit trail. If a correction is required, create a new record and link it to this one.",
        "permission": "candidate.view",
    }


def employee_history(institution, pk):
    from apps.employees.models import Employee

    employee = Employee.objects.filter(institution=institution, pk=pk).first()
    if employee is None:
        raise NotFound("Employee not found.")
    offer = getattr(employee, "recruitment_offer", None) if hasattr(employee, "recruitment_offer") else None
    employment_ids = list(employee.employments.values_list("id", flat=True))
    events = _events(institution, [employee.id, *employment_ids])
    stages = _stage(events, (
        ("Hire & onboarding", "user-check", ("employee.created", "hired", "onboarding", "invitation")),
        ("Employment changes", "briefcase", ("employment", "transfer", "promotion", "position")),
        ("Compensation", "wallet", ("compensation", "salary")),
        ("Exit", "log-out", ("terminated", "offboard", "exit", "deactivated")),
    ), default="Profile updates")
    current = employee.employments.filter(is_current=True).select_related("department", "position").first()
    return {
        "record": {"type": "employee", "id": str(employee.id), "reference": employee.employee_number, "title": employee.full_name, "status": employee.status,
                   "facts": [["Employee ID", employee.employee_number], ["Position", current.position.title if current else "—"], ["Department", current.department.name if current else "—"], ["Hired", employee.hire_date if hasattr(employee, "hire_date") else employee.created_at]],
                   "href": f"/hr/employees/{employee.id}", "href_label": "View employee"},
        "current_state": {"label": employee.get_status_display(), "at": employee.updated_at, "link": None},
        "stages": stages,
        "lineage": {"predecessors": [_link(f"APP-{str(offer.application_id)[:8].upper()}", "Recruitment application", offer.application.applied_at, f"/recruitment/candidates/{offer.application.candidate_id}?application={offer.application_id}")] if offer else [],
                    "this": _link(employee.employee_number, "Employee record", employee.created_at, None), "successors": []},
        "people": [["Employee", employee.full_name, None], ["Manager", current.reports_to.employee.full_name if current and current.reports_to_id else None, None]],
        "read_only": employee.status in ("TERMINATED",),
        "read_only_reason": "Employee records are retained for payroll, attendance, leave and audit history after exit, in line with the data retention policy.",
        "permission": "employee.view",
    }


def journal_history(institution, pk):
    from apps.accounting.models import JournalEntry

    journal = JournalEntry.objects.select_related("reversal_of", "created_by").filter(institution=institution, pk=pk).first()
    if journal is None:
        raise NotFound("Journal not found.")
    events = _events(institution, [journal.id])
    stages = _stage(events, (
        ("Preparation", "file", ("created", "submitted", "note", "attachment")),
        ("Approval", "check", ("approved", "returned")),
        ("Posting", "book", ("posted",)),
        ("Reversal", "refresh", ("revers",)),
    ))
    predecessors = [_link(journal.reversal_of.journal_number, "Reversed journal", journal.reversal_of.entry_date, f"/accounting/journals/{journal.reversal_of_id}")] if journal.reversal_of_id else []
    for bill in journal.vendor_bills.all():
        predecessors.append(_link(bill.bill_number, "Vendor bill", bill.bill_date, f"/accounting/payables/bills/{bill.id}"))
    for invoice in journal.invoices.all():
        predecessors.append(_link(invoice.invoice_number, "Customer invoice", invoice.invoice_date, f"/accounting/receivables/invoices/{invoice.id}"))
    return {
        "record": {"type": "journal", "id": str(journal.id), "reference": journal.journal_number, "title": journal.description[:80], "status": journal.status,
                   "facts": [["Journal", journal.journal_number], ["Source", journal.get_source_display()], ["Entry date", journal.entry_date], ["Prepared by", _person(journal.created_by)]],
                   "href": f"/accounting/journals/{journal.id}", "href_label": "View journal"},
        "current_state": {"label": journal.get_status_display(), "at": journal.posted_at or journal.updated_at, "link": None},
        "stages": stages,
        "lineage": {"predecessors": predecessors, "this": _link(journal.journal_number, "Journal entry", journal.entry_date, None),
                    "successors": [_link(item.journal_number, "Reversing journal", item.entry_date, f"/accounting/journals/{item.id}") for item in journal.reversals.all()]},
        "people": [["Prepared by", _person(journal.created_by), None], ["Approved by", _person(journal.approved_by), None], ["Posted by", _person(journal.posted_by), None]],
        "read_only": journal.status in (JournalEntry.Status.POSTED, JournalEntry.Status.REVERSED, JournalEntry.Status.VOID),
        "read_only_reason": "Posted journals are immutable. Corrections are made with a reversing journal, which is linked here as a successor record.",
        "permission": "journal.view",
    }


def _document_history(institution, pk, kind):
    from apps.accounting.models import Invoice, Payment, Receipt, VendorBill

    model = VendorBill if kind == "vendor_bill" else Invoice
    record = model.objects.select_related("journal_entry").filter(institution=institution, pk=pk).first()
    if record is None:
        raise NotFound("Record not found.")
    number = record.bill_number if kind == "vendor_bill" else record.invoice_number
    settlements = Payment.objects.filter(vendor_bill=record) if kind == "vendor_bill" else Receipt.objects.filter(invoice=record)
    events = _events(institution, [record.id, *settlements.values_list("id", flat=True)])
    stages = _stage(events, (
        ("Capture", "file", ("created", "attachment", "document")),
        ("Approval", "check", ("submitted", "approved", "rejected", "revised", "held", "released", "issued", "sent")),
        ("Posting", "book", ("posted",)),
        ("Settlement", "wallet", ("settlement", "payment", "receipt", "scheduled", "reminder")),
    ))
    successors = [_link(record.journal_entry.journal_number, "Ledger journal", record.journal_entry.entry_date, f"/accounting/journals/{record.journal_entry_id}")] if record.journal_entry_id else []
    for item in settlements:
        successors.append(_link(getattr(item, "payment_number", None) or getattr(item, "receipt_number", ""), "Payment" if kind == "vendor_bill" else "Receipt", getattr(item, "payment_date", None) or getattr(item, "receipt_date", None), None))
    party = record.vendor.name if kind == "vendor_bill" else record.customer.name
    href = f"/accounting/payables/bills/{record.id}" if kind == "vendor_bill" else f"/accounting/receivables/invoices/{record.id}"
    return {
        "record": {"type": kind, "id": str(record.id), "reference": number, "title": party, "status": record.status,
                   "facts": [["Number", number], ["Vendor" if kind == "vendor_bill" else "Customer", party], ["Date", record.bill_date if kind == "vendor_bill" else record.invoice_date], ["Total", f"{record.currency} {record.total_amount:,.2f}"]],
                   "href": href, "href_label": "View bill" if kind == "vendor_bill" else "View invoice"},
        "current_state": {"label": record.get_status_display(), "at": record.updated_at, "link": successors[0] if successors else None},
        "stages": stages,
        "lineage": {"predecessors": [], "this": _link(number, "Vendor bill" if kind == "vendor_bill" else "Customer invoice", record.bill_date if kind == "vendor_bill" else record.invoice_date, None), "successors": successors},
        "people": [],
        "read_only": record.status in ("POSTED", "PART_PAID", "PAID", "ISSUED", "VOID"),
        "read_only_reason": "Posted and settled records keep their amounts; corrections go through a reversal, a void of an unposted record, or a new linked record.",
        "permission": "vendor_bill.view" if kind == "vendor_bill" else "invoice.view",
    }


BUILDERS = {
    "application": application_history,
    "employee": employee_history,
    "journal": journal_history,
    "vendor_bill": lambda institution, pk: _document_history(institution, pk, "vendor_bill"),
    "invoice": lambda institution, pk: _document_history(institution, pk, "invoice"),
}


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
class RecordHistoryView(APIView):
    permission_classes = [TenantContextPermission]

    def get(self, request, record_type, pk):
        builder = BUILDERS.get(record_type)
        if builder is None:
            raise ValidationError({"type": f"History is not available for {record_type!r}."})
        payload = builder(request.institution, pk)
        membership = getattr(request, "membership", None)
        codes = set(membership.role.permissions.values_list("code", flat=True)) if membership else set()
        if payload.pop("permission") not in codes and "audit.view" not in codes:
            raise PermissionDenied("Your institution role does not grant access to this record's history.")
        payload["people"] = [{"label": label, "value": value, "href": href} for label, value, href in payload["people"] if value]
        payload["record"]["facts"] = [{"label": label, "value": value} for label, value in payload["record"]["facts"]]
        return Response(payload)
