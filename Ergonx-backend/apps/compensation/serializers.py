from rest_framework import serializers

from apps.compensation.models import (
    EmployeeCompensation,
    EmployeePayComponent,
    PayComponent,
    SalaryStructure,
    SalaryStructureComponent,
)
from apps.compensation.services import (
    change_current_compensation,
    set_employee_pay_component,
)
from apps.employees.models import Employee
from common.serializers import ValidatedModelSerializer, call_validated_service


class TenantRelationSerializer(ValidatedModelSerializer):
    tenant_relations = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            for field_name, model in self.tenant_relations.items():
                if field_name in self.fields:
                    self.fields[field_name].queryset = model.objects.for_institution(institution)


class PayComponentSerializer(TenantRelationSerializer):
    class Meta:
        model = PayComponent
        fields = (
            "id",
            "name",
            "code",
            "component_type",
            "calculation_type",
            "taxable",
            "pensionable",
            "cash_or_kind",
            "recurring",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class SalaryStructureSerializer(TenantRelationSerializer):
    class Meta:
        model = SalaryStructure
        fields = (
            "id",
            "name",
            "code",
            "description",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class SalaryStructureComponentSerializer(TenantRelationSerializer):
    tenant_relations = {
        "salary_structure": SalaryStructure,
        "pay_component": PayComponent,
        "percentage_base_component": PayComponent,
    }

    class Meta:
        model = SalaryStructureComponent
        fields = (
            "id",
            "salary_structure",
            "pay_component",
            "default_amount",
            "default_percentage",
            "percentage_base_component",
            "sequence",
            "is_required",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class EmployeeCompensationSerializer(TenantRelationSerializer):
    tenant_relations = {
        "employee": Employee,
        "salary_structure": SalaryStructure,
    }

    class Meta:
        model = EmployeeCompensation
        fields = (
            "id",
            "employee",
            "salary_structure",
            "base_salary",
            "pay_basis",
            "currency",
            "effective_from",
            "effective_to",
            "is_current",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "effective_to",
            "is_current",
            "created_at",
            "updated_at",
        )

    def create(self, validated_data):
        return call_validated_service(change_current_compensation, **validated_data)


class EmployeePayComponentSerializer(TenantRelationSerializer):
    tenant_relations = {
        "employee_compensation": EmployeeCompensation,
        "pay_component": PayComponent,
    }

    class Meta:
        model = EmployeePayComponent
        fields = (
            "id",
            "employee_compensation",
            "pay_component",
            "amount",
            "percentage",
            "effective_from",
            "effective_to",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "effective_to",
            "is_active",
            "created_at",
            "updated_at",
        )

    def create(self, validated_data):
        return call_validated_service(set_employee_pay_component, **validated_data)


class OverrideEndSerializer(serializers.Serializer):
    effective_to = serializers.DateField()


class ResolvedPayComponentSerializer(serializers.Serializer):
    pay_component_id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()
    component_type = serializers.CharField()
    calculation_type = serializers.CharField()
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, allow_null=True)
    percentage = serializers.DecimalField(max_digits=9, decimal_places=4, allow_null=True)
    percentage_base_component_id = serializers.UUIDField(allow_null=True)
    resolved_amount = serializers.DecimalField(
        max_digits=18, decimal_places=2, allow_null=True
    )
    source = serializers.CharField()
    is_required = serializers.BooleanField()


class ResolvedCompensationSerializer(serializers.Serializer):
    employee_compensation_id = serializers.UUIDField()
    employee_id = serializers.UUIDField()
    salary_structure_id = serializers.UUIDField()
    base_salary = serializers.DecimalField(max_digits=18, decimal_places=2)
    currency = serializers.CharField()
    as_of = serializers.DateField()
    components = ResolvedPayComponentSerializer(many=True)
