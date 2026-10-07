# Generated manually to accompany the emergency-contact API contract.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0004_employee_lifecycle_statuses"),
    ]

    operations = [
        migrations.AddField(
            model_name="emergencycontact",
            name="address",
            field=models.CharField(blank=True, max_length=300),
        ),
    ]
