from rest_framework import serializers

from common.serializers import ValidatedModelSerializer

from apps.workflows.models import ApprovalAction, ApprovalRequest, ApprovalWorkflowDefinition, ApprovalWorkflowStep


class ApprovalWorkflowDefinitionSerializer(ValidatedModelSerializer):
    class Meta:
        model = ApprovalWorkflowDefinition
        fields = ("id", "institution", "code", "name", "trigger", "workflow_type", "entity_type", "department", "min_amount", "max_amount", "escalation_role", "is_active", "steps", "created_at", "updated_at")
        read_only_fields = ("id", "institution", "steps", "created_at", "updated_at")

    steps = serializers.SerializerMethodField()

    def get_steps(self, obj) -> list[dict]:
        return [
            {"id": str(step.id), "order": step.order, "name": step.name, "approver_type": step.approver_type,
             "approver_role": str(step.approver_role_id) if step.approver_role_id else None,
             "approver_user": str(step.approver_user_id) if step.approver_user_id else None,
             "due_after_hours": step.due_after_hours}
            for step in obj.steps.order_by("order")
        ]

    def validate(self, attrs):
        institution = self.context["request"].institution
        for field in ("department", "escalation_role"):
            value = attrs.get(field)
            if value is not None and value.institution_id != institution.id:
                raise serializers.ValidationError({field: "Must belong to the selected institution."})
        return attrs


class ApprovalWorkflowStepSerializer(ValidatedModelSerializer):
    class Meta:
        model = ApprovalWorkflowStep
        fields = ("id", "institution", "workflow", "order", "name", "approver_type", "approver_role", "approver_user", "due_after_hours", "created_at", "updated_at")
        read_only_fields = ("id", "institution", "created_at", "updated_at")

    def validate(self, attrs):
        institution = self.context["request"].institution
        workflow = attrs.get("workflow", getattr(self.instance, "workflow", None))
        if workflow and workflow.institution_id != institution.id:
            raise serializers.ValidationError({"workflow": "Workflow must belong to the selected institution."})
        return attrs


class ApprovalRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalRequest
        fields = ("id", "institution", "workflow", "entity_type", "entity_id", "requested_by", "current_step", "status", "due_at", "completed_at", "metadata", "created_at", "updated_at")
        read_only_fields = ("id", "institution", "requested_by", "current_step", "status", "due_at", "completed_at", "created_at", "updated_at")


class ApprovalActionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalAction
        fields = ("id", "request", "step", "actor", "action", "comments", "acted_at")
        read_only_fields = fields


class ApprovalDecisionSerializer(serializers.Serializer):
    comments = serializers.CharField(required=False, allow_blank=True, max_length=5000)
