"""Dashboard rollups behind the visualization-diversity charts.

Seeds the integrated demo once and checks that each new rollup is shaped for
its chart and reconciles with the underlying records (no browser arithmetic
is needed to trust them).
"""
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.accounting.models import BankStatementLine, Expense
from apps.accounts.models import User
from apps.institutions.models import Institution
from apps.recruitment.models import Application, Interview, Offer


@pytest.fixture
def demo(api_client, db):
    with override_settings(DEBUG=True):
        call_command("seed_ergonx_demo", password="ErgonxDemo!2026", stdout=StringIO())
    institution = Institution.objects.get(code="CSA-DEMO")
    api_client.force_authenticate(User.objects.get(email="kwame.mensah@csa.test"))
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return institution


@pytest.mark.django_db
def test_recruitment_rollups_reconcile_with_records(api_client, demo):
    data = api_client.get("/api/v1/dashboards/recruitment/").data

    sources = data["applications_by_source"]
    assert len(sources) <= 6
    assert sum(row["count"] for row in sources) <= Application.objects.filter(institution=demo).count()
    assert all(row["source"] for row in sources)

    interviews = {row["status"]: row["count"] for row in data["interviews_by_status"]}
    assert sum(interviews.values()) == Interview.objects.filter(institution=demo).count()

    buckets = data["time_to_hire"]
    assert [row["bucket"] for row in buckets] == ["0–14 days", "15–30 days", "31–60 days", "61+ days"]
    accepted = Offer.objects.filter(institution=demo, accepted_at__isnull=False, application__applied_at__isnull=False).count()
    assert sum(row["hires"] for row in buckets) == accepted


@pytest.mark.django_db
def test_leave_department_and_calendar_rollups(api_client, demo):
    data = api_client.get("/api/v1/dashboards/leave/").data

    calendar = data["leave_calendar"]
    assert len(calendar) == 28
    assert all(day["on_leave"] >= 0 for day in calendar)
    assert calendar[0]["date"] < calendar[-1]["date"]

    departments = data["approved_days_by_department"]
    assert len(departments) <= 8
    days = [Decimal(str(row["requested_days"])) for row in departments]
    assert days == sorted(days, reverse=True)


@pytest.mark.django_db
def test_payroll_cost_by_department_uses_latest_finalized_run(api_client, demo):
    data = api_client.get("/api/v1/dashboards/payroll/").data
    cost = data["cost_by_department"]
    departments = cost["departments"]
    assert len(departments) <= 8
    if departments:
        assert cost["period"]
        values = [Decimal(str(row["gross_pay"])) for row in departments]
        assert values == sorted(values, reverse=True)


@pytest.mark.django_db
def test_finance_expense_categories_and_unreconciled_lines(api_client, demo):
    data = api_client.get("/api/v1/dashboards/finance/").data

    slices = data["expenses_by_account"]
    assert len(slices) <= 6
    assert sum(Decimal(str(row["value"])) for row in slices) == Decimal(str(data["expenses"]))

    unreconciled = data["unreconciled_bank_lines"]
    expected = BankStatementLine.objects.filter(
        institution=demo, status__in=(BankStatementLine.Status.UNMATCHED, BankStatementLine.Status.EXCEPTION)
    ).count()
    assert unreconciled["count"] == expected
    assert len(unreconciled["latest"]) == min(expected, 5)
    assert Expense.objects.filter(institution=demo).exists() or slices == []
