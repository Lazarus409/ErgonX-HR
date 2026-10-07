"""Cross-module approval inbox: collects what waits on the caller and points at each module's own endpoint."""
from datetime import date
from decimal import Decimal

import pytest

from apps.accounting.models import Account, FiscalYear
from apps.accounting.services import create_vendor, create_vendor_bill, submit_vendor_bill
from apps.leave.services import create_leave_request, submit_leave_request
from tests.test_accounts_payable import _accounting_foundation, _enable_accounting, _finance
from tests.test_leave import _employee_with_employment, _enable_leave, _leave_configuration

pytestmark = pytest.mark.django_db

URL = "/api/v1/approvals/inbox/"


def _api(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return api_client


def _inbox(api_client, user, institution):
    response = _api(api_client, user, institution).get(URL)
    assert response.status_code == 200, response.content
    return response.json()["data"]


@pytest.fixture
def leave_flow(institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory()
    _enable_leave(institution)
    hr = user_factory(email="hr.inbox@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    director = user_factory(email="director.inbox@example.com")
    membership_factory(user=director, institution=institution, role_code="DIRECTOR")
    staff = user_factory(email="staff.inbox@example.com")
    membership_factory(user=staff, institution=institution, role_code="EMPLOYEE")
    employee, _ = _employee_with_employment(
        institution, user=staff, employee_factory=employee_factory,
        organization_factory=organization_factory, assignment_dimensions_factory=assignment_dimensions_factory,
    )
    leave_type, _ = _leave_configuration(institution)
    request = create_leave_request(
        institution=institution, actor=staff, employee=employee, leave_type=leave_type,
        start_date=date(2026, 11, 2), end_date=date(2026, 11, 4), requested_days=Decimal("3"), reason="Trip",
    )
    request = submit_leave_request(leave_request=request, actor=staff)
    return {"institution": institution, "hr": hr, "director": director, "staff": staff, "request": request}


def test_leave_listed_only_for_current_step_owner_and_decided_through_module(api_client, leave_flow):
    institution = leave_flow["institution"]
    inbox = _inbox(api_client, leave_flow["hr"], institution)
    item = next(row for row in inbox["items"] if row["kind"] == "LEAVE_REQUEST")
    assert item["id"] == str(leave_flow["request"].id)
    assert item["route"] == f"/leave/requests/{leave_flow['request'].id}"
    assert {action["code"] for action in item["actions"]} == {"approve", "return", "reject"}
    assert inbox["summary"]["total"] >= 1 and {"module": "LEAVE", "count": 1} in inbox["summary"]["by_module"]

    # The director holds leave.approve but is not on this request's current step.
    assert not [row for row in _inbox(api_client, leave_flow["director"], institution)["items"] if row["kind"] == "LEAVE_REQUEST"]
    staff_inbox = _inbox(api_client, leave_flow["staff"], institution)
    assert staff_inbox["items"] == [] and staff_inbox["decisions"] == []

    approve = next(action for action in item["actions"] if action["code"] == "approve")
    decided = _api(api_client, leave_flow["hr"], institution).post(f"/api/v1{approve['path']}", {approve["comment_key"]: "Enjoy"}, format="json")
    assert decided.status_code == 200, decided.content

    after = _inbox(api_client, leave_flow["hr"], institution)
    assert not [row for row in after["items"] if row["id"] == item["id"] and row["kind"] == "LEAVE_REQUEST"]
    decision = after["decisions"][0]
    assert decision["kind"] == "LEAVE_REQUEST" and decision["is_mine"]
    assert decision["outcome"] in {"APPROVED", "FORWARDED"}


@pytest.fixture
def finance_flow(institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="INBOX-FIN", country_code="GH")
    _enable_accounting(institution)
    clerk = _finance(institution, user_factory, membership_factory, "inbox.clerk@example.com")
    approver = _finance(institution, user_factory, membership_factory, "inbox.approver@example.com")
    period, _, _ = _accounting_foundation(institution, clerk, "INBOX-FIN")
    expense = Account.objects.get(institution=institution, code="5000")
    vendor = create_vendor(institution=institution, actor=clerk, name="Inbox Supplier", vendor_code="SUP-INB")
    bill = create_vendor_bill(
        institution=institution, actor=clerk, vendor=vendor, bill_number="INB-1", bill_date=date(2026, 1, 15),
        due_date=date(2026, 1, 30), currency="GHS", accounting_period=period,
        lines=[{"description": "Consulting", "expense_account": expense, "quantity": Decimal("1"), "unit_price": Decimal("120")}],
    )
    bill = submit_vendor_bill(bill=bill, actor=clerk)
    return {"institution": institution, "clerk": clerk, "approver": approver, "bill": bill, "expense": expense,
            "year": FiscalYear.objects.get(institution=institution, name="FY2026")}


def test_accounting_items_and_submitter_is_blocked_on_budget(api_client, finance_flow):
    institution = finance_flow["institution"]
    client = _api(api_client, finance_flow["clerk"], institution)
    created = client.post("/api/v1/budgets/", {
        "name": "Inbox Budget", "fiscal_year": str(finance_flow["year"].id), "budget_type": "OPERATING",
        "lines": [{"category": "OPERATING", "account": str(finance_flow["expense"].id), "description": "Fees", "allocated": "500.00"}],
    }, format="json")
    assert created.status_code == 201, created.content
    budget_id = created.json()["data"]["id"]
    assert client.post(f"/api/v1/budgets/{budget_id}/submit/").status_code == 200

    clerk_budget = next(row for row in _inbox(api_client, finance_flow["clerk"], institution)["items"] if row["kind"] == "BUDGET")
    assert clerk_budget["actions"] == [] and "another approver" in clerk_budget["blocked_reason"]

    inbox = _inbox(api_client, finance_flow["approver"], institution)
    bill = next(row for row in inbox["items"] if row["kind"] == "VENDOR_BILL")
    assert bill["amount"] and bill["currency"] == "GHS" and bill["reference"] == "INB-1"
    reject = next(action for action in bill["actions"] if action["code"] == "reject")
    assert reject["comment_key"] == "reason" and reject["comment_required"]
    budget = next(row for row in inbox["items"] if row["kind"] == "BUDGET")
    ret = next(action for action in budget["actions"] if action["code"] == "return")
    returned = _api(api_client, finance_flow["approver"], institution).post(f"/api/v1{ret['path']}", {ret["comment_key"]: "Split fees by quarter"}, format="json")
    assert returned.status_code == 200, returned.content

    after = _inbox(api_client, finance_flow["approver"], institution)
    assert not [row for row in after["items"] if row["kind"] == "BUDGET"]
    assert after["decisions"][0]["kind"] == "BUDGET" and after["decisions"][0]["outcome"] == "RETURNED"
    assert after["decisions"][0]["route"] == f"/accounting/budgets/{budget_id}"
