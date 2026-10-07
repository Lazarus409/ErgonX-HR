from django.db import migrations


def seed(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permission = Permission.objects.update_or_create(code="report.view", defaults={"name": "View and export institution reports", "module_code": "CORE_HR"})[0]
    for role in Role.objects.filter(code__in=("INSTITUTION_ADMIN", "HR_ADMIN", "FINANCE_MANAGER", "AUDITOR", "DIRECTOR")):
        role.permissions.add(permission)


class Migration(migrations.Migration):
    dependencies = [("institutions", "0016_seed_dashboard_access")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
