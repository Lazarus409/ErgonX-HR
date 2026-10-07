from django.db import migrations


PAYROLL_PERMISSION_CODES = (
    "payroll.view",
    "payroll.approve",
    "payroll.finalize",
    "payslip.view",
    "tax_relief.view",
    "tax_relief.approve",
    "dashboard.payroll.view",
)


def grant_payroll_access(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permissions = Permission.objects.filter(code__in=PAYROLL_PERMISSION_CODES)

    for role in Role.objects.filter(code__in=("ACCOUNTANT", "FINANCE_MANAGER")):
        role.permissions.add(*permissions)


class Migration(migrations.Migration):
    dependencies = [("institutions", "0025_institutioninvitation")]

    operations = [migrations.RunPython(grant_payroll_access, migrations.RunPython.noop)]
