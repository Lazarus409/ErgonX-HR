from django.db import migrations


PRESET_CODES = ("GH-COMMERCIAL", "GH-SME", "GH-PUBLIC", "GH-NONPROFIT")
COMPONENT_CODE = "GH_CASUAL_WORKER_TAX"


def add_casual_worker_tax_mapping(apps, schema_editor):
    Version = apps.get_model("accounting", "AccountingPresetVersion")
    Template = apps.get_model("accounting", "PayrollAccountMappingTemplate")

    for version in Version.objects.filter(accounting_preset__code__in=PRESET_CODES):
        Template.objects.get_or_create(
            accounting_preset_version=version,
            payroll_component_code=COMPONENT_CODE,
            defaults={
                "debit_account_mapping_code": "NET_PAY_PAYABLE",
                "credit_account_mapping_code": "PAYE_PAYABLE",
                "description": "Ghana casual-worker withholding tax payable.",
            },
        )


class Migration(migrations.Migration):
    dependencies = [("accounting", "0014_ghana_compliance_reminders")]

    operations = [migrations.RunPython(add_casual_worker_tax_mapping, migrations.RunPython.noop)]
