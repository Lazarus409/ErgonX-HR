import django.db.models.deletion
import uuid
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("accounting", "0008_expense"), ("compensation", "0001_initial")]
    operations = [
        migrations.CreateModel(name="PayrollAccountMappingTemplate", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)), ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("payroll_component_code", models.CharField(max_length=50)), ("debit_account_mapping_code", models.CharField(blank=True, max_length=80, null=True)), ("credit_account_mapping_code", models.CharField(blank=True, max_length=80, null=True)), ("description", models.TextField()),
            ("accounting_preset_version", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="payroll_account_mapping_templates", to="accounting.accountingpresetversion")),
        ]),
        migrations.CreateModel(name="PayComponentAccountMapping", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)), ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("effective_from", models.DateField()), ("effective_to", models.DateField(blank=True, null=True)), ("is_active", models.BooleanField(default=True)),
            ("credit_account", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="payroll_credit_mappings", to="accounting.account")), ("debit_account", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="payroll_debit_mappings", to="accounting.account")),
            ("institution", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pay_component_account_mappings", to="institutions.institution")), ("pay_component", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="account_mappings", to="compensation.paycomponent")),
        ]),
        migrations.AddConstraint(model_name="payrollaccountmappingtemplate", constraint=models.UniqueConstraint(fields=("accounting_preset_version", "payroll_component_code"), name="uniq_payroll_mapping_template_component")),
        migrations.AddConstraint(model_name="paycomponentaccountmapping", constraint=models.UniqueConstraint(fields=("institution", "pay_component", "effective_from"), name="uniq_pay_component_mapping_effective_date")),
    ]
