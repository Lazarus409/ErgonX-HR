from django.db import migrations


PERMISSIONS = {
    "document.view": "View shared documents",
    "document.create": "Create shared document references",
    "document.update": "Update shared document metadata",
    "document.delete": "Deactivate shared documents",
}


def seed(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    records = [Permission.objects.update_or_create(code=code, defaults={"name": name, "module_code": "CORE_HR"})[0] for code, name in PERMISSIONS.items()]
    for role in Role.objects.filter(code__in=("INSTITUTION_ADMIN", "HR_ADMIN")):
        role.permissions.add(*records)
    for role in Role.objects.filter(code__in=("DIRECTOR", "AUDITOR", "ACCOUNTANT", "FINANCE_MANAGER")):
        role.permissions.add(records[0])


class Migration(migrations.Migration):
    dependencies = [("institutions", "0018_align_dashboard_role_access")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
