import django.db.models.deletion
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("accounting", "0009_payroll_account_mappings"), ("payroll", "0003_seed_ghana_payroll_2026")]
    operations = [migrations.AddField(model_name="payrollrun", name="accounting_journal_entry", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="payroll_runs", to="accounting.journalentry"))]
