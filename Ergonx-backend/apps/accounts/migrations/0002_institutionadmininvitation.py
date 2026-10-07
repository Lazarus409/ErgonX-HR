import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL), ("accounts", "0001_initial")]

    operations = [
        migrations.CreateModel(
            name="InstitutionAdminInvitation",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("email", models.EmailField(max_length=254)),
                ("token_hash", models.CharField(max_length=128, unique=True)),
                ("status", models.CharField(choices=[("PENDING", "Pending"), ("ACCEPTED", "Accepted"), ("EXPIRED", "Expired"), ("REVOKED", "Revoked")], default="PENDING", max_length=10)),
                ("expires_at", models.DateTimeField()),
                ("accepted_at", models.DateTimeField(blank=True, null=True)),
                ("invited_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="institution_admin_invitations", to=settings.AUTH_USER_MODEL)),
            ],
            options={"indexes": [models.Index(fields=["email", "status"], name="accounts_in_email_0313bb_idx")]},
        ),
    ]
