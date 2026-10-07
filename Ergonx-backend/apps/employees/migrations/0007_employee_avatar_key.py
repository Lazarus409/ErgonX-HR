from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("employees", "0006_allow_multi_institution_employee_profiles")]
    operations = [migrations.AddField(model_name="employee", name="avatar_key", field=models.CharField(blank=True, default="", max_length=40))]
