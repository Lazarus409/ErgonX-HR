from django.db import migrations


PERMISSIONS = {
    "compensation.view": "View employee compensation",
    "compensation.configure": "Configure pay components and salary structures",
    "compensation.manage": "Manage employee compensation and overrides",
}

ROLE_PERMISSIONS = {
    "INSTITUTION_ADMIN": tuple(PERMISSIONS),
    "HR_ADMIN": tuple(PERMISSIONS),
    "DIRECTOR": ("compensation.view",),
    "EMPLOYEE": ("compensation.view",),
}


def seed_compensation_access(apps, schema_editor):
    Institution = apps.get_model("institutions", "Institution")
    InstitutionModule = apps.get_model("institutions", "InstitutionModule")
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")

    permissions = {}
    for code, name in PERMISSIONS.items():
        permission, _ = Permission.objects.update_or_create(
            code=code,
            defaults={"name": name, "module_code": "PAYROLL"},
        )
        permissions[code] = permission

    for institution in Institution.objects.all():
        InstitutionModule.objects.get_or_create(
            institution=institution,
            module_code="PAYROLL",
            defaults={
                "is_enabled": False,
                "configuration_status": "NOT_CONFIGURED",
            },
        )
        for role_code, permission_codes in ROLE_PERMISSIONS.items():
            role = Role.objects.filter(institution=institution, code=role_code).first()
            if role:
                role.permissions.add(*(permissions[code] for code in permission_codes))


class Migration(migrations.Migration):
    dependencies = [("institutions", "0005_seed_leave_scheduling_attendance")]

    operations = [
        migrations.RunPython(seed_compensation_access, migrations.RunPython.noop)
    ]
