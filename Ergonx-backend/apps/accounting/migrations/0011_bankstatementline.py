import django.db.models.deletion
import uuid

from django.conf import settings
from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [("accounting", "0010_seed_ghana_payroll_account_mapping_templates")]

    operations = [
        migrations.CreateModel(
            name="BankStatementLine",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("statement_date", models.DateField()),
                ("external_id", models.CharField(max_length=120)),
                ("reference", models.CharField(blank=True, max_length=150)),
                ("description", models.TextField(blank=True)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=20)),
                ("currency", models.CharField(max_length=3)),
                ("status", models.CharField(choices=[("UNMATCHED", "Unmatched"), ("MATCHED", "Matched"), ("EXCEPTION", "Exception")], default="UNMATCHED", max_length=10)),
                ("reconciled_at", models.DateTimeField(blank=True, null=True)),
                ("bank_account", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="statement_lines", to="accounting.bankaccount")),
                ("institution", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="bank_statement_lines", to="institutions.institution")),
                ("journal_entry", models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="bank_statement_match", to="accounting.journalentry")),
                ("reconciled_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="bank_statement_lines_reconciled", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-statement_date", "-created_at")},
        ),
        migrations.AddConstraint(model_name="bankstatementline", constraint=models.UniqueConstraint(fields=("bank_account", "external_id"), name="uniq_bank_statement_external_id")),
        migrations.AddConstraint(model_name="bankstatementline", constraint=models.CheckConstraint(condition=Q(("amount__gt", 0), ("amount__lt", 0), _connector="OR"), name="bank_statement_amount_nonzero")),
        migrations.AddIndex(model_name="bankstatementline", index=models.Index(fields=["institution", "status", "statement_date"], name="accounting__institu_6b19fd_idx")),
        migrations.AddIndex(model_name="bankstatementline", index=models.Index(fields=["bank_account", "statement_date"], name="accounting__bank_ac_e414dd_idx")),
    ]
