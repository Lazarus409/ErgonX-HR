from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest
from django.urls import reverse

from apps.accounting.services import (
    configure_accounting,
    create_account,
    create_accounting_period,
    create_fiscal_year,
    create_journal,
)
from apps.institutions.models import InstitutionModule


pytestmark = pytest.mark.django_db


def _enable_accounting(institution):
    module = institution.modules.get(module_code=InstitutionModule.ModuleCode.ACCOUNTING)
    module.is_enabled = True
    module.save(update_fields=("is_enabled", "updated_at"))


def _request(api_client, method, url, data):
    return getattr(api_client, method)(url, data=data, format="json")


def _assert_error(response, status, code):
    payload = response.json()
    assert response.status_code == status
    assert payload["success"] is False
    assert payload["data"] is None
    assert payload["code"] == code
    assert payload["message"]
    assert payload["errors"]


def _contract_operations(object_id=None):
    object_id = object_id or uuid4()
    return (
        ("get", reverse("v1:accounting-preset-list"), None),
        ("get", reverse("v1:accounting-preset-detail", args=(object_id,)), None),
        ("get", reverse("v1:accounting-preset-version-list"), None),
        ("get", reverse("v1:accounting-preset-version-detail", args=(object_id,)), None),
        ("post", reverse("v1:accounting-preset-version-apply", args=(object_id,)), {}),
        ("get", reverse("v1:ghana-localization-version-list"), None),
        ("get", reverse("v1:ghana-localization-version-detail", args=(object_id,)), None),
        ("get", reverse("v1:tax-code-list"), None),
        ("get", reverse("v1:tax-code-detail", args=(object_id,)), None),
        ("get", reverse("v1:tax-component-list"), None),
        ("get", reverse("v1:tax-component-detail", args=(object_id,)), None),
        ("get", reverse("v1:withholding-rule-list"), None),
        ("get", reverse("v1:withholding-rule-detail", args=(object_id,)), None),
        ("get", reverse("v1:vendor-list"), None),
        ("post", reverse("v1:vendor-list"), {}),
        ("get", reverse("v1:vendor-detail", args=(object_id,)), None),
        ("patch", reverse("v1:vendor-detail", args=(object_id,)), {}),
        ("get", reverse("v1:vendor-bill-list"), None),
        ("post", reverse("v1:vendor-bill-list"), {}),
        ("get", reverse("v1:vendor-bill-detail", args=(object_id,)), None),
        ("patch", reverse("v1:vendor-bill-detail", args=(object_id,)), {}),
        ("post", reverse("v1:vendor-bill-submit", args=(object_id,)), None),
        ("post", reverse("v1:vendor-bill-approve", args=(object_id,)), None),
        ("post", reverse("v1:vendor-bill-post", args=(object_id,)), None),
        ("post", reverse("v1:vendor-bill-void", args=(object_id,)), None),
        ("get", reverse("v1:customer-list"), None),
        ("post", reverse("v1:customer-list"), {}),
        ("get", reverse("v1:customer-detail", args=(object_id,)), None),
        ("patch", reverse("v1:customer-detail", args=(object_id,)), {}),
        ("get", reverse("v1:invoice-list"), None),
        ("post", reverse("v1:invoice-list"), {}),
        ("get", reverse("v1:invoice-detail", args=(object_id,)), None),
        ("patch", reverse("v1:invoice-detail", args=(object_id,)), {}),
        ("post", reverse("v1:invoice-issue", args=(object_id,)), None),
        ("post", reverse("v1:invoice-void", args=(object_id,)), None),
        ("get", reverse("v1:bank-account-list"), None),
        ("post", reverse("v1:bank-account-list"), {}),
        ("get", reverse("v1:bank-account-detail", args=(object_id,)), None),
        ("patch", reverse("v1:bank-account-detail", args=(object_id,)), {}),
        ("get", reverse("v1:payment-list"), None),
        ("post", reverse("v1:payment-list"), {}),
        ("get", reverse("v1:payment-detail", args=(object_id,)), None),
        ("post", reverse("v1:payment-void", args=(object_id,)), {}),
        ("get", reverse("v1:receipt-list"), None),
        ("post", reverse("v1:receipt-list"), {}),
        ("get", reverse("v1:receipt-detail", args=(object_id,)), None),
        ("post", reverse("v1:receipt-void", args=(object_id,)), {}),
        ("get", reverse("v1:expense-list"), None),
        ("post", reverse("v1:expense-list"), {}),
        ("get", reverse("v1:expense-detail", args=(object_id,)), None),
        ("patch", reverse("v1:expense-detail", args=(object_id,)), {}),
        ("post", reverse("v1:expense-submit", args=(object_id,)), {}),
        ("post", reverse("v1:expense-approve", args=(object_id,)), {}),
        ("post", reverse("v1:expense-reject", args=(object_id,)), {}),
        ("post", reverse("v1:expense-post", args=(object_id,)), {}),
        ("get", reverse("v1:chart-of-accounts-template-list"), None),
        ("get", reverse("v1:chart-of-accounts-template-detail", args=(object_id,)), None),
        ("get", reverse("v1:account-template-list"), None),
        ("get", reverse("v1:account-template-detail", args=(object_id,)), None),
        ("get", reverse("v1:accounting-configuration-list"), None),
        ("post", reverse("v1:accounting-configuration-list"), {}),
        ("get", reverse("v1:accounting-configuration-detail", args=(object_id,)), None),
        ("patch", reverse("v1:accounting-configuration-detail", args=(object_id,)), {}),
        ("get", reverse("v1:accounting-configuration-choices"), None),
        ("get", reverse("v1:account-list"), None),
        ("post", reverse("v1:account-list"), {}),
        ("get", reverse("v1:account-detail", args=(object_id,)), None),
        ("patch", reverse("v1:account-detail", args=(object_id,)), {}),
        ("get", reverse("v1:fiscal-year-list"), None),
        ("post", reverse("v1:fiscal-year-list"), {}),
        ("get", reverse("v1:fiscal-year-detail", args=(object_id,)), None),
        ("post", reverse("v1:fiscal-year-close", args=(object_id,)), None),
        ("get", reverse("v1:accounting-period-list"), None),
        ("post", reverse("v1:accounting-period-list"), {}),
        ("get", reverse("v1:accounting-period-detail", args=(object_id,)), None),
        ("post", reverse("v1:accounting-period-close", args=(object_id,)), None),
        ("post", reverse("v1:accounting-period-lock", args=(object_id,)), None),
        ("post", reverse("v1:accounting-period-reopen", args=(object_id,)), None),
        ("get", reverse("v1:journal-entry-list"), None),
        ("post", reverse("v1:journal-entry-list"), {}),
        ("get", reverse("v1:journal-entry-detail", args=(object_id,)), None),
        ("patch", reverse("v1:journal-entry-detail", args=(object_id,)), {}),
        ("post", reverse("v1:journal-entry-submit", args=(object_id,)), None),
        ("post", reverse("v1:journal-entry-approve", args=(object_id,)), None),
        ("post", reverse("v1:journal-entry-post", args=(object_id,)), None),
        ("post", reverse("v1:journal-entry-void", args=(object_id,)), None),
        ("post", reverse("v1:journal-entry-reverse", args=(object_id,)), {}),
        ("get", reverse("v1:journal-line-list"), None),
        ("get", reverse("v1:journal-line-detail", args=(object_id,)), None),
        ("get", reverse("v1:accounting-report-general-ledger"), None),
        ("get", reverse("v1:accounting-report-trial-balance"), None),
        ("get", reverse("v1:accounting-report-income-statement"), None),
        ("get", reverse("v1:accounting-report-balance-sheet"), None),
    )


def test_every_accounting_operation_requires_authentication(api_client):
    for method, url, data in _contract_operations():
        _assert_error(
            _request(api_client, method, url, data), 401, "authentication_required"
        )


def test_every_accounting_operation_requires_enabled_module(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="ACC-DISABLED")
    finance = user_factory(email="disabled-finance@example.com")
    membership_factory(
        user=finance,
        institution=institution,
        role_code="FINANCE_MANAGER",
        is_primary=True,
    )
    api_client.force_authenticate(finance)
    for method, url, data in _contract_operations():
        _assert_error(_request(api_client, method, url, data), 403, "module_disabled")


def test_every_accounting_operation_enforces_operation_permission(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="ACC-DENIED")
    _enable_accounting(institution)
    employee = user_factory(email="denied-employee@example.com")
    membership_factory(
        user=employee, institution=institution, role_code="EMPLOYEE", is_primary=True
    )
    api_client.force_authenticate(employee)
    # Staff claim their own expenses (expense.claim_own, Wave 6); those calls are
    # authorized and scoped in the service, so they are checked separately below.
    object_id = uuid4()
    self_service = {
        reverse("v1:expense-list"), reverse("v1:expense-detail", args=(object_id,)),
        reverse("v1:expense-submit", args=(object_id,)), reverse("v1:expense-approve", args=(object_id,)),
        reverse("v1:expense-reject", args=(object_id,)),
    }
    for method, url, data in _contract_operations(object_id):
        if url in self_service:
            continue
        _assert_error(_request(api_client, method, url, data), 403, "permission_denied")


def test_employees_reach_only_their_own_expense_claims(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="ACC-SELF")
    _enable_accounting(institution)
    employee = user_factory(email="self-claim@example.com")
    membership_factory(user=employee, institution=institution, role_code="EMPLOYEE", is_primary=True)
    api_client.force_authenticate(employee)
    listed = api_client.get(reverse("v1:expense-list"))
    assert listed.status_code == 200 and listed.data["results"] == []
    assert api_client.get(reverse("v1:expense-detail", args=(uuid4(),))).status_code == 404
    _assert_error(api_client.post(reverse("v1:expense-post", args=(uuid4(),)), {}, format="json"), 403, "permission_denied")


def test_accounting_detail_operations_hide_cross_tenant_resources(
    api_client, institution_factory, user_factory, membership_factory
):
    home = institution_factory(code="ACC-API-HOME")
    foreign = institution_factory(code="ACC-API-FOREIGN")
    _enable_accounting(home)
    _enable_accounting(foreign)
    home_finance = user_factory(email="home-finance@example.com")
    foreign_finance = user_factory(email="foreign-finance@example.com")
    membership_factory(
        user=home_finance,
        institution=home,
        role_code="FINANCE_MANAGER",
        is_primary=True,
    )
    membership_factory(
        user=foreign_finance,
        institution=foreign,
        role_code="FINANCE_MANAGER",
        is_primary=True,
    )
    configuration = configure_accounting(
        institution=foreign,
        actor=foreign_finance,
        country_code="GH",
        base_currency="GHS",
        accounting_setup_mode="CUSTOM",
        selected_accounting_preset_version=None,
        reporting_framework="IFRS",
        fiscal_year_start_month=1,
        is_configured=True,
    )
    fiscal_year = create_fiscal_year(
        institution=foreign,
        actor=foreign_finance,
        name="FY2026",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
    )
    period = create_accounting_period(
        institution=foreign,
        actor=foreign_finance,
        fiscal_year=fiscal_year,
        name="September",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
    )
    cash = create_account(
        institution=foreign,
        actor=foreign_finance,
        code="1000",
        name="Cash",
        account_type="ASSET",
        normal_balance="DEBIT",
    )
    journal = create_journal(
        institution=foreign,
        actor=foreign_finance,
        accounting_period=period,
        entry_date=date(2026, 9, 10),
        description="Foreign journal",
        lines=[{"account": cash, "debit": Decimal("1.00"), "credit": Decimal("0.00")}],
    )
    line = journal.lines.get()
    api_client.force_authenticate(home_finance)
    unknown_cash_record = uuid4()

    operations = (
        ("get", reverse("v1:accounting-configuration-detail", args=(configuration.id,)), None),
        ("patch", reverse("v1:accounting-configuration-detail", args=(configuration.id,)), {}),
        ("get", reverse("v1:account-detail", args=(cash.id,)), None),
        ("patch", reverse("v1:account-detail", args=(cash.id,)), {}),
        ("get", reverse("v1:fiscal-year-detail", args=(fiscal_year.id,)), None),
        ("post", reverse("v1:fiscal-year-close", args=(fiscal_year.id,)), None),
        ("get", reverse("v1:accounting-period-detail", args=(period.id,)), None),
        ("post", reverse("v1:accounting-period-close", args=(period.id,)), None),
        ("post", reverse("v1:accounting-period-lock", args=(period.id,)), None),
        ("post", reverse("v1:accounting-period-reopen", args=(period.id,)), None),
        ("get", reverse("v1:journal-entry-detail", args=(journal.id,)), None),
        ("patch", reverse("v1:journal-entry-detail", args=(journal.id,)), {}),
        ("post", reverse("v1:journal-entry-submit", args=(journal.id,)), None),
        ("post", reverse("v1:journal-entry-approve", args=(journal.id,)), None),
        ("post", reverse("v1:journal-entry-post", args=(journal.id,)), None),
        ("post", reverse("v1:journal-entry-void", args=(journal.id,)), None),
        ("post", reverse("v1:journal-entry-reverse", args=(journal.id,)), {}),
        ("get", reverse("v1:journal-line-detail", args=(line.id,)), None),
        ("get", reverse("v1:bank-account-detail", args=(unknown_cash_record,)), None),
        ("patch", reverse("v1:bank-account-detail", args=(unknown_cash_record,)), {}),
        ("get", reverse("v1:payment-detail", args=(unknown_cash_record,)), None),
        ("post", reverse("v1:payment-void", args=(unknown_cash_record,)), {}),
        ("get", reverse("v1:receipt-detail", args=(unknown_cash_record,)), None),
        ("post", reverse("v1:receipt-void", args=(unknown_cash_record,)), {}),
    )
    for method, url, data in operations:
        _assert_error(_request(api_client, method, url, data), 404, "not_found")

    for list_name in (
        "accounting-configuration-list",
        "account-list",
        "fiscal-year-list",
        "accounting-period-list",
        "journal-entry-list",
        "journal-line-list",
        "bank-account-list",
        "payment-list",
        "receipt-list",
        "expense-list",
    ):
        assert api_client.get(reverse(f"v1:{list_name}")).json()["data"]["count"] == 0
