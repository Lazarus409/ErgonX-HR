from django.db import migrations


DASHBOARD_CODES = (
    "dashboard.executive.view",
    "dashboard.hr.view",
    "dashboard.leave.view",
    "dashboard.attendance.view",
    "dashboard.payroll.view",
    "dashboard.finance.view",
)

ROLE_CODES = {
    "INSTITUTION_ADMIN": DASHBOARD_CODES,
    "HR_ADMIN": ("dashboard.hr.view", "dashboard.leave.view", "dashboard.attendance.view", "dashboard.payroll.view"),
    "DIRECTOR": ("dashboard.executive.view",),
    "ACCOUNTANT": ("dashboard.finance.view",),
    "FINANCE_MANAGER": ("dashboard.payroll.view", "dashboard.finance.view"),
    "AUDITOR": ("dashboard.executive.view", "dashboard.finance.view"),
}


def align_role_access(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permissions = {permission.code: permission for permission in Permission.objects.filter(code__in=DASHBOARD_CODES)}
    for role_code, allowed_codes in ROLE_CODES.items():
        for role in Role.objects.filter(code=role_code):
            role.permissions.remove(*permissions.values())
            role.permissions.add(*(permissions[code] for code in allowed_codes if code in permissions))


class Migration(migrations.Migration):
    dependencies = [("institutions", "0017_seed_report_access")]
    operations = [migrations.RunPython(align_role_access, migrations.RunPython.noop)]
