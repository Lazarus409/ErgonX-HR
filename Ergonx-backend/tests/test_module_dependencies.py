"""Module dependency rules and audit (Wave 2: MOD-01/02) and REPORTS gating (BQ-05)."""

import pytest

from apps.audit.models import AuditLog
from apps.institutions.models import InstitutionModule

pytestmark = pytest.mark.django_db

MODULES = "/api/v1/institutions/modules/"


@pytest.fixture
def admin_client(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory()
    admin = user_factory(email="mod.admin@example.com")
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN")
    api_client.force_authenticate(admin)
    return api_client, institution


def module(institution, code):
    return InstitutionModule.objects.get(institution=institution, module_code=code)


def test_core_hr_cannot_be_disabled(admin_client):
    client, institution = admin_client
    response = client.patch(f"{MODULES}{module(institution, 'CORE_HR').id}/", {"is_enabled": False}, format="json")
    assert response.status_code == 400 and response.data["code"] == "module_dependency"
    assert module(institution, "CORE_HR").is_enabled


def test_a_module_needs_core_hr_enabled(admin_client):
    client, institution = admin_client
    InstitutionModule.objects.filter(institution=institution, module_code="CORE_HR").update(is_enabled=False)
    response = client.patch(f"{MODULES}{module(institution, 'PAYROLL').id}/", {"is_enabled": True}, format="json")
    # With Core HR off the API itself is gated on Core HR, so the request is refused either way.
    assert response.status_code in (400, 403)
    assert not module(institution, "PAYROLL").is_enabled


def test_enable_and_disable_are_audited_and_keep_data(admin_client):
    client, institution = admin_client
    leave = module(institution, "LEAVE")
    assert client.patch(f"{MODULES}{leave.id}/", {"is_enabled": True}, format="json").status_code == 200
    assert client.patch(f"{MODULES}{leave.id}/", {"is_enabled": False}, format="json").status_code == 200
    actions = list(AuditLog.objects.filter(institution=institution, action__startswith="institution.module.").order_by("created_at").values_list("action", flat=True))
    assert actions == ["institution.module.enabled", "institution.module.disabled"]
    assert InstitutionModule.objects.filter(pk=leave.pk).exists()


def test_reports_csv_endpoints_require_the_reports_module(admin_client):
    client, institution = admin_client
    InstitutionModule.objects.filter(institution=institution, module_code="LEAVE").update(is_enabled=True)
    InstitutionModule.objects.filter(institution=institution, module_code="REPORTS").update(is_enabled=False)
    blocked = client.get("/api/v1/reports/leave/")
    assert blocked.status_code == 403 and blocked.data["code"] == "module_disabled"
    InstitutionModule.objects.filter(institution=institution, module_code="REPORTS").update(is_enabled=True)
    assert client.get("/api/v1/reports/leave/").status_code == 200
