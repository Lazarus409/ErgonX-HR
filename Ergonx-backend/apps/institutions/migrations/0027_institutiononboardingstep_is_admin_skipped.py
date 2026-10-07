from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("institutions", "0026_grant_finance_roles_payroll_access"),
    ]

    operations = [
        migrations.AddField(
            model_name="institutiononboardingstep",
            name="is_admin_skipped",
            field=models.BooleanField(default=False),
        ),
    ]
