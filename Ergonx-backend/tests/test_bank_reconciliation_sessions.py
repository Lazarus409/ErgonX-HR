"""Bank reconciliation sessions: import, suggestions, match, exceptions, completion and report (Finance concepts)."""
from datetime import date
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounting.models import Account, Payment
from apps.accounting.services import (
    approve_vendor_bill,
    create_bank_account,
    create_payment,
    create_vendor,
    create_vendor_bill,
    post_vendor_bill,
    submit_vendor_bill,
)
from tests.test_accounts_payable import _accounting_foundation, _enable_accounting, _finance

pytestmark = pytest.mark.django_db


@pytest.fixture
def banking(institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="RECON-WS", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(institution, user_factory, membership_factory, "recon.ws@example.com")
    period, tax_code, _ = _accounting_foundation(institution, actor, "RECON-WS")
    bank = create_bank_account(institution=institution, actor=actor, name="Operating", bank_name="Example Bank", masked_account_number="****5678",
                               currency="GHS", ledger_account=Account.objects.get(institution=institution, code="1110"))
    vendor = create_vendor(institution=institution, actor=actor, name="Supplier", vendor_code="SUP-WS")
    bill = create_vendor_bill(
        institution=institution, actor=actor, vendor=vendor, bill_number="BILL-WS", bill_date=date(2026, 1, 15), due_date=date(2026, 1, 30),
        currency="GHS", accounting_period=period,
        lines=[{"description": "Service", "expense_account": Account.objects.get(institution=institution, code="5000"), "quantity": Decimal("1"), "unit_price": Decimal("100"), "tax_code": tax_code}],
    )
    bill = post_vendor_bill(bill=approve_vendor_bill(bill=submit_vendor_bill(bill=bill, actor=actor), actor=actor), actor=actor)
    payment = create_payment(institution=institution, actor=actor, payment_number="PAY-WS", payment_date=date(2026, 1, 20), amount=Decimal("40"),
                             currency="GHS", payment_method=Payment.Method.BANK_TRANSFER, bank_account=bank, vendor_bill=bill)
    return {"institution": institution, "actor": actor, "bank": bank, "payment": payment}


def test_session_workflow_api(api_client, banking):
    api_client.force_authenticate(banking["actor"])
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(banking["institution"].id))
    created = api_client.post("/api/v1/bank-reconciliations/", {"bank_account": str(banking["bank"].id), "period_start": "2026-01-01", "period_end": "2026-01-31"}, format="json")
    assert created.status_code == 201, created.content
    session_id = created.json()["data"]["session"]["id"]
    base = f"/api/v1/bank-reconciliations/{session_id}/"

    csv = b"date,description,reference,amount\n2026-01-20,Supplier payment,PAY-WS,-40.00\n2026-01-25,Bank charges,CHG,-5.00\nbad,row,,x\n"
    imported = api_client.post(base + "import/", {"file": SimpleUploadedFile("statement.csv", csv, content_type="text/csv")}, format="multipart")
    assert imported.status_code == 200, imported.content
    data = imported.json()["data"]
    assert data["import_result"]["created"] == 2 and len(data["import_result"]["errors"]) == 1
    assert data["counts"] == {"all": 2, "matched": 0, "unmatched": 2, "exceptions": 0}
    payment_line = next(row for row in data["lines"] if row["reference"] == "PAY-WS")
    charge_line = next(row for row in data["lines"] if row["reference"] == "CHG")
    assert payment_line["suggestion_count"] == 1

    suggestions = api_client.get(base + f"lines/{payment_line['id']}/suggestions/").json()["data"]
    assert suggestions[0]["id"] == str(banking["payment"].journal_entry_id)
    matched = api_client.post(base + f"lines/{payment_line['id']}/match/", {"journal_entry": suggestions[0]["id"]}, format="json").json()["data"]
    assert matched["counts"]["matched"] == 1 and matched["progress"] == 50
    assert api_client.post(base + f"lines/{charge_line['id']}/flag/", {"note": ""}, format="json").status_code == 400
    flagged = api_client.post(base + f"lines/{charge_line['id']}/flag/", {"note": "Bank charge to be journalled"}, format="json").json()["data"]
    assert flagged["counts"]["exceptions"] == 1

    # Book balance on the bank ledger is -40 (the payment); statement closing is set to match.
    assert api_client.post(base + "complete/").status_code == 400
    patched = api_client.patch(base, {"statement_closing_balance": "-40.00"}, format="json").json()["data"]
    assert patched["difference"] == "0.00" and patched["can_complete"] is True
    completed = api_client.post(base + "complete/").json()["data"]
    assert completed["session"]["status"] == "COMPLETED"

    accounts = api_client.get("/api/v1/bank-reconciliations/accounts/").json()["data"]
    assert accounts[0]["latest_session"]["status"] == "COMPLETED"
    report = api_client.get(base + "report/")
    assert report.status_code == 200 and b"Bank charge to be journalled" in report.content
