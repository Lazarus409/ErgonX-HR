"""Wave 6: account provenance (BQ-09) and Expense Management 2.0 (BQ-02, BQ-03, BQ-04, FIN-03)."""

from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db.models import Sum

from apps.accounting.models import Account, Expense, ExpenseCategory, JournalEntry
from apps.accounting.services import (
    create_expense,
    decide_expense_step,
    finance_review_expense,
    post_expense,
    reverse_expense,
    settle_expense,
    submit_expense,
)
from apps.audit.models import AuditLog
from apps.documents.models import Document
from apps.employees.models import Employment
from apps.notifications.models import Notification
from apps.organization.models import Department, Grade, Location, Position
from apps.workflows.models import ApprovalWorkflowDefinition, ApprovalWorkflowStep
from common.exceptions import CodedValidationError
from tests.test_accounts_payable import _accounting_foundation, _enable_accounting, _finance

pytestmark = pytest.mark.django_db
DAY = date(2026, 1, 20)


@pytest.fixture
def org(institution_factory, user_factory, membership_factory, employee_factory):
    institution = institution_factory(code="EXP2", country_code="GH")
    _enable_accounting(institution)
    finance = _finance(institution, user_factory, membership_factory, "exp2.finance@example.com")
    poster = _finance(institution, user_factory, membership_factory, "exp2.poster@example.com")
    _accounting_foundation(institution, finance, "EXP2-GH")
    payable = Account.objects.create(institution=institution, code="2150", name="Employee reimbursements payable", account_type="LIABILITY", normal_balance="CREDIT", system_mapping_code="EMPLOYEE_PAYABLE")
    travel = Account.objects.create(institution=institution, code="5100", name="Travel", account_type="EXPENSE", normal_balance="DEBIT")
    category = ExpenseCategory.objects.create(institution=institution, code="TRAVEL", name="Travel", expense_account=travel, max_amount=Decimal("500"), receipt_required_over=Decimal("100"))

    department = Department.objects.create(institution=institution, name="Field", code="FLD")
    position = Position.objects.create(institution=institution, department=department, title="Officer", code="OFF")
    grade = Grade.objects.create(institution=institution, name="G", code="G1", level=1)
    location = Location.objects.create(institution=institution, name="Accra", code="ACC", timezone="Africa/Accra")

    def person(email, role, reports_to=None):
        user = user_factory(email=email)
        membership_factory(user=user, institution=institution, role_code=role, is_primary=True)
        employee = employee_factory(institution, user=user)
        employment = Employment.objects.create(institution=institution, employee=employee, department=department, position=position, grade=grade, location=location, start_date=date(2025, 1, 1), reports_to=reports_to, employment_type=Employment.EmploymentType.PERMANENT)
        return user, employee, employment

    manager, _, manager_employment = person("exp2.manager@example.com", "EMPLOYEE")
    claimant, claimant_employee, _ = person("exp2.claimant@example.com", "EMPLOYEE", reports_to=manager_employment)
    return {"institution": institution, "finance": finance, "poster": poster, "payable": payable, "travel": travel, "category": category,
            "manager": manager, "claimant": claimant, "employee": claimant_employee, "person": person}


def _receipt(org):
    return Document.objects.create(institution=org["institution"], uploaded_by=org["claimant"], original_filename="taxi.pdf", content_type="application/pdf", size_bytes=1200)


def _claim(org, amount="120.00", receipts=True, **values):
    lines = [{"category": org["category"], "expense_date": DAY, "description": "Taxi to client", "amount": Decimal(amount), "receipts": [_receipt(org)] if receipts else []}]
    return create_expense(institution=org["institution"], actor=org["claimant"], lines=lines, description="Client visit", **values)


# ---- account provenance ----------------------------------------------------------------------------


def test_preset_application_records_provenance_and_posting_survives_a_recode(org):
    cash = Account.objects.get(institution=org["institution"], system_mapping_code="CASH")
    assert cash.code == "1110"
    Account.objects.filter(pk=cash.pk).update(code="1199")  # renumbering no longer breaks posting
    from apps.accounting.services import _mapping_account

    assert _mapping_account(org["institution"], "CASH").pk == cash.pk
    with pytest.raises(CodedValidationError, match="No account is mapped to NOT_A_ROLE"):
        _mapping_account(org["institution"], "NOT_A_ROLE")


def test_a_mapping_code_belongs_to_one_account(org):
    duplicate = Account(institution=org["institution"], code="2151", name="Second payable", account_type="LIABILITY", normal_balance="CREDIT", system_mapping_code="EMPLOYEE_PAYABLE")
    with pytest.raises(ValidationError, match="already mapped"):
        duplicate.save()


# ---- claim lifecycle ---------------------------------------------------------------------------------


def test_claim_runs_manager_finance_post_and_settle(org):
    claim = _claim(org)
    assert claim.payment_method == Expense.PaymentMethod.REIMBURSABLE and claim.amount == Decimal("120.00")

    claim = submit_expense(expense=claim, actor=org["claimant"])
    assert claim.status == Expense.Status.PENDING
    assert list(claim.approvals.values_list("approver", flat=True)) == [org["manager"].id]
    with pytest.raises(CodedValidationError):
        decide_expense_step(expense=claim, actor=org["claimant"], decision="approve")

    claim = decide_expense_step(expense=claim, actor=org["manager"], decision="approve")
    assert claim.status == Expense.Status.FINANCE_REVIEW
    assert Notification.objects.filter(user=org["finance"], notification_type="EXPENSE_FINANCE_REVIEW").exists()

    line = claim.lines.get()
    claim = finance_review_expense(expense=claim, actor=org["finance"], decision="approve", recodes={str(line.id): str(org["travel"].id)})
    assert claim.status == Expense.Status.APPROVED

    claim = post_expense(expense=claim, actor=org["poster"])
    journal = claim.journal_entry
    assert claim.status == Expense.Status.POSTED and journal.source == JournalEntry.Source.EXPENSE
    assert journal.lines.get(account=org["payable"]).credit == Decimal("120.00")
    assert journal.lines.get(account=org["travel"]).debit == Decimal("120.00")

    cash = Account.objects.get(institution=org["institution"], system_mapping_code="CASH")
    claim = settle_expense(expense=claim, actor=org["finance"], settlement_account=cash, settlement_date=DAY, reference="TRF-001")
    assert claim.status == Expense.Status.SETTLED
    assert claim.settlement_journal.lines.aggregate(debit=Sum("debit"), credit=Sum("credit")) == {"debit": Decimal("120.00"), "credit": Decimal("120.00")}
    assert claim.settlement_journal.lines.get(account=org["payable"]).debit == Decimal("120.00")
    assert settle_expense(expense=claim, actor=org["finance"], settlement_account=cash).pk == claim.pk  # idempotent
    claim.description = "edit"
    with pytest.raises(ValidationError, match="immutable"):
        claim.save()
    assert AuditLog.objects.filter(entity_id=claim.id, action="accounting.expense.settled").count() == 1


def test_return_and_resubmit_then_reject(org):
    claim = submit_expense(expense=_claim(org), actor=org["claimant"])
    with pytest.raises(CodedValidationError, match="Explain"):
        decide_expense_step(expense=claim, actor=org["manager"], decision="return")
    claim = decide_expense_step(expense=claim, actor=org["manager"], decision="return", comment="Add the meeting name")
    assert claim.status == Expense.Status.RETURNED
    assert Notification.objects.filter(user=org["claimant"], notification_type="EXPENSE_RETURNED").exists()
    claim = submit_expense(expense=claim, actor=org["claimant"])
    assert claim.status == Expense.Status.PENDING and claim.approvals.filter(status="PENDING").count() == 1
    claim = decide_expense_step(expense=claim, actor=org["manager"], decision="reject", comment="Personal trip")
    assert claim.status == Expense.Status.REJECTED


def test_policy_failures_block_submission(org):
    with pytest.raises(CodedValidationError, match="Category limits"):
        submit_expense(expense=_claim(org, amount="900.00"), actor=org["claimant"])
    with pytest.raises(CodedValidationError, match="Receipts"):
        submit_expense(expense=_claim(org, amount="150.00", receipts=False), actor=org["claimant"])


def test_foreign_currency_is_refused_until_fx_exists(org):
    with pytest.raises(CodedValidationError, match="base currency"):
        _claim(org, currency="USD")


def test_without_a_manager_the_claim_goes_straight_to_finance(org):
    _, solo, _ = org["person"]("exp2.solo@example.com", "EMPLOYEE")
    claim = create_expense(institution=org["institution"], actor=solo.user, lines=[{"category": org["category"], "expense_date": DAY, "amount": Decimal("40")}], description="Parking")
    assert submit_expense(expense=claim, actor=solo.user).status == Expense.Status.FINANCE_REVIEW


def test_configured_expense_workflow_is_used(org):
    workflow = ApprovalWorkflowDefinition.objects.create(institution=org["institution"], code="EXP", name="Expense claims", trigger="EXPENSE_CLAIM")
    ApprovalWorkflowStep.objects.create(institution=org["institution"], workflow=workflow, order=1, name="Line manager", approver_type="REQUESTER_MANAGER")
    ApprovalWorkflowStep.objects.create(institution=org["institution"], workflow=workflow, order=2, name="Finance manager", approver_type="USER", approver_user=org["poster"])
    claim = submit_expense(expense=_claim(org), actor=org["claimant"])
    assert list(claim.approvals.order_by("sequence").values_list("approver", flat=True)) == [org["manager"].id, org["poster"].id]
    claim = decide_expense_step(expense=claim, actor=org["manager"], decision="approve")
    assert claim.status == Expense.Status.PENDING
    with pytest.raises(CodedValidationError):
        decide_expense_step(expense=claim, actor=org["manager"], decision="approve")
    assert decide_expense_step(expense=claim, actor=org["poster"], decision="approve").status == Expense.Status.FINANCE_REVIEW


def test_reversal_is_governed_and_terminal(org):
    claim = submit_expense(expense=_claim(org), actor=org["claimant"])
    claim = decide_expense_step(expense=claim, actor=org["manager"], decision="approve")
    claim = finance_review_expense(expense=claim, actor=org["finance"], decision="approve")
    claim = post_expense(expense=claim, actor=org["poster"])
    with pytest.raises(CodedValidationError, match="Explain"):
        reverse_expense(expense=claim, actor=org["finance"], reason=" ", reversal_date=DAY)
    claim = reverse_expense(expense=claim, actor=org["finance"], reason="Duplicate claim", reversal_date=DAY)
    assert claim.status == Expense.Status.REVERSED
    assert claim.reversal_journal.lines.get(account=org["payable"]).debit == Decimal("120.00")


def test_finance_cannot_review_their_own_claim(org, employee_factory):
    finance_employee = employee_factory(org["institution"], user=org["finance"])
    claim = create_expense(institution=org["institution"], actor=org["finance"], claimant=finance_employee, lines=[{"category": org["category"], "expense_date": DAY, "amount": Decimal("40")}], description="Parking")
    claim = submit_expense(expense=claim, actor=org["finance"])
    assert claim.status == Expense.Status.FINANCE_REVIEW
    with pytest.raises(CodedValidationError, match="claimed or created"):
        finance_review_expense(expense=claim, actor=org["finance"], decision="approve")


# ---- self-service API --------------------------------------------------------------------------------


def _client(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return api_client


def test_claimants_see_and_create_only_their_own_claims(api_client, org):
    institution = org["institution"]
    other_claim = create_expense(institution=institution, actor=org["manager"], lines=[{"category": org["category"], "expense_date": DAY, "amount": Decimal("30")}], description="Manager lunch")
    client = _client(api_client, org["claimant"], institution)

    categories = client.get("/api/v1/expense-categories/").json()["data"]["results"]
    assert [row["code"] for row in categories] == ["TRAVEL"]
    created = client.post("/api/v1/expenses/", {"description": "Client visit", "lines": [{"category": str(org["category"].id), "expense_date": "2026-01-20", "amount": "60.00"}]}, format="json")
    assert created.status_code == 201, created.content
    body = created.json()["data"]
    assert body["claimant"] == str(org["employee"].id) and body["amount"] == "60.00" and body["payment_method"] == "REIMBURSABLE"

    listed = {row["id"] for row in client.get("/api/v1/expenses/").json()["data"]["results"]}
    assert body["id"] in listed and str(other_claim.id) not in listed
    assert client.get(f"/api/v1/expenses/{other_claim.id}/").status_code == 404
    assert client.post(f"/api/v1/expenses/{body['id']}/finance-review/", {"decision": "approve"}, format="json").status_code == 403
    assert client.post(f"/api/v1/expenses/{body['id']}/submit/").status_code == 200
    checks = client.get(f"/api/v1/expenses/{body['id']}/policy-checks/").json()["data"]["checks"]
    assert {check["code"] for check in checks} >= {"currency", "category_limit", "receipts", "duplicates"}


def test_claimant_cannot_claim_for_someone_else(api_client, org):
    client = _client(api_client, org["claimant"], org["institution"])
    manager_employee = org["institution"].employees.get(user=org["manager"])
    response = client.post("/api/v1/expenses/", {"claimant": str(manager_employee.id), "description": "x", "lines": [{"category": str(org["category"].id), "amount": "10.00"}]}, format="json")
    assert response.status_code == 400


def test_manager_sees_the_claim_in_the_approvals_inbox(api_client, org):
    claim = submit_expense(expense=_claim(org), actor=org["claimant"])
    inbox = _client(api_client, org["manager"], org["institution"]).get("/api/v1/approvals/inbox/").json()["data"]
    row = next(item for item in inbox["items"] if item["id"] == str(claim.id))
    assert row["kind"] == "EXPENSE_CLAIM" and {action["code"] for action in row["actions"]} == {"approve", "return", "reject"}


def test_claimants_upload_receipts_but_not_other_documents(api_client, org, settings, tmp_path):
    from django.core.files.uploadedfile import SimpleUploadedFile

    settings.MEDIA_ROOT = tmp_path
    client = _client(api_client, org["claimant"], org["institution"])
    receipt = client.post("/api/v1/documents/", {"uploaded_file": SimpleUploadedFile("taxi.pdf", b"%PDF-1.4 receipt", content_type="application/pdf"), "category": "EXPENSE_RECEIPT", "classification": "CONFIDENTIAL"}, format="multipart")
    assert receipt.status_code == 201, receipt.content
    other = client.post("/api/v1/documents/", {"uploaded_file": SimpleUploadedFile("cv.pdf", b"%PDF-1.4 cv", content_type="application/pdf"), "category": "HR", "classification": "CONFIDENTIAL"}, format="multipart")
    assert other.status_code == 403
    receipt_id = receipt.json()["data"]["id"]
    assert client.get(f"/api/v1/documents/{receipt_id}/").status_code == 200
    manager_client = _client(api_client, org["manager"], org["institution"])
    assert manager_client.get(f"/api/v1/documents/{receipt_id}/").status_code == 404
