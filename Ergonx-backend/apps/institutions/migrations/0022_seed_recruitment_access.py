from django.db import migrations


PERMISSIONS = {
    "job_posting.view": "View job postings",
    "job_posting.create": "Create and publish job postings",
    "job_posting.update": "Update and close job postings",
    "candidate.view": "View candidates and applications",
    "candidate.create": "Create candidates and applications",
    "candidate.update": "Update candidates and move applications",
    "recruitment_stage.view": "View recruitment pipeline stages",
    "recruitment_stage.manage": "Manage recruitment pipeline stages",
    "interview.view": "View interviews and evaluations",
    "interview.manage": "Schedule and complete interviews",
    "candidate_evaluation.create": "Record candidate evaluations",
    "offer.view": "View offers",
    "offer.create": "Create and extend offers",
    "offer.manage": "Accept, decline, withdraw, and hire offers",
}


def seed(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    Institution = apps.get_model("institutions", "Institution")
    InstitutionModule = apps.get_model("institutions", "InstitutionModule")
    records = {
        code: Permission.objects.update_or_create(
            code=code, defaults={"name": name, "module_code": "RECRUITMENT"}
        )[0]
        for code, name in PERMISSIONS.items()
    }
    for role in Role.objects.filter(code__in=("INSTITUTION_ADMIN", "HR_ADMIN")):
        role.permissions.add(*records.values())
    for role in Role.objects.filter(code="DIRECTOR"):
        role.permissions.add(records["job_posting.view"], records["candidate.view"], records["interview.view"], records["offer.view"])
    for institution in Institution.objects.all():
        InstitutionModule.objects.get_or_create(
            institution=institution,
            module_code="RECRUITMENT",
            defaults={"is_enabled": False, "configuration_status": "NOT_CONFIGURED"},
        )


class Migration(migrations.Migration):
    dependencies = [("institutions", "0021_seed_operations_access")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
