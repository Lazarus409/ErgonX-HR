from django.db import migrations


def remove_hr_audit_access(apps, schema_editor):
    """HR Admins no longer read the audit trail; it stays with admins, directors and auditors."""
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permission = Permission.objects.filter(code="audit.view").first()
    if permission is None:
        return
    for role in Role.objects.filter(code="HR_ADMIN", is_system_role=True):
        role.permissions.remove(permission)


class Migration(migrations.Migration):
    dependencies = [("institutions", "0037_platform_admin")]

    operations = [migrations.RunPython(remove_hr_audit_access, migrations.RunPython.noop)]
