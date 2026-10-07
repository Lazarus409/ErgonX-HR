"""Budgets: allocation, actuals from the posted ledger, committed bills, approval and overview (Finance concepts)."""
from datetime import date
from decimal import Decimal

import pytest

from apps.accounting.models import Account, Budget, FiscalYear
from apps.accounting.services import approve_vendor_bill, create_vendor, create_vendor_bill, post_vendor_bill, submit_vendor_bill
from apps.institutions.models import Role
from tests.test_accounts_payable import _accounting_foundation, _enable_accounting, _finance

pytestmark = pytest.mark.django_db


@pytest.fixture
def budgeting(institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="BUDGET-WS", country_code="GH")
    _enable_accounting(institution)
    finance = _finance(institution, user_factory, membership_factory, "budget.finance@example.com")
    approver = _finance(institution, user_factory, membership_factory, "budget.approver@example.com")
    period, tax_code, _ = _accounting_foundation(institution, finance, "BUDGET-WS")
    expense = Account.objects.get(institution=institution, code="5000")
    vendor = create_vendor(institution=institution, actor=finance, name="Supplier", vendor_code="SUP-BUD")

    def bill(number, amount, post):
        created = create_vendor_bill(institution=institution, actor=finance, vendor=vendor, bill_number=number, bill_date=date(2026, 1, 15),
                                     due_date=date(2026, 1, 30), currency="GHS", accounting_period=period,
                                     lines=[{"description": "Consulting", "expense_account": expense, "quantity": Decimal("1"), "unit_price": Decimal(amount)}])
        created = approve_vendor_bill(bill=submit_vendor_bill(bill=created, actor=finance), actor=finance)
        return post_vendor_bill(bill=created, actor=finance) if post else created

    bill("BUD-1", "300", post=True)
    bill("BUD-2", "50", post=False)
    return {"institution": institution, "finance": finance, "approver": approver, "expense": expense,
            "year": FiscalYear.objects.get(institution=institution, name="FY2026")}


def _client(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return api_client


def test_budget_actuals_committed_and_approval(api_client, budgeting):
    client = _client(api_client, budgeting["finance"], budgeting["institution"])
    created = client.post("/api/v1/budgets/", {
        "name": "FY2026 Operating Budget", "fiscal_year": str(budgeting["year"].id), "budget_type": "OPERATING",
        "lines": [{"category": "OPERATING", "account": str(budgeting["expense"].id), "description": "Professional fees", "initiative": "Audit readiness", "allocated": "1000.00"},
                  {"category": "TRAVEL", "description": "Conferences", "allocated": "200.00"}],
    }, format="json")
    assert created.status_code == 201, created.content
    budget = created.json()["data"]
    assert budget["code"].startswith("BUD-") and budget["totals"]["allocated"] == "1200.00"
    assert budget["totals"]["actual"] == "300.00" and budget["totals"]["committed"] == "50.00"
    assert budget["totals"]["remaining"] == "850.00"

    detail = client.get(f"/api/v1/budgets/{budget['id']}/detail_view/").json()["data"]
    operating = next(row for row in detail["categories"] if row["category"] == "OPERATING")
    assert operating["variance"] == "700.00" and detail["initiatives"][0]["initiative"] in {"Audit readiness", "Unassigned"}

    assert client.post(f"/api/v1/budgets/{budget['id']}/submit/").status_code == 200
    assert client.post(f"/api/v1/budgets/{budget['id']}/approve/").status_code == 400  # submitter cannot approve
    approver = _client(api_client, budgeting["approver"], budgeting["institution"])
    assert approver.post(f"/api/v1/budgets/{budget['id']}/return/", {"note": ""}, format="json").status_code == 400
    approved = approver.post(f"/api/v1/budgets/{budget['id']}/approve/", {"note": "Within envelope"}, format="json").json()["data"]
    assert approved["status"] == "APPROVED"

    edited = approver.patch(f"/api/v1/budgets/{budget['id']}/", {"description": "Revised"}, format="json").json()["data"]
    assert edited["status"] == "DRAFT" and edited["version"] == 2

    overview = client.get("/api/v1/budgets/overview/").json()["data"]
    assert overview["total_budgets"] == 1 and overview["folders"][0]["name"] == "Institution-wide"
    assert {row["category"] for row in overview["categories"]} == {"OPERATING", "TRAVEL"}


def test_budget_permissions_for_roles(budgeting):
    institution = budgeting["institution"]
    assert Role.objects.filter(institution=institution, code="DIRECTOR", permissions__code="budget.approve").exists()
    assert Role.objects.filter(institution=institution, code="ACCOUNTANT", permissions__code="budget.manage").exists()
    assert not Role.objects.filter(institution=institution, code="HR_ADMIN", permissions__code="budget.view").exists()
    assert Budget.objects.count() == 0
