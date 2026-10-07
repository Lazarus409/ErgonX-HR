from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0005_emergencycontact_address"),
        ("institutions", "0028_grant_director_module_access"),
    ]

    operations = [
        migrations.AddField(
            model_name="institutioninvitation",
            name="employee",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="self_service_invitations", to="employees.employee"),
        ),
    ]
