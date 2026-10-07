from django.db import migrations


def seed(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    records = {code: Permission.objects.update_or_create(code=code, defaults={"name": name, "module_code": "ACCOUNTING"})[0] for code, name in {
        "vat_withholding_certificate.view": "View VAT withholding certificates",
        "vat_withholding_certificate.issue": "Issue and void VAT withholding certificates",
    }.items()}
    for role in Role.objects.filter(code__in=("INSTITUTION_ADMIN", "FINANCE_MANAGER")):
        role.permissions.add(*records.values())
    for role in Role.objects.filter(code="ACCOUNTANT"):
        role.permissions.add(records["vat_withholding_certificate.view"])


class Migration(migrations.Migration):
    dependencies = [("accounting", "0013_vat_withholding_certificate"), ("institutions", "0014_seed_bank_reconciliation_access")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
