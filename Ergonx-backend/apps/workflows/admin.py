from django.contrib import admin

from apps.workflows.models import (
    ApprovalAction,
    ApprovalRequest,
    ApprovalWorkflowDefinition,
    ApprovalWorkflowStep,
)

admin.site.register(
    [ApprovalWorkflowDefinition, ApprovalWorkflowStep, ApprovalRequest, ApprovalAction]
)
