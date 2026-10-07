from django.db import migrations


ROLE_PERMISSION_CODES = {
    "INSTITUTION_ADMIN": (
        "institution.view",
        "organization.view",
        "organization.create",
        "organization.update",
        "organization.delete",
        "employee.view",
        "employee.create",
        "employee.update",
        "employee.delete",
        "employment.view",
        "employment.create",
        "employment.update",
        "employment.delete",
    ),
    "HR_ADMIN": (
        "institution.view",
        "organization.view",
        "organization.create",
        "organization.update",
        "organization.delete",
        "employee.view",
        "employee.create",
        "employee.update",
        "employee.delete",
        "employment.view",
        "employment.create",
        "employment.update",
        "employment.delete",
    ),
    "DIRECTOR": (
        "institution.view",
        "organization.view",
        "employee.view",
        "employment.view",
    ),
    "EMPLOYEE": ("institution.view",),
    "ACCOUNTANT": ("institution.view",),
    "FINANCE_MANAGER": ("institution.view",),
    "AUDITOR": ("institution.view",),
}


def seed_roles(apps, schema_editor):
    Institution = apps.get_model("institutions", "Institution")
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")

    permissions = {item.code: item for item in Permission.objects.all()}
    for institution in Institution.objects.all():
        for code, permission_codes in ROLE_PERMISSION_CODES.items():
            role, _ = Role.objects.update_or_create(
                institution=institution,
                code=code,
                defaults={
                    "name": code.replace("_", " ").title(),
                    "is_system_role": True,
                },
            )
            role.permissions.set(
                permissions[permission_code]
                for permission_code in permission_codes
                if permission_code in permissions
            )


class Migration(migrations.Migration):
    dependencies = [
        ("institutions", "0003_institutionfeatureoverride_institutionsetting_and_more")
    ]

    operations = [migrations.RunPython(seed_roles, migrations.RunPython.noop)]
