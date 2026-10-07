import django.db.models.deletion
from django.db import migrations, models


ELIGIBILITY_MODELS = (
    "LeavePolicyDepartmentEligibility",
    "LeavePolicyEmploymentTypeEligibility",
    "LeavePolicyGenderEligibility",
    "LeavePolicyGradeEligibility",
    "LeavePolicyLocationEligibility",
)


def backfill_institution(apps, schema_editor):
    for model_name in ELIGIBILITY_MODELS:
        model = apps.get_model("leave", model_name)
        for row in model.objects.filter(institution__isnull=True).select_related("policy"):
            row.institution_id = row.policy.institution_id
            row.save(update_fields=("institution",))


def institution_field(model_name, *, nullable):
    return migrations.AddField(
        model_name=model_name.lower(),
        name="institution",
        field=models.ForeignKey(
            null=nullable,
            on_delete=django.db.models.deletion.CASCADE,
            related_name=f"leave_{model_name.lower()}_records",
            to="institutions.institution",
        ),
    )


def required_institution_field(model_name):
    return migrations.AlterField(
        model_name=model_name.lower(),
        name="institution",
        field=models.ForeignKey(
            on_delete=django.db.models.deletion.CASCADE,
            related_name=f"leave_{model_name.lower()}_records",
            to="institutions.institution",
        ),
    )


class Migration(migrations.Migration):
    dependencies = [("leave", "0001_initial")]

    operations = [
        *(institution_field(model_name, nullable=True) for model_name in ELIGIBILITY_MODELS),
        migrations.RunPython(backfill_institution, migrations.RunPython.noop),
        *(required_institution_field(model_name) for model_name in ELIGIBILITY_MODELS),
    ]
