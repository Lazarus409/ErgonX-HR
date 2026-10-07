"""The rolling activity seed fills every dashboard with real, current data."""
from io import StringIO

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.accounts.models import User
from apps.institutions.models import Institution, InstitutionMembership


@pytest.fixture
def seeded(api_client, db):
    with override_settings(DEBUG=True):
        call_command("seed_ergonx_demo", password="ErgonxDemo!2026", stdout=StringIO())
        output = StringIO()
        call_command("seed_ergonx_activity", stdout=output)
    institution = Institution.objects.get(code="CSA-DEMO")
    api_client.force_authenticate(User.objects.get(email="kwame.mensah@csa.test"))
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return institution, output.getvalue()


def _get(api_client, name):
    response = api_client.get(f"/api/v1/dashboards/{name}/")
    assert response.status_code == 200, name
    return response.data


@pytest.mark.django_db
def test_activity_seed_populates_every_dashboard(api_client, seeded):
    institution, output = seeded
    assert "activity is current" in output

    attendance = _get(api_client, "attendance")
    assert any(day["present"] or day["late"] for day in attendance["weekly_attendance"])
    assert attendance["by_department"]

    leave = _get(api_client, "leave")
    assert leave["currently_on_leave"] > 0
    assert leave["upcoming"] > 0
    assert any(day["on_leave"] for day in leave["leave_calendar"])
    assert leave["approved_days_by_department"]

    recruitment = _get(api_client, "recruitment")
    assert recruitment["scheduled_interviews"] > 0
    assert len(recruitment["applications_by_source"]) > 1
    assert sum(bucket["hires"] for bucket in recruitment["time_to_hire"]) >= 3
    assert sum(point["applications"] for point in recruitment["applications_trend"]) > 5

    payroll = _get(api_client, "payroll")
    assert len(payroll["payroll_by_period"]) >= 4
    assert payroll["cost_by_department"]["departments"]

    finance = _get(api_client, "finance")
    assert float(finance["accounts_payable"]) > 0
    assert float(finance["expenses"]) > 0
    assert len(finance["expenses_by_account"]) >= 3
    assert finance["unreconciled_bank_lines"]["count"] > 0
    assert finance["pending_journals"] > 0
    assert len([point for point in finance["profit_and_loss_trend"] if float(point["income"])]) >= 3


@pytest.mark.django_db
def test_activity_seed_gives_employees_a_personal_snapshot(api_client, seeded):
    institution, _ = seeded
    # The self-service persona used for demos and visual checks.
    persona = User.objects.get(email="nana.nyarko@csa.test")
    assert InstitutionMembership.objects.get(institution=institution, user=persona).role.code == "EMPLOYEE"
    api_client.force_authenticate(persona)
    snapshot = api_client.get("/api/v1/home/").data["optional_personal_snapshot"]
    assert snapshot["upcoming_shifts"]
    assert snapshot["activity"]["documents_on_file"] >= 1
    codes = {item["code"] for item in snapshot["attention"]}
    assert snapshot["activity"]["attendance_corrections_pending"] >= 1 or "MY_LEAVE_PENDING" in codes


@pytest.mark.django_db
def test_activity_seed_is_idempotent(seeded):
    institution, _ = seeded
    counts = (institution.attendance_records.count(), institution.leave_requests.count(), institution.documents.count())
    with override_settings(DEBUG=True):
        call_command("seed_ergonx_activity", stdout=StringIO())
    assert counts == (institution.attendance_records.count(), institution.leave_requests.count(), institution.documents.count())
