from django.db import migrations


PERMISSIONS = {
    "dashboard.executive.view": "View executive dashboard",
    "dashboard.hr.view": "View HR dashboard",
    "dashboard.leave.view": "View leave dashboard",
    "dashboard.attendance.view": "View attendance dashboard",
    "dashboard.payroll.view": "View payroll dashboard",
    "dashboard.finance.view": "View finance dashboard",
}


def seed(apps, schema_editor):
    Permission = apps.get_model("institutions", "Permission")
    Role = apps.get_model("institutions", "Role")
    records = {code: Permission.objects.update_or_create(code=code, defaults={"name": name, "module_code": "CORE_HR"})[0] for code, name in PERMISSIONS.items()}
    for role in Role.objects.filter(code="INSTITUTION_ADMIN"):
        role.permissions.add(*records.values())
    for role in Role.objects.filter(code="HR_ADMIN"):
        role.permissions.add(records["dashboard.hr.view"], records["dashboard.leave.view"], records["dashboard.attendance.view"], records["dashboard.payroll.view"])
    for role in Role.objects.filter(code="FINANCE_MANAGER"):
        role.permissions.add(records["dashboard.executive.view"], records["dashboard.finance.view"], records["dashboard.payroll.view"])


class Migration(migrations.Migration):
    dependencies = [("institutions", "0015_seed_vat_withholding_certificate_access")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
