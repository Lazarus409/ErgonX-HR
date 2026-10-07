from django.db import migrations


PERMISSIONS = {
    "leave.view": ("View leave records", "LEAVE"),
    "leave.request": ("Request and submit leave", "LEAVE"),
    "leave.approve": ("Approve leave requests", "LEAVE"),
    "leave.reject": ("Reject leave requests", "LEAVE"),
    "leave.configure": ("Configure leave types and policies", "LEAVE"),
    "leave.balance.manage": ("Manage employee leave balances", "LEAVE"),
    "schedule.view": ("View work schedules", "ATTENDANCE"),
    "schedule.manage": ("Configure and assign work schedules", "ATTENDANCE"),
    "attendance.view": ("View attendance records", "ATTENDANCE"),
    "attendance.clock": ("Clock in and out", "ATTENDANCE"),
    "attendance.adjust": ("Request attendance adjustments", "ATTENDANCE"),
    "attendance.manage": ("Manage attendance records", "ATTENDANCE"),
    "attendance.approve": (
        "Approve attendance adjustments and overtime",
        "ATTENDANCE",
    ),
}

ROLE_PERMISSIONS = {
    "INSTITUTION_ADMIN": tuple(PERMISSIONS),
    "HR_ADMIN": tuple(PERMISSIONS),
    "DIRECTOR": (
        "leave.view",
        "leave.approve",
        "leave.reject",
        "schedule.view",
        "attendance.view",
    ),
    "EMPLOYEE": (
        "leave.view",
        "leave.request",
        "schedule.view",
        "attendance.view",
        "attendance.clock",
        "attendance.adjust",
    ),
}


def seed_domain_access(apps, schema_editor):
    Institution = apps.get_model("institutions", "Institution")
    InstitutionModule = apps.get_model("institutions", "InstitutionModule")
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")

    permissions = {}
    for code, (name, module_code) in PERMISSIONS.items():
        permission, _ = Permission.objects.update_or_create(
            code=code,
            defaults={"name": name, "module_code": module_code},
        )
        permissions[code] = permission

    for institution in Institution.objects.all():
        for module_code in ("LEAVE", "ATTENDANCE"):
            InstitutionModule.objects.get_or_create(
                institution=institution,
                module_code=module_code,
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
    dependencies = [("institutions", "0004_seed_reconciled_roles")]

    operations = [migrations.RunPython(seed_domain_access, migrations.RunPython.noop)]
