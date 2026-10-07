from decimal import Decimal
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.audit.services import record_audit_event

from apps.accounting.models import (
    Account,
    ExpenseCategory,
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
    Customer,
    Invoice,
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
from apps.accounting.selectors import (
    available_accounting_preset_versions,
    balance_sheet,
    general_ledger,
    income_statement,
    trial_balance,
)
from apps.accounting.serializers import (
    ExpenseCategorySerializer,
    ExpenseFinanceReviewSerializer,
    ExpenseReverseSerializer,
    ExpenseSettleSerializer,
    ExpenseStepDecisionSerializer,
    AccountSerializer,
    BalanceSheetSerializer,
    BalanceSheetQuerySerializer,
    AccountingPeriodSerializer,
    AccountingPresetSerializer,
    AccountingPresetVersionSerializer,
    AccountingPresetApplicationSerializer,
    AccountingPresetApplicationResultSerializer,
    AccountTemplateSerializer,
    ChartOfAccountsTemplateSerializer,
    FiscalYearSerializer,
    GeneralLedgerQuerySerializer,
    GeneralLedgerSerializer,
    GhanaLocalizationVersionSerializer,
    IncomeStatementSerializer,
    InstitutionAccountingConfigurationSerializer,
    JournalEntrySerializer,
    JournalLineSerializer,
    JournalReversalSerializer,
    DateRangeQuerySerializer,
    TrialBalanceSerializer,
    TaxCodeSerializer,
    TaxComponentSerializer,
    WithholdingRuleSerializer,
    VendorSerializer,
    VendorBillSerializer,
    CustomerSerializer,
    InvoiceSerializer,
    BankAccountSerializer,
    PaymentSerializer,
    ReceiptSerializer,
    CashTransactionVoidSerializer,
    BankStatementLineSerializer,
    BankStatementMatchSerializer,
    VATWithholdingCertificateSerializer,
    GhanaComplianceReminderSerializer,
    ExpenseSerializer,
    PayrollAccountMappingTemplateSerializer,
    PayComponentAccountMappingSerializer,
    PayrollMappingTemplateApplySerializer,
)
from apps.accounting.services import (
    decide_expense_step,
    finance_review_expense,
    reverse_expense,
    settle_expense,
    apply_accounting_preset,
    approve_journal,
    create_reversal,
    close_fiscal_year,
    post_journal,
    set_period_status,
    submit_journal,
    void_journal,
    approve_vendor_bill,
    post_vendor_bill,
    submit_vendor_bill,
    void_vendor_bill,
    issue_invoice,
    void_invoice,
    void_payment,
    void_receipt,
    match_bank_statement_line,
    unmatch_bank_statement_line,
    void_vat_withholding_certificate,
    submit_expense,
    approve_expense,
    reject_expense,
    post_expense,
    apply_payroll_account_mapping_templates,
)
from common.permissions import TenantContextPermission, TenantRBACPermission
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet


class AccountingPresetViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AccountingPreset.objects.all()
    serializer_class = AccountingPresetSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    filterset_fields = ("country_code", "institution_type", "is_system_managed")
    search_fields = ("code", "name", "description")

    def get_required_permission(self):
        return "account.view"


class AccountingPresetVersionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AccountingPresetVersion.objects.select_related("accounting_preset")
    serializer_class = AccountingPresetVersionSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    filterset_fields = ("accounting_preset", "status", "effective_from")
    search_fields = ("version_code", "localization_version", "reporting_framework")

    schema_action_descriptions = {
        "apply": (
            "Atomically instantiate one chart template and select this preset version "
            "for the active institution"
        )
    }
    schema_action_error_codes = {
        "apply": (
            "invalid_state_transition",
            "policy_not_applicable",
            "duplicate_operation",
            "record_immutable",
        )
    }

    def get_required_permission(self):
        return "accounting.configure" if self.action == "apply" else "account.view"

    @extend_schema(
        request=AccountingPresetApplicationSerializer,
        responses=AccountingPresetApplicationResultSerializer,
        filters=False,
    )
    @action(detail=True, methods=("post",), filter_backends=())
    def apply(self, request, pk=None):
        preset_version = self.get_object()
        payload = AccountingPresetApplicationSerializer(
            data=request.data,
            context={**self.get_serializer_context(), "preset_version": preset_version},
        )
        payload.is_valid(raise_exception=True)
        result = call_validated_service(
            apply_accounting_preset,
            institution=request.institution,
            actor=request.user,
            preset_version=preset_version,
            **payload.validated_data,
        )
        return Response(
            AccountingPresetApplicationResultSerializer(
                result, context=self.get_serializer_context()
            ).data
        )


class GhanaLocalizationVersionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = GhanaLocalizationVersion.objects.all()
    serializer_class = GhanaLocalizationVersionSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    filterset_fields = ("code", "version", "status", "effective_from")
    search_fields = ("code", "version", "tax_authority")
    ordering_fields = ("code", "version", "effective_from")
    ordering = ("-effective_from", "code")

    def get_required_permission(self):
        return "account.view"


class TaxCodeViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = TaxCode.objects.select_related("preset_version", "preset_version__accounting_preset")
    serializer_class = TaxCodeSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    filterset_fields = ("preset_version", "code", "tax_treatment", "is_active", "effective_from")
    search_fields = ("code", "name", "tax_treatment")
    ordering_fields = ("code", "name", "effective_from")
    ordering = ("code", "effective_from")

    def get_required_permission(self):
        return "account.view"


class TaxComponentViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = TaxComponent.objects.select_related(
        "tax_code", "tax_code__preset_version", "tax_code__preset_version__accounting_preset"
    )
    serializer_class = TaxComponentSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    filterset_fields = ("tax_code", "code", "sequence")
    search_fields = ("code", "name", "input_account_mapping_code", "output_account_mapping_code")
    ordering_fields = ("code", "name", "sequence", "rate")
    ordering = ("tax_code", "sequence", "code")

    def get_required_permission(self):
        return "account.view"


class WithholdingRuleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = WithholdingRule.objects.select_related(
        "preset_version", "preset_version__accounting_preset"
    )
    serializer_class = WithholdingRuleSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    filterset_fields = (
        "preset_version",
        "code",
        "residency",
        "transaction_category",
        "is_vat_withholding_rule",
        "requires_confirmation",
        "effective_from",
    )
    search_fields = ("code", "name", "residency", "transaction_category")
    ordering_fields = ("code", "name", "rate", "effective_from")
    ordering = ("code", "effective_from")

    def get_required_permission(self):
        return "account.view"


class VendorViewSet(TenantModelViewSet):
    model = Vendor
    serializer_class = VendorSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = (
        "is_active", "country_code", "tax_residency", "taxpayer_type", "vat_registered",
        "withholding_category",
    )
    search_fields = ("vendor_code", "name", "email", "tax_identification_number")
    ordering_fields = ("vendor_code", "name", "created_at")
    ordering = ("vendor_code",)

    def get_required_permission(self):
        return {"create": "vendor.create", "partial_update": "vendor.update"}.get(
            self.action, "vendor.view"
        )

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def perform_update(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)


class RecordAttachmentsMixin:
    """Confidential supporting files on an accounting record (bills, invoices)."""

    attachment_entity_type = ""
    attachment_category = "SUPPORTING_DOCUMENT"

    def _record_documents(self, record):
        from apps.documents.models import Document

        return Document.objects.for_institution(self.request.institution).filter(
            entity_type=self.attachment_entity_type, entity_id=record.id, is_active=True
        )

    def _record_context(self, record):
        from apps.audit.models import AuditLog
        from apps.documents.serializers import DocumentSerializer

        audit = AuditLog.objects.filter(institution=self.request.institution, entity_id=record.id).select_related("actor").order_by("-created_at")[:50]
        return {
            "attachments": DocumentSerializer(self._record_documents(record), many=True, context={"request": self.request}).data,
            "audit": [
                {"id": str(entry.id), "action": entry.action, "actor": _person(entry.actor), "created_at": entry.created_at, "metadata": entry.metadata}
                for entry in audit
            ],
        }

    @action(detail=True, methods=("post",), filter_backends=(), parser_classes=(MultiPartParser, FormParser))
    def attachments(self, request, pk=None):
        import mimetypes

        from django.conf import settings as django_settings
        from apps.audit.services import record_audit_event
        from apps.documents.models import Document
        from apps.documents.serializers import DocumentSerializer
        from rest_framework.exceptions import ValidationError as DRFValidationError

        record = self.get_object()
        upload = request.FILES.get("uploaded_file")
        if upload is None:
            raise DRFValidationError({"uploaded_file": "Choose a file to upload."})
        if upload.size > django_settings.DOCUMENT_UPLOAD_MAX_BYTES:
            raise DRFValidationError({"uploaded_file": f"Files must be {django_settings.DOCUMENT_UPLOAD_MAX_BYTES // (1024 * 1024)} MB or smaller."})
        name = (upload.name or "attachment").replace("\\", "/").rsplit("/", 1)[-1][:255]
        content_type = (upload.content_type or "").split(";")[0].strip().lower()
        if not content_type or content_type == "application/octet-stream":
            content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        document = Document.objects.create(
            institution=request.institution, uploaded_by=request.user, stored_file=upload, original_filename=name,
            content_type=content_type[:150], size_bytes=upload.size, category=self.attachment_category,
            classification=Document.Classification.CONFIDENTIAL, entity_type=self.attachment_entity_type, entity_id=record.id,
        )
        record_audit_event(actor=request.user, institution=request.institution, entity=record, action=f"{self.attachment_entity_type.lower()}.attachment_added", metadata={"filename": name})
        return Response(DocumentSerializer(document, context={"request": request}).data, status=201)

    @action(detail=True, methods=("get",), filter_backends=(), url_path=r"attachments/(?P<document_id>[0-9a-f-]+)/download")
    def download_attachment(self, request, pk=None, document_id=None):
        from django.http import FileResponse
        from rest_framework.exceptions import NotFound

        document = self._record_documents(self.get_object()).filter(pk=document_id).first()
        if document is None or not document.stored_file:
            raise NotFound("Attachment not found.")
        response = FileResponse(document.stored_file.open("rb"), as_attachment=True, filename=document.original_filename,
                                content_type=document.content_type or "application/octet-stream")
        response["X-Content-Type-Options"] = "nosniff"
        return response


def _person(user):
    return (user.get_full_name() or user.email) if user else "System"


class VendorBillViewSet(RecordAttachmentsMixin, TenantModelViewSet):
    attachment_entity_type = "accounting.VendorBill"
    model = VendorBill
    serializer_class = VendorBillSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("vendor", "status", "currency", "accounting_period", "bill_date", "on_hold")
    search_fields = ("bill_number", "vendor__name", "vendor__vendor_code", "lines__description")
    ordering_fields = ("bill_number", "bill_date", "due_date", "total_amount", "created_at")
    ordering = ("-bill_date", "-created_at")
    schema_action_descriptions = {
        "submit": "Validate and submit a draft vendor bill for approval",
        "approve": "Approve a pending vendor bill for controlled posting",
        "post": "Create, approve, and post the linked AP journal for an approved bill",
        "void": "Void an unposted vendor bill",
    }
    schema_action_error_codes = {
        "submit": ("invalid_state_transition", "period_closed", "validation_error"),
        "approve": ("invalid_state_transition",),
        "post": ("invalid_state_transition", "policy_not_applicable", "period_closed"),
        "void": ("invalid_state_transition", "record_immutable"),
    }

    def get_queryset(self):
        return super().get_queryset().select_related(
            "vendor", "accounting_period", "journal_entry"
        ).prefetch_related("lines")

    def get_required_permission(self):
        return {
            "create": "vendor_bill.create",
            "partial_update": "vendor_bill.create",
            "submit": "vendor_bill.create",
            "approve": "vendor_bill.approve",
            "post": "vendor_bill.post",
            "void": "vendor_bill.void",
            "reject": "vendor_bill.approve",
            "hold": "vendor_bill.approve",
            "release": "vendor_bill.approve",
            "revise": "vendor_bill.create",
            "schedule_payment": "payment.create",
            "attachments": "vendor_bill.create",
            # bulk_execute checks the chosen operation's own permission per call.
        }.get(self.action, "vendor_bill.view")

    def _bill_response(self, service, **kwargs):
        bill = call_validated_service(service, bill=self.get_object(), actor=self.request.user, **kwargs)
        return Response(VendorBillSerializer(bill, context=self.get_serializer_context()).data)

    @action(detail=True, methods=("post",), filter_backends=())
    def reject(self, request, pk=None):
        from apps.accounting.services import reject_vendor_bill

        return self._bill_response(reject_vendor_bill, reason=str(request.data.get("reason", "")))

    @action(detail=True, methods=("post",), filter_backends=())
    def revise(self, request, pk=None):
        from apps.accounting.services import revise_vendor_bill

        return self._bill_response(revise_vendor_bill)

    @action(detail=True, methods=("post",), filter_backends=())
    def hold(self, request, pk=None):
        from apps.accounting.services import set_vendor_bill_hold

        return self._bill_response(set_vendor_bill_hold, on_hold=True, reason=str(request.data.get("reason", "")))

    @action(detail=True, methods=("post",), filter_backends=())
    def release(self, request, pk=None):
        from apps.accounting.services import set_vendor_bill_hold

        return self._bill_response(set_vendor_bill_hold, on_hold=False)

    @action(detail=True, methods=("post",), filter_backends=(), url_path="schedule-payment")
    def schedule_payment(self, request, pk=None):
        from datetime import date as date_type

        from apps.accounting.services import schedule_vendor_bill_payment
        from rest_framework.exceptions import ValidationError as DRFValidationError

        try:
            payment_date = date_type.fromisoformat(str(request.data.get("payment_date", "")))
        except ValueError:
            raise DRFValidationError({"payment_date": "Use a YYYY-MM-DD date."})
        return self._bill_response(schedule_vendor_bill_payment, payment_date=payment_date, payment_method=str(request.data.get("payment_method", "")))

    @action(detail=True, methods=("get",), filter_backends=())
    def context(self, request, pk=None):
        """Payments, related records, attachments and audit history for the bill detail page."""
        bill = self.get_object()
        payload = self._record_context(bill)
        payload["payments"] = [
            {"id": str(item.id), "payment_number": item.payment_number, "payment_date": item.payment_date, "amount": str(item.amount),
             "currency": item.currency, "payment_method": item.payment_method, "status": item.status}
            for item in bill.payments.order_by("-payment_date")
        ]
        related = []
        if bill.journal_entry_id:
            related.append({"type": "AP journal", "reference": bill.journal_entry.journal_number, "status": bill.journal_entry.status, "href": f"/accounting/journals/{bill.journal_entry_id}"})
        for certificate in bill.vat_withholding_certificates.all():
            related.append({"type": "VAT withholding certificate", "reference": certificate.certificate_number, "status": getattr(certificate, "status", ""), "href": None})
        for payment in payload["payments"]:
            related.append({"type": "Payment", "reference": payment["payment_number"], "status": payment["status"], "href": None})
        payload["related"] = related
        payload["vendor"] = {
            "id": str(bill.vendor_id), "name": bill.vendor.name, "code": bill.vendor.vendor_code, "email": bill.vendor.email,
            "phone": bill.vendor.phone, "address": bill.vendor.address, "tax_identification_number": bill.vendor.tax_identification_number,
        }
        payload["institution"] = {"name": request.institution.name}
        return Response(payload)

    @action(detail=False, methods=("post",), filter_backends=(), url_path="bulk/preview")
    def bulk_preview(self, request):
        """Which bulk actions the selected bills can take, and why the others cannot."""
        from apps.accounting.batch import preview

        ids = request.data.get("ids") or []
        return Response(call_validated_service(preview, resource="vendor_bill", institution=request.institution, actor=request.user, ids=list(ids)))

    @action(detail=False, methods=("post",), filter_backends=(), url_path="bulk/execute")
    def bulk_execute(self, request):
        """Run one governed bulk action; each bill succeeds or fails on its own."""
        from apps.accounting.batch import RESOURCES, execute, serialize_job

        job = call_validated_service(
            execute, resource="vendor_bill", institution=request.institution, actor=request.user,
            ids=list(request.data.get("ids") or []), operation_code=str(request.data.get("operation", "")),
            reason=str(request.data.get("reason", "")), confirm_text=str(request.data.get("confirm_text", "")),
        )
        return Response(serialize_job(job, RESOURCES["vendor_bill"]["operations"]()), status=201)

    @action(detail=False, methods=("get",), filter_backends=(), url_path="batch-jobs")
    def batch_jobs(self, request):
        """Recent bulk actions on vendor bills, newest first."""
        from apps.accounting.batch import RESOURCES, serialize_job
        from apps.accounting.models import BatchJob

        operations = RESOURCES["vendor_bill"]["operations"]()
        jobs = BatchJob.objects.filter(institution=request.institution, resource="vendor_bill").select_related("created_by")
        limit = request.query_params.get("limit", "5")
        limit = min(int(limit), 50) if limit.isdigit() and int(limit) > 0 else 5
        return Response({"count": jobs.count(), "results": [serialize_job(job, operations) for job in jobs[:limit]]})

    @action(detail=False, methods=("get",), filter_backends=())
    def summary(self, request):
        """Tab counts, approval queue and vendor/payment summary for the AP workspace."""
        from datetime import timedelta

        from django.db.models import Sum
        from django.utils import timezone

        from apps.accounting.models import Payment

        try:
            span = int(request.query_params.get("months", 12))
        except (TypeError, ValueError):
            span = 12
        span = span if span in (3, 6, 12) else 12
        start = timezone.localdate().replace(day=1)
        for _ in range(span - 1):
            start = (start - timedelta(days=1)).replace(day=1)
        bills = VendorBill.objects.for_institution(request.institution)
        in_range = bills.filter(bill_date__gte=start)
        pending = bills.filter(status=VendorBill.Status.PENDING).select_related("vendor", "submitted_by").order_by("submitted_at", "bill_date")
        membership = getattr(request, "membership", None)
        codes = set(membership.role.permissions.values_list("code", flat=True)) if membership else set()
        can_see_payments = "payment.view" in codes
        payments = Payment.objects.filter(institution=request.institution, status=Payment.Status.POSTED, vendor_bill__isnull=False, payment_date__gte=start)
        return Response({
            "range_months": span,
            "range_start": start.isoformat(),
            "counts": {
                "all": in_range.count(),
                "pending": in_range.filter(status=VendorBill.Status.PENDING).count(),
                "approved": in_range.filter(status=VendorBill.Status.APPROVED).count(),
                "rejected": in_range.filter(status=VendorBill.Status.REJECTED).count(),
                "paid": in_range.filter(status=VendorBill.Status.PAID).count(),
                "on_hold": in_range.filter(on_hold=True).count(),
            },
            "approval_queue": [
                {"id": str(bill.id), "vendor": bill.vendor.name, "bill_number": bill.bill_number, "amount": str(bill.total_amount),
                 "currency": bill.currency, "submitted_at": bill.submitted_at, "submitted_by": _person(bill.submitted_by) if bill.submitted_by_id else None,
                 "on_hold": bill.on_hold}
                for bill in pending[:5]
            ],
            "approval_queue_total": pending.count(),
            "active_vendors": Vendor.objects.for_institution(request.institution).filter(is_active=True).count(),
            "total_bills": in_range.exclude(status=VendorBill.Status.VOID).count(),
            "payments_made": payments.count() if can_see_payments else None,
            "payments_amount": str(payments.aggregate(total=Sum("amount"))["total"] or 0) if can_see_payments else None,
            "amounts_restricted": not can_see_payments,
        })

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def perform_update(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(request=None, responses=VendorBillSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def submit(self, request, pk=None):
        return Response(
            VendorBillSerializer(
                call_validated_service(
                    submit_vendor_bill, bill=self.get_object(), actor=request.user
                ),
                context=self.get_serializer_context(),
            ).data
        )

    @extend_schema(request=None, responses=VendorBillSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def approve(self, request, pk=None):
        return Response(
            VendorBillSerializer(
                call_validated_service(
                    approve_vendor_bill, bill=self.get_object(), actor=request.user
                ),
                context=self.get_serializer_context(),
            ).data
        )

    @extend_schema(request=None, responses=VendorBillSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def post(self, request, pk=None):
        return Response(
            VendorBillSerializer(
                call_validated_service(
                    post_vendor_bill, bill=self.get_object(), actor=request.user
                ),
                context=self.get_serializer_context(),
            ).data
        )

    @extend_schema(request=None, responses=VendorBillSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def void(self, request, pk=None):
        return Response(
            VendorBillSerializer(
                call_validated_service(
                    void_vendor_bill, bill=self.get_object(), actor=request.user
                ),
                context=self.get_serializer_context(),
            ).data
        )


class CustomerViewSet(TenantModelViewSet):
    model = Customer
    serializer_class = CustomerSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("is_active", "country_code", "tax_residency", "taxpayer_type", "vat_registered")
    search_fields = ("customer_code", "name", "email", "tax_identification_number")
    ordering_fields = ("customer_code", "name", "created_at")
    ordering = ("customer_code",)

    def get_required_permission(self):
        return {"create": "customer.create", "partial_update": "customer.update"}.get(self.action, "customer.view")

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def perform_update(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)


class InvoiceViewSet(RecordAttachmentsMixin, TenantModelViewSet):
    model = Invoice
    serializer_class = InvoiceSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("customer", "status", "currency", "accounting_period", "invoice_date", "on_hold")
    search_fields = ("invoice_number", "customer__name", "customer__customer_code", "external_tax_reference", "lines__description")
    ordering_fields = ("invoice_number", "invoice_date", "due_date", "total_amount", "created_at")
    ordering = ("-invoice_date", "-created_at")
    attachment_entity_type = "accounting.Invoice"
    schema_action_descriptions = {"issue": "Issue a draft invoice and post its controlled AR journal", "void": "Void a draft invoice"}
    schema_action_error_codes = {"issue": ("invalid_state_transition", "policy_not_applicable", "period_closed"), "void": ("record_immutable",)}

    def get_queryset(self):
        return super().get_queryset().select_related("customer", "accounting_period", "journal_entry").prefetch_related("lines")

    def get_required_permission(self):
        return {
            "create": "invoice.create", "partial_update": "invoice.create", "issue": "invoice.issue", "void": "invoice.void",
            "hold": "invoice.issue", "release": "invoice.issue", "send": "invoice.issue", "reminders": "invoice.issue" if self.request.method == "POST" else "invoice.view",
            "update_reminder": "invoice.issue", "attachments": "invoice.create",
        }.get(self.action, "invoice.view")

    def _invoice(self, invoice):
        return Response(InvoiceSerializer(invoice, context=self.get_serializer_context()).data)

    @action(detail=True, methods=("post",), filter_backends=())
    def hold(self, request, pk=None):
        from apps.accounting.services import set_invoice_hold

        return self._invoice(call_validated_service(set_invoice_hold, invoice=self.get_object(), actor=request.user, on_hold=True, reason=str(request.data.get("reason", ""))))

    @action(detail=True, methods=("post",), filter_backends=())
    def release(self, request, pk=None):
        from apps.accounting.services import set_invoice_hold

        return self._invoice(call_validated_service(set_invoice_hold, invoice=self.get_object(), actor=request.user, on_hold=False))

    @action(detail=True, methods=("post",), filter_backends=())
    def send(self, request, pk=None):
        from apps.accounting.services import send_invoice

        invoice, delivery = call_validated_service(send_invoice, invoice=self.get_object(), actor=request.user, email=str(request.data.get("email", "")))
        payload = InvoiceSerializer(invoice, context=self.get_serializer_context()).data
        return Response({**payload, "delivery": delivery})

    @action(detail=True, methods=("get", "post"), filter_backends=())
    def reminders(self, request, pk=None):
        from datetime import date as date_type

        from apps.accounting.services import add_invoice_reminder
        from rest_framework.exceptions import ValidationError as DRFValidationError

        invoice = self.get_object()
        if request.method == "POST":
            try:
                remind_on = date_type.fromisoformat(str(request.data.get("remind_on", "")))
            except ValueError:
                raise DRFValidationError({"remind_on": "Use a YYYY-MM-DD date."})
            call_validated_service(add_invoice_reminder, invoice=invoice, actor=request.user, remind_on=remind_on,
                                   channel=str(request.data.get("channel", "EMAIL")), note=str(request.data.get("note", "")))
        return Response(_reminders(invoice), status=201 if request.method == "POST" else 200)

    @extend_schema(operation_id="invoices_reminders_update")
    @action(detail=True, methods=("post",), filter_backends=(), url_path=r"reminders/(?P<reminder_id>[0-9a-f-]+)")
    def update_reminder(self, request, pk=None, reminder_id=None):
        from apps.accounting.services import update_invoice_reminder
        from rest_framework.exceptions import NotFound

        invoice = self.get_object()
        reminder = invoice.reminders.filter(pk=reminder_id).first()
        if reminder is None:
            raise NotFound("Reminder not found.")
        call_validated_service(update_invoice_reminder, reminder=reminder, actor=request.user, status=str(request.data.get("status", "")))
        return Response(_reminders(invoice))

    @action(detail=True, methods=("get",), filter_backends=())
    def context(self, request, pk=None):
        from django.utils import timezone

        invoice = self.get_object()
        payload = self._record_context(invoice)
        payload["receipts"] = [
            {"id": str(item.id), "receipt_number": item.receipt_number, "receipt_date": item.receipt_date, "amount": str(item.amount),
             "currency": item.currency, "payment_method": item.payment_method, "status": item.status}
            for item in Receipt.objects.filter(invoice=invoice).order_by("-receipt_date")
        ]
        payload["reminders"] = _reminders(invoice)
        related = []
        if invoice.journal_entry_id:
            related.append({"type": "AR journal", "reference": invoice.journal_entry.journal_number, "status": invoice.journal_entry.status, "href": f"/accounting/journals/{invoice.journal_entry_id}"})
        for receipt in payload["receipts"]:
            related.append({"type": "Receipt", "reference": receipt["receipt_number"], "status": receipt["status"], "href": None})
        payload["related"] = related
        today = timezone.localdate()
        payload["collection"] = {
            "days_outstanding": (today - invoice.invoice_date).days if invoice.status in (Invoice.Status.ISSUED, Invoice.Status.PART_PAID) else None,
            "days_overdue": max((today - invoice.due_date).days, 0) if invoice.status in (Invoice.Status.ISSUED, Invoice.Status.PART_PAID) else 0,
        }
        payload["customer"] = {
            "id": str(invoice.customer_id), "name": invoice.customer.name, "code": invoice.customer.customer_code, "email": invoice.customer.email,
            "phone": invoice.customer.phone, "address": invoice.customer.address, "tax_identification_number": invoice.customer.tax_identification_number,
        }
        payload["institution"] = {"name": request.institution.name}
        return Response(payload)

    @action(detail=False, methods=("get",), filter_backends=())
    def summary(self, request):
        """KPIs, tab counts and upcoming receipts for the AR workspace."""
        from datetime import timedelta

        from django.db.models import Q, Sum
        from django.utils import timezone

        from apps.accounting.services import invoice_amount_received

        try:
            span = int(request.query_params.get("months", 12))
        except (TypeError, ValueError):
            span = 12
        span = span if span in (3, 6, 12) else 12
        today = timezone.localdate()
        start = today.replace(day=1)
        for _ in range(span - 1):
            start = (start - timedelta(days=1)).replace(day=1)
        invoices = Invoice.objects.for_institution(request.institution)
        in_range = invoices.filter(invoice_date__gte=start)
        open_statuses = (Invoice.Status.ISSUED, Invoice.Status.PART_PAID)
        outstanding = invoices.filter(status__in=open_statuses)
        overdue = outstanding.filter(due_date__lt=today)
        due_week = outstanding.filter(due_date__gte=today, due_date__lte=today + timedelta(days=7))
        exceptions = outstanding.filter(Q(on_hold=True) | Q(due_date__lt=today - timedelta(days=60)))
        membership = getattr(request, "membership", None)
        codes = set(membership.role.permissions.values_list("code", flat=True)) if membership else set()
        can_see_amounts = "receipt.view" in codes

        def total_due(queryset):
            return str(sum((invoice.total_amount - invoice_amount_received(invoice) for invoice in queryset), Decimal("0.00")).quantize(Decimal("0.01")))

        upcoming = outstanding.filter(due_date__gte=today, due_date__lte=today + timedelta(days=30)).select_related("customer").order_by("due_date")
        return Response({
            "range_months": span,
            "range_start": start.isoformat(),
            "outstanding": {"count": outstanding.count(), "amount": total_due(outstanding) if can_see_amounts else None},
            "due_this_week": {"count": due_week.count(), "amount": total_due(due_week) if can_see_amounts else None},
            "overdue": {"count": overdue.count(), "amount": total_due(overdue) if can_see_amounts else None},
            "exceptions": {"count": exceptions.count(), "on_hold": outstanding.filter(on_hold=True).count(), "over_60_days": outstanding.filter(due_date__lt=today - timedelta(days=60)).count()},
            "counts": {
                "all": in_range.count(),
                "outstanding": in_range.filter(status__in=open_statuses).count(),
                "overdue": in_range.filter(status__in=open_statuses, due_date__lt=today).count(),
                "paid": in_range.filter(status=Invoice.Status.PAID).count(),
                "on_hold": in_range.filter(on_hold=True).count(),
                "drafts": in_range.filter(status=Invoice.Status.DRAFT).count(),
            },
            "upcoming_receipts": [
                {"id": str(item.id), "customer": item.customer.name, "invoice_number": item.invoice_number, "due_date": item.due_date,
                 "amount_due": str(item.total_amount - invoice_amount_received(item)) if can_see_amounts else None, "currency": item.currency}
                for item in upcoming[:6]
            ],
            "amounts_restricted": not can_see_amounts,
            "today": today.isoformat(),
        })

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def perform_update(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(request=None, responses=InvoiceSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def issue(self, request, pk=None):
        return Response(InvoiceSerializer(call_validated_service(issue_invoice, invoice=self.get_object(), actor=request.user), context=self.get_serializer_context()).data)

    @extend_schema(request=None, responses=InvoiceSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def void(self, request, pk=None):
        return Response(InvoiceSerializer(call_validated_service(void_invoice, invoice=self.get_object(), actor=request.user), context=self.get_serializer_context()).data)


def _reminders(invoice):
    return [
        {"id": str(item.id), "remind_on": item.remind_on, "channel": item.channel, "note": item.note, "status": item.status,
         "created_by": _person(item.created_by), "completed_at": item.completed_at}
        for item in invoice.reminders.select_related("created_by")
    ]


class BankAccountViewSet(TenantModelViewSet):
    model = BankAccount
    serializer_class = BankAccountSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("is_active", "currency", "ledger_account")
    search_fields = ("name", "bank_name", "masked_account_number")
    ordering_fields = ("name", "bank_name", "created_at")
    ordering = ("name",)

    def get_required_permission(self):
        return {"create": "bank_account.create", "partial_update": "bank_account.update"}.get(
            self.action, "bank_account.view"
        )

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def perform_update(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)


class PaymentViewSet(TenantModelViewSet):
    model = Payment
    serializer_class = PaymentSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("status", "currency", "payment_method", "bank_account", "vendor_bill", "payment_date")
    search_fields = ("payment_number", "vendor_bill__bill_number", "vendor_bill__vendor__name")
    ordering_fields = ("payment_number", "payment_date", "amount", "created_at")
    ordering = ("-payment_date", "-created_at")
    schema_action_descriptions = {
        "create": "Post one payment against one vendor bill and derive the bill settlement state",
        "void": "Reverse a posted payment journal and recompute the linked vendor bill state",
    }
    schema_action_error_codes = {
        "create": ("invalid_state_transition", "period_closed", "policy_not_applicable", "validation_error"),
        "void": ("invalid_state_transition", "period_closed", "record_immutable"),
    }

    def get_queryset(self):
        return super().get_queryset().select_related("bank_account", "vendor_bill", "journal_entry")

    def get_required_permission(self):
        return {"create": "payment.create", "void": "payment.void"}.get(
            self.action, "payment.view"
        )

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(request=CashTransactionVoidSerializer, responses=PaymentSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def void(self, request, pk=None):
        payment = self.get_object()
        payload = CashTransactionVoidSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(
            PaymentSerializer(
                call_validated_service(
                    void_payment,
                    payment=payment,
                    actor=request.user,
                    **payload.validated_data,
                ),
                context=self.get_serializer_context(),
            ).data
        )


class ReceiptViewSet(TenantModelViewSet):
    model = Receipt
    serializer_class = ReceiptSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("status", "currency", "payment_method", "bank_account", "invoice", "receipt_date")
    search_fields = ("receipt_number", "invoice__invoice_number", "invoice__customer__name")
    ordering_fields = ("receipt_number", "receipt_date", "amount", "created_at")
    ordering = ("-receipt_date", "-created_at")
    schema_action_descriptions = {
        "create": "Post one receipt against one invoice and derive the invoice settlement state",
        "void": "Reverse a posted receipt journal and recompute the linked invoice state",
    }
    schema_action_error_codes = {
        "create": ("invalid_state_transition", "period_closed", "policy_not_applicable", "validation_error"),
        "void": ("invalid_state_transition", "period_closed", "record_immutable"),
    }

    def get_queryset(self):
        return super().get_queryset().select_related("bank_account", "invoice", "journal_entry")

    def get_required_permission(self):
        return {"create": "receipt.create", "void": "receipt.void"}.get(
            self.action, "receipt.view"
        )

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(request=CashTransactionVoidSerializer, responses=ReceiptSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def void(self, request, pk=None):
        receipt = self.get_object()
        payload = CashTransactionVoidSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(
            ReceiptSerializer(
                call_validated_service(
                    void_receipt,
                    receipt=receipt,
                    actor=request.user,
                    **payload.validated_data,
                ),
                context=self.get_serializer_context(),
            ).data
        )


class BankStatementLineViewSet(TenantModelViewSet):
    model = BankStatementLine
    serializer_class = BankStatementLineSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("bank_account", "status", "currency", "statement_date")
    search_fields = ("external_id", "reference", "description")
    ordering_fields = ("statement_date", "amount", "created_at")
    ordering = ("-statement_date", "-created_at")
    schema_action_descriptions = {
        "create": "Import an idempotent bank statement line using its bank-supplied external identifier",
        "match": "Match one statement movement to one posted journal with an equal bank-ledger movement",
        "unmatch": "Remove a statement-to-journal match without altering either ledger record",
    }
    schema_action_error_codes = {
        "create": ("duplicate_operation", "validation_error"),
        "match": ("invalid_state_transition", "duplicate_operation", "validation_error"),
        "unmatch": ("invalid_state_transition",),
    }

    def get_queryset(self):
        return super().get_queryset().select_related("bank_account", "journal_entry", "reconciled_by")

    def get_required_permission(self):
        return {"create": "bank_reconciliation.manage", "match": "bank_reconciliation.manage", "unmatch": "bank_reconciliation.manage"}.get(self.action, "bank_reconciliation.view")

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(request=BankStatementMatchSerializer, responses=BankStatementLineSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def match(self, request, pk=None):
        payload = BankStatementMatchSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        return Response(BankStatementLineSerializer(call_validated_service(match_bank_statement_line, statement_line=self.get_object(), actor=request.user, **payload.validated_data), context=self.get_serializer_context()).data)

    @extend_schema(request=None, responses=BankStatementLineSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def unmatch(self, request, pk=None):
        return Response(BankStatementLineSerializer(call_validated_service(unmatch_bank_statement_line, statement_line=self.get_object(), actor=request.user), context=self.get_serializer_context()).data)


class VATWithholdingCertificateViewSet(TenantModelViewSet):
    model = VATWithholdingCertificate
    serializer_class = VATWithholdingCertificateSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("vendor_bill", "withholding_rule", "status", "certificate_date")
    search_fields = ("certificate_number",)
    ordering_fields = ("certificate_date", "certificate_number", "created_at")
    schema_action_descriptions = {"create": "Issue a VAT withholding certificate for a posted vendor bill", "void": "Void an issued VAT withholding certificate while retaining audit history"}
    schema_action_error_codes = {"create": ("policy_not_applicable", "invalid_state_transition", "validation_error"), "void": ("invalid_state_transition",)}

    def get_required_permission(self):
        return {"create": "vat_withholding_certificate.issue", "void": "vat_withholding_certificate.issue"}.get(self.action, "vat_withholding_certificate.view")

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(request=None, responses=VATWithholdingCertificateSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def void(self, request, pk=None):
        return Response(VATWithholdingCertificateSerializer(call_validated_service(void_vat_withholding_certificate, certificate=self.get_object(), actor=request.user), context=self.get_serializer_context()).data)


class GhanaComplianceReminderViewSet(TenantModelViewSet):
    model = GhanaComplianceReminder
    serializer_class = GhanaComplianceReminderSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("code", "status", "due_date")
    ordering_fields = ("due_date", "code", "created_at")

    def get_required_permission(self):
        return "accounting.configure" if self.action in {"create", "partial_update"} else "financial_report.view"

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution)


def _holds(request, code):
    from apps.institutions.services import effective_permission_codes

    return code in effective_permission_codes(getattr(request, "membership", None))


class ExpenseCategoryViewSet(TenantModelViewSet):
    """Expense categories and their GL accounts; claimants read them to fill a claim."""

    model = ExpenseCategory
    serializer_class = ExpenseCategorySerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("is_active",)
    search_fields = ("code", "name")

    def get_required_permission(self):
        if self.action in ("create", "partial_update"):
            return "accounting.configure"
        return "expense.view" if _holds(self.request, "expense.view") else "expense.claim_own"

    def perform_create(self, serializer):
        category = serializer.save(institution=self.request.institution)
        record_audit_event(actor=self.request.user, institution=self.request.institution, entity=category, action="accounting.expense_category.created")

    def perform_update(self, serializer):
        category = serializer.save()
        record_audit_event(actor=self.request.user, institution=self.request.institution, entity=category, action="accounting.expense_category.updated", metadata={"fields": sorted(serializer.validated_data)})


class ExpenseViewSet(TenantModelViewSet):
    """Expense claims (Expense Management 2.0). Paths are unchanged from the flat expense API."""

    model = Expense
    serializer_class = ExpenseSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("status", "currency", "account", "expense_date", "claimant", "payment_method")
    search_fields = ("description",)
    ordering_fields = ("expense_date", "amount", "created_at")
    schema_action_descriptions = {
        "submit": "Submit a draft or returned expense", "approve": "Approve (manager step, or legacy one-step approval)",
        "reject": "Reject a pending expense", "return_for_changes": "Return a claim to the claimant",
        "finance_review": "Finance review: approve, return or reject, with optional recoding",
        "post": "Post an approved expense to the ledger", "settle": "Record settlement of a posted reimbursable claim",
        "reverse": "Reverse a posted claim (governed correction)", "policy_checks": "Policy checks for this claim",
    }
    schema_action_error_codes = {
        "submit": ("invalid_state_transition", "policy_not_applicable"), "approve": ("invalid_state_transition", "separation_of_duties"),
        "reject": ("invalid_state_transition",), "return_for_changes": ("invalid_state_transition",),
        "finance_review": ("invalid_state_transition", "policy_not_applicable"),
        "post": ("invalid_state_transition", "period_closed", "policy_not_applicable"),
        "settle": ("invalid_state_transition", "period_closed", "policy_not_applicable"),
        "reverse": ("invalid_state_transition", "period_closed"),
    }

    def get_queryset(self):
        queryset = super().get_queryset().select_related("claimant", "claimant__user").prefetch_related("lines__category", "lines__account", "lines__receipts", "approvals__approver")
        if getattr(self, "swagger_fake_view", False) or _holds(self.request, "expense.view"):
            return queryset
        # Self-service: your own claims, and claims waiting on (or decided by) you.
        from django.db.models import Q

        return queryset.filter(Q(claimant__user=self.request.user) | Q(created_by=self.request.user) | Q(approvals__approver=self.request.user)).distinct()

    def get_required_permission(self):
        own = "expense.claim_own"
        creates = "expense.create" if _holds(self.request, "expense.create") else own
        decides = "expense.approve" if _holds(self.request, "expense.approve") else own
        mapping = {
            "create": creates,
            "partial_update": creates,
            "submit": creates,
            # Manager-stage decisions are authorized by step assignment in the service.
            "approve": decides,
            "reject": decides,
            "return_for_changes": own,
            "finance_review": "expense.finance_review",
            "post": "expense.post",
            "reverse": "expense.post",
            "settle": "expense.settle",
        }
        if self.action in mapping:
            return mapping[self.action]
        return "expense.view" if _holds(self.request, "expense.view") else own

    def perform_create(self, serializer): serializer.save(institution=self.request.institution, actor=self.request.user)
    def perform_update(self, serializer): serializer.save(actor=self.request.user)

    def _respond(self, expense):
        return Response(ExpenseSerializer(expense, context=self.get_serializer_context()).data)

    @action(detail=True, methods=("post",), filter_backends=())
    def submit(self, request, pk=None): return self._respond(call_validated_service(submit_expense, expense=self.get_object(), actor=request.user))

    @extend_schema(request=ExpenseStepDecisionSerializer)
    @action(detail=True, methods=("post",), filter_backends=())
    def approve(self, request, pk=None): return self._respond(call_validated_service(approve_expense, expense=self.get_object(), actor=request.user))

    @extend_schema(request=ExpenseStepDecisionSerializer)
    @action(detail=True, methods=("post",), filter_backends=())
    def reject(self, request, pk=None):
        payload = ExpenseStepDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._respond(call_validated_service(reject_expense, expense=self.get_object(), actor=request.user, comment=payload.validated_data["comment"]))

    @extend_schema(request=ExpenseStepDecisionSerializer)
    @action(detail=True, methods=("post",), url_path="return", filter_backends=())
    def return_for_changes(self, request, pk=None):
        payload = ExpenseStepDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._respond(call_validated_service(decide_expense_step, expense=self.get_object(), actor=request.user, decision="return", comment=payload.validated_data["comment"]))

    @extend_schema(request=ExpenseFinanceReviewSerializer)
    @action(detail=True, methods=("post",), url_path="finance-review", filter_backends=())
    def finance_review(self, request, pk=None):
        payload = ExpenseFinanceReviewSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        recodes = {str(key): str(value) for key, value in data["recodes"].items()}
        return self._respond(call_validated_service(finance_review_expense, expense=self.get_object(), actor=request.user, decision=data["decision"], comment=data["comment"], recodes=recodes))

    @action(detail=True, methods=("post",), filter_backends=())
    def post(self, request, pk=None): return self._respond(call_validated_service(post_expense, expense=self.get_object(), actor=request.user))

    @extend_schema(request=ExpenseSettleSerializer)
    @action(detail=True, methods=("post",), filter_backends=())
    def settle(self, request, pk=None):
        payload = ExpenseSettleSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        return self._respond(call_validated_service(settle_expense, expense=self.get_object(), actor=request.user, settlement_account=str(data["settlement_account"]), settlement_date=data.get("settlement_date"), reference=data["reference"]))

    @extend_schema(request=ExpenseReverseSerializer)
    @action(detail=True, methods=("post",), filter_backends=())
    def reverse(self, request, pk=None):
        payload = ExpenseReverseSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._respond(call_validated_service(reverse_expense, expense=self.get_object(), actor=request.user, reason=payload.validated_data["reason"], reversal_date=payload.validated_data.get("reversal_date")))

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    @action(detail=True, methods=("get",), url_path="policy-checks", filter_backends=())
    def policy_checks(self, request, pk=None):
        from apps.accounting.expenses import policy_checks

        return Response({"checks": policy_checks(self.get_object())})


class PayrollAccountMappingTemplateViewSet(viewsets.ReadOnlyModelViewSet):
    # Stable order so pagination never repeats or skips templates.
    queryset = PayrollAccountMappingTemplate.objects.select_related("accounting_preset_version").order_by("accounting_preset_version_id", "payroll_component_code", "id")
    serializer_class = PayrollAccountMappingTemplateSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    def get_required_permission(self): return "account.view"


class PayComponentAccountMappingViewSet(TenantModelViewSet):
    model = PayComponentAccountMapping
    serializer_class = PayComponentAccountMappingSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    def get_required_permission(self): return "payroll_accounting.configure" if self.action in {"create", "partial_update", "apply_templates"} else "payroll_accounting.view"

    @extend_schema(request=PayrollMappingTemplateApplySerializer, responses=PayComponentAccountMappingSerializer(many=True), filters=False)
    @action(detail=False, methods=("post",), url_path="apply-templates", filter_backends=())
    def apply_templates(self, request):
        payload = PayrollMappingTemplateApplySerializer(data=request.data); payload.is_valid(raise_exception=True)
        result = call_validated_service(apply_payroll_account_mapping_templates, institution=request.institution, actor=request.user, **payload.validated_data)
        return Response(PayComponentAccountMappingSerializer(result, many=True, context=self.get_serializer_context()).data)


class ChartOfAccountsTemplateViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ChartOfAccountsTemplate.objects.select_related(
        "preset_version", "preset_version__accounting_preset"
    )
    serializer_class = ChartOfAccountsTemplateSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    filterset_fields = ("preset_version",)
    search_fields = ("name", "description")

    def get_required_permission(self):
        return "account.view"


class AccountTemplateViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AccountTemplate.objects.select_related(
        "coa_template", "coa_template__preset_version", "parent_template"
    )
    serializer_class = AccountTemplateSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    filterset_fields = (
        "coa_template",
        "account_type",
        "normal_balance",
        "parent_template",
        "is_postable",
        "system_mapping_code",
    )
    search_fields = ("code", "name", "system_mapping_code")
    ordering_fields = ("code", "name", "account_type")
    ordering = ("code",)

    def get_required_permission(self):
        return "account.view"


class InstitutionAccountingConfigurationViewSet(TenantModelViewSet):
    model = InstitutionAccountingConfiguration
    serializer_class = InstitutionAccountingConfigurationSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")

    def get_required_permission(self):
        return (
            "accounting.configure"
            if self.action in {"create", "partial_update"}
            else "account.view"
        )

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def perform_update(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @action(detail=False, methods=("get",), filter_backends=())
    def choices(self, request):
        versions = available_accounting_preset_versions(
            institution=request.institution
        )
        choices = [
            {
                "mode": "PRESET",
                "preset_version_id": str(version.id),
                "preset_code": version.accounting_preset.code,
                "version_code": version.version_code,
                "name": version.accounting_preset.name,
                "institution_type": version.accounting_preset.institution_type,
                "reporting_framework": version.reporting_framework,
                "coa_templates": [
                    {"id": str(template.id), "name": template.name}
                    for template in version.coa_templates.all()
                ],
            }
            for version in versions
        ]
        choices.append(
            {
                "mode": "CUSTOM",
                "preset_version_id": None,
                "preset_code": None,
                "version_code": None,
                "name": "Configure manually",
                "reporting_framework": None,
                "compliance_warning": (
                    "Manual accounting setup does not apply localized chart or tax defaults."
                ),
            }
        )
        return Response(
            {
                "country_code": request.institution.country_code,
                "currency": request.institution.default_currency,
                "choices": choices,
            }
        )


class AccountViewSet(TenantModelViewSet):
    model = Account
    serializer_class = AccountSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("account_type", "normal_balance", "parent", "is_postable", "is_active")
    search_fields = ("code", "name")
    ordering_fields = ("code", "name", "account_type", "created_at")
    ordering = ("code",)

    def get_required_permission(self):
        return {
            "create": "account.create",
            "partial_update": "account.update",
            "activity": "journal.view",
            "balances": "account.view",
        }.get(self.action, "account.view")

    @action(detail=False, methods=("get",), filter_backends=())
    def balances(self, request):
        """Posted balance per account (debit minus credit) for the chart of accounts."""
        from django.db.models import Sum

        rows = JournalLine.objects.filter(
            journal_entry__institution=request.institution,
            journal_entry__status__in=(JournalEntry.Status.POSTED, JournalEntry.Status.REVERSED),
        ).values("account_id").annotate(debit=Sum("debit"), credit=Sum("credit"))
        cents = Decimal("0.01")
        return Response({str(row["account_id"]): str((Decimal(row["debit"] or 0) - Decimal(row["credit"] or 0)).quantize(cents)) for row in rows})

    @action(detail=True, methods=("get",), filter_backends=())
    def activity(self, request, pk=None):
        """Every journal line on this account in the range, posted or not, with a
        running balance over posted lines and a monthly movement summary."""
        from datetime import date as date_type
        from decimal import Decimal as D

        from django.db.models import Sum
        from django.db.models.functions import TruncMonth

        account = self.get_object()
        params = request.query_params
        money = lambda value: str(D(value or 0).quantize(D("0.01")))  # noqa: E731
        try:
            date_from = date_type.fromisoformat(params["date_from"]) if params.get("date_from") else None
            date_to = date_type.fromisoformat(params["date_to"]) if params.get("date_to") else None
        except ValueError:
            from rest_framework.exceptions import ValidationError as DRFValidationError

            raise DRFValidationError({"date_from": "Use YYYY-MM-DD dates."})
        posted = (JournalEntry.Status.POSTED, JournalEntry.Status.REVERSED)
        # A header (non-postable) account reports the lines of all its descendants.
        scope_ids, frontier = {account.id}, [account.id]
        while frontier:
            frontier = list(Account.objects.filter(institution=request.institution, parent_id__in=frontier).values_list("id", flat=True))
            frontier = [value for value in frontier if value not in scope_ids]
            scope_ids.update(frontier)
        base = JournalLine.objects.filter(journal_entry__institution=request.institution, account_id__in=scope_ids)
        opening = D("0.00")
        if date_from:
            before = base.filter(journal_entry__status__in=posted, journal_entry__entry_date__lt=date_from).aggregate(debit=Sum("debit"), credit=Sum("credit"))
            opening = D(before["debit"] or 0) - D(before["credit"] or 0)
        lines = base.select_related("journal_entry")
        if date_from:
            lines = lines.filter(journal_entry__entry_date__gte=date_from)
        if date_to:
            lines = lines.filter(journal_entry__entry_date__lte=date_to)
        if params.get("status"):
            lines = lines.filter(journal_entry__status=params["status"])
        if params.get("source"):
            lines = lines.filter(journal_entry__source=params["source"])
        if params.get("search"):
            from django.db.models import Q

            term = params["search"]
            lines = lines.filter(Q(description__icontains=term) | Q(journal_entry__description__icontains=term) | Q(journal_entry__journal_number__icontains=term) | Q(journal_entry__reference__icontains=term))
        running = opening
        rows = []
        for line in lines.order_by("journal_entry__entry_date", "journal_entry__journal_number", "created_at")[:500]:
            is_posted = line.journal_entry.status in posted
            if is_posted:
                running += line.debit - line.credit
            rows.append({
                "id": str(line.id), "journal_entry_id": str(line.journal_entry_id), "journal_number": line.journal_entry.journal_number,
                "entry_date": line.journal_entry.entry_date, "reference": line.journal_entry.reference or "",
                "description": line.description or line.journal_entry.description, "debit": money(line.debit), "credit": money(line.credit),
                "running_balance": money(running) if is_posted else None, "status": line.journal_entry.status, "source": line.journal_entry.source,
            })
        posted_range = base.filter(journal_entry__status__in=posted)
        if date_from:
            posted_range = posted_range.filter(journal_entry__entry_date__gte=date_from)
        if date_to:
            posted_range = posted_range.filter(journal_entry__entry_date__lte=date_to)
        totals = posted_range.aggregate(debit=Sum("debit"), credit=Sum("credit"))
        monthly = [
            {"month": (row["month"].date() if hasattr(row["month"], "date") else row["month"]).isoformat(), "debit": money(row["debit"]), "credit": money(row["credit"])}
            for row in posted_range.annotate(month=TruncMonth("journal_entry__entry_date")).values("month").annotate(debit=Sum("debit"), credit=Sum("credit")).order_by("month")
        ]
        all_time = base.filter(journal_entry__status__in=posted).aggregate(debit=Sum("debit"), credit=Sum("credit"))
        return Response({
            "account": {"id": str(account.id), "code": account.code, "name": account.name, "account_type": account.account_type,
                        "normal_balance": account.normal_balance, "is_postable": account.is_postable, "is_active": account.is_active,
                        "parent": str(account.parent_id) if account.parent_id else None, "parent_name": account.parent.name if account.parent_id else None},
            "balance": money(D(all_time["debit"] or 0) - D(all_time["credit"] or 0)),
            "opening_balance": money(opening),
            "closing_balance": money(running),
            "period_debits": money(totals["debit"]),
            "period_credits": money(totals["credit"]),
            "unposted_lines": sum(1 for row in rows if row["running_balance"] is None),
            "includes_descendants": len(scope_ids) > 1,
            "monthly": monthly,
            "lines": rows,
        })

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def perform_update(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)


class FiscalYearViewSet(TenantModelViewSet):
    model = FiscalYear
    serializer_class = FiscalYearSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("status", "start_date", "end_date")
    search_fields = ("name",)

    def get_required_permission(self):
        if self.action == "create":
            return "accounting.configure"
        if self.action == "close":
            return "accounting_period.close"
        return "account.view"

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(request=None, responses=FiscalYearSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def close(self, request, pk=None):
        fiscal_year = call_validated_service(
            close_fiscal_year, fiscal_year=self.get_object(), actor=request.user
        )
        return Response(self.get_serializer(fiscal_year).data)


class AccountingPeriodViewSet(TenantModelViewSet):
    model = AccountingPeriod
    serializer_class = AccountingPeriodSerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("fiscal_year", "status", "start_date", "end_date")
    search_fields = ("name",)
    schema_action_descriptions = {
        "close": "Close an open accounting period after all journals are resolved",
        "lock": "Lock an accounting period after all journals are resolved",
        "reopen": "Reopen a closed or locked accounting period",
    }
    schema_action_error_codes = {
        "close": ("invalid_state_transition",),
        "lock": ("invalid_state_transition",),
        "reopen": ("invalid_state_transition",),
    }

    def get_required_permission(self):
        if self.action == "create":
            return "accounting.configure"
        if self.action in {"close", "lock"}:
            return "accounting_period.close"
        if self.action == "reopen":
            return "accounting_period.reopen"
        return "account.view"

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def _set_status(self, request, status):
        period = call_validated_service(
            set_period_status, period=self.get_object(), actor=request.user, status=status
        )
        return Response(self.get_serializer(period).data)

    @extend_schema(request=None, responses=AccountingPeriodSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def close(self, request, pk=None):
        return self._set_status(request, AccountingPeriod.Status.CLOSED)

    @extend_schema(request=None, responses=AccountingPeriodSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def lock(self, request, pk=None):
        return self._set_status(request, AccountingPeriod.Status.LOCKED)

    @extend_schema(request=None, responses=AccountingPeriodSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def reopen(self, request, pk=None):
        return self._set_status(request, AccountingPeriod.Status.OPEN)


class JournalEntryViewSet(TenantModelViewSet):
    model = JournalEntry
    serializer_class = JournalEntrySerializer
    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("accounting_period", "entry_date", "source", "status", "reversal_of")
    search_fields = ("journal_number", "description", "reference")
    ordering_fields = ("journal_number", "entry_date", "created_at", "posted_at")
    schema_action_descriptions = {
        "submit": "Validate and submit a balanced draft journal for approval",
        "approve": "Approve a submitted journal for posting",
        "post": "Post an approved journal into the immutable general ledger",
        "void": "Void an unposted journal",
        "reverse": "Create an unposted journal with lines that reverse a posted journal",
    }
    schema_action_error_codes = {
        "submit": ("unbalanced_journal", "invalid_state_transition"),
        "approve": ("unbalanced_journal", "invalid_state_transition"),
        "post": (
            "unbalanced_journal",
            "invalid_state_transition",
            "period_closed",
            "record_immutable",
        ),
        "void": ("invalid_state_transition", "record_immutable"),
        "reverse": ("invalid_state_transition", "period_closed", "duplicate_operation"),
    }

    def get_required_permission(self):
        return {
            "create": "journal.create",
            "partial_update": "journal.create",
            "submit": "journal.create",
            "approve": "journal.approve",
            "post": "journal.post",
            "reverse": "journal.reverse",
            "void": "journal.create",
            "attachments": "journal.create",
            "notes": "journal.view",
        }.get(self.action, "journal.view")

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            "accounting_period", "created_by", "approved_by", "posted_by", "reversal_of"
        ).prefetch_related("lines__account", "lines__department")
        params = self.request.query_params
        if params.get("account"):
            queryset = queryset.filter(lines__account_id=params["account"]).distinct()
        if params.get("date_from"):
            queryset = queryset.filter(entry_date__gte=params["date_from"])
        if params.get("date_to"):
            queryset = queryset.filter(entry_date__lte=params["date_to"])
        return queryset

    def _journal_documents(self, journal):
        from apps.documents.models import Document

        return Document.objects.for_institution(self.request.institution).filter(
            entity_type="accounting.JournalEntry", entity_id=journal.id, is_active=True
        )

    @action(detail=True, methods=("get",), filter_backends=())
    def context(self, request, pk=None):
        """Related records, notes, attachments and audit events for the detail page."""
        from apps.accounting.models import Expense, Invoice, Payment, Receipt, VendorBill
        from apps.audit.models import AuditLog
        from apps.documents.serializers import DocumentSerializer

        journal = self.get_object()
        related = []
        for label, rows, route in (
            ("Vendor bill", VendorBill.objects.filter(journal_entry=journal), "/accounting/payables/bills/"),
            ("Customer invoice", Invoice.objects.filter(journal_entry=journal), "/accounting/receivables/invoices/"),
            ("Payment", Payment.objects.filter(journal_entry=journal), None),
            ("Receipt", Receipt.objects.filter(journal_entry=journal), None),
            ("Expense", Expense.objects.filter(journal_entry=journal), None),
        ):
            for row in rows[:20]:
                number = next((getattr(row, field) for field in ("bill_number", "invoice_number", "payment_number", "receipt_number", "reference") if getattr(row, field, None)), str(row.pk)[:8])
                related.append({"type": label, "id": str(row.pk), "reference": number, "status": getattr(row, "status", ""), "href": f"{route}{row.pk}" if route else None})
        for run in journal.payroll_runs.all()[:5]:
            related.append({"type": "Payroll run", "id": str(run.pk), "reference": str(run), "status": run.status, "href": f"/payroll/runs/{run.pk}"})
        if journal.reversal_of_id:
            related.append({"type": "Reverses journal", "id": str(journal.reversal_of_id), "reference": journal.reversal_of.journal_number, "status": journal.reversal_of.status, "href": f"/accounting/journals/{journal.reversal_of_id}"})
        for reversal in journal.reversals.all():
            related.append({"type": "Reversed by", "id": str(reversal.pk), "reference": reversal.journal_number, "status": reversal.status, "href": f"/accounting/journals/{reversal.pk}"})
        audit = AuditLog.objects.filter(institution=request.institution, entity_id=journal.id).select_related("actor").order_by("-created_at")[:50]
        name = lambda user: (user.get_full_name() or user.email) if user else "System"  # noqa: E731
        return Response({
            "related": related,
            "notes": [{"id": str(note.id), "author": name(note.author), "body": note.body, "created_at": note.created_at} for note in journal.notes.select_related("author")],
            "attachments": DocumentSerializer(self._journal_documents(journal), many=True, context={"request": request}).data,
            "audit": [{"id": str(entry.id), "action": entry.action, "actor": name(entry.actor), "created_at": entry.created_at, "metadata": entry.metadata} for entry in audit],
            "requires_approval": journal.source == JournalEntry.Source.MANUAL,
        })

    @action(detail=True, methods=("post",), filter_backends=())
    def notes(self, request, pk=None):
        from apps.accounting.models import JournalEntryNote
        from apps.audit.services import record_audit_event
        from rest_framework.exceptions import ValidationError as DRFValidationError

        journal = self.get_object()
        body = (request.data.get("body") or "").strip()
        if not body:
            raise DRFValidationError({"body": "Write a note first."})
        note = JournalEntryNote.objects.create(institution=request.institution, journal_entry=journal, author=request.user, body=body[:4000])
        record_audit_event(actor=request.user, institution=request.institution, entity=journal, action="accounting.journal.note_added")
        return Response({"id": str(note.id), "author": request.user.get_full_name() or request.user.email, "body": note.body, "created_at": note.created_at}, status=201)

    @action(detail=True, methods=("post",), filter_backends=(), parser_classes=(MultiPartParser, FormParser))
    def attachments(self, request, pk=None):
        import mimetypes

        from django.conf import settings as django_settings
        from apps.audit.services import record_audit_event
        from apps.documents.models import Document
        from apps.documents.serializers import DocumentSerializer
        from rest_framework.exceptions import ValidationError as DRFValidationError

        journal = self.get_object()
        upload = request.FILES.get("uploaded_file")
        if upload is None:
            raise DRFValidationError({"uploaded_file": "Choose a file to upload."})
        if upload.size > django_settings.DOCUMENT_UPLOAD_MAX_BYTES:
            raise DRFValidationError({"uploaded_file": f"Files must be {django_settings.DOCUMENT_UPLOAD_MAX_BYTES // (1024 * 1024)} MB or smaller."})
        name = (upload.name or "attachment").replace("\\", "/").rsplit("/", 1)[-1][:255]
        content_type = (upload.content_type or "").split(";")[0].strip().lower()
        if not content_type or content_type == "application/octet-stream":
            content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        document = Document.objects.create(
            institution=request.institution, uploaded_by=request.user, stored_file=upload, original_filename=name,
            content_type=content_type[:150], size_bytes=upload.size, category="JOURNAL_SUPPORT",
            classification=Document.Classification.CONFIDENTIAL, entity_type="accounting.JournalEntry", entity_id=journal.id,
        )
        record_audit_event(actor=request.user, institution=request.institution, entity=journal, action="accounting.journal.attachment_added", metadata={"filename": name})
        return Response(DocumentSerializer(document, context={"request": request}).data, status=201)

    @action(detail=True, methods=("get",), filter_backends=(), url_path=r"attachments/(?P<document_id>[0-9a-f-]+)/download")
    def download_attachment(self, request, pk=None, document_id=None):
        from django.http import FileResponse
        from rest_framework.exceptions import NotFound

        document = self._journal_documents(self.get_object()).filter(pk=document_id).first()
        if document is None or not document.stored_file:
            raise NotFound("Attachment not found.")
        response = FileResponse(document.stored_file.open("rb"), as_attachment=True, filename=document.original_filename,
                                content_type=document.content_type or "application/octet-stream")
        response["X-Content-Type-Options"] = "nosniff"
        return response

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def perform_update(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def _transition(self, request, service):
        journal = call_validated_service(
            service, journal=self.get_object(), actor=request.user
        )
        return Response(self.get_serializer(journal).data)

    @extend_schema(request=None, responses=JournalEntrySerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def submit(self, request, pk=None):
        return self._transition(request, submit_journal)

    @extend_schema(request=None, responses=JournalEntrySerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def approve(self, request, pk=None):
        return self._transition(request, approve_journal)

    @extend_schema(request=None, responses=JournalEntrySerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def post(self, request, pk=None):
        return self._transition(request, post_journal)

    @extend_schema(request=None, responses=JournalEntrySerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def void(self, request, pk=None):
        return self._transition(request, void_journal)

    @extend_schema(
        request=JournalReversalSerializer,
        responses=JournalEntrySerializer,
        filters=False,
    )
    @action(detail=True, methods=("post",), filter_backends=())
    def reverse(self, request, pk=None):
        journal = self.get_object()
        payload = JournalReversalSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        reversal = call_validated_service(
            create_reversal,
            journal=journal,
            actor=request.user,
            **payload.validated_data,
        )
        return Response(self.get_serializer(reversal).data)


class JournalLineViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = JournalLineSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    filterset_fields = ("journal_entry", "account", "department", "location", "employee")
    ordering_fields = ("debit", "credit", "created_at")

    def get_required_permission(self):
        return "journal.view"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return JournalLine.objects.none()
        return JournalLine.objects.filter(
            journal_entry__institution=self.request.institution
        ).select_related("journal_entry", "account", "department", "location", "employee")


class AccountingReportViewSet(viewsets.ViewSet):
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "ACCOUNTING"
    schema_scope_description = (
        "Reports are derived only from posted journal lines in the active institution."
    )
    schema_action_error_codes = {
        "general_ledger": ("not_found", "validation_error"),
        "trial_balance": ("validation_error",),
        "income_statement": ("validation_error",),
        "balance_sheet": ("validation_error",),
    }

    def get_required_permission(self):
        return "financial_report.view"

    @extend_schema(
        parameters=[GeneralLedgerQuerySerializer],
        responses=GeneralLedgerSerializer,
        filters=False,
    )
    @action(detail=False, methods=("get",), url_path="general-ledger")
    def general_ledger(self, request):
        query = GeneralLedgerQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        account = get_object_or_404(
            Account.objects.for_institution(request.institution),
            pk=query.validated_data["account"],
        )
        result = general_ledger(
            institution=request.institution,
            account=account,
            date_from=query.validated_data.get("date_from"),
            date_to=query.validated_data.get("date_to"),
        )
        return Response(GeneralLedgerSerializer(result).data)

    @extend_schema(
        parameters=[DateRangeQuerySerializer],
        responses=TrialBalanceSerializer,
        filters=False,
    )
    @action(detail=False, methods=("get",), url_path="trial-balance")
    def trial_balance(self, request):
        query = DateRangeQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = trial_balance(
            institution=request.institution,
            date_from=query.validated_data.get("date_from"),
            date_to=query.validated_data.get("date_to"),
        )
        return Response(TrialBalanceSerializer(result).data)

    @extend_schema(
        parameters=[DateRangeQuerySerializer],
        responses=IncomeStatementSerializer,
        filters=False,
    )
    @action(detail=False, methods=("get",), url_path="income-statement")
    def income_statement(self, request):
        query = DateRangeQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = income_statement(
            institution=request.institution,
            date_from=query.validated_data.get("date_from"),
            date_to=query.validated_data.get("date_to"),
        )
        return Response(IncomeStatementSerializer(result).data)

    @extend_schema(
        parameters=[BalanceSheetQuerySerializer],
        responses=BalanceSheetSerializer,
        filters=False,
    )
    @action(detail=False, methods=("get",), url_path="balance-sheet")
    def balance_sheet(self, request):
        query = BalanceSheetQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = balance_sheet(
            institution=request.institution,
            as_of=query.validated_data.get("as_of"),
        )
        return Response(BalanceSheetSerializer(result).data)


class BankReconciliationSessionViewSet(TenantModelViewSet):
    """Reconciliation sessions per bank account and statement period (concept "Bank reconciliation")."""

    required_module = "ACCOUNTING"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("bank_account", "status")
    ordering = ("-period_end",)

    @property
    def model(self):
        from apps.accounting.models import BankReconciliationSession

        return BankReconciliationSession

    def get_serializer_class(self):
        from apps.accounting.serializers import BankReconciliationSessionSerializer

        return BankReconciliationSessionSerializer

    def get_queryset(self):
        return super().get_queryset().select_related("bank_account", "started_by", "completed_by", "last_imported_by")

    def get_required_permission(self):
        if self.action in {"list", "retrieve", "accounts", "report", "suggestions"}:
            return "bank_reconciliation.view"
        return "bank_reconciliation.manage"

    def create(self, request, *args, **kwargs):
        from datetime import date as date_type

        from apps.accounting.services import start_reconciliation_session
        from rest_framework.exceptions import ValidationError as DRFValidationError

        bank_account = BankAccount.objects.for_institution(request.institution).filter(pk=request.data.get("bank_account")).first()
        if bank_account is None:
            raise DRFValidationError({"bank_account": "Choose a bank account."})
        try:
            period_start = date_type.fromisoformat(str(request.data.get("period_start")))
            period_end = date_type.fromisoformat(str(request.data.get("period_end")))
        except ValueError:
            raise DRFValidationError({"period_start": "Use YYYY-MM-DD dates."})
        money = lambda key: Decimal(str(request.data[key])) if request.data.get(key) not in (None, "") else None  # noqa: E731
        session = call_validated_service(
            start_reconciliation_session, institution=request.institution, actor=request.user, bank_account=bank_account,
            period_start=period_start, period_end=period_end,
            statement_opening_balance=money("statement_opening_balance"), statement_closing_balance=money("statement_closing_balance"),
        )
        return Response(self._detail(session), status=201)

    def retrieve(self, request, *args, **kwargs):
        return Response(self._detail(self.get_object()))

    def partial_update(self, request, *args, **kwargs):
        from apps.accounting.services import update_reconciliation_balances

        money = lambda key: Decimal(str(request.data[key])) if request.data.get(key) not in (None, "") else None  # noqa: E731
        session = call_validated_service(update_reconciliation_balances, session=self.get_object(), actor=request.user,
                                         statement_opening_balance=money("statement_opening_balance"), statement_closing_balance=money("statement_closing_balance"))
        return Response(self._detail(session))

    def _detail(self, session):
        from apps.accounting.services import reconciliation_overview, suggested_journals

        overview = reconciliation_overview(session)
        rows = []
        for line in overview["lines"]:
            suggestions = suggested_journals(statement_line=line, limit=3) if line.status == BankStatementLine.Status.UNMATCHED else []
            rows.append({
                "id": str(line.id), "statement_date": line.statement_date, "description": line.description, "reference": line.reference,
                "amount": str(line.amount), "currency": line.currency, "type": "Credit" if line.amount > 0 else "Debit", "status": line.status,
                "journal_entry": str(line.journal_entry_id) if line.journal_entry_id else None,
                "journal_number": line.journal_entry.journal_number if line.journal_entry_id else None,
                "suggestion_count": len(suggestions), "exception_note": line.exception_note,
            })
        account = session.bank_account
        return {
            "session": self.get_serializer(session).data,
            "bank_account": {"id": str(account.id), "name": account.name, "bank_name": account.bank_name, "masked_account_number": account.masked_account_number, "currency": account.currency},
            "institution": {"name": self.request.institution.name},
            "started_by": _person(session.started_by),
            "completed_by": _person(session.completed_by) if session.completed_by_id else None,
            "last_imported_by": _person(session.last_imported_by) if session.last_imported_by_id else None,
            "counts": overview["counts"],
            "progress": overview["progress"],
            "matched_amount": str(overview["matched_amount"]),
            "unmatched_amount": str(overview["unmatched_amount"]),
            "book_balance": str(overview["book_balance"]),
            "difference": str(overview["difference"]) if overview["difference"] is not None else None,
            "can_complete": overview["can_complete"],
            "lines": rows,
        }

    @action(detail=False, methods=("get",), filter_backends=())
    def accounts(self, request):
        """Bank accounts with their latest reconciliation status for the account picker."""
        from django.utils import timezone

        from apps.accounting.models import BankReconciliationSession

        today = timezone.localdate()
        rows = []
        for account in BankAccount.objects.for_institution(request.institution).filter(is_active=True).order_by("name"):
            latest = BankReconciliationSession.objects.filter(bank_account=account).order_by("-period_end").first()
            unmatched = BankStatementLine.objects.filter(bank_account=account, status=BankStatementLine.Status.UNMATCHED).count()
            if latest is None:
                state = "NOT_STARTED"
            elif latest.status == BankReconciliationSession.Status.COMPLETED:
                state = "RECONCILED" if (today - latest.period_end).days <= 45 else "OVERDUE"
            else:
                state = "IN_PROGRESS"
            rows.append({"id": str(account.id), "name": account.name, "bank_name": account.bank_name, "masked_account_number": account.masked_account_number,
                         "currency": account.currency, "state": state, "unmatched_lines": unmatched,
                         "latest_session": {"id": str(latest.id), "period_start": latest.period_start, "period_end": latest.period_end, "status": latest.status} if latest else None})
        return Response(rows)

    @action(detail=True, methods=("post",), filter_backends=())
    def complete(self, request, pk=None):
        from apps.accounting.services import complete_reconciliation_session

        return Response(self._detail(call_validated_service(complete_reconciliation_session, session=self.get_object(), actor=request.user)))

    @action(detail=True, methods=("post",), filter_backends=(), parser_classes=(MultiPartParser, FormParser), url_path="import")
    def import_statement(self, request, pk=None):
        from apps.accounting.services import import_statement_csv
        from rest_framework.exceptions import ValidationError as DRFValidationError

        upload = request.FILES.get("file")
        if upload is None:
            raise DRFValidationError({"file": "Choose a CSV statement file."})
        try:
            content = upload.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            raise DRFValidationError({"file": "The statement must be a UTF-8 CSV file."})
        session = self.get_object()
        result = call_validated_service(import_statement_csv, session=session, actor=request.user, content=content)
        session.refresh_from_db()
        return Response({**self._detail(session), "import_result": result})

    @action(detail=True, methods=("get",), filter_backends=(), url_path=r"lines/(?P<line_id>[0-9a-f-]+)/suggestions")
    def suggestions(self, request, pk=None, line_id=None):
        from apps.accounting.services import suggested_journals
        from rest_framework.exceptions import NotFound

        session = self.get_object()
        line = BankStatementLine.objects.filter(bank_account=session.bank_account, pk=line_id).first()
        if line is None:
            raise NotFound("Statement line not found.")
        return Response([
            {"id": str(journal.id), "journal_number": journal.journal_number, "entry_date": journal.entry_date, "description": journal.description, "source": journal.source}
            for journal in suggested_journals(statement_line=line)
        ])

    @action(detail=True, methods=("post",), filter_backends=(), url_path=r"lines/(?P<line_id>[0-9a-f-]+)/(?P<operation>match|unmatch|flag|unflag)")
    def line_action(self, request, pk=None, line_id=None, operation=None):
        from apps.accounting.services import flag_statement_line
        from rest_framework.exceptions import NotFound

        session = self.get_object()
        line = BankStatementLine.objects.filter(bank_account=session.bank_account, pk=line_id).first()
        if line is None:
            raise NotFound("Statement line not found.")
        if operation == "match":
            journal = JournalEntry.objects.for_institution(request.institution).filter(pk=request.data.get("journal_entry")).first()
            if journal is None:
                raise NotFound("Journal not found.")
            call_validated_service(match_bank_statement_line, statement_line=line, journal=journal, actor=request.user)
        elif operation == "unmatch":
            call_validated_service(unmatch_bank_statement_line, statement_line=line, actor=request.user)
        else:
            call_validated_service(flag_statement_line, statement_line=line, actor=request.user, exception=operation == "flag", note=str(request.data.get("note", "")))
        return Response(self._detail(session))

    @action(detail=True, methods=("get",), filter_backends=())
    def report(self, request, pk=None):
        """CSV reconciliation report for the session."""
        import csv
        import io

        from django.http import HttpResponse

        detail = self._detail(self.get_object())
        session = detail["session"]
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["Bank reconciliation", detail["bank_account"]["name"], f"{session['period_start']} to {session['period_end']}"])
        writer.writerow(["Statement closing balance", session["statement_closing_balance"] or ""])
        writer.writerow(["Book balance", detail["book_balance"]])
        writer.writerow(["Difference", detail["difference"] or ""])
        writer.writerow([])
        writer.writerow(["Date", "Description", "Reference", "Amount", "Status", "Matched journal", "Exception note"])
        for line in detail["lines"]:
            writer.writerow([line["statement_date"], line["description"], line["reference"], line["amount"], line["status"], line["journal_number"] or "", line["exception_note"]])
        response = HttpResponse(buffer.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="reconciliation-{session["period_end"]}.csv"'
        return response
