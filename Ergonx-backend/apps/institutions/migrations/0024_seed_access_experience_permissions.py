from django.db import migrations


PERMISSIONS = {
    "home.view": "View personalized home",
    "search.use": "Use universal search",
    "settings.profile.manage_self": "Manage personal preferences",
    "settings.institution.view": "View institution settings",
    "settings.institution.manage": "Manage institution settings",
    "settings.modules.manage": "Manage institution modules",
    "settings.users.manage": "Manage institution memberships",
    "settings.roles.manage": "Manage custom roles and permissions",
    "settings.notifications.manage": "Manage notification settings",
    "settings.security.manage": "Manage institution security settings",
    "onboarding.view": "View institution onboarding state",
    "onboarding.manage": "Manage institution onboarding",
}


def seed(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    records = {
        code: Permission.objects.update_or_create(
            code=code, defaults={"name": name, "module_code": "CORE_HR"}
        )[0]
        for code, name in PERMISSIONS.items()
    }
    admin_codes = tuple(PERMISSIONS)
    general_codes = ("home.view", "search.use", "settings.profile.manage_self")
    for role in Role.objects.filter(code="INSTITUTION_ADMIN"):
        role.permissions.add(*(records[code] for code in admin_codes))
    for role in Role.objects.filter(code__in=("HR_ADMIN", "DIRECTOR", "EMPLOYEE", "ACCOUNTANT", "FINANCE_MANAGER", "AUDITOR")):
        role.permissions.add(*(records[code] for code in general_codes))
    for role in Role.objects.filter(code="HR_ADMIN"):
        role.permissions.add(records["onboarding.view"])


class Migration(migrations.Migration):
    dependencies = [("institutions", "0023_permission_classification_role_created_by_and_more")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
