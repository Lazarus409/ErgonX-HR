from django.db import migrations


DIRECTOR_PERMISSION_CODES = (
    "leave.view",
    "leave.approve",
    "leave.reject",
    "dashboard.leave.view",
    "schedule.view",
    "attendance.view",
    "dashboard.attendance.view",
    "compensation.view",
    "payroll.view",
    "payslip.view",
    "tax_relief.view",
    "dashboard.payroll.view",
    "job_posting.view",
    "candidate.view",
    "recruitment_stage.view",
    "interview.view",
    "offer.view",
)


def grant_director_module_access(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    permissions = Permission.objects.filter(code__in=DIRECTOR_PERMISSION_CODES)
    for role in Role.objects.filter(code="DIRECTOR"):
        role.permissions.add(*permissions)


class Migration(migrations.Migration):
    dependencies = [("institutions", "0027_institutiononboardingstep_is_admin_skipped")]

    operations = [migrations.RunPython(grant_director_module_access, migrations.RunPython.noop)]
