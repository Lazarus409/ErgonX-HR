from django.db import migrations

SELF_SERVICE_PERMISSION_CODES = (
    "leave.view",
    "leave.request",
    "schedule.view",
    "attendance.view",
    "attendance.clock",
    "attendance.adjust",
    "payslip.view",
)
STAFF_ROLES = ("DIRECTOR", "ACCOUNTANT", "FINANCE_MANAGER", "AUDITOR")


def grant_staff_self_service(apps, schema_editor):
    """Staff roles are employees too: give them their own leave, attendance and payslips.

    Row scoping keeps these self-only unless the role also holds the module's
    management permissions.
    """
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permissions = list(Permission.objects.filter(code__in=SELF_SERVICE_PERMISSION_CODES))
    for role in Role.objects.filter(code__in=STAFF_ROLES, is_system_role=True):
        role.permissions.add(*permissions)


class Migration(migrations.Migration):
    dependencies = [("institutions", "0035_department_head_role")]

    operations = [migrations.RunPython(grant_staff_self_service, migrations.RunPython.noop)]
