from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db.models import Sum
from django.urls import reverse

from apps.accounting.models import (
    Account,
    AccountingPreset,
    AccountingPresetVersion,
    AccountingPeriod,
    AccountTemplate,
    ChartOfAccountsTemplate,
    TaxCode,
    TaxComponent,
    Vendor,
    VendorBill,
    Customer,
    Invoice,
    BankAccount,
    Payment,
    Receipt,
    BankStatementLine,
    VATWithholdingCertificate,
    GhanaComplianceReminder,
    Expense,
    WithholdingRule,
)
from apps.accounting.services import (
    approve_vendor_bill,
    apply_accounting_preset,
    create_accounting_period,
    create_fiscal_year,
    create_vendor,
    create_vendor_bill,
    post_vendor_bill,
    submit_vendor_bill,
    create_customer,
    create_invoice,
    issue_invoice,
    create_bank_account,
    create_payment,
    create_receipt,
    void_payment,
    void_receipt,
    create_expense,
    submit_expense,
    approve_expense,
    reject_expense,
    post_expense,
    create_bank_statement_line,
    match_bank_statement_line,
    unmatch_bank_statement_line,
    issue_vat_withholding_certificate,
    void_vat_withholding_certificate,
)
from apps.institutions.models import InstitutionModule


pytestmark = pytest.mark.django_db


def _enable_accounting(institution):
    module = institution.modules.get(module_code=InstitutionModule.ModuleCode.ACCOUNTING)
    module.is_enabled = True
    module.save(update_fields=("is_enabled", "updated_at"))


def _finance(institution, user_factory, membership_factory, email="ap.finance@example.com"):
    actor = user_factory(email=email)
    membership_factory(
        user=actor,
        institution=institution,
        role_code="FINANCE_MANAGER",
        is_primary=True,
    )
    return actor


def _accounting_foundation(institution, actor, code="AP-GH"):
    preset = AccountingPreset.objects.create(
        code=code,
        country_code="GH",
        name="AP test Ghana preset",
        institution_type="COMMERCIAL",
    )
    version = AccountingPresetVersion.objects.create(
        accounting_preset=preset,
        version_code=f"{code}-2026.1",
        localization_version="GH-LOCALIZATION-2026.1",
        effective_from=date(2026, 1, 1),
        reporting_framework="IFRS",
        status="ACTIVE",
    )
    chart = ChartOfAccountsTemplate.objects.create(
        preset_version=version, name="AP test chart"
    )
    specs = (
        ("1110", "Cash at bank", "ASSET", "DEBIT", "CASH"),
        ("2000", "Trade payables", "LIABILITY", "CREDIT", "TRADE_PAYABLES"),
        ("1300", "VAT input", "ASSET", "DEBIT", "VAT_INPUT"),
        ("1310", "NHIL input", "ASSET", "DEBIT", "NHIL_INPUT"),
        ("1320", "GETFund input", "ASSET", "DEBIT", "GETFUND_INPUT"),
        ("2200", "WHT payable", "LIABILITY", "CREDIT", "WITHHOLDING_TAX_PAYABLE"),
        ("2210", "VAT WHT payable", "LIABILITY", "CREDIT", "VAT_WITHHOLDING_PAYABLE"),
        ("5000", "Professional fees", "EXPENSE", "DEBIT", "PROFESSIONAL_FEES"),
        ("1200", "Trade receivables", "ASSET", "DEBIT", "TRADE_RECEIVABLES"),
        ("4000", "Service revenue", "INCOME", "CREDIT", "SERVICE_REVENUE"),
        ("2300", "VAT output", "LIABILITY", "CREDIT", "VAT_OUTPUT_PAYABLE"),
        ("2310", "NHIL output", "LIABILITY", "CREDIT", "NHIL_PAYABLE"),
        ("2320", "GETFund output", "LIABILITY", "CREDIT", "GETFUND_PAYABLE"),
    )
    for account_code, name, account_type, normal_balance, mapping in specs:
        AccountTemplate.objects.create(
            coa_template=chart,
            code=account_code,
            name=name,
            account_type=account_type,
            normal_balance=normal_balance,
            system_mapping_code=mapping,
        )
    apply_accounting_preset(
        institution=institution,
        actor=actor,
        preset_version=version,
        coa_template=chart,
        base_currency="GHS",
        fiscal_year_start_month=1,
    )
    fiscal_year = create_fiscal_year(
        institution=institution,
        actor=actor,
        name="FY2026",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
    )
    period = create_accounting_period(
        institution=institution,
        actor=actor,
        fiscal_year=fiscal_year,
        name="January 2026",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 31),
    )
    tax_code = TaxCode.objects.create(
        preset_version=version,
        code=f"{code}-VAT",
        name="Test standard tax",
        tax_treatment="STANDARD",
        effective_from=date(2026, 1, 1),
    )
    for component_code, rate, mapping, output_mapping in (
        ("VAT", "15.0000", "VAT_INPUT", "VAT_OUTPUT_PAYABLE"),
        ("NHIL", "2.5000", "NHIL_INPUT", "NHIL_PAYABLE"),
        ("GETFUND", "2.5000", "GETFUND_INPUT", "GETFUND_PAYABLE"),
    ):
        TaxComponent.objects.create(
            tax_code=tax_code,
            code=component_code,
            name=component_code,
            rate=Decimal(rate),
            input_account_mapping_code=mapping,
            output_account_mapping_code=output_mapping,
            sequence=len(component_code),
        )
    withholding = WithholdingRule.objects.create(
        preset_version=version,
        code=f"{code}-WHT",
        name="Test WHT",
        residency="RESIDENT",
        transaction_category="SERVICES",
        rate=Decimal("3.0000"),
        effective_from=date(2026, 1, 1),
        requires_confirmation=True,
    )
    return period, tax_code, withholding


def test_vendor_bill_derives_tax_and_withholding_then_posts_balanced_ap_journal(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="AP-POST", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(institution, user_factory, membership_factory)
    period, tax_code, withholding = _accounting_foundation(institution, actor)
    vendor = create_vendor(
        institution=institution,
        actor=actor,
        name="Acme Services",
        vendor_code="ACME",
        country_code="GH",
        tax_residency="RESIDENT",
    )
    expense = Account.objects.get(institution=institution, code="5000")
    bill = create_vendor_bill(
        institution=institution,
        actor=actor,
        vendor=vendor,
        bill_number="ACME-001",
        bill_date=date(2026, 1, 15),
        due_date=date(2026, 1, 30),
        currency="GHS",
        accounting_period=period,
        lines=[
            {
                "description": "Consulting",
                "expense_account": expense,
                "quantity": Decimal("2"),
                "unit_price": Decimal("100"),
                "tax_code": tax_code,
                "withholding_rule": withholding,
            }
        ],
    )
    assert (bill.subtotal, bill.tax_total, bill.withholding_total) == (
        Decimal("200.00"),
        Decimal("40.00"),
        Decimal("6.00"),
    )
    assert (bill.total_amount, bill.amount_payable) == (
        Decimal("240.00"),
        Decimal("234.00"),
    )

    bill = submit_vendor_bill(bill=bill, actor=actor)
    bill = approve_vendor_bill(bill=bill, actor=actor)
    bill = post_vendor_bill(bill=bill, actor=actor)
    assert bill.status == VendorBill.Status.POSTED
    assert bill.journal_entry.source == "AP"
    assert bill.journal_entry.status == "POSTED"
    totals = bill.journal_entry.lines.aggregate(debit=Sum("debit"), credit=Sum("credit"))
    assert totals == {"debit": Decimal("240.00"), "credit": Decimal("240.00")}
    assert set(
        bill.journal_entry.lines.values_list("account__code", "debit", "credit")
    ) == {
        ("5000", Decimal("200.00"), Decimal("0.00")),
        ("1300", Decimal("30.00"), Decimal("0.00")),
        ("1310", Decimal("5.00"), Decimal("0.00")),
        ("1320", Decimal("5.00"), Decimal("0.00")),
        ("2000", Decimal("0.00"), Decimal("234.00")),
        ("2200", Decimal("0.00"), Decimal("6.00")),
    }


def test_vendor_bill_rejects_cross_tenant_vendor_and_preset_mismatched_tax(
    institution_factory, user_factory, membership_factory
):
    home = institution_factory(code="AP-HOME", country_code="GH")
    foreign = institution_factory(code="AP-FOREIGN", country_code="GH")
    _enable_accounting(home)
    _enable_accounting(foreign)
    home_actor = _finance(institution=home, user_factory=user_factory, membership_factory=membership_factory)
    foreign_actor = _finance(foreign, user_factory, membership_factory, "ap.foreign@example.com")
    period, tax_code, _ = _accounting_foundation(home, home_actor, "AP-HOME")
    foreign_vendor = create_vendor(
        institution=foreign, actor=foreign_actor, name="Foreign", vendor_code="FOREIGN"
    )
    expense = Account.objects.get(institution=home, code="5000")
    with pytest.raises(ValidationError, match="Vendor belongs to another"):
        create_vendor_bill(
            institution=home,
            actor=home_actor,
            vendor=foreign_vendor,
            bill_number="INVALID-VENDOR",
            bill_date=date(2026, 1, 15),
            due_date=date(2026, 1, 30),
            currency="GHS",
            accounting_period=period,
            lines=[],
        )

    foreign_period, foreign_tax, _ = _accounting_foundation(foreign, foreign_actor, "AP-FOREIGN")
    vendor = create_vendor(institution=home, actor=home_actor, name="Home", vendor_code="HOME")
    with pytest.raises(ValidationError, match="must match the selected accounting preset"):
        create_vendor_bill(
            institution=home,
            actor=home_actor,
            vendor=vendor,
            bill_number="INVALID-TAX",
            bill_date=date(2026, 1, 15),
            due_date=date(2026, 1, 30),
            currency="GHS",
            accounting_period=period,
            lines=[
                {
                    "description": "Wrong tax",
                    "expense_account": expense,
                    "quantity": Decimal("1"),
                    "unit_price": Decimal("1"),
                    "tax_code": foreign_tax,
                }
            ],
        )
    assert foreign_period.institution_id == foreign.id


def test_vendor_and_bill_api_enforce_permissions_and_nested_workflow(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="AP-API", country_code="GH")
    _enable_accounting(institution)
    finance = _finance(institution, user_factory, membership_factory)
    accountant = user_factory(email="ap.accountant@example.com")
    membership_factory(
        user=accountant, institution=institution, role_code="ACCOUNTANT", is_primary=True
    )
    period, tax_code, _ = _accounting_foundation(institution, finance, "AP-API")
    expense = Account.objects.get(institution=institution, code="5000")
    api_client.force_authenticate(accountant)
    vendor_payload = {"name": "API Vendor", "vendor_code": "API-VENDOR", "country_code": "GH"}
    vendor_response = api_client.post(reverse("v1:vendor-list"), vendor_payload, format="json")
    assert vendor_response.status_code == 201
    vendor_id = vendor_response.json()["data"]["id"]
    bill_response = api_client.post(
        reverse("v1:vendor-bill-list"),
        {
            "vendor": vendor_id,
            "bill_number": "API-001",
            "bill_date": "2026-01-15",
            "due_date": "2026-01-30",
            "currency": "GHS",
            "accounting_period": str(period.id),
            "lines": [
                {
                    "description": "API service",
                    "expense_account": str(expense.id),
                    "quantity": "1",
                    "unit_price": "100",
                    "tax_code": str(tax_code.id),
                }
            ],
        },
        format="json",
    )
    assert bill_response.status_code == 201
    bill_id = bill_response.json()["data"]["id"]
    assert bill_response.json()["data"]["tax_total"] == "20.00"
    assert api_client.post(
        reverse("v1:vendor-bill-approve", args=(bill_id,)), format="json"
    ).status_code == 403
    submitted = api_client.post(
        reverse("v1:vendor-bill-submit", args=(bill_id,)), format="json"
    )
    assert submitted.status_code == 200
    api_client.force_authenticate(finance)
    approved = api_client.post(
        reverse("v1:vendor-bill-approve", args=(bill_id,)), format="json"
    )
    assert approved.status_code == 200
    assert approved.json()["data"]["status"] == "APPROVED"


def test_invoice_issues_a_balanced_ar_journal_with_separate_output_tax(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="AR-POST", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(institution, user_factory, membership_factory, "ar.finance@example.com")
    period, tax_code, _ = _accounting_foundation(institution, actor, "AR-GH")
    customer = create_customer(
        institution=institution, actor=actor, name="Client", customer_code="CLIENT"
    )
    income = Account.objects.get(institution=institution, code="4000")
    invoice = create_invoice(
        institution=institution,
        actor=actor,
        customer=customer,
        invoice_number="CLIENT-001",
        invoice_date=date(2026, 1, 15),
        due_date=date(2026, 1, 30),
        currency="GHS",
        accounting_period=period,
        lines=[{"description": "Service", "income_account": income, "quantity": Decimal("2"), "unit_price": Decimal("100"), "tax_code": tax_code}],
    )
    assert (invoice.subtotal, invoice.tax_total, invoice.total_amount) == (Decimal("200.00"), Decimal("40.00"), Decimal("240.00"))
    invoice = issue_invoice(invoice=invoice, actor=actor)
    assert invoice.status == Invoice.Status.ISSUED
    assert invoice.journal_entry.source == "AR"
    assert invoice.journal_entry.lines.aggregate(debit=Sum("debit"), credit=Sum("credit")) == {"debit": Decimal("240.00"), "credit": Decimal("240.00")}


def test_cash_bank_settles_and_voids_single_bill_and_invoice_with_balanced_journals(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="CASH-SETTLE", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(institution, user_factory, membership_factory, "cash.finance@example.com")
    period, tax_code, _ = _accounting_foundation(institution, actor, "CASH-GH")
    bank = create_bank_account(
        institution=institution,
        actor=actor,
        name="Operating account",
        bank_name="Example Bank",
        masked_account_number="****1234",
        currency="GHS",
        ledger_account=Account.objects.get(institution=institution, code="1110"),
    )
    vendor = create_vendor(institution=institution, actor=actor, name="Supplier", vendor_code="SUP")
    bill = create_vendor_bill(
        institution=institution,
        actor=actor,
        vendor=vendor,
        bill_number="SUP-001",
        bill_date=date(2026, 1, 15),
        due_date=date(2026, 1, 30),
        currency="GHS",
        accounting_period=period,
        lines=[{
            "description": "Service", "expense_account": Account.objects.get(institution=institution, code="5000"),
            "quantity": Decimal("1"), "unit_price": Decimal("100"), "tax_code": tax_code,
        }],
    )
    bill = post_vendor_bill(bill=approve_vendor_bill(bill=submit_vendor_bill(bill=bill, actor=actor), actor=actor), actor=actor)
    payment = create_payment(
        institution=institution, actor=actor, payment_number="PAY-001", payment_date=date(2026, 1, 20),
        amount=Decimal("40"), currency="GHS", payment_method=Payment.Method.BANK_TRANSFER,
        bank_account=bank, vendor_bill=bill,
    )
    bill.refresh_from_db()
    assert bill.status == VendorBill.Status.PART_PAID
    assert payment.journal_entry.source == "CASH"
    assert payment.journal_entry.lines.aggregate(debit=Sum("debit"), credit=Sum("credit")) == {"debit": Decimal("40.00"), "credit": Decimal("40.00")}
    payment = void_payment(payment=payment, actor=actor, void_date=date(2026, 1, 21))
    bill.refresh_from_db()
    assert payment.status == Payment.Status.VOID
    assert bill.status == VendorBill.Status.POSTED

    customer = create_customer(institution=institution, actor=actor, name="Client", customer_code="CLIENT")
    invoice = create_invoice(
        institution=institution,
        actor=actor,
        customer=customer,
        invoice_number="CLIENT-SETTLE-001",
        invoice_date=date(2026, 1, 15),
        due_date=date(2026, 1, 30),
        currency="GHS",
        accounting_period=period,
        lines=[{
            "description": "Service", "income_account": Account.objects.get(institution=institution, code="4000"),
            "quantity": Decimal("1"), "unit_price": Decimal("100"), "tax_code": tax_code,
        }],
    )
    invoice = issue_invoice(invoice=invoice, actor=actor)
    receipt = create_receipt(
        institution=institution, actor=actor, receipt_number="REC-001", receipt_date=date(2026, 1, 20),
        amount=Decimal("120"), currency="GHS", payment_method=Receipt.Method.BANK_TRANSFER,
        bank_account=bank, invoice=invoice,
    )
    invoice.refresh_from_db()
    assert invoice.status == Invoice.Status.PAID
    assert receipt.journal_entry.source == "CASH"
    assert receipt.journal_entry.lines.aggregate(debit=Sum("debit"), credit=Sum("credit")) == {"debit": Decimal("120.00"), "credit": Decimal("120.00")}
    receipt = void_receipt(receipt=receipt, actor=actor, void_date=date(2026, 1, 21))
    invoice.refresh_from_db()
    assert receipt.status == Receipt.Status.VOID
    assert invoice.status == Invoice.Status.ISSUED


def test_bank_statement_reconciliation_matches_only_equal_posted_bank_journals(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="BANK-RECON", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(institution, user_factory, membership_factory, "bank.recon@example.com")
    period, tax_code, _ = _accounting_foundation(institution, actor, "BANK-RECON-GH")
    bank = create_bank_account(
        institution=institution, actor=actor, name="Operating", bank_name="Example Bank",
        masked_account_number="****5678", currency="GHS",
        ledger_account=Account.objects.get(institution=institution, code="1110"),
    )
    vendor = create_vendor(institution=institution, actor=actor, name="Supplier", vendor_code="SUP-REC")
    bill = create_vendor_bill(
        institution=institution, actor=actor, vendor=vendor, bill_number="BILL-REC",
        bill_date=date(2026, 1, 15), due_date=date(2026, 1, 30), currency="GHS",
        accounting_period=period,
        lines=[{"description": "Service", "expense_account": Account.objects.get(institution=institution, code="5000"), "quantity": Decimal("1"), "unit_price": Decimal("100"), "tax_code": tax_code}],
    )
    bill = post_vendor_bill(bill=approve_vendor_bill(bill=submit_vendor_bill(bill=bill, actor=actor), actor=actor), actor=actor)
    payment = create_payment(
        institution=institution, actor=actor, payment_number="PAY-REC", payment_date=date(2026, 1, 20),
        amount=Decimal("40"), currency="GHS", payment_method=Payment.Method.BANK_TRANSFER,
        bank_account=bank, vendor_bill=bill,
    )
    line = create_bank_statement_line(
        institution=institution, actor=actor, bank_account=bank, statement_date=date(2026, 1, 20),
        external_id="bank-0001", reference="PAY-REC", description="Supplier payment",
        amount=Decimal("-40"), currency="GHS",
    )
    assert create_bank_statement_line(
        institution=institution, actor=actor, bank_account=bank, statement_date=date(2026, 1, 20),
        external_id="BANK-0001", reference="PAY-REC", description="Supplier payment",
        amount=Decimal("-40"), currency="GHS",
    ).id == line.id
    line = match_bank_statement_line(statement_line=line, journal=payment.journal_entry, actor=actor)
    assert line.status == BankStatementLine.Status.MATCHED
    assert line.journal_entry_id == payment.journal_entry_id
    line = unmatch_bank_statement_line(statement_line=line, actor=actor)
    assert line.status == BankStatementLine.Status.UNMATCHED
    assert line.journal_entry_id is None
    mismatched = create_bank_statement_line(
        institution=institution, actor=actor, bank_account=bank, statement_date=date(2026, 1, 20),
        external_id="BANK-0002", reference="BAD", description="Bad amount", amount=Decimal("-39"), currency="GHS",
    )
    with pytest.raises(ValidationError, match="does not equal"):
        match_bank_statement_line(statement_line=mismatched, journal=payment.journal_entry, actor=actor)


def test_cash_settlement_rejects_overpayment_and_cross_tenant_bank_account(
    institution_factory, user_factory, membership_factory
):
    home = institution_factory(code="CASH-HOME", country_code="GH")
    foreign = institution_factory(code="CASH-FOREIGN", country_code="GH")
    _enable_accounting(home)
    _enable_accounting(foreign)
    actor = _finance(home, user_factory, membership_factory, "cash.home@example.com")
    foreign_actor = _finance(foreign, user_factory, membership_factory, "cash.foreign@example.com")
    period, tax_code, _ = _accounting_foundation(home, actor, "CASH-HOME")
    foreign_period, _, _ = _accounting_foundation(foreign, foreign_actor, "CASH-FOREIGN")
    foreign_bank = create_bank_account(
        institution=foreign, actor=foreign_actor, name="Foreign bank", bank_name="Bank", masked_account_number="****0001",
        currency="GHS", ledger_account=Account.objects.get(institution=foreign, code="1110"),
    )
    vendor = create_vendor(institution=home, actor=actor, name="Supplier", vendor_code="SUP")
    bill = create_vendor_bill(
        institution=home, actor=actor, vendor=vendor, bill_number="SUP-OVER", bill_date=date(2026, 1, 15),
        due_date=date(2026, 1, 30), currency="GHS", accounting_period=period,
        lines=[{"description": "Service", "expense_account": Account.objects.get(institution=home, code="5000"), "quantity": Decimal("1"), "unit_price": Decimal("100"), "tax_code": tax_code}],
    )
    bill = post_vendor_bill(bill=approve_vendor_bill(bill=submit_vendor_bill(bill=bill, actor=actor), actor=actor), actor=actor)
    with pytest.raises(ValidationError, match="Bank account belongs to another institution"):
        create_payment(
            institution=home, actor=actor, payment_number="PAY-FOREIGN", payment_date=date(2026, 1, 20),
            amount=Decimal("1"), currency="GHS", payment_method=Payment.Method.BANK_TRANSFER,
            bank_account=foreign_bank, vendor_bill=bill,
        )
    with pytest.raises(ValidationError, match="exceeds the outstanding"):
        create_payment(
            institution=home, actor=actor, payment_number="PAY-OVER", payment_date=date(2026, 1, 20),
            amount=Decimal("121"), currency="GHS", payment_method=Payment.Method.CASH,
            vendor_bill=bill,
        )
    assert foreign_period.institution_id == foreign.id


def test_vat_withholding_certificate_requires_agent_and_keeps_void_audit_history(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="VAT-CERT", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(institution, user_factory, membership_factory, "vat.cert@example.com")
    period, tax_code, rule = _accounting_foundation(institution, actor, "VAT-CERT-GH")
    rule.is_vat_withholding_rule = True
    rule.save(update_fields=("is_vat_withholding_rule", "updated_at"))
    vendor = create_vendor(institution=institution, actor=actor, name="Supplier", vendor_code="VAT-SUP")
    bill = create_vendor_bill(
        institution=institution, actor=actor, vendor=vendor, bill_number="VAT-BILL",
        bill_date=date(2026, 1, 15), due_date=date(2026, 1, 30), currency="GHS", accounting_period=period,
        lines=[{"description": "Service", "expense_account": Account.objects.get(institution=institution, code="5000"), "quantity": Decimal("1"), "unit_price": Decimal("100"), "tax_code": tax_code, "withholding_rule": rule}],
    )
    bill = post_vendor_bill(bill=approve_vendor_bill(bill=submit_vendor_bill(bill=bill, actor=actor), actor=actor), actor=actor)
    with pytest.raises(ValidationError, match="not configured"):
        issue_vat_withholding_certificate(institution=institution, actor=actor, vendor_bill=bill, withholding_rule=rule, certificate_number="VAT-001", certificate_date=date(2026, 1, 20), amount=Decimal("7"))
    configuration = institution.accounting_configuration
    configuration.is_vat_withholding_agent = True
    configuration.save(update_fields=("is_vat_withholding_agent", "updated_at"))
    certificate = issue_vat_withholding_certificate(institution=institution, actor=actor, vendor_bill=bill, withholding_rule=rule, certificate_number="VAT-001", certificate_date=date(2026, 1, 20), amount=Decimal("7"))
    assert certificate.status == VATWithholdingCertificate.Status.ISSUED
    certificate = void_vat_withholding_certificate(certificate=certificate, actor=actor)
    assert certificate.status == VATWithholdingCertificate.Status.VOID
    reminder = GhanaComplianceReminder.objects.create(institution=institution, code="VAT_RETURN", title="VAT return", due_date=date(2026, 2, 15), statutory_reference="https://gra.gov.gh/domestic-tax/tax-types/vat/")
    assert reminder.status == GhanaComplianceReminder.Status.OPEN


def test_expense_workflow_posts_a_balanced_cash_journal_and_rejects_invalid_transitions(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="EXPENSE", country_code="GH")
    _enable_accounting(institution)
    actor = _finance(institution, user_factory, membership_factory, "expense.finance@example.com")
    _, _, _ = _accounting_foundation(institution, actor, "EXPENSE-GH")
    expense = create_expense(institution=institution, actor=actor, expense_date=date(2026, 1, 20), account=Account.objects.get(institution=institution, code="5000"), amount=Decimal("75"), currency="GHS", description="Office supplies")
    with pytest.raises(ValidationError, match="Only approved expenses"):
        post_expense(expense=expense, actor=actor)
    expense = submit_expense(expense=expense, actor=actor)
    # Whoever enters an expense cannot approve it (BQ-04).
    with pytest.raises(ValidationError, match="separation of duties"):
        approve_expense(expense=expense, actor=actor)
    approver = _finance(institution, user_factory, membership_factory, "expense.approver@example.com")
    expense = approve_expense(expense=expense, actor=approver)
    expense = post_expense(expense=expense, actor=actor)
    assert expense.status == Expense.Status.POSTED
    assert expense.journal_entry.source == "EXPENSE"
    assert expense.journal_entry.lines.aggregate(debit=Sum("debit"), credit=Sum("credit")) == {"debit": Decimal("75.00"), "credit": Decimal("75.00")}
