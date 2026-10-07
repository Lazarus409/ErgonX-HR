import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("institutions", "0024_seed_access_experience_permissions"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [migrations.CreateModel(name="InstitutionInvitation", fields=[("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)), ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)), ("email", models.EmailField(max_length=254)), ("token_hash", models.CharField(max_length=128, unique=True)), ("status", models.CharField(choices=[("PENDING", "Pending"), ("ACCEPTED", "Accepted"), ("EXPIRED", "Expired"), ("REVOKED", "Revoked")], default="PENDING", max_length=10)), ("expires_at", models.DateTimeField()), ("accepted_at", models.DateTimeField(blank=True, null=True)), ("institution", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="invitations", to="institutions.institution")), ("invited_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="institution_invitations", to=settings.AUTH_USER_MODEL)), ("role", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="invitations", to="institutions.role"))], options={"indexes": [models.Index(fields=["institution", "email", "status"], name="institution_institu_a1e4be_idx")]})]
