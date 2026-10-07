"""Employee document checklist: which required documents each employee has on file.

A requirement (``DocumentRequirement``) applies to an employee when it is active
and covers their current employment type. Its status for that employee is:

* ``ON_FILE``  - an active matching document is attached to the employee;
* ``EXPIRING`` - on file, but a renewable document lapses within 30 days;
* ``EXPIRED``  - the latest matching document has passed its validity period;
* ``WAIVED``   - HR excused the employee, with a reason;
* ``MISSING``  - nothing matching is on file.

A document matches when it is attached to the employee (entity type
``EMPLOYEE``) and its category equals the requirement's category, ignoring case.
Everything is computed from a handful of queries, so compliance views scale
with the number of employees rather than employees x requirements.
"""

import calendar
from datetime import date, timedelta

from django.utils import timezone

from apps.documents.models import EMPLOYEE_ENTITY_TYPE, Document, DocumentRequirement, DocumentRequirementWaiver
from apps.employees.models import Employee, Employment

ON_FILE = "ON_FILE"
EXPIRING = "EXPIRING"
EXPIRED = "EXPIRED"
WAIVED = "WAIVED"
MISSING = "MISSING"
SATISFIED = frozenset({ON_FILE, EXPIRING, WAIVED})
EXPIRY_WARNING_DAYS = 30
# Terminated employees have left; their records no longer need to be complete.
CHECKED_STATUSES = (Employee.Status.ACTIVE, Employee.Status.SUSPENDED, Employee.Status.INACTIVE)


def add_months(day, months):
    month_index = day.month - 1 + months
    year, month = day.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def active_requirements(institution):
    return list(DocumentRequirement.objects.for_institution(institution).filter(is_active=True).order_by("sort_order", "name"))


def _context(institution, employee_ids):
    employment_types = dict(
        Employment.objects.filter(employee_id__in=employee_ids, is_current=True).values_list("employee_id", "employment_type")
    )
    documents = {}
    for document in (
        Document.objects.for_institution(institution)
        .filter(entity_type=EMPLOYEE_ENTITY_TYPE, entity_id__in=employee_ids, is_active=True)
        .order_by("-created_at")
    ):
        # Newest first, so the first document seen per category is the latest.
        documents.setdefault(document.entity_id, {}).setdefault(document.category.strip().lower(), document)
    waivers = {
        (waiver.employee_id, waiver.requirement_id): waiver
        for waiver in DocumentRequirementWaiver.objects.for_institution(institution).filter(employee_id__in=employee_ids).select_related("waived_by")
    }
    return employment_types, documents, waivers


def _item(requirement, document, waiver, today):
    item = {
        "requirement_id": str(requirement.id),
        "requirement": requirement.name,
        "document_category": requirement.document_category,
        "is_mandatory": requirement.is_mandatory,
        "validity_months": requirement.validity_months,
        "status": MISSING,
        "document": None,
        "expires_on": None,
        "waiver": None,
    }
    if waiver is not None:
        item["status"] = WAIVED
        item["waiver"] = {
            "id": str(waiver.id),
            "reason": waiver.reason,
            "waived_by": waiver.waived_by.get_full_name() or waiver.waived_by.email if waiver.waived_by else "",
            "waived_at": waiver.created_at,
        }
        return item
    if document is None:
        return item
    item["document"] = {"id": str(document.id), "original_filename": document.original_filename, "uploaded_at": document.created_at}
    item["status"] = ON_FILE
    if requirement.validity_months:
        expires_on = add_months(timezone.localtime(document.created_at).date(), requirement.validity_months)
        item["expires_on"] = expires_on
        if expires_on < today:
            item["status"] = EXPIRED
        elif expires_on <= today + timedelta(days=EXPIRY_WARNING_DAYS):
            item["status"] = EXPIRING
    return item


def checklists(institution, employees, *, requirements=None, today=None):
    """``{employee_id: [item, ...]}`` for each given employee."""
    employees = list(employees)
    requirements = active_requirements(institution) if requirements is None else requirements
    today = today or timezone.localdate()
    employment_types, documents, waivers = _context(institution, [employee.id for employee in employees])
    result = {}
    for employee in employees:
        employment_type = employment_types.get(employee.id)
        on_file = documents.get(employee.id, {})
        result[employee.id] = [
            _item(requirement, on_file.get(requirement.document_category.strip().lower()), waivers.get((employee.id, requirement.id)), today)
            for requirement in requirements
            if requirement.applies_to(employment_type)
        ]
    return result


def summarize(items):
    """Counts for one employee's checklist; only mandatory items count toward compliance."""
    mandatory = [item for item in items if item["is_mandatory"]]
    satisfied = sum(1 for item in mandatory if item["status"] in SATISFIED)
    return {
        "required": len(mandatory),
        "satisfied": satisfied,
        "missing": sum(1 for item in mandatory if item["status"] == MISSING),
        "expired": sum(1 for item in mandatory if item["status"] == EXPIRED),
        "expiring": sum(1 for item in items if item["status"] == EXPIRING),
        "complete": satisfied == len(mandatory),
        "compliance_rate": round(satisfied * 100 / len(mandatory), 1) if mandatory else 100.0,
    }


def compliance_overview(institution, employees, *, today=None):
    """Institution (or team) compliance: overall rate, per requirement, per employee."""
    employees = list(employees.filter(status__in=CHECKED_STATUSES).order_by("last_name", "first_name"))
    requirements = active_requirements(institution)
    by_employee = checklists(institution, employees, requirements=requirements, today=today)
    per_requirement = {
        str(requirement.id): {
            "requirement_id": str(requirement.id),
            "requirement": requirement.name,
            "document_category": requirement.document_category,
            "is_mandatory": requirement.is_mandatory,
            "validity_months": requirement.validity_months,
            "applicable": 0,
            ON_FILE: 0,
            EXPIRING: 0,
            EXPIRED: 0,
            WAIVED: 0,
            MISSING: 0,
        }
        for requirement in requirements
    }
    rows = []
    required = satisfied = 0
    for employee in employees:
        items = by_employee[employee.id]
        for item in items:
            counts = per_requirement[item["requirement_id"]]
            counts["applicable"] += 1
            counts[item["status"]] += 1
        summary = summarize(items)
        required += summary["required"]
        satisfied += summary["satisfied"]
        rows.append({
            "employee_id": str(employee.id),
            "employee_number": employee.employee_number,
            "employee": employee.full_name,
            **summary,
            "outstanding": [item["requirement"] for item in items if item["is_mandatory"] and item["status"] in (MISSING, EXPIRED)],
        })
    return {
        "as_of": today or timezone.localdate(),
        "employees": len(employees),
        "complete_employees": sum(1 for row in rows if row["complete"]),
        "compliance_rate": round(satisfied * 100 / required, 1) if required else 100.0,
        "requirements": list(per_requirement.values()),
        "employees_detail": rows,
    }
