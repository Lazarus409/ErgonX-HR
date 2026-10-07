from django.db import migrations


PERMISSIONS = {
    "approval_workflow.view": "View approval workflows",
    "approval_workflow.create": "Create approval workflows",
    "approval_workflow.update": "Update approval workflows",
    "approval_workflow.delete": "Deactivate approval workflows",
    "approval_request.view": "View approval requests",
    "approval_request.create": "Submit approval requests",
}


def seed(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    records = {code: Permission.objects.update_or_create(code=code, defaults={"name": name, "module_code": "CORE_HR"})[0] for code, name in PERMISSIONS.items()}
    for role in Role.objects.filter(code__in=("INSTITUTION_ADMIN", "HR_ADMIN")):
        role.permissions.add(*records.values())
    for role in Role.objects.filter(code__in=("DIRECTOR", "AUDITOR", "ACCOUNTANT", "FINANCE_MANAGER")):
        role.permissions.add(records["approval_workflow.view"], records["approval_request.view"])
    for role in Role.objects.filter(code="EMPLOYEE"):
        role.permissions.add(records["approval_request.create"])


class Migration(migrations.Migration):
    dependencies = [("institutions", "0019_seed_document_access")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
