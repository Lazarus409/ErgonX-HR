"""Setup owners are required only for the modules an institution enabled."""
import pytest

from apps.institutions.models import InstitutionMembership, InstitutionModule
from apps.institutions.services import _onboarding_step_blocker, reconcile_institution_onboarding

pytestmark = pytest.mark.django_db


def _users_and_roles_blocker(institution):
    steps = {step.code: step for step in reconcile_institution_onboarding(institution)}
    return _onboarding_step_blocker(institution, steps["USERS_AND_ROLES"])


def _enable(institution, module_code):
    InstitutionModule.objects.update_or_create(institution=institution, module_code=module_code, defaults={"is_enabled": True})


@pytest.fixture
def admin_institution(institution_factory, user_factory, membership_factory):
    institution = institution_factory()
    admin = user_factory(email="setup.admin@example.com")
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN")
    return institution


def test_core_hr_only_needs_an_hr_admin(admin_institution):
    assert _users_and_roles_blocker(admin_institution) == ("SETUP_OWNERS_REQUIRED", "Invite a setup owner for: HR Admin.")


def test_finance_modules_add_their_owners(admin_institution):
    _enable(admin_institution, "ACCOUNTING")
    assert _users_and_roles_blocker(admin_institution)[1] == "Invite a setup owner for: HR Admin, Finance Manager, Accountant."


def test_invited_owner_counts_and_governance_roles_are_optional(admin_institution, user_factory, membership_factory):
    hr = user_factory(email="setup.hr@example.com")
    membership_factory(user=hr, institution=admin_institution, role_code="HR_ADMIN", status=InstitutionMembership.Status.INVITED)
    # No Auditor or Director has been invited, and none is needed.
    assert _users_and_roles_blocker(admin_institution) is None


def test_step_applies_without_core_hr(admin_institution):
    InstitutionModule.objects.filter(institution=admin_institution).update(is_enabled=False)
    _enable(admin_institution, "PAYROLL")
    steps = {step.code: step for step in reconcile_institution_onboarding(admin_institution)}
    assert steps["USERS_AND_ROLES"].required_module == ""
    assert steps["USERS_AND_ROLES"].status != "SKIPPED"
    assert _users_and_roles_blocker(admin_institution)[1] == "Invite a setup owner for: Finance Manager."


def test_hr_admin_role_is_named_with_the_acronym(admin_institution):
    assert admin_institution.roles.get(code="HR_ADMIN").name == "HR Admin"
