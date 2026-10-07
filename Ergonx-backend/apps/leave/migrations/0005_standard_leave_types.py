from datetime import date
from decimal import Decimal

from django.db import migrations

from apps.leave.defaults import STANDARD_LEAVE_TYPES


def add_standard_leave_types(apps, schema_editor):
    """Give every existing institution the standard leave types it is missing.

    Mirrors apps.leave.defaults.ensure_standard_leave_types with historical
    models: a type matched by code or name is kept as it is, and a policy is
    only added to a type that has none, so configured entitlements never change.
    """
    Institution = apps.get_model("institutions", "Institution")
    LeaveType = apps.get_model("leave", "LeaveType")
    LeavePolicy = apps.get_model("leave", "LeavePolicy")
    GenderEligibility = apps.get_model("leave", "LeavePolicyGenderEligibility")
    effective_from = date(date.today().year, 1, 1)
    for institution in Institution.objects.all():
        types = list(LeaveType.objects.filter(institution=institution))
        by_code = {item.code: item for item in types}
        by_name = {item.name.strip().lower(): item for item in types}
        for code, name, description, is_paid, requires_attachment, days, gender in STANDARD_LEAVE_TYPES:
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
            if LeavePolicy.objects.filter(institution=institution, leave_type=leave_type).exists():
                continue
            policy = LeavePolicy.objects.create(
                institution=institution,
                leave_type=leave_type,
                name=f"Standard {leave_type.name}",
                annual_entitlement=Decimal(days),
                accrual_method="ANNUAL",
                effective_from=effective_from,
            )
            if gender:
                GenderEligibility.objects.create(institution=institution, policy=policy, gender=gender)


class Migration(migrations.Migration):
    dependencies = [
        ("leave", "0004_alter_leavetype_code"),
        ("institutions", "0038_hr_admin_without_audit"),
    ]

    operations = [migrations.RunPython(add_standard_leave_types, migrations.RunPython.noop)]
