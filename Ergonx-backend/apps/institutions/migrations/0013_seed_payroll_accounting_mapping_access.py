from django.db import migrations

PERMISSIONS = {"payroll_accounting.view": "View payroll accounting mappings", "payroll_accounting.configure": "Configure payroll accounting mappings"}
def seed(apps, schema_editor):
    Permission=apps.get_model("institutions","Permission"); Role=apps.get_model("institutions","Role")
    records={k: Permission.objects.update_or_create(code=k, defaults={"name":v,"module_code":"ACCOUNTING"})[0] for k,v in PERMISSIONS.items()}
    for role in Role.objects.filter(code__in=("INSTITUTION_ADMIN","FINANCE_MANAGER")): role.permissions.add(*records.values())
    for role in Role.objects.filter(code="ACCOUNTANT"): role.permissions.add(records["payroll_accounting.view"])
class Migration(migrations.Migration):
    dependencies=[("accounting","0009_payroll_account_mappings"),("institutions","0012_seed_expense_access")]
    operations=[migrations.RunPython(seed,migrations.RunPython.noop)]
