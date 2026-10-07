"""Accounts receivable workspace: holds, sending, reminders, summary and invoice context (Finance concepts)."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core import mail
from django.core.exceptions import ValidationError

from apps.accounting.models import Account, Invoice
from apps.accounting.services import (
    add_invoice_reminder,
    create_customer,
    create_invoice,
    issue_invoice,
    send_invoice,
    set_invoice_hold,
)
from tests.test_accounts_payable import _accounting_foundation, _enable_accounting, _finance

pytestmark = pytest.mark.django_db


@pytest.fixture
def receivables(institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="AR-WS", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(institution, user_factory, membership_factory, "ar.ws@example.com")
    period, tax_code, _ = _accounting_foundation(institution, actor, "AR-WS")
    customer = create_customer(institution=institution, actor=actor, name="Client Ltd", customer_code="CLIENT", email="billing@client.example")
    income = Account.objects.get(institution=institution, code="4000")

    def invoice(number, due=date(2026, 1, 30)):
        return create_invoice(
            institution=institution, actor=actor, customer=customer, invoice_number=number, invoice_date=date(2026, 1, 15), due_date=due,
            currency="GHS", accounting_period=period,
            lines=[{"description": "Service", "income_account": income, "quantity": Decimal("1"), "unit_price": Decimal("100"), "tax_code": tax_code}],
        )

    return {"institution": institution, "actor": actor, "invoice": invoice}


def test_send_hold_and_reminders(receivables, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    actor = receivables["actor"]
    invoice, delivery = send_invoice(invoice=receivables["invoice"]("AR-WS-1"), actor=actor)
    assert invoice.status == Invoice.Status.ISSUED and delivery == "SENT"
    assert invoice.sent_to == "billing@client.example" and len(mail.outbox) == 1
    with pytest.raises(ValidationError):
        set_invoice_hold(invoice=invoice, actor=actor, on_hold=True, reason="")
    invoice = set_invoice_hold(invoice=invoice, actor=actor, on_hold=True, reason="Customer disputes quantity")
    assert invoice.on_hold and invoice.status == Invoice.Status.ISSUED
    reminder = add_invoice_reminder(invoice=invoice, actor=actor, remind_on=date(2026, 2, 5), channel="PHONE", note="Call AP desk")
    assert reminder.status == "SCHEDULED"
    with pytest.raises(ValidationError):
        add_invoice_reminder(invoice=receivables["invoice"]("AR-WS-DRAFT"), actor=actor, remind_on=date(2026, 2, 5), channel="EMAIL")


def test_summary_and_context_api(api_client, receivables):
    actor = receivables["actor"]
    overdue = issue_invoice(invoice=receivables["invoice"]("AR-WS-10"), actor=actor)
    receivables["invoice"]("AR-WS-11")
    api_client.force_authenticate(actor)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(receivables["institution"].id))
    summary = api_client.get("/api/v1/invoices/summary/", {"months": 12})
    assert summary.status_code == 200, summary.content
    data = summary.json()["data"]
    assert data["outstanding"]["count"] == 1 and data["overdue"]["count"] == 1
    assert data["exceptions"]["over_60_days"] == (1 if date.today() - date(2026, 1, 30) > timedelta(days=60) else 0)

    base = f"/api/v1/invoices/{overdue.id}/"
    listed = api_client.get("/api/v1/invoices/", {"status": "ISSUED"}).json()["data"]["results"][0]
    assert listed["customer_name"] == "Client Ltd" and listed["amount_due"] == str(overdue.total_amount)
    created = api_client.post(base + "reminders/", {"remind_on": "2026-02-10", "channel": "EMAIL", "note": "Second notice"}, format="json")
    assert created.status_code == 201, created.content
    reminder_id = created.json()["data"][0]["id"]
    done = api_client.post(base + f"reminders/{reminder_id}/", {"status": "DONE"}, format="json")
    assert done.json()["data"][0]["status"] == "DONE"
    context = api_client.get(base + "context/").json()["data"]
    assert context["customer"]["name"] == "Client Ltd" and context["collection"]["days_overdue"] > 0
    assert {"accounting.invoice.reminder_added", "accounting.invoice.reminder_done"} <= {row["action"] for row in context["audit"]}
