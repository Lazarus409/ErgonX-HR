"""ErgonX HR edition: Payroll and Accounting are not part of the product.

Run with the default ERGONX_EXCLUDED_MODULES (PAYROLL,ACCOUNTING); the rest of the
suite still covers those modules when it is run with ERGONX_EXCLUDED_MODULES="".
"""

import pytest
from django.conf import settings
from django.urls import Resolver404, resolve

from apps.institutions.models import InstitutionModule
from apps.institutions.services import set_module_enabled

pytestmark = [
    pytest.mark.django_db,
    pytest.mark.skipif(
        settings.ERGONX_EXCLUDED_MODULES != {"PAYROLL", "ACCOUNTING"},
        reason="HR edition exclusions are switched off for this run.",
    ),
]

MODULES = "/api/v1/institutions/modules/"


@pytest.fixture
def admin_client(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory()
    admin = user_factory(email="hr.edition.admin@example.com")
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN")
    api_client.force_authenticate(admin)
    return api_client, institution, admin


def test_new_institution_has_no_payroll_or_accounting_module(admin_client):
    client, institution, _ = admin_client
    codes = set(institution.modules.values_list("module_code", flat=True))
    assert codes == {"CORE_HR", "LEAVE", "ATTENDANCE", "RECRUITMENT", "REPORTS"}
    listed = {row["module_code"] for row in client.get(MODULES).data["results"]}
    assert listed == codes


def test_excluded_module_can_never_be_enabled(admin_client):
    _, institution, admin = admin_client
    payroll = InstitutionModule.objects.create(institution=institution, module_code="PAYROLL")
    with pytest.raises(Exception) as error:
        set_module_enabled(module=payroll, institution=institution, actor=admin, is_enabled=True)
    assert getattr(error.value, "api_code", None) == "module_not_available"
    payroll.refresh_from_db()
    assert not payroll.is_enabled


def test_onboarding_has_no_payroll_or_accounting_steps(admin_client):
    client, _, _ = admin_client
    response = client.get("/api/v1/institutions/onboarding/")
    assert response.status_code == 200
    codes = {step["code"] for step in response.data["steps"]}
    assert not codes & {"PAYROLL_CONFIGURATION", "ACCOUNTING_CONFIGURATION", "PAYROLL_GL_MAPPING"}
    assert {"ORGANIZATION_SETUP", "RECRUITMENT_CONFIGURATION", "VALIDATION"} <= codes


@pytest.mark.parametrize("url", ["/api/v1/payroll-runs/", "/api/v1/pay-components/", "/api/v1/salary-structures/", "/api/v1/journal-entries/"])
def test_payroll_and_accounting_routes_are_not_mounted(url):
    with pytest.raises(Resolver404):
        resolve(url)


def test_excluded_module_views_are_refused_even_if_enabled_directly(admin_client):
    client, institution, _ = admin_client
    InstitutionModule.objects.create(institution=institution, module_code="ACCOUNTING", is_enabled=True)
    InstitutionModule.objects.filter(institution=institution, module_code="REPORTS").update(is_enabled=True)
    response = client.get("/api/v1/reports/accounting/")
    assert response.status_code == 403 and response.data["code"] == "module_not_available"


def test_health_endpoint_is_lightweight(client, django_assert_num_queries):
    with django_assert_num_queries(0):
        response = client.get("/api/v1/health/")
    assert response.status_code == 200 and response.json() == {"status": "ok"}


def test_finance_roles_and_permissions_are_hidden(admin_client):
    client, _, _ = admin_client
    role_codes = {role["code"] for role in client.get("/api/v1/institutions/roles/", {"page_size": 100}).data["results"]}
    assert not role_codes & {"FINANCE_MANAGER", "ACCOUNTANT"} and "HR_ADMIN" in role_codes
    catalogue = client.get("/api/v1/institutions/permissions/").data
    codes = {item["code"] for item in catalogue}
    assert "employee.view" in codes
    assert not {item["module_code"] for item in catalogue} & {"PAYROLL", "ACCOUNTING"}
    assert not codes & {"dashboard.payroll.view", "dashboard.finance.view"}
    hr_admin = next(role for role in client.get("/api/v1/institutions/roles/", {"page_size": 100}).data["results"] if role["code"] == "HR_ADMIN")
    assert not [code for code in hr_admin["permissions"] if code.startswith(("payroll.", "journal.", "account."))]


def test_workforce_report_has_no_pay_totals(admin_client):
    client, institution, _ = admin_client
    InstitutionModule.objects.filter(institution=institution, module_code="REPORTS").update(is_enabled=True)
    response = client.get("/api/v1/reports/workforce-cost/")
    assert response.status_code == 200
    assert "PAYROLL_TOTAL" not in response.content.decode()
