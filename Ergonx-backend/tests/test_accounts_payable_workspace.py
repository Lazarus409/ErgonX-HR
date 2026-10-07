"""Accounts payable workspace: reject/revise, hold, payment scheduling, summary and bill context (Finance concepts)."""
from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounting.models import Account, VendorBill
from apps.accounting.services import (
    approve_vendor_bill,
    create_vendor,
    create_vendor_bill,
    post_vendor_bill,
    reject_vendor_bill,
    revise_vendor_bill,
    schedule_vendor_bill_payment,
    set_vendor_bill_hold,
    submit_vendor_bill,
)
from tests.test_accounts_payable import _accounting_foundation, _enable_accounting, _finance

pytestmark = pytest.mark.django_db


@pytest.fixture
def payables(institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="AP-WS", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(institution, user_factory, membership_factory)
    period, tax_code, _ = _accounting_foundation(institution, actor, code="AP-WS")
    vendor = create_vendor(institution=institution, actor=actor, name="Acme Services", vendor_code="ACME", country_code="GH", tax_residency="RESIDENT")
    expense = Account.objects.get(institution=institution, code="5000")

    def bill(number):
        return create_vendor_bill(
            institution=institution, actor=actor, vendor=vendor, bill_number=number, bill_date=date(2026, 1, 15), due_date=date(2026, 1, 30),
            currency="GHS", accounting_period=period,
            lines=[{"description": "Consulting", "expense_account": expense, "quantity": Decimal("1"), "unit_price": Decimal("100"), "tax_code": tax_code}],
        )

    return {"institution": institution, "actor": actor, "bill": bill}


def test_reject_revise_hold_and_schedule(payables):
    actor = payables["actor"]
    bill = submit_vendor_bill(bill=payables["bill"]("WS-001"), actor=actor)
    assert bill.submitted_by == actor and bill.submitted_at
    with pytest.raises(ValidationError):
        reject_vendor_bill(bill=bill, actor=actor, reason="")
    bill = reject_vendor_bill(bill=bill, actor=actor, reason="Wrong amount")
    assert bill.status == VendorBill.Status.REJECTED and bill.rejection_reason == "Wrong amount"
    bill = revise_vendor_bill(bill=bill, actor=actor)
    bill = submit_vendor_bill(bill=bill, actor=actor)
    assert bill.rejection_reason == ""

    bill = set_vendor_bill_hold(bill=bill, actor=actor, on_hold=True, reason="Awaiting delivery note")
    with pytest.raises(ValidationError):
        approve_vendor_bill(bill=bill, actor=actor)
    bill = set_vendor_bill_hold(bill=bill, actor=actor, on_hold=False)
    bill = approve_vendor_bill(bill=bill, actor=actor)
    assert bill.approved_by == actor
    with pytest.raises(ValidationError):
        schedule_vendor_bill_payment(bill=bill, actor=actor, payment_date=date(2026, 2, 5), payment_method="BANK_TRANSFER")
    bill = post_vendor_bill(bill=bill, actor=actor)
    bill = schedule_vendor_bill_payment(bill=bill, actor=actor, payment_date=date(2026, 2, 5), payment_method="BANK_TRANSFER")
    assert bill.scheduled_payment_date == date(2026, 2, 5)


def test_summary_context_and_attachments_api(api_client, payables, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    actor = payables["actor"]
    submit_vendor_bill(bill=payables["bill"]("WS-010"), actor=actor)
    held = submit_vendor_bill(bill=payables["bill"]("WS-011"), actor=actor)
    set_vendor_bill_hold(bill=held, actor=actor, on_hold=True, reason="Query")
    api_client.force_authenticate(actor)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(payables["institution"].id))

    summary = api_client.get("/api/v1/vendor-bills/summary/", {"months": 12})
    assert summary.status_code == 200, summary.content
    data = summary.json()["data"]
    assert data["approval_queue_total"] == 2 and data["active_vendors"] == 1
    assert data["approval_queue"][0]["bill_number"] == "WS-010"

    listed = api_client.get("/api/v1/vendor-bills/", {"on_hold": "true"}).json()["data"]
    assert [row["bill_number"] for row in listed["results"]] == ["WS-011"]
    assert listed["results"][0]["vendor_name"] == "Acme Services" and listed["results"][0]["submitted_by_name"]

    base = f"/api/v1/vendor-bills/{held.id}/"
    assert api_client.post(base + "reject/", {"reason": "Duplicate"}, format="json").status_code == 200
    upload = api_client.post(base + "attachments/", {"uploaded_file": SimpleUploadedFile("invoice.pdf", b"%PDF-1.4")}, format="multipart")
    assert upload.status_code == 201, upload.content
    context = api_client.get(base + "context/").json()["data"]
    assert context["vendor"]["name"] == "Acme Services"
    assert context["attachments"][0]["original_filename"] == "invoice.pdf"
    assert {"accounting.vendor_bill.held", "accounting.vendor_bill.rejected"} <= {row["action"] for row in context["audit"]}
