from django.db import migrations

PERMISSIONS = {"expense.view": "View expenses", "expense.create": "Create and submit expenses", "expense.approve": "Approve or reject expenses", "expense.post": "Post approved expenses"}

def seed_expense_access(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission"); Role = apps.get_model("institutions", "Role")
    records = {code: Permission.objects.update_or_create(code=code, defaults={"name": name, "module_code": "ACCOUNTING"})[0] for code, name in PERMISSIONS.items()}
    grants = {"INSTITUTION_ADMIN": tuple(PERMISSIONS), "ACCOUNTANT": ("expense.view", "expense.create"), "FINANCE_MANAGER": tuple(PERMISSIONS), "AUDITOR": ("expense.view",)}
    for role_code, codes in grants.items():
        for role in Role.objects.filter(code=role_code): role.permissions.add(*(records[code] for code in codes))

class Migration(migrations.Migration):
    dependencies = [("accounting", "0008_expense"), ("institutions", "0011_seed_cash_bank_access")]
    operations = [migrations.RunPython(seed_expense_access, migrations.RunPython.noop)]
