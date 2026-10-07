from django.db import migrations


def rename_hr_admin(apps, schema_editor):
    """System roles were named with str.title(), which spelled HR as "Hr"."""
    Role = apps.get_model("institutions", "Role")
    Role.objects.filter(code="HR_ADMIN", is_system_role=True, name="Hr Admin").update(name="HR Admin")


def restore_hr_admin(apps, schema_editor):
    Role = apps.get_model("institutions", "Role")
    Role.objects.filter(code="HR_ADMIN", is_system_role=True, name="HR Admin").update(name="Hr Admin")


class Migration(migrations.Migration):
    dependencies = [("institutions", "0040_search_entries")]

    operations = [migrations.RunPython(rename_hr_admin, restore_hr_admin)]
