from rest_framework.routers import DefaultRouter

from apps.workflows.views import ApprovalActionViewSet, ApprovalInboxViewSet, ApprovalRequestViewSet, WorkflowDefinitionViewSet, WorkflowStepViewSet

router = DefaultRouter()
router.register("approval-workflows", WorkflowDefinitionViewSet, basename="approval-workflow")
router.register("approval-workflow-steps", WorkflowStepViewSet, basename="approval-workflow-step")
router.register("approval-requests", ApprovalRequestViewSet, basename="approval-request")
router.register("approval-actions", ApprovalActionViewSet, basename="approval-action")
router.register("approvals/inbox", ApprovalInboxViewSet, basename="approval-inbox")
urlpatterns = router.urls
