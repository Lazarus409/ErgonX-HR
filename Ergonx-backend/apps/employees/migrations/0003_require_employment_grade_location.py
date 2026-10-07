import django.db.models.deletion
from django.db import migrations, models


UNASSIGNED_CODE = "__UNASSIGNED__"


def backfill_assignment_dimensions(apps, schema_editor):
    Employment = apps.get_model("employees", "Employment")
    Grade = apps.get_model("organization", "Grade")
    Location = apps.get_model("organization", "Location")

    institution_ids = (
        Employment.objects.filter(models.Q(grade__isnull=True) | models.Q(location__isnull=True))
        .values_list("institution_id", flat=True)
        .distinct()
    )
    for institution_id in institution_ids:
        grade, _ = Grade.objects.get_or_create(
            institution_id=institution_id,
            code=UNASSIGNED_CODE,
            defaults={
                "name": "Unassigned",
                "description": "System placeholder created during ERD v1.1 reconciliation.",
                "is_active": False,
            },
        )
        location, _ = Location.objects.get_or_create(
            institution_id=institution_id,
            code=UNASSIGNED_CODE,
            defaults={
                "name": "Unassigned",
                "address": "",
                "city": "",
                "country": "",
                "timezone": "",
                "is_remote": False,
                "is_active": False,
            },
        )
        Employment.objects.filter(
            institution_id=institution_id, grade__isnull=True
        ).update(grade=grade)
        Employment.objects.filter(
            institution_id=institution_id, location__isnull=True
        ).update(location=location)


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0002_emergencycontact_employeeoffboarding_and_more"),
        ("organization", "0002_location_is_remote"),
    ]

    operations = [
        migrations.RunPython(backfill_assignment_dimensions, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="employment",
            name="grade",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="employments",
                to="organization.grade",
            ),
        ),
        migrations.AlterField(
            model_name="employment",
            name="location",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="employments",
                to="organization.location",
            ),
        ),
    ]
