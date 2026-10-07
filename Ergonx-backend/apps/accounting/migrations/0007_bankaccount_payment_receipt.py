# Generated manually to preserve the ERD §21 Cash / Bank field set.

import django.db.models.deletion
import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounting", "0006_customer_invoice_invoiceline_and_more"),
        ("institutions", "0010_seed_accounts_receivable_access"),
    ]

    operations = [
        migrations.CreateModel(
            name="BankAccount",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=150)),
                ("bank_name", models.CharField(max_length=150)),
                ("masked_account_number", models.CharField(max_length=80)),
                ("currency", models.CharField(max_length=3)),
                ("is_active", models.BooleanField(default=True)),
                ("institution", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="bank_accounts", to="institutions.institution")),
                ("ledger_account", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="bank_accounts", to="accounting.account")),
            ],
            options={"ordering": ("name",)},
        ),
        migrations.CreateModel(
            name="Payment",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("payment_number", models.CharField(max_length=80)),
                ("payment_date", models.DateField()),
                ("amount", models.DecimalField(decimal_places=2, max_digits=20)),
                ("currency", models.CharField(max_length=3)),
                ("payment_method", models.CharField(choices=[("CASH", "Cash"), ("BANK_TRANSFER", "Bank transfer"), ("CHEQUE", "Cheque"), ("CARD", "Card"), ("MOBILE_MONEY", "Mobile money"), ("OTHER", "Other")], max_length=16)),
                ("status", models.CharField(choices=[("POSTED", "Posted"), ("VOID", "Void")], default="POSTED", max_length=8)),
                ("bank_account", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="payments", to="accounting.bankaccount")),
                ("institution", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="payments", to="institutions.institution")),
                ("journal_entry", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="payments", to="accounting.journalentry")),
                ("vendor_bill", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="payments", to="accounting.vendorbill")),
            ],
            options={"ordering": ("-payment_date", "-created_at")},
        ),
        migrations.CreateModel(
            name="Receipt",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("receipt_number", models.CharField(max_length=80)),
                ("receipt_date", models.DateField()),
                ("amount", models.DecimalField(decimal_places=2, max_digits=20)),
                ("currency", models.CharField(max_length=3)),
                ("payment_method", models.CharField(choices=[("CASH", "Cash"), ("BANK_TRANSFER", "Bank transfer"), ("CHEQUE", "Cheque"), ("CARD", "Card"), ("MOBILE_MONEY", "Mobile money"), ("OTHER", "Other")], max_length=16)),
                ("status", models.CharField(choices=[("POSTED", "Posted"), ("VOID", "Void")], default="POSTED", max_length=8)),
                ("bank_account", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="receipts", to="accounting.bankaccount")),
                ("institution", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="receipts", to="institutions.institution")),
                ("invoice", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="receipts", to="accounting.invoice")),
                ("journal_entry", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="receipts", to="accounting.journalentry")),
            ],
            options={"ordering": ("-receipt_date", "-created_at")},
        ),
        migrations.AddConstraint(model_name="bankaccount", constraint=models.UniqueConstraint(fields=("institution", "name"), name="uniq_bank_account_name_per_institution")),
        migrations.AddConstraint(model_name="bankaccount", constraint=models.UniqueConstraint(fields=("institution", "ledger_account"), name="uniq_bank_ledger_account_per_institution")),
        migrations.AddConstraint(model_name="payment", constraint=models.UniqueConstraint(fields=("institution", "payment_number"), name="uniq_payment_number_per_institution")),
        migrations.AddConstraint(model_name="payment", constraint=models.CheckConstraint(condition=models.Q(("amount__gt", 0)), name="payment_amount_positive")),
        migrations.AddConstraint(model_name="receipt", constraint=models.UniqueConstraint(fields=("institution", "receipt_number"), name="uniq_receipt_number_per_institution")),
        migrations.AddConstraint(model_name="receipt", constraint=models.CheckConstraint(condition=models.Q(("amount__gt", 0)), name="receipt_amount_positive")),
        migrations.AddIndex(model_name="bankaccount", index=models.Index(fields=["institution", "is_active", "name"], name="accounting__institu_f66ff4_idx")),
        migrations.AddIndex(model_name="payment", index=models.Index(fields=["institution", "status", "payment_date"], name="accounting__institu_3580a8_idx")),
        migrations.AddIndex(model_name="receipt", index=models.Index(fields=["institution", "status", "receipt_date"], name="accounting__institu_fe6147_idx")),
    ]
