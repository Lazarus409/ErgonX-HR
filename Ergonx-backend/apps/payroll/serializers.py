from rest_framework import serializers

from apps.compensation.models import PayComponent
from apps.documents.models import Document
from apps.employees.models import Employee
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
from apps.payroll.services import (
    configure_payroll,
    configure_employee_payroll_profile,
    create_payroll_adjustment,
    create_payroll_period,
    create_payroll_run,
    create_tax_relief_claim,
    payslip_payload,
)
from common.serializers import ValidatedModelSerializer, call_validated_service


class PayrollPresetSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollPreset
        fields = (
            "id",
            "code",
            "country_code",
            "name",
            "description",
            "is_system_managed",
            "created_at",
            "updated_at",
        )


class PayrollPresetVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollPresetVersion
        fields = (
            "id",
            "payroll_preset",
            "version_code",
            "effective_from",
            "effective_to",
            "status",
            "source_metadata",
            "created_at",
            "updated_at",
        )


class TaxRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxRule
        fields = (
            "id",
            "preset_version",
            "code",
            "name",
            "method",
            "residency",
            "rate",
            "threshold",
            "basis",
            "sequence",
            "active",
            "created_at",
            "updated_at",
        )


class TaxBandSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxBand
        fields = (
            "id",
            "tax_rule",
            "sequence",
            "lower_bound",
            "upper_bound",
            "band_amount",
            "rate",
            "created_at",
            "updated_at",
        )


class ContributionRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContributionRule
        fields = (
            "id",
            "preset_version",
            "code",
            "name",
            "basis",
            "employee_rate",
            "employer_rate",
            "minimum_basis",
            "maximum_basis",
            "effective_from",
            "effective_to",
            "created_at",
            "updated_at",
        )


class ContributionAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContributionAllocation
        fields = (
            "id",
            "contribution_rule",
            "code",
            "name",
            "rate",
            "destination_type",
            "destination_reference",
            "created_at",
            "updated_at",
        )


class SpecialIncomeRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = SpecialIncomeRule
        fields = (
            "id",
            "preset_version",
            "code",
            "name",
            "income_type",
            "eligibility_json",
            "calculation_json",
            "effective_from",
            "effective_to",
            "requires_validation",
            "created_at",
            "updated_at",
        )


class TaxReliefDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxReliefDefinition
        fields = (
            "id",
            "preset_version",
            "code",
            "name",
            "calculation_method",
            "default_amount",
            "max_count",
            "percentage",
            "eligibility_json",
            "requires_evidence",
            "created_at",
            "updated_at",
        )


class StatutoryThresholdSerializer(serializers.ModelSerializer):
    class Meta:
        model = StatutoryThreshold
        fields = (
            "id",
            "preset_version",
            "code",
            "name",
            "amount",
            "unit",
            "effective_from",
            "effective_to",
            "created_at",
            "updated_at",
        )


class ComplianceDeadlineSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComplianceDeadline
        fields = (
            "id",
            "preset_version",
            "code",
            "authority",
            "event_type",
            "calculation_rule",
            "offset_days",
            "day_of_month",
            "effective_from",
            "effective_to",
            "created_at",
            "updated_at",
        )


class TenantRelationSerializer(ValidatedModelSerializer):
    tenant_relations = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            for field_name, model in self.tenant_relations.items():
                if field_name in self.fields:
                    self.fields[field_name].queryset = model.objects.for_institution(institution)


class InstitutionPayrollConfigurationSerializer(TenantRelationSerializer):
    class Meta:
        model = InstitutionPayrollConfiguration
        fields = (
            "id",
            "country_code",
            "currency",
            "payroll_frequency",
            "payroll_setup_mode",
            "selected_payroll_preset_version",
            "pay_day_rule",
            "rounding_rule",
            "custom_rules",
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
        self.fields["selected_payroll_preset_version"].queryset = (
            PayrollPresetVersion.objects.filter(status=PayrollPresetVersion.Status.ACTIVE)
        )

    def create(self, validated_data):
        return call_validated_service(configure_payroll, **validated_data)

    def update(self, instance, validated_data):
        values = {
            field: validated_data.get(field, getattr(instance, field))
            for field in (
                "country_code",
                "currency",
                "payroll_frequency",
                "payroll_setup_mode",
                "selected_payroll_preset_version",
                "pay_day_rule",
                "rounding_rule",
                "custom_rules",
                "is_configured",
            )
        }
        values.update(
            institution=validated_data["institution"], actor=validated_data["actor"]
        )
        return call_validated_service(configure_payroll, **values)


class EmployeePayrollProfileSerializer(TenantRelationSerializer):
    tenant_relations = {"employee": Employee}

    class Meta:
        model = EmployeePayrollProfile
        fields = (
            "id",
            "employee",
            "tax_residency",
            "tax_identification_number",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def create(self, validated_data):
        return call_validated_service(configure_employee_payroll_profile, **validated_data)

    def update(self, instance, validated_data):
        return call_validated_service(
            configure_employee_payroll_profile,
            institution=validated_data["institution"],
            actor=validated_data["actor"],
            employee=validated_data.get("employee", instance.employee),
            tax_residency=validated_data.get("tax_residency", instance.tax_residency),
            tax_identification_number=validated_data.get(
                "tax_identification_number", instance.tax_identification_number
            ),
        )


class PayrollSetupChoiceSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=InstitutionPayrollConfiguration.SetupMode.choices)
    preset_version_id = serializers.UUIDField(allow_null=True)
    preset_code = serializers.CharField(allow_null=True)
    version_code = serializers.CharField(allow_null=True)
    name = serializers.CharField()
    recommended = serializers.BooleanField()
    compliance_warning = serializers.CharField(allow_null=True)


class PayrollSetupChoicesSerializer(serializers.Serializer):
    country_code = serializers.CharField()
    currency = serializers.CharField()
    choices = PayrollSetupChoiceSerializer(many=True)


class PayrollPeriodSerializer(TenantRelationSerializer):
    class Meta:
        model = PayrollPeriod
        fields = (
            "id",
            "name",
            "start_date",
            "end_date",
            "pay_date",
            "status",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "status", "created_at", "updated_at")

    def create(self, validated_data):
        return call_validated_service(create_payroll_period, **validated_data)


class PayrollRunSerializer(TenantRelationSerializer):
    tenant_relations = {"payroll_period": PayrollPeriod}
    idempotency_key = serializers.CharField(write_only=True, max_length=100)
    reference = serializers.SerializerMethodField()
    period_name = serializers.CharField(source="payroll_period.name", read_only=True)
    started_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    finalized_by_name = serializers.SerializerMethodField()
    exception_counts = serializers.SerializerMethodField()

    @staticmethod
    def _name(user):
        return (user.get_full_name() or user.email) if user else None

    def get_reference(self, obj):
        return f"PR-{obj.payroll_period.start_date:%Y%m}-{obj.run_number:02d}"

    def get_started_by_name(self, obj):
        return self._name(obj.started_by)

    def get_approved_by_name(self, obj):
        return self._name(obj.approved_by)

    def get_finalized_by_name(self, obj):
        return self._name(obj.finalized_by)

    def get_exception_counts(self, obj):
        from django.db.models import Count, Q

        from apps.payroll.models import PayrollRunException

        counts = obj.exceptions.aggregate(
            total=Count("id"),
            open=Count("id", filter=Q(status=PayrollRunException.Status.OPEN)),
            high_open=Count("id", filter=Q(status=PayrollRunException.Status.OPEN, severity=PayrollRunException.Severity.HIGH)),
        )
        return counts

    class Meta:
        model = PayrollRun
        fields = (
            "id",
            "reference",
            "period_name",
            "started_by_name",
            "approved_by_name",
            "finalized_by_name",
            "exception_counts",
            "payroll_period",
            "preset_version",
            "run_number",
            "status",
            "started_by",
            "started_at",
            "approved_by",
            "approved_at",
            "finalized_by",
            "finalized_at",
            "statutory_snapshot",
            "accounting_journal_entry",
            "idempotency_key",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "preset_version",
            "run_number",
            "status",
            "started_by",
            "started_at",
            "approved_by",
            "approved_at",
            "finalized_by",
            "finalized_at",
            "statutory_snapshot",
            "accounting_journal_entry",
            "created_at",
            "updated_at",
        )

    def create(self, validated_data):
        return call_validated_service(create_payroll_run, **validated_data)


class PayrollRecordSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_number = serializers.CharField(source="employee.employee_number", read_only=True)

    class Meta:
        model = PayrollRecord
        fields = (
            "id",
            "payroll_run",
            "employee",
            "employee_name",
            "employee_number",
            "gross_pay",
            "taxable_income",
            "total_deductions",
            "employee_contributions",
            "employer_contributions",
            "net_pay",
            "currency",
            "status",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class PayrollItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollItem
        fields = (
            "id",
            "payroll_record",
            "pay_component",
            "component_code_snapshot",
            "component_name_snapshot",
            "source",
            "quantity",
            "rate",
            "amount",
            "metadata",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class PayrollAdjustmentSerializer(TenantRelationSerializer):
    tenant_relations = {
        "employee": Employee,
        "payroll_period": PayrollPeriod,
        "pay_component": PayComponent,
    }

    class Meta:
        model = PayrollAdjustment
        fields = (
            "id",
            "employee",
            "payroll_period",
            "pay_component",
            "amount",
            "reason",
            "status",
            "created_by",
            "approved_by",
            "applied_run",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "status",
            "created_by",
            "approved_by",
            "applied_run",
            "created_at",
            "updated_at",
        )

    def create(self, validated_data):
        return call_validated_service(create_payroll_adjustment, **validated_data)


class PayslipSerializer(serializers.ModelSerializer):
    payload = serializers.SerializerMethodField()
    payroll_period = PayrollPeriodSerializer(
        source="payroll_record.payroll_run.payroll_period", read_only=True
    )

    class Meta:
        model = Payslip
        fields = (
            "id",
            "payroll_record",
            "generated_at",
            "document_reference",
            "checksum",
            "payroll_period",
            "payload",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_payload(self, obj) -> dict:
        return payslip_payload(obj.payroll_record)


class EmployeeTaxReliefClaimSerializer(TenantRelationSerializer):
    tenant_relations = {"employee": Employee, "evidence": Document}

    class Meta:
        model = EmployeeTaxReliefClaim
        fields = (
            "id",
            "employee",
            "relief_definition",
            "tax_year",
            "claimed_amount",
            "approved_amount",
            "evidence",
            "status",
            "approved_by",
            "approved_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "approved_amount",
            "status",
            "approved_by",
            "approved_at",
            "created_at",
            "updated_at",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["relief_definition"].queryset = TaxReliefDefinition.objects.all()

    def create(self, validated_data):
        return call_validated_service(create_tax_relief_claim, **validated_data)


class TaxReliefDecisionSerializer(serializers.Serializer):
    approved_amount = serializers.DecimalField(
        max_digits=18, decimal_places=2, min_value=0, required=False
    )


class PayrollReconciliationTotalsSerializer(serializers.Serializer):
    gross_pay = serializers.DecimalField(max_digits=20, decimal_places=2)
    total_deductions = serializers.DecimalField(max_digits=20, decimal_places=2)
    employee_contributions = serializers.DecimalField(max_digits=20, decimal_places=2)
    employer_contributions = serializers.DecimalField(max_digits=20, decimal_places=2)
    net_pay = serializers.DecimalField(max_digits=20, decimal_places=2)


class PayrollReconciliationSerializer(serializers.Serializer):
    payroll_run_id = serializers.UUIDField()
    status = serializers.CharField()
    record_count = serializers.IntegerField()
    totals = PayrollReconciliationTotalsSerializer()
    source_totals = serializers.DictField(
        child=serializers.DecimalField(max_digits=20, decimal_places=2)
    )
    component_totals = serializers.DictField(
        child=serializers.DecimalField(max_digits=20, decimal_places=2)
    )
    discrepancy_count = serializers.IntegerField()
    discrepancies = serializers.ListField(child=serializers.DictField())


class PayrollComplianceDeadlineSerializer(serializers.Serializer):
    compliance_deadline_id = serializers.UUIDField()
    code = serializers.CharField()
    authority = serializers.CharField()
    event_type = serializers.CharField()
    due_date = serializers.DateField()


class PayrollRunExceptionSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True, default=None)
    employee_number = serializers.CharField(source="employee.employee_number", read_only=True, default=None)
    resolved_by_name = serializers.SerializerMethodField()

    def get_resolved_by_name(self, obj):
        return (obj.resolved_by.get_full_name() or obj.resolved_by.email) if obj.resolved_by else None

    class Meta:
        from apps.payroll.models import PayrollRunException

        model = PayrollRunException
        fields = (
            "id", "payroll_run", "employee", "employee_name", "employee_number", "code", "severity", "message",
            "details", "status", "resolution_note", "resolved_by", "resolved_by_name", "resolved_at", "created_at", "updated_at",
        )
        read_only_fields = fields


class PayrollExceptionUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=("OPEN", "ACKNOWLEDGED", "RESOLVED"))
    note = serializers.CharField(required=False, allow_blank=True, max_length=2000)
