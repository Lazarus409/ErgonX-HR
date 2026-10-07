from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from apps.institutions.services import effective_permission_codes
from apps.workflows.inbox import approval_inbox
from apps.workflows.models import ApprovalAction, ApprovalRequest, ApprovalWorkflowDefinition, ApprovalWorkflowStep
from apps.workflows.serializers import ApprovalActionSerializer, ApprovalDecisionSerializer, ApprovalRequestSerializer, ApprovalWorkflowDefinitionSerializer, ApprovalWorkflowStepSerializer
from apps.audit.services import record_audit_event
from apps.workflows.services import decide_approval_request, submit_approval_request
from common.permissions import TenantContextPermission, TenantRBACPermission
from common.viewsets import TenantModelViewSet


class AuditedConfigurationMixin:
    """Configuration changes are audited with before/after values (Wave 2, AUD-02)."""

    audit_prefix = ""

    def _snapshot(self, instance):
        return {key: (str(value) if value is not None else None) for key, value in self.get_serializer(instance).data.items() if key not in ("created_at", "updated_at")}

    def perform_create(self, serializer):
        super().perform_create(serializer)
        record_audit_event(actor=self.request.user, institution=self.request.institution, entity=serializer.instance, action=f"{self.audit_prefix}.created", metadata={"after": self._snapshot(serializer.instance)})

    def perform_update(self, serializer):
        before = self._snapshot(serializer.instance)
        super().perform_update(serializer)
        after = self._snapshot(serializer.instance)
        changes = {key: [before.get(key), value] for key, value in after.items() if before.get(key) != value}
        record_audit_event(actor=self.request.user, institution=self.request.institution, entity=serializer.instance, action=f"{self.audit_prefix}.updated", metadata={"changes": changes})

    def perform_destroy(self, instance):
        before = self._snapshot(instance)
        super().perform_destroy(instance)
        record_audit_event(actor=self.request.user, institution=self.request.institution, entity=instance, action=f"{self.audit_prefix}.deactivated" if hasattr(instance, "is_active") else f"{self.audit_prefix}.deleted", metadata={"before": before})


class WorkflowDefinitionViewSet(AuditedConfigurationMixin, TenantModelViewSet):
    model = ApprovalWorkflowDefinition
    serializer_class = ApprovalWorkflowDefinitionSerializer
    permission_resource = "approval_workflow"
    audit_prefix = "approval_workflow"


class WorkflowStepViewSet(AuditedConfigurationMixin, TenantModelViewSet):
    model = ApprovalWorkflowStep
    serializer_class = ApprovalWorkflowStepSerializer
    permission_resource = "approval_workflow"
    audit_prefix = "approval_workflow_step"


class ApprovalRequestViewSet(TenantModelViewSet):
    model = ApprovalRequest
    serializer_class = ApprovalRequestSerializer
    permission_resource = "approval_request"
    # Records are kept for audit: no hard DELETE route (W0-API-02).
    http_method_names = ("get", "post", "head", "options")

    def perform_create(self, serializer):
        request = self.request
        instance = submit_approval_request(institution=request.institution, workflow=serializer.validated_data["workflow"], entity_type=serializer.validated_data["entity_type"], entity_id=serializer.validated_data["entity_id"], requested_by=request.user, metadata=serializer.validated_data.get("metadata"))
        serializer.instance = instance

    @action(detail=True, methods=("post",))
    def approve(self, request, pk=None):
        return self._decide(request, ApprovalAction.Action.APPROVE)

    @action(detail=True, methods=("post",))
    def reject(self, request, pk=None):
        return self._decide(request, ApprovalAction.Action.REJECT)

    @action(detail=True, methods=("post",), url_path="return")
    def return_for_changes(self, request, pk=None):
        return self._decide(request, ApprovalAction.Action.RETURN)

    @action(detail=True, methods=("post",))
    def cancel(self, request, pk=None):
        return self._decide(request, ApprovalAction.Action.CANCEL)

    def _decide(self, request, action):
        serializer = ApprovalDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = self.get_object()
        result = decide_approval_request(request=item, actor=request.user, action=action, comments=serializer.validated_data.get("comments", ""))
        return Response(self.get_serializer(result).data)


class ApprovalActionViewSet(TenantModelViewSet):
    model = ApprovalAction
    serializer_class = ApprovalActionSerializer
    permission_resource = "approval_request"
    http_method_names = ("get", "head", "options")


class ApprovalInboxViewSet(ViewSet):
    """Everything waiting on the caller's decision, across modules."""

    permission_classes = (TenantContextPermission, TenantRBACPermission)

    def get_required_permission(self):
        # Every member may open their inbox; each module gates its own rows.
        return "home.view"

    @extend_schema(
        responses={200: OpenApiTypes.OBJECT},
        description=(
            "Pending approvals the caller can act on (leave steps they own, attendance, payroll, "
            "recruitment, accounting and workflow requests gated by module, permission and data "
            "scope) plus recent decisions. Each item names the module endpoint that decides it."
        ),
    )
    def list(self, request):
        return Response(approval_inbox(request, permission_codes=effective_permission_codes(request.membership)))
