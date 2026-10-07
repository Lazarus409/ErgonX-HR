from django.db import migrations


TEMPLATES = (
    ("BASE_SALARY", "SALARIES_EXPENSE", "NET_PAY_PAYABLE", "Base-pay accrual"),
    ("PAYE", "NET_PAY_PAYABLE", "PAYE_PAYABLE", "PAYE deduction"),
    ("PENSION_EMPLOYEE", "NET_PAY_PAYABLE", "TIER1_PAYABLE", "Employee pension deduction"),
    ("PENSION_EMPLOYER", "EMPLOYER_PENSION_EXPENSE", "TIER1_PAYABLE", "Employer pension accrual"),
    ("GH_MANDATORY_PENSION_EMPLOYEE", "NET_PAY_PAYABLE", "TIER1_PAYABLE", "Employee mandatory pension deduction"),
    ("GH_MANDATORY_PENSION_EMPLOYER", "EMPLOYER_PENSION_EXPENSE", "TIER1_PAYABLE", "Employer mandatory pension accrual"),
    ("GH_PAYE_RESIDENT", "NET_PAY_PAYABLE", "PAYE_PAYABLE", "Resident PAYE deduction"),
    ("GH_PAYE_NON_RESIDENT", "NET_PAY_PAYABLE", "PAYE_PAYABLE", "Non-resident PAYE deduction"),
)


def seed(apps, schema_editor):
    Version = apps.get_model("accounting", "AccountingPresetVersion")
    Template = apps.get_model("accounting", "PayrollAccountMappingTemplate")
    for version in Version.objects.filter(accounting_preset__code__in=("GH-COMMERCIAL", "GH-SME", "GH-PUBLIC", "GH-NONPROFIT")):
        for code, debit, credit, description in TEMPLATES:
            Template.objects.get_or_create(
                accounting_preset_version=version,
                payroll_component_code=code,
                defaults={
                    "debit_account_mapping_code": debit,
                    "credit_account_mapping_code": credit,
                    "description": description,
                },
            )


class Migration(migrations.Migration):
    dependencies = [("accounting", "0009_payroll_account_mappings")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
