"""Employee documents uploaded by HR used entity_type "employees.Employee" while
self-service uploads used "EMPLOYEE", so neither side saw the other's files.
Use "EMPLOYEE" everywhere (apps.documents.models.EMPLOYEE_ENTITY_TYPE)."""

from django.db import migrations


def unify(apps, schema_editor):
    Document = apps.get_model("documents", "Document")
    Document.objects.filter(entity_type="employees.Employee").update(entity_type="EMPLOYEE")


class Migration(migrations.Migration):
    dependencies = [("documents", "0004_document_requirements")]

    operations = [migrations.RunPython(unify, migrations.RunPython.noop)]
