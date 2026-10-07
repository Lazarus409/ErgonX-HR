from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiExample, extend_schema, extend_schema_view
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.payroll.models import (
    ComplianceDeadline,
    ContributionAllocation,
    ContributionRule,
    EmployeeTaxReliefClaim,
    EmployeePayrollProfile,
    InstitutionPayrollConfiguration,
    PayrollAdjustment,
    PayrollItem,
    PayrollPeriod,
    PayrollPreset,
    PayrollPresetVersion,
    PayrollRecord,
    PayrollRun,
    Payslip,
    SpecialIncomeRule,
    StatutoryThreshold,
    TaxBand,
    TaxReliefDefinition,
    TaxRule,
)
from apps.payroll.serializers import (
    PayrollExceptionUpdateSerializer,
    PayrollRunExceptionSerializer,
    ComplianceDeadlineSerializer,
    ContributionAllocationSerializer,
    ContributionRuleSerializer,
    EmployeeTaxReliefClaimSerializer,
    EmployeePayrollProfileSerializer,
    InstitutionPayrollConfigurationSerializer,
    PayrollAdjustmentSerializer,
    PayrollItemSerializer,
    PayrollPeriodSerializer,
    PayrollComplianceDeadlineSerializer,
    PayrollPresetSerializer,
    PayrollPresetVersionSerializer,
    PayrollSetupChoicesSerializer,
    PayrollReconciliationSerializer,
    PayrollRecordSerializer,
    PayrollRunSerializer,
    PayslipSerializer,
    SpecialIncomeRuleSerializer,
    StatutoryThresholdSerializer,
    TaxBandSerializer,
    TaxReliefDecisionSerializer,
    TaxReliefDefinitionSerializer,
    TaxRuleSerializer,
)
from apps.payroll.services import (
    approve_payroll_run,
    calculate_payroll_run,
    cancel_payroll_run,
    compliance_deadlines_for_period,
    revalidate_payroll_run,
    update_payroll_exception,
    decide_payroll_adjustment,
    decide_tax_relief_claim,
    finalize_payroll_run,
    reconcile_payroll_run,
    payroll_setup_choices,
    submit_payroll_adjustment,
    submit_payroll_run_for_review,
    submit_tax_relief_claim,
)
from apps.accounting.serializers import JournalEntrySerializer
from apps.accounting.services import generate_payroll_journal
from common.scoping import PAYSLIP_BROAD, scope_to_employees
from common.permissions import TenantContextPermission, TenantRBACPermission
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet


class GlobalPayrollReadOnlyViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "PAYROLL"
    ordering = ("id",)
    schema_scope_description = (
        "The catalog is system-managed; access is still gated by the active institution."
    )

    def get_required_permission(self):
        return "payroll.view"


class PayrollPresetViewSet(GlobalPayrollReadOnlyViewSet):
    queryset = PayrollPreset.objects.all()
    serializer_class = PayrollPresetSerializer
    filterset_fields = ("country_code", "is_system_managed")
    search_fields = ("code", "name", "description")
    ordering_fields = ("country_code", "code", "name", "created_at")


class PayrollPresetVersionViewSet(GlobalPayrollReadOnlyViewSet):
    queryset = PayrollPresetVersion.objects.select_related("payroll_preset")
    serializer_class = PayrollPresetVersionSerializer
    filterset_fields = ("payroll_preset", "status", "effective_from")
    search_fields = ("version_code", "payroll_preset__code", "payroll_preset__name")
    ordering_fields = ("effective_from", "version_code", "created_at")


class TaxRuleViewSet(GlobalPayrollReadOnlyViewSet):
    queryset = TaxRule.objects.select_related("preset_version")
    serializer_class = TaxRuleSerializer
    filterset_fields = ("preset_version", "method", "residency", "basis", "active")
    search_fields = ("code", "name")
    ordering_fields = ("sequence", "code", "created_at")


class TaxBandViewSet(GlobalPayrollReadOnlyViewSet):
    queryset = TaxBand.objects.select_related("tax_rule")
    serializer_class = TaxBandSerializer
    filterset_fields = ("tax_rule",)
    ordering_fields = ("sequence", "created_at")


class ContributionRuleViewSet(GlobalPayrollReadOnlyViewSet):
    queryset = ContributionRule.objects.select_related("preset_version")
    serializer_class = ContributionRuleSerializer
    filterset_fields = ("preset_version", "basis", "effective_from")
    search_fields = ("code", "name")
    ordering_fields = ("code", "effective_from", "created_at")


class ContributionAllocationViewSet(GlobalPayrollReadOnlyViewSet):
    queryset = ContributionAllocation.objects.select_related("contribution_rule")
    serializer_class = ContributionAllocationSerializer
    filterset_fields = ("contribution_rule", "destination_type")
    search_fields = ("code", "name", "destination_reference")


class SpecialIncomeRuleViewSet(GlobalPayrollReadOnlyViewSet):
    queryset = SpecialIncomeRule.objects.select_related("preset_version")
    serializer_class = SpecialIncomeRuleSerializer
    filterset_fields = ("preset_version", "income_type", "effective_from")
    search_fields = ("code", "name")


class TaxReliefDefinitionViewSet(GlobalPayrollReadOnlyViewSet):
    queryset = TaxReliefDefinition.objects.select_related("preset_version")
    serializer_class = TaxReliefDefinitionSerializer
    filterset_fields = ("preset_version", "requires_evidence")
    search_fields = ("code", "name")


class StatutoryThresholdViewSet(GlobalPayrollReadOnlyViewSet):
    queryset = StatutoryThreshold.objects.select_related("preset_version")
    serializer_class = StatutoryThresholdSerializer
    filterset_fields = ("preset_version", "unit", "effective_from")
    search_fields = ("code", "name")


class ComplianceDeadlineViewSet(GlobalPayrollReadOnlyViewSet):
    queryset = ComplianceDeadline.objects.select_related("preset_version")
    serializer_class = ComplianceDeadlineSerializer
    filterset_fields = ("preset_version", "authority", "event_type", "effective_from")
    search_fields = ("code", "authority", "event_type")


class InstitutionPayrollConfigurationViewSet(TenantModelViewSet):
    model = InstitutionPayrollConfiguration
    serializer_class = InstitutionPayrollConfigurationSerializer
    required_module = "PAYROLL"
    http_method_names = ("get", "post", "patch", "head", "options")
    schema_action_summaries = {
        "choices": "List payroll setup choices",
    }
    schema_action_descriptions = {
        "choices": (
            "Return active, effective payroll presets matching the institution country, "
            "plus the explicit Custom configuration option"
        ),
    }
    schema_action_error_codes = {
        "create": ("validation_error",),
        "partial_update": ("validation_error",),
    }

    def get_required_permission(self):
        if self.action in {"create", "update", "partial_update"}:
            return "payroll.configure"
        return "payroll.view"

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def perform_update(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(
        filters=False,
        responses=PayrollSetupChoicesSerializer,
        examples=[
            OpenApiExample(
                "Ghana payroll setup choices",
                value={
                    "success": True,
                    "data": {
                        "country_code": "GH",
                        "currency": "GHS",
                        "choices": [
                            {
                                "mode": "PRESET",
                                "preset_version_id": "00000000-0000-0000-0000-000000000001",
                                "preset_code": "GH-PAYROLL",
                                "version_code": "GH-2026.1",
                                "name": "Ghana Payroll",
                                "recommended": True,
                                "compliance_warning": None,
                            }
                        ],
                    },
                    "message": "",
                    "errors": None,
                },
                response_only=True,
                status_codes=("200",),
            ),
        ],
    )
    @action(detail=False, methods=("get",))
    def choices(self, request):
        result = payroll_setup_choices(request.institution)
        return Response(PayrollSetupChoicesSerializer(result).data)


class EmployeePayrollProfileViewSet(TenantModelViewSet):
    model = EmployeePayrollProfile
    serializer_class = EmployeePayrollProfileSerializer
    required_module = "PAYROLL"
    required_permission = "payroll.configure"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("employee", "tax_residency")
    search_fields = (
        "employee__employee_number",
        "employee__first_name",
        "employee__last_name",
        "tax_identification_number",
    )

    def get_queryset(self):
        return super().get_queryset().select_related("employee")

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def perform_update(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)


class PayrollPeriodViewSet(TenantModelViewSet):
    model = PayrollPeriod
    serializer_class = PayrollPeriodSerializer
    required_module = "PAYROLL"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("status", "start_date", "end_date", "pay_date")
    search_fields = ("name",)
    ordering_fields = ("start_date", "end_date", "pay_date", "created_at")
    schema_action_summaries = {
        "compliance_deadlines": "Calculate payroll compliance deadlines",
    }
    schema_action_descriptions = {
        "compliance_deadlines": (
            "Calculate filing and remittance due dates from the period and its effective "
            "configured statutory rules; this does not file or remit anything"
        ),
    }
    schema_action_error_codes = {
        "create": ("validation_error",),
        "compliance_deadlines": ("validation_error",),
    }

    def get_required_permission(self):
        return "payroll.prepare" if self.action == "create" else "payroll.view"

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(
        filters=False,
        responses=PayrollComplianceDeadlineSerializer(many=True),
    )
    @action(
        detail=True,
        methods=("get",),
        url_path="compliance-deadlines",
        filter_backends=(),
        pagination_class=None,
    )
    def compliance_deadlines(self, request, pk=None):
        result = compliance_deadlines_for_period(self.get_object())
        return Response(PayrollComplianceDeadlineSerializer(result, many=True).data)


@extend_schema_view(
    create=extend_schema(
        examples=[
            OpenApiExample(
                "Create an idempotent payroll run",
                value={
                    "payroll_period": "00000000-0000-0000-0000-000000000003",
                    "idempotency_key": "payroll-2026-09-primary",
                },
                request_only=True,
            ),
        ]
    )
)
class PayrollRunViewSet(TenantModelViewSet):
    model = PayrollRun
    serializer_class = PayrollRunSerializer
    required_module = "PAYROLL"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("payroll_period", "preset_version", "status", "run_number")
    ordering_fields = ("started_at", "run_number", "approved_at", "finalized_at")
    schema_action_summaries = {
        "calculate": "Calculate payroll run",
        "submit_review": "Submit payroll run for review",
        "approve": "Approve payroll run",
        "finalize": "Finalize payroll run",
        "cancel": "Cancel payroll run",
        "reconcile": "Reconcile payroll run",
        "generate_accounting_journal": "Generate draft accounting journal from finalized payroll",
    }
    schema_action_descriptions = {
        "calculate": (
            "Calculate all eligible employees transactionally from snapshotted compensation, "
            "approved operational inputs, and the selected statutory preset"
        ),
        "submit_review": "Move a calculated run into approval review",
        "approve": "Approve an under-review run after a clean derived reconciliation",
        "finalize": (
            "Finalize an approved run, close its period, freeze records/items, generate "
            "payslips, and create configured compliance reminders"
        ),
        "cancel": "Cancel a non-approved, non-finalized run without deleting its history",
        "reconcile": (
            "Recalculate record totals from immutable line-item effects and report any "
            "differences without changing payroll data"
        ),
        "generate_accounting_journal": (
            "Generate the single idempotent draft PAYROLL journal from finalized payroll "
            "items and effective component account mappings. The journal then follows the "
            "normal accounting submit, approve, and post workflow."
        ),
    }
    schema_action_error_codes = {
        "create": (
            "period_closed",
            "invalid_state_transition",
            "duplicate_operation",
        ),
        "calculate": ("invalid_state_transition", "record_immutable"),
        "submit_review": ("invalid_state_transition",),
        "approve": ("invalid_state_transition",),
        "finalize": ("invalid_state_transition",),
        "cancel": ("invalid_state_transition", "record_immutable"),
        "generate_accounting_journal": (
            "invalid_state_transition",
            "policy_not_applicable",
            "period_closed",
        ),
    }

    def get_required_permission(self):
        return {
            "create": "payroll.prepare",
            "calculate": "payroll.prepare",
            "submit_review": "payroll.prepare",
            "cancel": "payroll.prepare",
            "approve": "payroll.approve",
            "finalize": "payroll.finalize",
            "generate_accounting_journal": "journal.create",
            "validate": "payroll.prepare",
            "update_exception": "payroll.prepare",
        }.get(self.action, "payroll.view")

    def get_queryset(self):
        return super().get_queryset().select_related(
            "payroll_period",
            "preset_version",
            "started_by",
            "approved_by",
            "finalized_by",
        )

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    def _transition(self, request, service):
        run = call_validated_service(
            service, payroll_run=self.get_object(), actor=request.user
        )
        return Response(self.get_serializer(run).data)

    @extend_schema(request=None, responses=PayrollRunSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def calculate(self, request, pk=None):
        return self._transition(request, calculate_payroll_run)

    @extend_schema(request=None, responses=PayrollRunSerializer, filters=False)
    @action(
        detail=True,
        methods=("post",),
        url_path="submit-review",
        filter_backends=(),
    )
    def submit_review(self, request, pk=None):
        return self._transition(request, submit_payroll_run_for_review)

    @extend_schema(request=None, responses=PayrollRunSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def approve(self, request, pk=None):
        return self._transition(request, approve_payroll_run)

    @extend_schema(request=None, responses=PayrollRunSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def finalize(self, request, pk=None):
        return self._transition(request, finalize_payroll_run)

    @extend_schema(request=None, responses=PayrollRunSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def cancel(self, request, pk=None):
        return self._transition(request, cancel_payroll_run)

    @extend_schema(request=None, responses=PayrollRunSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def validate(self, request, pk=None):
        """Re-run exception detection on a calculated or in-review run."""
        return self._transition(request, revalidate_payroll_run)

    @extend_schema(request=None, responses=PayrollRunExceptionSerializer(many=True), filters=False)
    @action(detail=True, methods=("get",), filter_backends=(), pagination_class=None)
    def exceptions(self, request, pk=None):
        run = self.get_object()
        items = run.exceptions.select_related("employee", "resolved_by").order_by("status", "severity", "created_at")
        return Response(PayrollRunExceptionSerializer(items, many=True).data)

    @extend_schema(request=PayrollExceptionUpdateSerializer, responses=PayrollRunExceptionSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=(), url_path=r"exceptions/(?P<exception_id>[0-9a-f-]+)")
    def update_exception(self, request, pk=None, exception_id=None):
        from rest_framework.exceptions import NotFound

        run = self.get_object()
        exception = run.exceptions.filter(pk=exception_id).first()
        if exception is None:
            raise NotFound("Payroll exception not found.")
        payload = PayrollExceptionUpdateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        updated = call_validated_service(
            update_payroll_exception, exception=exception, actor=request.user,
            status=payload.validated_data["status"], note=payload.validated_data.get("note", ""),
        )
        return Response(PayrollRunExceptionSerializer(updated).data)

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT, filters=False)
    @action(detail=True, methods=("get",), filter_backends=(), pagination_class=None)
    def activity(self, request, pk=None):
        """Audit trail for this run (status changes, validation, exception handling)."""
        from apps.audit.models import AuditLog

        run = self.get_object()
        entries = AuditLog.objects.filter(institution=request.institution, entity_id=run.id).select_related("actor").order_by("-created_at")[:100]
        return Response([
            {
                "id": str(entry.id),
                "action": entry.action,
                "actor": (entry.actor.get_full_name() or entry.actor.email) if entry.actor else "System",
                "created_at": entry.created_at,
                "metadata": entry.metadata,
            }
            for entry in entries
        ])

    @extend_schema(
        filters=False,
        responses=PayrollReconciliationSerializer,
        examples=[
            OpenApiExample(
                "Clean payroll reconciliation",
                value={
                    "success": True,
                    "data": {
                        "payroll_run_id": "00000000-0000-0000-0000-000000000004",
                        "status": "CALCULATED",
                        "record_count": 2,
                        "totals": {
                            "gross_pay": "8500.00",
                            "total_deductions": "1311.88",
                            "employee_contributions": "467.50",
                            "employer_contributions": "1105.00",
                            "net_pay": "6720.62",
                        },
                        "source_totals": {},
                        "component_totals": {},
                        "discrepancy_count": 0,
                        "discrepancies": [],
                    },
                    "message": "",
                    "errors": None,
                },
                response_only=True,
                status_codes=("200",),
            ),
        ],
    )
    @action(detail=True, methods=("get",), filter_backends=(), pagination_class=None)
    def reconcile(self, request, pk=None):
        result = reconcile_payroll_run(self.get_object())
        return Response(PayrollReconciliationSerializer(result).data)

    @extend_schema(request=None, responses=JournalEntrySerializer, filters=False)
    @action(
        detail=True,
        methods=("post",),
        url_path="generate-accounting-journal",
        filter_backends=(),
    )
    def generate_accounting_journal(self, request, pk=None):
        journal = call_validated_service(
            generate_payroll_journal,
            payroll_run=self.get_object(),
            actor=request.user,
        )
        return Response(JournalEntrySerializer(journal).data)


class PayrollRecordViewSet(TenantModelViewSet):
    model = PayrollRecord
    serializer_class = PayrollRecordSerializer
    required_module = "PAYROLL"
    http_method_names = ("get", "head", "options")
    filterset_fields = ("payroll_run", "employee", "currency", "status")
    ordering_fields = ("gross_pay", "net_pay", "created_at")

    def get_required_permission(self):
        return "payroll.view"

    def get_queryset(self):
        return super().get_queryset().select_related("payroll_run", "employee")


class PayrollItemViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PayrollItemSerializer
    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "PAYROLL"
    filterset_fields = ("payroll_record", "pay_component", "source")
    search_fields = ("component_code_snapshot", "component_name_snapshot")
    ordering_fields = ("amount", "created_at")
    ordering = ("created_at",)

    def get_required_permission(self):
        return "payroll.view"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return PayrollItem.objects.none()
        return PayrollItem.objects.filter(
            payroll_record__institution=self.request.institution
        ).select_related("payroll_record", "pay_component")


class PayrollAdjustmentViewSet(TenantModelViewSet):
    model = PayrollAdjustment
    serializer_class = PayrollAdjustmentSerializer
    required_module = "PAYROLL"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("employee", "payroll_period", "pay_component", "status")
    ordering_fields = ("created_at", "amount")
    schema_action_summaries = {
        "submit": "Submit payroll adjustment",
        "approve": "Approve payroll adjustment",
        "reject": "Reject payroll adjustment",
    }
    schema_action_descriptions = {
        "submit": "Submit a draft adjustment for approval before its payroll period closes",
        "approve": "Approve a pending adjustment for consumption by a future calculation",
        "reject": "Reject a pending adjustment",
    }
    schema_action_error_codes = {
        "submit": ("invalid_state_transition", "period_closed"),
        "approve": ("invalid_state_transition",),
        "reject": ("invalid_state_transition",),
    }

    def get_required_permission(self):
        if self.action in {"approve", "reject"}:
            return "payroll.approve"
        if self.action in {"create", "submit"}:
            return "payroll.prepare"
        return "payroll.view"

    def get_queryset(self):
        return super().get_queryset().select_related(
            "employee", "payroll_period", "pay_component", "created_by", "approved_by"
        )

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(request=None, responses=PayrollAdjustmentSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def submit(self, request, pk=None):
        adjustment = call_validated_service(
            submit_payroll_adjustment,
            adjustment=self.get_object(),
            actor=request.user,
        )
        return Response(self.get_serializer(adjustment).data)

    @extend_schema(request=None, responses=PayrollAdjustmentSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def approve(self, request, pk=None):
        adjustment = call_validated_service(
            decide_payroll_adjustment,
            adjustment=self.get_object(),
            actor=request.user,
            approve=True,
        )
        return Response(self.get_serializer(adjustment).data)

    @extend_schema(request=None, responses=PayrollAdjustmentSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def reject(self, request, pk=None):
        adjustment = call_validated_service(
            decide_payroll_adjustment,
            adjustment=self.get_object(),
            actor=request.user,
            approve=False,
        )
        return Response(self.get_serializer(adjustment).data)


class EmployeeTaxReliefClaimViewSet(TenantModelViewSet):
    model = EmployeeTaxReliefClaim
    serializer_class = EmployeeTaxReliefClaimSerializer
    required_module = "PAYROLL"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("employee", "relief_definition", "tax_year", "status")
    ordering_fields = ("tax_year", "created_at", "approved_at")
    schema_action_summaries = {
        "submit": "Submit employee tax-relief claim",
        "approve": "Approve employee tax-relief claim",
        "reject": "Reject employee tax-relief claim",
    }
    schema_action_descriptions = {
        "submit": "Submit a draft, eligible, evidence-backed relief claim for review",
        "approve": "Approve a pending claim with an optional approved-amount override",
        "reject": "Reject a pending relief claim without applying an approved amount",
    }
    schema_action_error_codes = {
        "submit": ("invalid_state_transition",),
        "approve": ("invalid_state_transition",),
        "reject": ("invalid_state_transition",),
    }

    def get_required_permission(self):
        if self.action in {"approve", "reject"}:
            return "tax_relief.approve"
        if self.action in {"create", "submit"}:
            return "tax_relief.claim"
        return "tax_relief.view"

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            "employee", "relief_definition", "evidence", "approved_by"
        )
        return scope_to_employees(queryset, self.request, allow_team=False)

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(request=None, responses=EmployeeTaxReliefClaimSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def submit(self, request, pk=None):
        claim = call_validated_service(
            submit_tax_relief_claim, claim=self.get_object(), actor=request.user
        )
        return Response(self.get_serializer(claim).data)

    def _decision(self, request, approve):
        payload = TaxReliefDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        claim = call_validated_service(
            decide_tax_relief_claim,
            claim=self.get_object(),
            actor=request.user,
            approve=approve,
            **payload.validated_data,
        )
        return Response(self.get_serializer(claim).data)

    @extend_schema(
        request=TaxReliefDecisionSerializer,
        responses=EmployeeTaxReliefClaimSerializer,
        filters=False,
    )
    @action(detail=True, methods=("post",), filter_backends=())
    def approve(self, request, pk=None):
        return self._decision(request, True)

    @extend_schema(request=None, responses=EmployeeTaxReliefClaimSerializer, filters=False)
    @action(detail=True, methods=("post",), filter_backends=())
    def reject(self, request, pk=None):
        return self._decision(request, False)


class PayslipViewSet(TenantModelViewSet):
    model = Payslip
    serializer_class = PayslipSerializer
    required_module = "PAYROLL"
    http_method_names = ("get", "head", "options")
    filterset_fields = ("payroll_record", "payroll_record__employee", "generated_at")
    ordering_fields = ("generated_at", "created_at")

    def get_required_permission(self):
        return "payslip.view"

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            "payroll_record__employee", "payroll_record__payroll_run", "document_reference"
        ).prefetch_related("payroll_record__items")
        return scope_to_employees(
            queryset, self.request, "payroll_record__employee", allow_team=False, broad=PAYSLIP_BROAD
        )
