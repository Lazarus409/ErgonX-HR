import django.db.models.deletion
import uuid

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounting", "0007_bankaccount_payment_receipt"), ("documents", "0001_initial"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name="Expense", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("expense_date", models.DateField()), ("amount", models.DecimalField(decimal_places=2, max_digits=20)),
            ("currency", models.CharField(max_length=3)), ("description", models.TextField()),
            ("status", models.CharField(choices=[("DRAFT", "Draft"), ("PENDING", "Pending"), ("APPROVED", "Approved"), ("POSTED", "Posted"), ("REJECTED", "Rejected")], default="DRAFT", max_length=10)),
            ("account", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="expenses", to="accounting.account")),
            ("approved_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="expenses_approved", to=settings.AUTH_USER_MODEL)),
            ("attachment", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="expenses", to="documents.document")),
            ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="expenses_created", to=settings.AUTH_USER_MODEL)),
            ("institution", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="expenses", to="institutions.institution")),
            ("journal_entry", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="expenses", to="accounting.journalentry")),
        ], options={"ordering": ("-expense_date", "-created_at")}),
        migrations.AddConstraint(model_name="expense", constraint=models.CheckConstraint(condition=models.Q(("amount__gt", 0)), name="expense_amount_positive")),
        migrations.AddIndex(model_name="expense", index=models.Index(fields=["institution", "status", "expense_date"], name="accounting__institu_fdd568_idx")),
    ]
