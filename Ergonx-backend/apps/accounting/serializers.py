from decimal import Decimal
from rest_framework import serializers

from apps.accounting.models import (
    Account,
    ExpenseApproval,
    ExpenseCategory,
    ExpenseLine,
    BankReconciliationSession,
    AccountingPeriod,
    AccountingPreset,
    AccountingPresetVersion,
    AccountTemplate,
    ChartOfAccountsTemplate,
    FiscalYear,
    GhanaLocalizationVersion,
    InstitutionAccountingConfiguration,
    JournalEntry,
    JournalLine,
    TaxCode,
    TaxComponent,
    Vendor,
    VendorBill,
    VendorBillLine,
    Customer,
    Invoice,
    InvoiceLine,
    BankAccount,
    Payment,
    Receipt,
    BankStatementLine,
    VATWithholdingCertificate,
    GhanaComplianceReminder,
    Expense,
    PayrollAccountMappingTemplate,
    PayComponentAccountMapping,
    WithholdingRule,
)
from apps.accounting.services import (
    configure_accounting,
    create_account,
    create_accounting_period,
    create_fiscal_year,
    create_journal,
    update_account,
    update_draft_journal,
    create_vendor,
    create_vendor_bill,
    update_vendor,
    update_draft_vendor_bill,
    create_customer,
    update_customer,
    create_invoice,
    create_bank_statement_line,
    issue_vat_withholding_certificate,
    update_draft_invoice,
    create_bank_account,
    update_bank_account,
    create_payment,
    create_receipt,
    create_expense,
    update_draft_expense,
)
from apps.employees.models import Employee
from apps.organization.models import Department, Location
from common.serializers import ValidatedModelSerializer, call_validated_service


class AccountingPresetSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountingPreset
        fields = "__all__"


class AccountingPresetVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountingPresetVersion
        fields = "__all__"


class GhanaLocalizationVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = GhanaLocalizationVersion
        fields = "__all__"


class TaxCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxCode
        fields = "__all__"


class TaxComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxComponent
        fields = "__all__"


class WithholdingRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = WithholdingRule
        fields = "__all__"


class VendorSerializer(ValidatedModelSerializer):
    class Meta:
        model = Vendor
        fields = (
            "id", "name", "vendor_code", "email", "phone", "address", "country_code",
            "tax_identification_number", "tax_residency", "taxpayer_type", "vat_registered",
            "withholding_category", "statutory_profile_metadata", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def create(self, validated_data):
        return call_validated_service(create_vendor, **validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("institution", None)
        return call_validated_service(
            update_vendor, vendor=instance, actor=validated_data.pop("actor"), **validated_data
        )


class VendorBillLineSerializer(ValidatedModelSerializer):
    class Meta:
        model = VendorBillLine
        fields = (
            "id", "description", "expense_account", "quantity", "unit_price", "tax_code",
            "withholding_rule", "line_total", "created_at", "updated_at",
        )
        read_only_fields = ("id", "line_total", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["expense_account"].queryset = Account.objects.for_institution(
                institution
            )


def _person_name(user):
    return (user.get_full_name() or user.email) if user else None


class VendorBillSerializer(ValidatedModelSerializer):
    lines = VendorBillLineSerializer(many=True)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    vendor_code = serializers.CharField(source="vendor.vendor_code", read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    rejected_by_name = serializers.SerializerMethodField()
    amount_paid = serializers.SerializerMethodField()

    def get_submitted_by_name(self, obj):
        return _person_name(obj.submitted_by)

    def get_approved_by_name(self, obj):
        return _person_name(obj.approved_by)

    def get_rejected_by_name(self, obj):
        return _person_name(obj.rejected_by)

    def get_amount_paid(self, obj):
        from django.db.models import Sum

        total = obj.payments.filter(status="POSTED").aggregate(total=Sum("amount"))["total"] or Decimal("0")
        return str(Decimal(total).quantize(Decimal("0.01")))

    class Meta:
        model = VendorBill
        fields = (
            "id", "vendor", "vendor_name", "vendor_code", "bill_number", "bill_date", "due_date", "currency", "subtotal",
            "tax_total", "withholding_total", "total_amount", "amount_payable", "amount_paid", "status",
            "accounting_period", "journal_entry", "lines", "submitted_by_name", "submitted_at", "approved_by_name",
            "approved_at", "rejected_by_name", "rejected_at", "rejection_reason", "on_hold", "hold_reason",
            "scheduled_payment_date", "scheduled_payment_method", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "subtotal", "tax_total", "withholding_total", "total_amount",
            "amount_payable", "status", "journal_entry", "submitted_at", "approved_at", "rejected_at",
            "rejection_reason", "on_hold", "hold_reason", "scheduled_payment_date", "scheduled_payment_method",
            "created_at", "updated_at",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["vendor"].queryset = Vendor.objects.for_institution(institution)
            self.fields["accounting_period"].queryset = AccountingPeriod.objects.for_institution(
                institution
            )

    def create(self, validated_data):
        lines = validated_data.pop("lines")
        return call_validated_service(create_vendor_bill, lines=lines, **validated_data)

    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        validated_data.pop("institution", None)
        return call_validated_service(
            update_draft_vendor_bill,
            bill=instance,
            actor=validated_data.pop("actor"),
            lines=lines,
            **validated_data,
        )


class CustomerSerializer(ValidatedModelSerializer):
    class Meta:
        model = Customer
        fields = (
            "id", "name", "customer_code", "email", "phone", "address", "country_code",
            "tax_identification_number", "tax_residency", "taxpayer_type", "vat_registered",
            "withholding_category", "statutory_profile_metadata", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def create(self, validated_data):
        return call_validated_service(create_customer, **validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("institution", None)
        return call_validated_service(update_customer, customer=instance, actor=validated_data.pop("actor"), **validated_data)


class InvoiceLineSerializer(ValidatedModelSerializer):
    class Meta:
        model = InvoiceLine
        fields = ("id", "description", "income_account", "quantity", "unit_price", "tax_code", "line_total", "created_at", "updated_at")
        read_only_fields = ("id", "line_total", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["income_account"].queryset = Account.objects.for_institution(institution)


class InvoiceSerializer(ValidatedModelSerializer):
    lines = InvoiceLineSerializer(many=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_code = serializers.CharField(source="customer.customer_code", read_only=True)
    amount_received = serializers.SerializerMethodField()
    amount_due = serializers.SerializerMethodField()

    def get_amount_received(self, obj):
        from apps.accounting.services import invoice_amount_received

        return str(invoice_amount_received(obj))

    def get_amount_due(self, obj):
        from apps.accounting.services import invoice_amount_received

        if obj.status in (Invoice.Status.DRAFT, Invoice.Status.VOID):
            return "0.00"
        return str((obj.total_amount - invoice_amount_received(obj)).quantize(Decimal("0.01")))

    class Meta:
        model = Invoice
        fields = (
            "id", "customer", "customer_name", "customer_code", "invoice_number", "invoice_date", "due_date", "currency",
            "subtotal", "tax_total", "total_amount", "amount_received", "amount_due", "status", "accounting_period",
            "journal_entry", "external_tax_reference", "lines", "on_hold", "hold_reason", "sent_at", "sent_to", "notes",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "subtotal", "tax_total", "total_amount", "status", "journal_entry", "on_hold", "hold_reason", "sent_at", "sent_to", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["customer"].queryset = Customer.objects.for_institution(institution)
            self.fields["accounting_period"].queryset = AccountingPeriod.objects.for_institution(institution)

    def create(self, validated_data):
        return call_validated_service(create_invoice, lines=validated_data.pop("lines"), **validated_data)

    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        validated_data.pop("institution", None)
        return call_validated_service(update_draft_invoice, invoice=instance, actor=validated_data.pop("actor"), lines=lines, **validated_data)


class BankAccountSerializer(ValidatedModelSerializer):
    class Meta:
        model = BankAccount
        fields = (
            "id", "name", "bank_name", "masked_account_number", "currency",
            "ledger_account", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["ledger_account"].queryset = Account.objects.for_institution(institution)

    def create(self, validated_data):
        return call_validated_service(create_bank_account, **validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("institution", None)
        return call_validated_service(
            update_bank_account,
            bank_account=instance,
            actor=validated_data.pop("actor"),
            **validated_data,
        )


class PaymentSerializer(ValidatedModelSerializer):
    class Meta:
        model = Payment
        fields = (
            "id", "payment_number", "payment_date", "amount", "currency",
            "payment_method", "bank_account", "vendor_bill", "journal_entry", "status",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "journal_entry", "status", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["bank_account"].queryset = BankAccount.objects.for_institution(institution)
            self.fields["vendor_bill"].queryset = VendorBill.objects.for_institution(institution)

    def create(self, validated_data):
        return call_validated_service(create_payment, **validated_data)


class ReceiptSerializer(ValidatedModelSerializer):
    class Meta:
        model = Receipt
        fields = (
            "id", "receipt_number", "receipt_date", "amount", "currency",
            "payment_method", "bank_account", "invoice", "journal_entry", "status",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "journal_entry", "status", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["bank_account"].queryset = BankAccount.objects.for_institution(institution)
            self.fields["invoice"].queryset = Invoice.objects.for_institution(institution)

    def create(self, validated_data):
        return call_validated_service(create_receipt, **validated_data)


class CashTransactionVoidSerializer(serializers.Serializer):
    void_date = serializers.DateField()


class BankStatementLineSerializer(ValidatedModelSerializer):
    class Meta:
        model = BankStatementLine
        fields = (
            "id", "bank_account", "statement_date", "external_id", "reference",
            "description", "amount", "currency", "journal_entry", "status",
            "reconciled_by", "reconciled_at", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "journal_entry", "status", "reconciled_by", "reconciled_at",
            "created_at", "updated_at",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["bank_account"].queryset = BankAccount.objects.for_institution(institution)

    def create(self, validated_data):
        return call_validated_service(create_bank_statement_line, **validated_data)


class BankStatementMatchSerializer(serializers.Serializer):
    journal_entry = serializers.PrimaryKeyRelatedField(queryset=JournalEntry.objects.none())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["journal_entry"].queryset = JournalEntry.objects.for_institution(institution)


class VATWithholdingCertificateSerializer(ValidatedModelSerializer):
    class Meta:
        model = VATWithholdingCertificate
        fields = (
            "id", "vendor_bill", "withholding_rule", "certificate_number",
            "certificate_date", "amount", "status", "issued_by", "issued_at",
            "voided_by", "voided_at", "created_at", "updated_at",
        )
        read_only_fields = ("id", "status", "issued_by", "issued_at", "voided_by", "voided_at", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["vendor_bill"].queryset = VendorBill.objects.for_institution(institution)
            self.fields["withholding_rule"].queryset = WithholdingRule.objects.filter(
                preset_version=getattr(getattr(institution, "accounting_configuration", None), "selected_accounting_preset_version", None),
                is_vat_withholding_rule=True,
            )

    def create(self, validated_data):
        return call_validated_service(issue_vat_withholding_certificate, **validated_data)


class GhanaComplianceReminderSerializer(serializers.ModelSerializer):
    class Meta:
        model = GhanaComplianceReminder
        fields = "__all__"
        read_only_fields = ("institution", "completed_by", "completed_at", "created_at", "updated_at")


class ExpenseCategorySerializer(ValidatedModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ("id", "code", "name", "expense_account", "max_amount", "receipt_required_over", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["expense_account"].queryset = Account.objects.for_institution(institution)


class ExpenseLineSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    account_code = serializers.CharField(source="account.code", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True)

    class Meta:
        model = ExpenseLine
        fields = ("id", "category", "category_name", "account", "account_code", "account_name", "expense_date", "description", "amount", "receipts", "sequence")
        read_only_fields = ("id", "account", "account_code", "account_name", "sequence")
        extra_kwargs = {"expense_date": {"required": False}, "description": {"required": False}, "receipts": {"required": False}}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            from apps.documents.models import Document

            self.fields["category"].queryset = ExpenseCategory.objects.for_institution(institution).filter(is_active=True)
            self.fields["receipts"].child_relation.queryset = Document.objects.for_institution(institution)


class ExpenseApprovalSerializer(serializers.ModelSerializer):
    approver_name = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseApproval
        fields = ("id", "sequence", "step_name", "approver", "approver_name", "status", "comment", "acted_at")
        read_only_fields = fields

    def get_approver_name(self, obj) -> str:
        return obj.approver.get_full_name() or obj.approver.email


class ExpenseSerializer(ValidatedModelSerializer):
    lines = ExpenseLineSerializer(many=True, required=False)
    approvals = ExpenseApprovalSerializer(many=True, read_only=True)
    claimant_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Expense
        fields = (
            "id", "claimant", "claimant_name", "expense_date", "account", "amount", "currency", "description", "payment_method",
            "attachment", "status", "status_label", "lines", "approvals", "submitted_at", "decision_note",
            "created_by", "finance_reviewed_by", "finance_reviewed_at", "approved_by", "journal_entry",
            "settlement_account", "settlement_date", "settlement_reference", "settlement_journal", "settled_by",
            "reversal_journal", "reversed_by", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "status", "status_label", "submitted_at", "decision_note", "created_by", "finance_reviewed_by",
            "finance_reviewed_at", "approved_by", "journal_entry", "settlement_account", "settlement_date",
            "settlement_reference", "settlement_journal", "settled_by", "reversal_journal", "reversed_by", "created_at", "updated_at",
        )
        extra_kwargs = {"amount": {"required": False}, "currency": {"required": False}, "expense_date": {"required": False}, "account": {"required": False}}

    def get_claimant_name(self, obj) -> str | None:
        return obj.claimant.full_name if obj.claimant_id else None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            from apps.documents.models import Document
            from apps.employees.models import Employee

            self.fields["account"].queryset = Account.objects.for_institution(institution)
            self.fields["attachment"].queryset = Document.objects.for_institution(institution)
            self.fields["claimant"].queryset = Employee.objects.for_institution(institution)

    def validate(self, attrs):
        # Model clean runs in the service; lines are validated there too.
        return attrs

    def create(self, validated_data):
        lines = validated_data.pop("lines", None)
        if lines is None and validated_data.get("account") is None:
            raise serializers.ValidationError({"lines": "Add at least one expense line, or choose an account for a finance-entered expense."})
        return call_validated_service(create_expense, lines=lines, **validated_data)

    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        return call_validated_service(update_draft_expense, expense=instance, actor=validated_data.pop("actor"), lines=lines, **validated_data)


class ExpenseStepDecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, default="")


class ExpenseFinanceReviewSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=("approve", "return", "reject"))
    comment = serializers.CharField(required=False, allow_blank=True, default="")
    recodes = serializers.DictField(child=serializers.UUIDField(), required=False, default=dict, help_text="Line id -> expense account id.")


class ExpenseSettleSerializer(serializers.Serializer):
    settlement_account = serializers.UUIDField()
    settlement_date = serializers.DateField(required=False)
    reference = serializers.CharField(required=False, allow_blank=True, default="", max_length=120)


class ExpenseReverseSerializer(serializers.Serializer):
    reason = serializers.CharField()
    reversal_date = serializers.DateField(required=False)


class PayrollAccountMappingTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollAccountMappingTemplate
        fields = "__all__"


class PayComponentAccountMappingSerializer(ValidatedModelSerializer):
    class Meta:
        model = PayComponentAccountMapping
        fields = "__all__"
        read_only_fields = ("institution",)


class PayrollMappingTemplateApplySerializer(serializers.Serializer):
    effective_from = serializers.DateField()


class ChartOfAccountsTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChartOfAccountsTemplate
        fields = "__all__"


class AccountTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountTemplate
        fields = "__all__"


class AccountingPresetApplicationSerializer(serializers.Serializer):
    coa_template = serializers.PrimaryKeyRelatedField(
        queryset=ChartOfAccountsTemplate.objects.none(), required=False
    )
    base_currency = serializers.CharField(min_length=3, max_length=3)
    fiscal_year_start_month = serializers.IntegerField(min_value=1, max_value=12)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        preset_version = self.context.get("preset_version")
        if preset_version:
            self.fields["coa_template"].queryset = (
                ChartOfAccountsTemplate.objects.filter(preset_version=preset_version)
            )


class InstitutionAccountingConfigurationSerializer(ValidatedModelSerializer):
    class Meta:
        model = InstitutionAccountingConfiguration
        fields = (
            "id",
            "country_code",
            "base_currency",
            "accounting_setup_mode",
            "selected_accounting_preset_version",
            "reporting_framework",
            "tax_identification_number",
            "vat_registered",
            "is_vat_withholding_agent",
            "statutory_profile_metadata",
            "fiscal_year_start_month",
            "is_configured",
            "configured_by",
            "configured_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "configured_by",
            "configured_at",
            "created_at",
            "updated_at",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["selected_accounting_preset_version"].queryset = (
            AccountingPresetVersion.objects.filter(
                status=AccountingPresetVersion.Status.ACTIVE
            )
        )

    def create(self, validated_data):
        return call_validated_service(configure_accounting, **validated_data)

    def update(self, instance, validated_data):
        values = {
            field: validated_data.get(field, getattr(instance, field))
            for field in (
                "country_code",
                "base_currency",
                "accounting_setup_mode",
                "selected_accounting_preset_version",
                "reporting_framework",
                "tax_identification_number",
                "vat_registered",
                "is_vat_withholding_agent",
                "statutory_profile_metadata",
                "fiscal_year_start_month",
                "is_configured",
            )
        }
        return call_validated_service(
            configure_accounting,
            institution=validated_data["institution"],
            actor=validated_data["actor"],
            **values,
        )


class AccountSerializer(ValidatedModelSerializer):
    class Meta:
        model = Account
        fields = (
            "id",
            "code",
            "name",
            "account_type",
            "parent",
            "normal_balance",
            "is_postable",
            "is_active",
            "system_mapping_code",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["parent"].queryset = Account.objects.for_institution(institution)

    def create(self, validated_data):
        return call_validated_service(create_account, **validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("institution", None)
        return call_validated_service(
            update_account,
            account=instance,
            actor=validated_data.pop("actor"),
            **validated_data,
        )


class AccountingPresetApplicationResultSerializer(serializers.Serializer):
    configuration = InstitutionAccountingConfigurationSerializer()
    coa_template = ChartOfAccountsTemplateSerializer()
    created_count = serializers.IntegerField()
    reused_count = serializers.IntegerField()
    accounts = AccountSerializer(many=True)


class FiscalYearSerializer(ValidatedModelSerializer):
    class Meta:
        model = FiscalYear
        fields = (
            "id", "name", "start_date", "end_date", "status", "created_at", "updated_at"
        )
        read_only_fields = ("id", "status", "created_at", "updated_at")

    def create(self, validated_data):
        return call_validated_service(create_fiscal_year, **validated_data)


class AccountingPeriodSerializer(ValidatedModelSerializer):
    class Meta:
        model = AccountingPeriod
        fields = (
            "id",
            "fiscal_year",
            "name",
            "start_date",
            "end_date",
            "status",
            "closed_by",
            "closed_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id", "status", "closed_by", "closed_at", "created_at", "updated_at"
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["fiscal_year"].queryset = FiscalYear.objects.for_institution(
                institution
            )

    def create(self, validated_data):
        return call_validated_service(create_accounting_period, **validated_data)


class JournalLineSerializer(ValidatedModelSerializer):
    account_code = serializers.CharField(source="account.code", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)

    class Meta:
        model = JournalLine
        fields = (
            "id",
            "account",
            "account_code",
            "account_name",
            "department_name",
            "description",
            "debit",
            "credit",
            "department",
            "location",
            "employee",
            "cost_centre",
            "project",
            "fund",
            "metadata",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["account"].queryset = Account.objects.for_institution(institution)
            self.fields["department"].queryset = Department.objects.for_institution(institution)
            self.fields["location"].queryset = Location.objects.for_institution(institution)
            self.fields["employee"].queryset = Employee.objects.for_institution(institution)


class JournalEntrySerializer(ValidatedModelSerializer):
    lines = JournalLineSerializer(many=True)
    period_name = serializers.CharField(source="accounting_period.name", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    posted_by_name = serializers.SerializerMethodField()
    total_debit = serializers.SerializerMethodField()
    total_credit = serializers.SerializerMethodField()

    @staticmethod
    def _name(user):
        return (user.get_full_name() or user.email) if user else None

    def get_created_by_name(self, obj):
        return self._name(obj.created_by)

    def get_approved_by_name(self, obj):
        return self._name(obj.approved_by)

    def get_posted_by_name(self, obj):
        return self._name(obj.posted_by)

    def get_total_debit(self, obj):
        return str(sum((line.debit for line in obj.lines.all()), Decimal("0.00")).quantize(Decimal("0.01")))

    def get_total_credit(self, obj):
        return str(sum((line.credit for line in obj.lines.all()), Decimal("0.00")).quantize(Decimal("0.01")))

    class Meta:
        model = JournalEntry
        fields = (
            "id",
            "journal_number",
            "accounting_period",
            "period_name",
            "created_by_name",
            "approved_by_name",
            "posted_by_name",
            "total_debit",
            "total_credit",
            "entry_date",
            "description",
            "source",
            "reference",
            "status",
            "created_by",
            "approved_by",
            "posted_by",
            "posted_at",
            "reversal_of",
            "lines",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "journal_number",
            "source",
            "status",
            "created_by",
            "approved_by",
            "posted_by",
            "posted_at",
            "reversal_of",
            "created_at",
            "updated_at",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["accounting_period"].queryset = (
                AccountingPeriod.objects.for_institution(institution)
            )
            line_fields = self.fields["lines"].child.fields
            line_fields["account"].queryset = Account.objects.for_institution(institution)
            line_fields["department"].queryset = Department.objects.for_institution(
                institution
            )
            line_fields["location"].queryset = Location.objects.for_institution(institution)
            line_fields["employee"].queryset = Employee.objects.for_institution(institution)

    def create(self, validated_data):
        lines = validated_data.pop("lines")
        return call_validated_service(create_journal, lines=lines, **validated_data)

    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        validated_data.pop("institution", None)
        return call_validated_service(
            update_draft_journal,
            journal=instance,
            actor=validated_data.pop("actor"),
            lines=lines,
            **validated_data,
        )


class JournalReversalSerializer(serializers.Serializer):
    accounting_period = serializers.PrimaryKeyRelatedField(
        queryset=AccountingPeriod.objects.none()
    )
    entry_date = serializers.DateField()
    description = serializers.CharField(required=False, allow_blank=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["accounting_period"].queryset = (
                AccountingPeriod.objects.for_institution(institution)
            )


class DateRangeQuerySerializer(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)

    def validate(self, attrs):
        if attrs.get("date_from") and attrs.get("date_to"):
            if attrs["date_from"] > attrs["date_to"]:
                raise serializers.ValidationError(
                    {"date_to": "End date cannot precede start date."}
                )
        return attrs


class GeneralLedgerQuerySerializer(DateRangeQuerySerializer):
    account = serializers.UUIDField()


class BalanceSheetQuerySerializer(serializers.Serializer):
    as_of = serializers.DateField(required=False)


class LedgerEntrySerializer(serializers.Serializer):
    journal_entry_id = serializers.UUIDField()
    journal_number = serializers.CharField()
    entry_date = serializers.DateField()
    description = serializers.CharField()
    debit = serializers.DecimalField(max_digits=20, decimal_places=2)
    credit = serializers.DecimalField(max_digits=20, decimal_places=2)
    running_balance = serializers.DecimalField(max_digits=20, decimal_places=2)


class GeneralLedgerSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    account_code = serializers.CharField()
    account_name = serializers.CharField()
    opening_balance = serializers.DecimalField(max_digits=20, decimal_places=2)
    entries = LedgerEntrySerializer(many=True)
    closing_balance = serializers.DecimalField(max_digits=20, decimal_places=2)


class TrialBalanceRowSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()
    account_type = serializers.CharField()
    normal_balance = serializers.CharField()
    debit = serializers.DecimalField(max_digits=20, decimal_places=2)
    credit = serializers.DecimalField(max_digits=20, decimal_places=2)


class TrialBalanceSerializer(serializers.Serializer):
    rows = TrialBalanceRowSerializer(many=True)
    total_debit = serializers.DecimalField(max_digits=20, decimal_places=2)
    total_credit = serializers.DecimalField(max_digits=20, decimal_places=2)
    balanced = serializers.BooleanField()


class IncomeStatementSerializer(serializers.Serializer):
    income = TrialBalanceRowSerializer(many=True)
    expenses = TrialBalanceRowSerializer(many=True)
    total_income = serializers.DecimalField(max_digits=20, decimal_places=2)
    total_expenses = serializers.DecimalField(max_digits=20, decimal_places=2)
    net_income = serializers.DecimalField(max_digits=20, decimal_places=2)


class BalanceSheetSerializer(serializers.Serializer):
    assets = TrialBalanceRowSerializer(many=True)
    liabilities = TrialBalanceRowSerializer(many=True)
    equity = TrialBalanceRowSerializer(many=True)
    total_assets = serializers.DecimalField(max_digits=20, decimal_places=2)
    total_liabilities = serializers.DecimalField(max_digits=20, decimal_places=2)
    retained_result = serializers.DecimalField(max_digits=20, decimal_places=2)
    total_equity = serializers.DecimalField(max_digits=20, decimal_places=2)
    balanced = serializers.BooleanField()


class BankReconciliationSessionSerializer(serializers.ModelSerializer):
    bank_account_name = serializers.CharField(source="bank_account.name", read_only=True)

    class Meta:
        model = BankReconciliationSession
        fields = ("id", "bank_account", "bank_account_name", "period_start", "period_end", "statement_opening_balance",
                  "statement_closing_balance", "status", "completed_at", "last_imported_at", "created_at", "updated_at")
        read_only_fields = ("id", "status", "completed_at", "last_imported_at", "created_at", "updated_at")
