from django.db import migrations


PERMISSIONS = {
    "bank_reconciliation.view": "View bank statement lines and reconciliation state",
    "bank_reconciliation.manage": "Import, match, and unmatch bank statement lines",
}


def seed(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permissions = {
        code: Permission.objects.update_or_create(
            code=code, defaults={"name": name, "module_code": "ACCOUNTING"}
        )[0]
        for code, name in PERMISSIONS.items()
    }
    for role in Role.objects.filter(code__in=("INSTITUTION_ADMIN", "FINANCE_MANAGER")):
        role.permissions.add(*permissions.values())
    for role in Role.objects.filter(code="ACCOUNTANT"):
        role.permissions.add(permissions["bank_reconciliation.view"])


class Migration(migrations.Migration):
    dependencies = [
        ("accounting", "0011_bankstatementline"),
        ("institutions", "0013_seed_payroll_accounting_mapping_access"),
    ]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
