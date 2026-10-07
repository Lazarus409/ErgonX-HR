from django.db import migrations


PERMISSIONS = {
    "payroll.view": "View payroll configuration and transactions",
    "payroll.configure": "Configure payroll rules and periods",
    "payroll.prepare": "Prepare and calculate payroll runs",
    "payroll.approve": "Approve payroll runs and adjustments",
    "payroll.finalize": "Finalize payroll runs",
    "payslip.view": "View payslips",
    "tax_relief.view": "View tax relief claims",
    "tax_relief.claim": "Create and submit tax relief claims",
    "tax_relief.approve": "Approve tax relief claims",
}

ROLE_PERMISSIONS = {
    "INSTITUTION_ADMIN": tuple(PERMISSIONS),
    "HR_ADMIN": tuple(PERMISSIONS),
    "EMPLOYEE": (
        "payslip.view",
        "tax_relief.view",
        "tax_relief.claim",
    ),
    "ACCOUNTANT": (
        "payroll.view",
        "payroll.prepare",
        "payslip.view",
        "tax_relief.view",
    ),
    "FINANCE_MANAGER": (
        "payroll.view",
        "payroll.approve",
        "payroll.finalize",
        "payslip.view",
        "tax_relief.view",
        "tax_relief.approve",
    ),
    "AUDITOR": (
        "payroll.view",
        "payslip.view",
        "tax_relief.view",
    ),
}


def seed_payroll_access(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")

    permissions = {}
    for code, name in PERMISSIONS.items():
        permission, _ = Permission.objects.update_or_create(
            code=code,
            defaults={"name": name, "module_code": "PAYROLL"},
        )
        permissions[code] = permission

    for role_code, permission_codes in ROLE_PERMISSIONS.items():
        for role in Role.objects.filter(code=role_code):
            role.permissions.add(*(permissions[code] for code in permission_codes))


class Migration(migrations.Migration):
    dependencies = [
        ("institutions", "0006_seed_compensation_access"),
        ("payroll", "0001_initial"),
    ]

    operations = [migrations.RunPython(seed_payroll_access, migrations.RunPython.noop)]
