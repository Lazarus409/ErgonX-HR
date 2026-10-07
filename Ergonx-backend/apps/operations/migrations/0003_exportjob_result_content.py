from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0002_alter_backgroundjob_institution")]

    operations = [
        migrations.AddField(
            model_name="exportjob",
            name="result_content",
            field=models.TextField(blank=True),
        ),
    ]
