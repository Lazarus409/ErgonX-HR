from django.db import migrations


PERMISSIONS = {
    "import_job.view": "View import jobs and row results",
    "import_job.create": "Create import jobs",
    "export_job.view": "View export jobs",
    "export_job.create": "Create export jobs",
    "background_job.view": "View background jobs",
}


def seed(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    records = {code: Permission.objects.update_or_create(code=code, defaults={"name": name, "module_code": "CORE_HR"})[0] for code, name in PERMISSIONS.items()}
    for role in Role.objects.filter(code__in=("INSTITUTION_ADMIN", "HR_ADMIN")):
        role.permissions.add(*records.values())
    for role in Role.objects.filter(code__in=("DIRECTOR", "AUDITOR", "ACCOUNTANT", "FINANCE_MANAGER")):
        role.permissions.add(records["import_job.view"], records["export_job.view"], records["background_job.view"])


class Migration(migrations.Migration):
    dependencies = [("institutions", "0020_seed_approval_access")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
