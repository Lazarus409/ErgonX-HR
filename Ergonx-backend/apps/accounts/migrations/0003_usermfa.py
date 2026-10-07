from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_institutionadmininvitation")]
    operations = [migrations.CreateModel(name="UserMFA", fields=[
        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        ("created_at", models.DateTimeField(auto_now_add=True)),
        ("updated_at", models.DateTimeField(auto_now=True)),
        ("secret", models.CharField(max_length=64)),
        ("is_enabled", models.BooleanField(default=False)),
        ("confirmed_at", models.DateTimeField(blank=True, null=True)),
        ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="mfa", to="accounts.user")),
    ])]
