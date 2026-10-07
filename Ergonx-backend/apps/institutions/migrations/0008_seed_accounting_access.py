from django.db import migrations


PERMISSIONS = {
    "accounting.configure": "Configure institution accounting",
    "account.view": "View the chart of accounts",
    "account.create": "Create chart-of-account records",
    "account.update": "Update chart-of-account records",
    "journal.view": "View journals and ledger entries",
    "journal.create": "Create and submit journals",
    "journal.approve": "Approve journals",
    "journal.post": "Post approved journals",
    "journal.reverse": "Create journal reversals",
    "financial_report.view": "View accounting reports",
    "accounting_period.close": "Close and lock accounting periods",
    "accounting_period.reopen": "Reopen closed accounting periods",
}

ROLE_PERMISSIONS = {
    "INSTITUTION_ADMIN": tuple(PERMISSIONS),
    "ACCOUNTANT": (
        "account.view",
        "account.create",
        "account.update",
        "journal.view",
        "journal.create",
        "financial_report.view",
    ),
    "FINANCE_MANAGER": tuple(PERMISSIONS),
    "AUDITOR": ("account.view", "journal.view", "financial_report.view"),
}


def seed_accounting_access(apps, schema_editor):
    Institution = apps.get_model("institutions", "Institution")
    InstitutionModule = apps.get_model("institutions", "InstitutionModule")
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")

    permissions = {}
    for code, name in PERMISSIONS.items():
        permission, _ = Permission.objects.update_or_create(
            code=code, defaults={"name": name, "module_code": "ACCOUNTING"}
        )
        permissions[code] = permission

    for institution in Institution.objects.all():
        InstitutionModule.objects.get_or_create(
            institution=institution,
            module_code="ACCOUNTING",
            defaults={"is_enabled": False, "configuration_status": "NOT_CONFIGURED"},
        )
        for role_code, permission_codes in ROLE_PERMISSIONS.items():
            role = Role.objects.filter(institution=institution, code=role_code).first()
            if role:
                role.permissions.add(*(permissions[code] for code in permission_codes))


class Migration(migrations.Migration):
    dependencies = [
        ("accounting", "0001_initial"),
        ("institutions", "0007_seed_payroll_access"),
    ]

    operations = [migrations.RunPython(seed_accounting_access, migrations.RunPython.noop)]
