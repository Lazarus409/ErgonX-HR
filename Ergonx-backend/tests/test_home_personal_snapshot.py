"""Employee / Self-Service Home personal snapshot on /api/v1/home/."""
from io import StringIO

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.employees.models import Employee
from apps.institutions.models import Institution, InstitutionMembership, InstitutionModule
from apps.leave.models import LeaveRequest

FORBIDDEN_KEYS = {"performance", "productivity", "efficiency", "score", "rank"}


def _walk_keys(value):
    if isinstance(value, dict):
        for key, inner in value.items():
            yield key
            yield from _walk_keys(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from _walk_keys(inner)


@pytest.fixture
def demo(db):
    with override_settings(DEBUG=True):
        call_command("seed_ergonx_demo", password="ErgonxDemo!2026", stdout=StringIO())
    return Institution.objects.get(code="CSA-DEMO")


def _employee_member(institution):
    membership = (
        InstitutionMembership.objects.filter(institution=institution, role__code="EMPLOYEE", status=InstitutionMembership.Status.ACTIVE)
        .select_related("user")
        .first()
    )
    employee = Employee.objects.for_institution(institution).get(user=membership.user)
    return membership.user, employee


@pytest.mark.django_db
def test_employee_home_includes_personal_snapshot(api_client, demo):
    user, employee = _employee_member(demo)
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(demo.id))

    snapshot = api_client.get("/api/v1/home/").data["optional_personal_snapshot"]
    assert snapshot is not None
    assert set(snapshot) == {"upcoming_shifts", "attention", "activity"}
    assert len(snapshot["upcoming_shifts"]) <= 7
    for shift in snapshot["upcoming_shifts"]:
        assert {"date", "schedule", "off_day", "flexible", "start", "end", "required_minutes"} <= set(shift)
    for item in snapshot["attention"]:
        assert item["severity"] in {"HIGH", "NORMAL"} and item["route"].startswith("/")

    pending = LeaveRequest.objects.for_institution(demo).filter(employee=employee, status=LeaveRequest.Status.PENDING).count()
    codes = {item["code"] for item in snapshot["attention"]}
    assert ("MY_LEAVE_PENDING" in codes) == bool(pending)
    assert snapshot["activity"]["documents_on_file"] >= 0
    assert not FORBIDDEN_KEYS & {key.lower() for key in _walk_keys(snapshot)}


@pytest.mark.django_db
def test_personal_snapshot_respects_disabled_modules(api_client, demo):
    user, _ = _employee_member(demo)
    InstitutionModule.objects.filter(institution=demo, module_code__in=("LEAVE", "ATTENDANCE")).update(is_enabled=False)
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(demo.id))

    snapshot = api_client.get("/api/v1/home/").data["optional_personal_snapshot"]
    assert snapshot["upcoming_shifts"] == []
    assert "leave_requests_this_year" not in snapshot["activity"]
    assert "attendance_corrections_pending" not in snapshot["activity"]
    assert not {item["code"] for item in snapshot["attention"]} & {"MY_LEAVE_PENDING", "MY_CLOCK_IN_MISSING", "MY_ADJUSTMENT_PENDING", "MY_ADJUSTMENT_REJECTED"}


@pytest.mark.django_db
def test_personal_snapshot_is_null_without_an_employee_record(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="NO-EMPLOYEE")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    api_client.force_authenticate(user)

    assert api_client.get("/api/v1/home/").data["optional_personal_snapshot"] is None
