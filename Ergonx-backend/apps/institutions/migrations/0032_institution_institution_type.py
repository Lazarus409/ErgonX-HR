from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("institutions", "0031_restore_accountant_payroll_separation")]

    operations = [
        migrations.AddField(
            model_name="institution",
            name="institution_type",
            field=models.CharField(
                choices=[
                    ("PRIVATE", "Private / Commercial"), ("SME", "SME"),
                    ("GOVERNMENT", "Government / Public Sector"),
                    ("NGO", "NGO / Nonprofit"),
                    ("EDUCATION", "Educational Institution"),
                    ("HEALTHCARE", "Healthcare Institution"),
                    ("OTHER", "Other"),
                ],
                default="PRIVATE",
                max_length=20,
            ),
        ),
    ]
