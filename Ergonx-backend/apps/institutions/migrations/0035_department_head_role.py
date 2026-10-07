from django.db import migrations

DEPARTMENT_DASHBOARD = "dashboard.department.view"

DEPARTMENT_HEAD_PERMISSION_CODES = (
    "home.view",
    "search.use",
    "settings.profile.manage_self",
    "institution.view",
    "organization.view",
    "employee.view",
    "employment.view",
    "leave.view",
    "leave.request",
    "leave.approve",
    "leave.reject",
    "schedule.view",
    "attendance.view",
    "attendance.clock",
    "attendance.adjust",
    "compensation.view",
    "payslip.view",
    "tax_relief.view",
    "tax_relief.claim",
    DEPARTMENT_DASHBOARD,
)


def add_department_head_role(apps, schema_editor):
    """Promote Department Head to a department-scoped system role everywhere.

    A same-coded custom role (the demo seed created one) is converted in place
    so existing memberships keep pointing at it.
    """
    Institution = apps.get_model("institutions", "Institution")
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    dashboard, _ = Permission.objects.get_or_create(
        code=DEPARTMENT_DASHBOARD,
        defaults={"name": "View the dashboard for departments the member heads", "module_code": "CORE_HR"},
    )
    permissions = list(Permission.objects.filter(code__in=DEPARTMENT_HEAD_PERMISSION_CODES))
    for role in Role.objects.filter(code__in=("INSTITUTION_ADMIN", "HR_ADMIN"), institution__isnull=False):
        role.permissions.add(dashboard)
    for institution in Institution.objects.all():
        role, _ = Role.objects.update_or_create(
            institution=institution,
            code="DEPARTMENT_HEAD",
            defaults={"name": "Department Head", "is_system_role": True, "is_custom": False},
        )
        role.permissions.set(permissions)


class Migration(migrations.Migration):
    dependencies = [("institutions", "0034_institution_executive_title")]

    operations = [migrations.RunPython(add_department_head_role, migrations.RunPython.noop)]
