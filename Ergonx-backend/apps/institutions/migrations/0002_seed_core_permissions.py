from django.db import migrations


PERMISSIONS = {
    "institution.view": "View current institution",
    "organization.view": "View organization records",
    "organization.create": "Create organization records",
    "organization.update": "Update organization records",
    "organization.delete": "Deactivate or delete organization records",
    "employee.view": "View employees",
    "employee.create": "Create employees",
    "employee.update": "Update employees",
    "employee.delete": "Deactivate or delete employees",
    "employment.view": "View employment history",
    "employment.create": "Create employment records",
    "employment.update": "Update employment records",
    "employment.delete": "Delete employment records",
}


def seed_permissions(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    for code, name in PERMISSIONS.items():
        Permission.objects.update_or_create(
            code=code,
            defaults={"name": name, "module_code": "CORE_HR"},
        )


def remove_permissions(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Permission.objects.filter(code__in=PERMISSIONS).delete()


class Migration(migrations.Migration):
    dependencies = [("institutions", "0001_initial")]

    operations = [migrations.RunPython(seed_permissions, remove_permissions)]
