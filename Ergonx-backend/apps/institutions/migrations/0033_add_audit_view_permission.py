from django.db import migrations


def grant_audit_view(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permission, _ = Permission.objects.get_or_create(
        code="audit.view",
        defaults={"name": "View institution audit history", "module_code": "CORE_HR", "classification": "PRIVILEGED", "description": "Read institution audit history."},
    )
    for role in Role.objects.filter(code__in=("INSTITUTION_ADMIN", "AUDITOR")):
        role.permissions.add(permission)


def revoke_audit_view(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Permission.objects.filter(code="audit.view").delete()


class Migration(migrations.Migration):
    dependencies = [("institutions", "0032_institution_institution_type")]
    operations = [migrations.RunPython(grant_audit_view, revoke_audit_view)]
