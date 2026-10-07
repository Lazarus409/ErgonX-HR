from django.db import migrations


def grant_accountant_payroll_prepare(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permission = Permission.objects.filter(code="payroll.prepare").first()
    if permission is None:
        return
    for role in Role.objects.filter(code="ACCOUNTANT"):
        role.permissions.add(permission)


class Migration(migrations.Migration):
    dependencies = [("institutions", "0029_institutioninvitation_employee")]

    operations = [migrations.RunPython(grant_accountant_payroll_prepare, migrations.RunPython.noop)]
