from django.db import migrations


OLD_CODE = "APEX-DEMO"
NEW_CODE = "CSA-DEMO"
OLD_DOMAIN = "@apexdemo.example"
NEW_DOMAIN = "@csa.test"


def _updated_email(email):
    if email and email.lower().endswith(OLD_DOMAIN):
        return f"{email[:-len(OLD_DOMAIN)]}{NEW_DOMAIN}"
    return email


def rename_demo_institution(apps, schema_editor):
    """Rename only the reserved synthetic demo tenant and its identities."""
    Institution = apps.get_model("institutions", "Institution")
    User = apps.get_model("accounts", "User")
    Employee = apps.get_model("employees", "Employee")
    Candidate = apps.get_model("recruitment", "Candidate")

    institution = Institution.objects.filter(code=OLD_CODE).first()
    if institution is None:
        return

    # Avoid merging or overwriting a separately created CSA tenant.
    if not Institution.objects.exclude(pk=institution.pk).filter(code=NEW_CODE).exists():
        institution.code = NEW_CODE
    institution.name = "Cyber Security Authority"
    institution.email = _updated_email(institution.email)
    institution.save(update_fields=("code", "name", "email", "updated_at"))

    for user in User.objects.filter(memberships__institution=institution, email__iendswith=OLD_DOMAIN).distinct():
        email = _updated_email(user.email)
        # Emails are unique: keep the old address if the new one is already taken.
        if User.objects.exclude(pk=user.pk).filter(email__iexact=email).exists():
            continue
        user.email = email
        user.save(update_fields=("email", "updated_at"))

    for employee in Employee.objects.filter(institution=institution):
        changed = []
        for field in ("work_email", "personal_email"):
            value = _updated_email(getattr(employee, field))
            if value != getattr(employee, field):
                setattr(employee, field, value)
                changed.append(field)
        if changed:
            employee.save(update_fields=(*changed, "updated_at"))

    for candidate in Candidate.objects.filter(institution=institution):
        changed = []
        email = _updated_email(candidate.email)
        if email != candidate.email:
            candidate.email = email
            changed.append("email")
        if candidate.source == OLD_CODE:
            candidate.source = NEW_CODE
            changed.append("source")
        if changed:
            candidate.save(update_fields=(*changed, "updated_at"))


class Migration(migrations.Migration):
    dependencies = [
        ("institutions", "0038_hr_admin_without_audit"),
        ("accounts", "0006_platform_admin"),
        ("employees", "0009_concept_profile_fields"),
        ("recruitment", "0005_interview_scheduling_offer_lifecycle"),
    ]

    operations = [migrations.RunPython(rename_demo_institution, migrations.RunPython.noop)]
