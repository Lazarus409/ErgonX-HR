"""Standard leave types every institution starts with.

Each type comes with a default policy so employees can request it straight
away. HR can change the entitlements, deactivate a type or add its own; this
module only fills in what is missing and never overwrites existing setup.
"""

from datetime import date
from decimal import Decimal

from django.db import transaction

# code, name, description, is_paid, requires_attachment, annual days, eligible gender
STANDARD_LEAVE_TYPES = (
    ("ANNUAL", "Annual Leave", "Paid yearly vacation leave.", True, False, "15", None),
    ("SICK", "Sick Leave", "Time off for illness or injury. A medical certificate may be requested.", True, False, "10", None),
    ("MATERNITY", "Maternity Leave", "Leave before and after childbirth.", True, False, "84", "FEMALE"),
    ("PATERNITY", "Paternity Leave", "Leave for a new father around the birth or adoption of a child.", True, False, "5", "MALE"),
    ("COMPASSIONATE", "Compassionate Leave", "Leave following the death or serious illness of a close family member.", True, False, "5", None),
    ("STUDY", "Study Leave", "Leave for approved courses and examinations.", True, False, "10", None),
    ("CASUAL", "Casual Leave", "Short leave for urgent personal matters.", True, False, "3", None),
    ("UNPAID", "Unpaid Leave", "Approved time off without pay; payroll deducts the days taken.", False, False, "30", None),
)


@transaction.atomic
def ensure_standard_leave_types(institution):
    from apps.leave.models import LeavePolicy, LeavePolicyGenderEligibility, LeaveType

    created = []
    types = list(LeaveType.objects.filter(institution=institution))
    by_code = {leave_type.code: leave_type for leave_type in types}
    by_name = {leave_type.name.strip().lower(): leave_type for leave_type in types}
    for code, name, description, is_paid, requires_attachment, days, gender in STANDARD_LEAVE_TYPES:
        # An institution's own "Maternity Leave" under another code counts as this type.
        leave_type = by_code.get(code) or by_name.get(name.lower())
        if leave_type is None:
            leave_type = LeaveType.objects.create(
                institution=institution,
                code=code,
                name=name,
                description=description,
                is_paid=is_paid,
                requires_attachment=requires_attachment,
            )
            created.append(leave_type)
        if LeavePolicy.objects.filter(institution=institution, leave_type=leave_type).exists():
            continue
        policy = LeavePolicy.objects.create(
            institution=institution,
            leave_type=leave_type,
            name=f"Standard {leave_type.name}",
            annual_entitlement=Decimal(days),
            accrual_method=LeavePolicy.AccrualMethod.ANNUAL,
            effective_from=date(date.today().year, 1, 1),
        )
        if gender:
            LeavePolicyGenderEligibility.objects.create(institution=institution, policy=policy, gender=gender)
    return created
