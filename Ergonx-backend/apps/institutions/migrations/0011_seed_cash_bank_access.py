# Generated manually to grant the ERD §21 Cash / Bank workflow permissions.

from django.db import migrations


PERMISSIONS = {
    "bank_account.view": "View bank accounts",
    "bank_account.create": "Create bank accounts",
    "bank_account.update": "Update bank accounts",
    "payment.view": "View payments",
    "payment.create": "Create and post payments",
    "payment.void": "Void posted payments",
    "receipt.view": "View receipts",
    "receipt.create": "Create and post receipts",
    "receipt.void": "Void posted receipts",
}


def seed_cash_bank_access(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permissions = {
        code: Permission.objects.update_or_create(
            code=code, defaults={"name": name, "module_code": "ACCOUNTING"}
        )[0]
        for code, name in PERMISSIONS.items()
    }
    roles = {
        "INSTITUTION_ADMIN": tuple(PERMISSIONS),
        "ACCOUNTANT": (
            "bank_account.view", "bank_account.create", "bank_account.update",
            "payment.view", "payment.create", "receipt.view", "receipt.create",
        ),
        "FINANCE_MANAGER": tuple(PERMISSIONS),
        "AUDITOR": ("bank_account.view", "payment.view", "receipt.view"),
    }
    for role_code, granted in roles.items():
        for role in Role.objects.filter(code=role_code):
            role.permissions.add(*(permissions[code] for code in granted))


class Migration(migrations.Migration):

    dependencies = [
        ("accounting", "0007_bankaccount_payment_receipt"),
        ("institutions", "0010_seed_accounts_receivable_access"),
    ]

    operations = [migrations.RunPython(seed_cash_bank_access, migrations.RunPython.noop)]
