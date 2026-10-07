from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.urls import reverse
from drf_spectacular.generators import SchemaGenerator

from apps.accounting.models import (
    Account,
    AccountingPeriod,
    FiscalYear,
    InstitutionAccountingConfiguration,
    JournalEntry,
    JournalLine,
)
from apps.accounting.services import (
    close_fiscal_year,
    configure_accounting,
    create_account,
    create_accounting_period,
    create_fiscal_year,
    create_journal,
    post_journal,
    set_period_status,
    void_journal,
)
from apps.audit.models import AuditLog
from apps.institutions.models import InstitutionModule, Permission


pytestmark = pytest.mark.django_db


def _enable_accounting(institution):
    module = institution.modules.get(module_code=InstitutionModule.ModuleCode.ACCOUNTING)
    module.is_enabled = True
    module.save(update_fields=("is_enabled", "updated_at"))


def _actors(institution, user_factory, membership_factory):
    accountant = user_factory(email="accountant@example.com")
    finance = user_factory(email="finance@example.com")
    employee = user_factory(email="non-finance@example.com")
    membership_factory(
        user=accountant,
        institution=institution,
        role_code="ACCOUNTANT",
        is_primary=True,
    )
    membership_factory(
        user=finance,
        institution=institution,
        role_code="FINANCE_MANAGER",
        is_primary=True,
    )
    membership_factory(
        user=employee,
        institution=institution,
        role_code="EMPLOYEE",
        is_primary=True,
    )
    return accountant, finance, employee


def _foundation(institution, finance):
    configure_accounting(
        institution=institution,
        actor=finance,
        country_code="GH",
        base_currency="GHS",
        accounting_setup_mode="CUSTOM",
        selected_accounting_preset_version=None,
        reporting_framework="IFRS",
        fiscal_year_start_month=1,
        is_configured=True,
    )
    fiscal_year = create_fiscal_year(
        institution=institution,
        actor=finance,
        name="FY2026",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
    )
    period = create_accounting_period(
        institution=institution,
        actor=finance,
        fiscal_year=fiscal_year,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
    )
    return fiscal_year, period


def test_accounting_module_bootstrap_and_finance_role_separation(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory()
    accountant, finance, employee = _actors(
        institution, user_factory, membership_factory
    )
    module = institution.modules.get(module_code="ACCOUNTING")
    assert module.is_enabled is False
    assert Permission.objects.get(code="journal.post").module_code == "ACCOUNTING"
    assert accountant.memberships.get().role.permissions.filter(
        code="journal.create"
    ).exists()
    assert finance.memberships.get().role.permissions.filter(code="journal.post").exists()
    assert not employee.memberships.get().role.permissions.filter(code="account.view").exists()
    assert not institution.roles.get(code="HR_ADMIN").permissions.filter(
        code="account.view"
    ).exists()

    api_client.force_authenticate(accountant)
    disabled = api_client.get(reverse("v1:account-list"))
    assert disabled.status_code == 403
    assert disabled.json()["code"] == "module_disabled"
    _enable_accounting(institution)
    assert api_client.get(reverse("v1:account-list")).status_code == 200
    api_client.force_authenticate(employee)
    denied = api_client.get(reverse("v1:account-list"))
    assert denied.status_code == 403
    assert denied.json()["code"] == "permission_denied"


def test_accounting_configuration_chart_and_period_api_contract(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(country_code="GH", default_currency="GHS")
    _enable_accounting(institution)
    accountant, finance, _ = _actors(institution, user_factory, membership_factory)
    api_client.force_authenticate(finance)

    choices = api_client.get(reverse("v1:accounting-configuration-choices"))
    assert choices.status_code == 200
    assert choices.json()["data"]["choices"][-1]["mode"] == "CUSTOM"
    configured = api_client.post(
        reverse("v1:accounting-configuration-list"),
        {
            "country_code": "GH",
            "base_currency": "GHS",
            "accounting_setup_mode": "CUSTOM",
            "selected_accounting_preset_version": None,
            "reporting_framework": "IFRS",
            "fiscal_year_start_month": 1,
            "is_configured": True,
        },
        format="json",
    )
    assert configured.status_code == 201
    assert InstitutionAccountingConfiguration.objects.get(
        institution=institution
    ).base_currency == "GHS"

    fiscal_year = api_client.post(
        reverse("v1:fiscal-year-list"),
        {"name": "FY2026", "start_date": "2026-01-01", "end_date": "2026-12-31"},
        format="json",
    )
    assert fiscal_year.status_code == 201
    period = api_client.post(
        reverse("v1:accounting-period-list"),
        {
            "fiscal_year": fiscal_year.data["id"],
            "name": "September",
            "start_date": "2026-09-01",
            "end_date": "2026-09-30",
        },
        format="json",
    )
    assert period.status_code == 201

    api_client.force_authenticate(accountant)
    account = api_client.post(
        reverse("v1:account-list"),
        {
            "code": "1000",
            "name": "Cash",
            "account_type": "ASSET",
            "normal_balance": "DEBIT",
            "is_postable": True,
            "is_active": True,
        },
        format="json",
    )
    assert account.status_code == 201
    listing = api_client.get(reverse("v1:account-list"), {"account_type": "ASSET"})
    assert listing.json()["data"]["count"] == 1


def test_journal_lifecycle_reports_reversal_and_immutability(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="LEDGER")
    _enable_accounting(institution)
    accountant, finance, _ = _actors(institution, user_factory, membership_factory)
    _, period = _foundation(institution, finance)
    cash = create_account(
        institution=institution,
        actor=accountant,
        code="1000",
        name="Cash",
        account_type=Account.AccountType.ASSET,
        normal_balance=Account.NormalBalance.DEBIT,
    )
    income = create_account(
        institution=institution,
        actor=accountant,
        code="4000",
        name="Service Income",
        account_type=Account.AccountType.INCOME,
        normal_balance=Account.NormalBalance.CREDIT,
    )
    api_client.force_authenticate(accountant)
    created = api_client.post(
        reverse("v1:journal-entry-list"),
        {
            "accounting_period": str(period.id),
            "entry_date": "2026-09-10",
            "description": "Cash sale",
            "reference": "SALE-001",
            "lines": [
                {"account": str(cash.id), "debit": "100.00", "credit": "0.00"},
                {"account": str(income.id), "debit": "0.00", "credit": "100.00"},
            ],
        },
        format="json",
    )
    assert created.status_code == 201
    journal = JournalEntry.objects.get(pk=created.data["id"])
    assert journal.journal_number == "JE-2026-000001"
    submit_url = reverse("v1:journal-entry-submit", args=(journal.id,))
    assert api_client.post(submit_url).status_code == 200
    assert api_client.post(submit_url).status_code == 200

    api_client.force_authenticate(finance)
    approve_url = reverse("v1:journal-entry-approve", args=(journal.id,))
    post_url = reverse("v1:journal-entry-post", args=(journal.id,))
    assert api_client.post(approve_url).status_code == 200
    assert api_client.post(approve_url).status_code == 200
    assert api_client.post(post_url).status_code == 200
    assert api_client.post(post_url).status_code == 200
    journal.refresh_from_db()
    assert journal.status == JournalEntry.Status.POSTED
    assert AuditLog.objects.filter(action="accounting.journal.posted", entity_id=journal.id).count() == 1

    api_client.force_authenticate(accountant)
    trial = api_client.get(reverse("v1:accounting-report-trial-balance")).json()["data"]
    assert trial["total_debit"] == "100.00"
    assert trial["total_credit"] == "100.00"
    assert trial["balanced"] is True
    statement = api_client.get(reverse("v1:accounting-report-income-statement")).json()["data"]
    assert statement["net_income"] == "100.00"
    ledger = api_client.get(
        reverse("v1:accounting-report-general-ledger"), {"account": str(cash.id)}
    ).json()["data"]
    assert ledger["opening_balance"] == "0.00"
    assert ledger["closing_balance"] == "100.00"
    brought_forward = api_client.get(
        reverse("v1:accounting-report-general-ledger"),
        {"account": str(cash.id), "date_from": "2026-09-11"},
    ).json()["data"]
    assert brought_forward["opening_balance"] == "100.00"
    assert brought_forward["closing_balance"] == "100.00"
    assert brought_forward["entries"] == []

    with pytest.raises(ValidationError, match="immutable"):
        journal.lines.first().delete()
    journal.description = "Mutated"
    with pytest.raises(ValidationError, match="immutable"):
        journal.save()

    api_client.force_authenticate(finance)
    reversal_response = api_client.post(
        reverse("v1:journal-entry-reverse", args=(journal.id,)),
        {
            "accounting_period": str(period.id),
            "entry_date": "2026-09-20",
            "description": "Reverse cash sale",
        },
        format="json",
    )
    assert reversal_response.status_code == 200
    reversal = JournalEntry.objects.get(pk=reversal_response.data["id"])
    assert api_client.post(
        reverse("v1:journal-entry-submit", args=(reversal.id,))
    ).status_code == 200
    # Separation of duties (BQ-04): whoever created the reversal cannot approve it.
    assert api_client.post(reverse("v1:journal-entry-approve", args=(reversal.id,))).status_code == 400
    controller = user_factory(email="controller@example.com")
    membership_factory(user=controller, institution=institution, role_code="INSTITUTION_ADMIN")
    api_client.force_authenticate(controller)
    assert api_client.post(
        reverse("v1:journal-entry-approve", args=(reversal.id,))
    ).status_code == 200
    api_client.force_authenticate(finance)
    assert api_client.post(reverse("v1:journal-entry-post", args=(reversal.id,))).status_code == 200
    journal.refresh_from_db()
    assert journal.status == JournalEntry.Status.REVERSED
    api_client.force_authenticate(accountant)
    reversed_trial = api_client.get(reverse("v1:accounting-report-trial-balance")).json()["data"]
    assert reversed_trial["total_debit"] == "200.00"
    assert reversed_trial["total_credit"] == "200.00"
    assert all(
        Decimal(row["debit"]) == Decimal(row["credit"])
        for row in reversed_trial["rows"]
    )


def test_unbalanced_and_closed_period_journals_fail_closed(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="LOCKS")
    _enable_accounting(institution)
    accountant, finance, _ = _actors(institution, user_factory, membership_factory)
    _, period = _foundation(institution, finance)
    cash = create_account(
        institution=institution,
        actor=accountant,
        code="1000",
        name="Cash",
        account_type="ASSET",
        normal_balance="DEBIT",
    )
    income = create_account(
        institution=institution,
        actor=accountant,
        code="4000",
        name="Income",
        account_type="INCOME",
        normal_balance="CREDIT",
    )
    unbalanced = create_journal(
        institution=institution,
        actor=accountant,
        accounting_period=period,
        entry_date=date(2026, 9, 5),
        description="Unbalanced",
        lines=[{"account": cash, "debit": Decimal("10.00"), "credit": Decimal("0.00")}],
    )
    api_client.force_authenticate(accountant)
    response = api_client.post(reverse("v1:journal-entry-submit", args=(unbalanced.id,)))
    assert response.status_code == 400
    assert response.json()["code"] == "unbalanced_journal"

    unbalanced.delete()
    balanced = create_journal(
        institution=institution,
        actor=accountant,
        accounting_period=period,
        entry_date=date(2026, 9, 6),
        description="Balanced",
        lines=[
            {"account": cash, "debit": Decimal("10.00"), "credit": Decimal("0.00")},
            {"account": income, "debit": Decimal("0.00"), "credit": Decimal("10.00")},
        ],
    )
    balanced.status = JournalEntry.Status.APPROVED
    balanced.approved_by = finance
    balanced.save(update_fields=("status", "approved_by", "updated_at"))
    with pytest.raises(ValidationError, match="unposted"):
        set_period_status(period=period, actor=finance, status=AccountingPeriod.Status.CLOSED)
    AccountingPeriod.objects.filter(pk=period.pk).update(status=AccountingPeriod.Status.CLOSED)
    with pytest.raises(ValidationError):
        post_journal(journal=balanced, actor=finance)


def test_accounting_tenant_relations_and_api_objects_are_isolated(
    api_client, institution_factory, user_factory, membership_factory
):
    home = institution_factory(code="ACC-HOME")
    foreign = institution_factory(code="ACC-FOREIGN")
    _enable_accounting(home)
    _enable_accounting(foreign)
    home_accountant, _, _ = _actors(home, user_factory, membership_factory)
    foreign_account = Account.objects.create(
        institution=foreign,
        code="1000",
        name="Foreign cash",
        account_type="ASSET",
        normal_balance="DEBIT",
    )
    with pytest.raises(ValidationError, match="another institution"):
        Account.objects.create(
            institution=home,
            code="1100",
            name="Invalid child",
            account_type="ASSET",
            normal_balance="DEBIT",
            parent=foreign_account,
        )

    api_client.force_authenticate(home_accountant)
    hidden = api_client.get(reverse("v1:account-detail", args=(foreign_account.id,)))
    assert hidden.status_code == 404
    assert hidden.json()["code"] == "not_found"
    assert api_client.get(reverse("v1:account-list")).json()["data"]["count"] == 0


def test_period_overlap_voiding_and_fiscal_year_close_controls(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="ACC-CLOSE")
    _enable_accounting(institution)
    accountant, finance, _ = _actors(institution, user_factory, membership_factory)
    fiscal_year, period = _foundation(institution, finance)

    with pytest.raises(ValidationError, match="Fiscal years cannot overlap"):
        create_fiscal_year(
            institution=institution,
            actor=finance,
            name="Overlapping FY",
            start_date=date(2026, 12, 1),
            end_date=date(2027, 11, 30),
        )
    with pytest.raises(ValidationError, match="Accounting periods cannot overlap"):
        create_accounting_period(
            institution=institution,
            actor=finance,
            fiscal_year=fiscal_year,
            name="September overlap",
            start_date=date(2026, 9, 15),
            end_date=date(2026, 10, 15),
        )

    cash = create_account(
        institution=institution,
        actor=accountant,
        code="1000",
        name="Cash",
        account_type="ASSET",
        normal_balance="DEBIT",
    )
    journal = create_journal(
        institution=institution,
        actor=accountant,
        accounting_period=period,
        entry_date=date(2026, 9, 10),
        description="Abandoned draft",
        lines=[{"account": cash, "debit": Decimal("1.00"), "credit": Decimal("0.00")}],
    )
    void_journal(journal=journal, actor=accountant)
    void_journal(journal=journal, actor=accountant)
    journal.refresh_from_db()
    assert journal.status == JournalEntry.Status.VOID
    assert AuditLog.objects.filter(
        action="accounting.journal.voided", entity_id=journal.id
    ).count() == 1

    with pytest.raises(ValidationError, match="every accounting period"):
        close_fiscal_year(fiscal_year=fiscal_year, actor=finance)
    set_period_status(period=period, actor=finance, status=AccountingPeriod.Status.CLOSED)
    close_fiscal_year(fiscal_year=fiscal_year, actor=finance)
    close_fiscal_year(fiscal_year=fiscal_year, actor=finance)
    fiscal_year.refresh_from_db()
    assert fiscal_year.status == FiscalYear.Status.CLOSED
    assert AuditLog.objects.filter(
        action="accounting.fiscal_year.closed", entity_id=fiscal_year.id
    ).count() == 1


def test_accounting_report_query_validation_is_explicit_and_tenant_safe(
    api_client, institution_factory, user_factory, membership_factory
):
    home = institution_factory(code="REPORT-HOME")
    foreign = institution_factory(code="REPORT-FOREIGN")
    _enable_accounting(home)
    _enable_accounting(foreign)
    accountant, _, _ = _actors(home, user_factory, membership_factory)
    foreign_account = Account.objects.create(
        institution=foreign,
        code="1000",
        name="Foreign cash",
        account_type="ASSET",
        normal_balance="DEBIT",
    )
    api_client.force_authenticate(accountant)

    missing = api_client.get(reverse("v1:accounting-report-general-ledger"))
    assert missing.status_code == 400
    assert missing.json()["code"] == "validation_error"
    malformed = api_client.get(
        reverse("v1:accounting-report-trial-balance"), {"date_from": "not-a-date"}
    )
    assert malformed.status_code == 400
    assert malformed.json()["code"] == "validation_error"
    backwards = api_client.get(
        reverse("v1:accounting-report-income-statement"),
        {"date_from": "2026-10-01", "date_to": "2026-09-01"},
    )
    assert backwards.status_code == 400
    assert backwards.json()["code"] == "validation_error"
    hidden = api_client.get(
        reverse("v1:accounting-report-general-ledger"),
        {"account": str(foreign_account.id)},
    )
    assert hidden.status_code == 404
    assert hidden.json()["code"] == "not_found"


def test_accounting_openapi_is_operation_level_and_matches_action_shapes():
    schema = SchemaGenerator().get_schema(request=None, public=True)
    prefixes = (
        "/api/v1/accounting-",
        "/api/v1/accounts/",
        "/api/v1/account-templates/",
        "/api/v1/chart-of-accounts-templates/",
        "/api/v1/fiscal-years/",
        "/api/v1/ghana-localization-versions/",
        "/api/v1/journal-",
        "/api/v1/tax-codes/",
        "/api/v1/tax-components/",
        "/api/v1/withholding-rules/",
        "/api/v1/vendors/",
        "/api/v1/vendor-bills/",
        "/api/v1/customers/",
        "/api/v1/invoices/",
        "/api/v1/bank-accounts/",
        "/api/v1/payments/",
        "/api/v1/receipts/",
        "/api/v1/expenses/",
    )
    operations = []
    for path, path_item in schema["paths"].items():
        if not path.startswith(prefixes):
            continue
        for method, operation in path_item.items():
            if method in {"get", "post", "patch"}:
                operations.append((path, method, operation))
                assert operation["summary"]
                assert "`ACCOUNTING` module enabled" in operation["description"]
                assert "permission" in operation["description"]
                assert operation["x-error-codes"]
    # +6: account balances/activity, journal context/notes/attachments/attachment download.
    # +9: vendor bill reject/revise/hold/release/schedule-payment/context/summary/attachments/download.
    # +10: invoice hold/release/send/reminders (get+post)/reminder update/context/summary/attachments/download.
    # +5: expense claim return/finance-review/settle/reverse/policy-checks (Wave 6).
    assert len(operations) == 126

    for action_name in ("submit", "approve", "post", "void"):
        operation = schema["paths"][
            f"/api/v1/journal-entries/{{id}}/{action_name}/"
        ]["post"]
        assert "requestBody" not in operation
    reverse_operation = schema["paths"][
        "/api/v1/journal-entries/{id}/reverse/"
    ]["post"]
    assert reverse_operation["requestBody"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/JournalReversal"}

    ledger = schema["paths"]["/api/v1/accounting-reports/general-ledger/"]["get"]
    parameters = {parameter["name"]: parameter for parameter in ledger["parameters"]}
    assert parameters["account"]["required"] is True
    assert set(parameters) == {"account", "date_from", "date_to"}
    assert {"400", "404"}.issubset(ledger["responses"])

    apply_preset = schema["paths"][
        "/api/v1/accounting-preset-versions/{id}/apply/"
    ]["post"]
    assert apply_preset["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/AccountingPresetApplication"
    }
    assert apply_preset["responses"]["200"]["content"]["application/json"][
        "schema"
    ]["properties"]["data"] == {
        "$ref": "#/components/schemas/AccountingPresetApplicationResult"
    }
    assert "duplicate_operation" in apply_preset["x-error-codes"]


@pytest.mark.postgresql
def test_postgresql_enforces_journal_line_and_reversal_constraints(
    institution_factory, user_factory, membership_factory
):
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL-specific accounting constraint coverage")
    institution = institution_factory(code="ACC-PG")
    _enable_accounting(institution)
    accountant, finance, _ = _actors(institution, user_factory, membership_factory)
    _, period = _foundation(institution, finance)
    cash = create_account(
        institution=institution,
        actor=accountant,
        code="1000",
        name="Cash",
        account_type="ASSET",
        normal_balance="DEBIT",
    )
    original = create_journal(
        institution=institution,
        actor=accountant,
        accounting_period=period,
        entry_date=date(2026, 9, 10),
        description="Constraint source",
        lines=[{"account": cash, "debit": Decimal("1.00"), "credit": Decimal("0.00")}],
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        JournalLine.objects.bulk_create(
            [
                JournalLine(
                    journal_entry=original,
                    account=cash,
                    debit=Decimal("0.00"),
                    credit=Decimal("0.00"),
                )
            ]
        )

    JournalEntry.objects.create(
        institution=institution,
        journal_number="JE-2026-900001",
        accounting_period=period,
        entry_date=date(2026, 9, 11),
        description="First reversal",
        created_by=finance,
        reversal_of=original,
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        JournalEntry.objects.create(
            institution=institution,
            journal_number="JE-2026-900002",
            accounting_period=period,
            entry_date=date(2026, 9, 12),
            description="Duplicate reversal",
            created_by=finance,
            reversal_of=original,
        )
