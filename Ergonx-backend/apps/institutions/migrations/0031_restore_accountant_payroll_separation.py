from django.db import migrations


OVERGRANTED_PERMISSION_CODES = (
    "payroll.approve",
    "payroll.finalize",
    "tax_relief.approve",
    "dashboard.payroll.view",
)


def restore_accountant_separation(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permissions = Permission.objects.filter(code__in=OVERGRANTED_PERMISSION_CODES)
    for role in Role.objects.filter(code="ACCOUNTANT"):
        role.permissions.remove(*permissions)


class Migration(migrations.Migration):
    dependencies = [("institutions", "0030_grant_accountant_payroll_prepare")]

    operations = [migrations.RunPython(restore_accountant_separation, migrations.RunPython.noop)]
