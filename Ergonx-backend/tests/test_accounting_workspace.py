"""Accounting dashboard workspace, account activity and journal detail context (Finance concepts)."""
from datetime import date
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounting.models import JournalEntry
from apps.accounting.services import approve_journal, create_account, create_journal, post_journal, submit_journal
from tests.test_accounting import _actors, _enable_accounting, _foundation

pytestmark = pytest.mark.django_db


@pytest.fixture
def ledger(institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="LEDGER-WS")
    _enable_accounting(institution)
    accountant, finance, _ = _actors(institution, user_factory, membership_factory)
    _, period = _foundation(institution, finance)
    cash = create_account(institution=institution, actor=accountant, code="1000", name="Cash", account_type="ASSET", normal_balance="DEBIT")
    income = create_account(institution=institution, actor=accountant, code="4000", name="Income", account_type="INCOME", normal_balance="CREDIT")

    def journal(day, amount, post=True):
        entry = create_journal(
            institution=institution, actor=accountant, accounting_period=period, entry_date=date(2026, 9, day), description=f"Sale {day}",
            lines=[{"account": cash, "debit": Decimal(amount), "credit": Decimal("0")}, {"account": income, "debit": Decimal("0"), "credit": Decimal(amount)}],
        )
        if post:
            submit_journal(journal=entry, actor=accountant)
            approve_journal(journal=entry, actor=finance)
            post_journal(journal=entry, actor=finance)
        return entry

    posted = [journal(3, "100.00"), journal(10, "50.00")]
    draft = journal(12, "25.00", post=False)
    return {"institution": institution, "accountant": accountant, "finance": finance, "cash": cash, "posted": posted, "draft": draft}


def _client(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return api_client


def test_account_activity_and_balances(api_client, ledger):
    client = _client(api_client, ledger["accountant"], ledger["institution"])
    data = client.get(f"/api/v1/accounts/{ledger['cash'].id}/activity/", {"date_from": "2026-09-05"}).json()["data"]
    assert data["opening_balance"] == "100.00" and data["balance"] == "150.00"
    assert [row["debit"] for row in data["lines"]] == ["50.00", "25.00"]
    assert data["lines"][0]["running_balance"] == "150.00" and data["lines"][1]["running_balance"] is None
    assert data["unposted_lines"] == 1 and data["period_debits"] == "50.00"
    balances = client.get("/api/v1/accounts/balances/").json()["data"]
    assert balances[str(ledger["cash"].id)] == "150.00"
    filtered = client.get("/api/v1/journal-entries/", {"account": str(ledger["cash"].id), "status": "DRAFT"}).json()["data"]
    assert filtered["count"] == 1 and filtered["results"][0]["total_debit"] == "25.00"
    assert filtered["results"][0]["created_by_name"]


def test_journal_context_notes_and_attachments(api_client, ledger, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    client = _client(api_client, ledger["accountant"], ledger["institution"])
    journal = ledger["posted"][0]
    base = f"/api/v1/journal-entries/{journal.id}/"
    assert client.post(base + "notes/", {"body": ""}, format="json").status_code == 400
    assert client.post(base + "notes/", {"body": "Checked against till report."}, format="json").status_code == 201
    upload = client.post(base + "attachments/", {"uploaded_file": SimpleUploadedFile("till.pdf", b"%PDF-1.4", content_type="application/pdf")}, format="multipart")
    assert upload.status_code == 201, upload.content
    context = client.get(base + "context/").json()["data"]
    assert context["notes"][0]["body"] == "Checked against till report."
    assert context["attachments"][0]["original_filename"] == "till.pdf"
    assert {"accounting.journal.note_added", "accounting.journal.attachment_added"} <= {row["action"] for row in context["audit"]}
    download = client.get(base + f"attachments/{context['attachments'][0]['id']}/download/")
    assert download.status_code == 200


def test_finance_dashboard_workspace(api_client, ledger):
    client = _client(api_client, ledger["finance"], ledger["institution"])
    response = client.get("/api/v1/dashboards/finance/", {"months": 6})
    assert response.status_code == 200, response.content
    data = response.json()["data"]
    assert data["range_months"] == 6
    assert data["unposted_journals"] == 1
    assert data["recent_journals"][0]["journal_number"] == ledger["draft"].journal_number
    assert set(data["controls"]) == {"period_close", "segregation_of_duties", "audit_trail"}
    assert data["controls"]["segregation_of_duties"]["ok"] is True
    assert "current_period" in data["close_status"]
    ledger["draft"].refresh_from_db()
    assert ledger["draft"].status == JournalEntry.Status.DRAFT
