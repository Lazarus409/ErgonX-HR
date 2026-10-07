"""Saved financial reports: standard library, runs with versions, custom reports, access and schedules (Finance concepts)."""
from datetime import date
from decimal import Decimal

import pytest

from apps.accounting.models import Account, FinancialReport
from apps.accounting.reporting import run_due_reports
from apps.accounting.services import approve_vendor_bill, create_vendor, create_vendor_bill, post_vendor_bill, submit_vendor_bill
from tests.test_accounts_payable import _accounting_foundation, _enable_accounting, _finance

pytestmark = pytest.mark.django_db


@pytest.fixture
def reporting(institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="REPORTS-WS", country_code="GH")
    _enable_accounting(institution)
    finance = _finance(institution, user_factory, membership_factory, "reports.finance@example.com")
    period, tax_code, _ = _accounting_foundation(institution, finance, "REPORTS-WS")
    vendor = create_vendor(institution=institution, actor=finance, name="Supplier", vendor_code="SUP-RPT")
    bill = create_vendor_bill(institution=institution, actor=finance, vendor=vendor, bill_number="RPT-1", bill_date=date(2026, 1, 15), due_date=date(2026, 1, 30),
                              currency="GHS", accounting_period=period,
                              lines=[{"description": "Consulting", "expense_account": Account.objects.get(institution=institution, code="5000"), "quantity": Decimal("1"), "unit_price": Decimal("200")}])
    post_vendor_bill(bill=approve_vendor_bill(bill=submit_vendor_bill(bill=bill, actor=finance), actor=finance), actor=finance)
    return {"institution": institution, "finance": finance}


def _client(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return api_client


def test_library_run_versions_and_custom_report(api_client, reporting):
    client = _client(api_client, reporting["finance"], reporting["institution"])
    library = client.get("/api/v1/financial-reports/").json()["data"]["results"]
    assert {row["report_type"] for row in library} >= {"BALANCE_SHEET", "INCOME_STATEMENT", "TRIAL_BALANCE", "AP_AGING"}
    balance = next(row for row in library if row["report_type"] == "BALANCE_SHEET")
    assert balance["status"] == "DRAFT"

    run = client.post(f"/api/v1/financial-reports/{balance['id']}/run/", {"parameters": {"as_of": "2026-01-31"}}, format="json")
    assert run.status_code == 201, run.content
    result = run.json()["data"]["result"]
    assert result["checks"]["balanced"] is True
    liabilities = next(section for section in result["sections"] if section["title"] == "Liabilities")
    assert liabilities["total"] == "200.00"
    client.post(f"/api/v1/financial-reports/{balance['id']}/run/", {"parameters": {"as_of": "2026-01-31"}}, format="json")
    versions = client.get(f"/api/v1/financial-reports/{balance['id']}/runs/").json()["data"]["versions"]
    assert [row["version"] for row in versions] == [2, 1]

    aging = next(row for row in library if row["report_type"] == "AP_AGING")
    aging_run = client.post(f"/api/v1/financial-reports/{aging['id']}/run/", {"parameters": {"as_of": "2026-03-15"}}, format="json").json()["data"]["result"]
    assert aging_run["sections"][0]["rows"][0]["buckets"]["31–60 days"] == "200.00"

    custom = client.post("/api/v1/financial-reports/", {"name": "Q1 P&L", "report_type": "INCOME_STATEMENT", "category": "MANAGEMENT",
                                                         "parameters": {"date_from": "2026-01-01", "date_to": "2026-03-31"}, "schedule_frequency": "QUARTERLY",
                                                         "allowed_roles": ["FINANCE_MANAGER"]}, format="json")
    assert custom.status_code == 201, custom.content
    assert custom.json()["data"]["status"] == "SCHEDULED" and custom.json()["data"]["next_run_on"]
    renamed = client.patch(f"/api/v1/financial-reports/{balance['id']}/", {"name": "Renamed", "notes": "Board pack"}, format="json").json()["data"]
    assert renamed["name"] == "Statement of Financial Position" and renamed["notes"] == "Board pack"


def test_scheduled_runs_and_role_visibility(api_client, reporting, user_factory, membership_factory):
    report = FinancialReport.objects.create(institution=reporting["institution"], name="Monthly TB", report_type="TRIAL_BALANCE", schedule_frequency="MONTHLY",
                                            next_run_on=date(2026, 1, 1), owner=reporting["finance"], allowed_roles=["FINANCE_MANAGER"])
    assert run_due_reports(today=date(2026, 2, 1)) == 1
    report.refresh_from_db()
    assert report.runs.get().scheduled is True and report.next_run_on > date(2026, 2, 1)

    auditor = user_factory(email="reports.auditor@example.com")
    membership_factory(user=auditor, institution=reporting["institution"], role_code="AUDITOR")
    names = {row["name"] for row in _client(api_client, auditor, reporting["institution"]).get("/api/v1/financial-reports/").json()["data"]["results"]}
    assert "Monthly TB" not in names and "Trial Balance" in names
