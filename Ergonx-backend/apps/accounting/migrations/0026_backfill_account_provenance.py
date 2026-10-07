"""Backfill durable account provenance and add the employee-payable mapping (BQ-09, BQ-03).

1. Every chart template gains "2150 Employee reimbursements payable" (EMPLOYEE_PAYABLE)
   under its liabilities root, so new applications carry it.
2. For institutions that already applied a preset, each account whose code matches a
   mapped template of that preset receives the template's mapping code. Code matching
   is used only here, once; posting reads ``Account.system_mapping_code`` afterwards.
3. Those institutions also get the employee-payable account when their liabilities
   root exists and code 2150 is free; otherwise finance maps an account themselves
   and expense posting fails closed until they do.
"""

from django.db import migrations

EMPLOYEE_PAYABLE = ("2150", "Employee reimbursements payable", "LIABILITY", "CREDIT", "EMPLOYEE_PAYABLE")


def forwards(apps, schema_editor):
    ChartOfAccountsTemplate = apps.get_model("accounting", "ChartOfAccountsTemplate")
    AccountTemplate = apps.get_model("accounting", "AccountTemplate")
    Account = apps.get_model("accounting", "Account")
    Configuration = apps.get_model("accounting", "InstitutionAccountingConfiguration")
    code, name, account_type, normal_balance, mapping = EMPLOYEE_PAYABLE

    for chart in ChartOfAccountsTemplate.objects.all():
        root = AccountTemplate.objects.filter(coa_template=chart, system_mapping_code="LIABILITIES_ROOT").first()
        if root is None or AccountTemplate.objects.filter(coa_template=chart, system_mapping_code=mapping).exists():
            continue
        if AccountTemplate.objects.filter(coa_template=chart, code=code).exists():
            continue
        AccountTemplate.objects.create(
            coa_template=chart, code=code, name=name, account_type=account_type, normal_balance=normal_balance,
            is_postable=True, system_mapping_code=mapping, parent_template=root,
        )

    for configuration in Configuration.objects.exclude(selected_accounting_preset_version=None):
        institution_id = configuration.institution_id
        templates = AccountTemplate.objects.filter(
            coa_template__preset_version_id=configuration.selected_accounting_preset_version_id,
        ).exclude(system_mapping_code=None)
        by_code = {}
        for template in templates:
            by_code.setdefault(template.system_mapping_code, []).append(template)
        for mapping_code, matches in by_code.items():
            if len(matches) != 1:
                continue  # ambiguous in the preset: leave unmapped (fails closed)
            if Account.objects.filter(institution_id=institution_id, system_mapping_code=mapping_code).exists():
                continue
            Account.objects.filter(institution_id=institution_id, code=matches[0].code, system_mapping_code=None).update(system_mapping_code=mapping_code)

        if not Account.objects.filter(institution_id=institution_id, system_mapping_code=mapping).exists():
            parent = Account.objects.filter(institution_id=institution_id, system_mapping_code="LIABILITIES_ROOT").first()
            if parent is not None and not Account.objects.filter(institution_id=institution_id, code=code).exists():
                Account.objects.create(
                    institution_id=institution_id, code=code, name=name, account_type=account_type,
                    normal_balance=normal_balance, parent=parent, is_postable=True, is_active=True,
                    system_mapping_code=mapping,
                )


class Migration(migrations.Migration):

    dependencies = [
        ("accounting", "0025_expense_claims_and_account_provenance"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
