from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.institutions.models import Institution, Role
from common.models import TenantOwnedModel


class ApprovalWorkflowDefinition(TenantOwnedModel):
    class Trigger(models.TextChoices):
        """Business events the approval engine supports (Wave 2, bounded engine)."""

        LEAVE_REQUEST = "LEAVE_REQUEST", "Leave request"
        ATTENDANCE_ADJUSTMENT = "ATTENDANCE_ADJUSTMENT", "Attendance adjustment"
        EXPENSE_CLAIM = "EXPENSE_CLAIM", "Expense claim"
        JOB_REQUISITION = "JOB_REQUISITION", "Job requisition"
        OFFER = "OFFER", "Offer"
        BUDGET = "BUDGET", "Budget"
        VENDOR_BILL = "VENDOR_BILL", "Vendor bill"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="approval_workflows"
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    workflow_type = models.CharField(max_length=100, blank=True)
    entity_type = models.CharField(max_length=150, blank=True)
    # Which business event uses this definition; null for legacy free-text definitions.
    trigger = models.CharField(max_length=40, choices=Trigger.choices, null=True, blank=True)
    # Optional conditions: requester's department and an amount band.
    department = models.ForeignKey(
        "organization.Department", on_delete=models.PROTECT, null=True, blank=True, related_name="approval_workflows"
    )
    min_amount = models.DecimalField(max_digits=20, decimal_places=2, null=True, blank=True)
    max_amount = models.DecimalField(max_digits=20, decimal_places=2, null=True, blank=True)
    # Holders of this role are told when a step passes its due time.
    escalation_role = models.ForeignKey(
        Role, on_delete=models.PROTECT, null=True, blank=True, related_name="escalation_workflows"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("institution", "code"),
                name="uniq_workflow_code_per_institution",
            )
        ]
        indexes = [models.Index(fields=("institution", "is_active"))]

    def clean(self):
        errors = {}
        if self.department_id and self.department.institution_id != self.institution_id:
            errors["department"] = "Department must belong to the same institution."
        if self.escalation_role_id and self.escalation_role.institution_id != self.institution_id:
            errors["escalation_role"] = "Escalation role must belong to the same institution."
        if self.min_amount is not None and self.max_amount is not None and self.min_amount > self.max_amount:
            errors["max_amount"] = "The maximum must not be below the minimum."
        if not self.trigger and not self.entity_type:
            errors["trigger"] = "Choose the business event this workflow applies to."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.institution.code}: {self.name}"


class ApprovalWorkflowStep(TenantOwnedModel):
    class ApproverType(models.TextChoices):
        USER = "USER", "A named person"
        ROLE = "ROLE", "Any member holding a role"
        REQUESTER_DEPARTMENT_HEAD = "REQUESTER_DEPARTMENT_HEAD", "The requester's department head"
        REQUESTER_MANAGER = "REQUESTER_MANAGER", "The requester's line manager"

    institution = models.ForeignKey(
        Institution, on_delete=models.CASCADE, related_name="approval_workflow_steps"
    )
    workflow = models.ForeignKey(
        ApprovalWorkflowDefinition, on_delete=models.CASCADE, related_name="steps"
    )
    order = models.PositiveSmallIntegerField()
    name = models.CharField(max_length=150)
    approver_role = models.ForeignKey(
        Role,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="approval_steps",
    )
    approver_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="assigned_approval_steps",
    )
    approver_type = models.CharField(max_length=30, choices=ApproverType.choices, default=ApproverType.ROLE)
    due_after_hours = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ("workflow", "order")
        constraints = [
            models.UniqueConstraint(
                fields=("workflow", "order"), name="uniq_step_order_per_workflow"
            ),
            models.CheckConstraint(
                condition=(models.Q(approver_type="USER") & models.Q(approver_user__isnull=False))
                | (models.Q(approver_type="ROLE") & models.Q(approver_role__isnull=False))
                | models.Q(approver_type__in=("REQUESTER_DEPARTMENT_HEAD", "REQUESTER_MANAGER")),
                name="workflow_step_approver_matches_type",
            ),
        ]

    def clean(self):
        errors = {}
        if self.approver_type == self.ApproverType.ROLE and self.approver_user_id and not self.approver_role_id:
            # Callers that name only a person (pre-Wave 2 clients) mean a USER step.
            self.approver_type = self.ApproverType.USER
        if self.workflow_id and self.workflow.institution_id != self.institution_id:
            errors["workflow"] = "Workflow must belong to the same institution."
        if self.approver_role_id and self.approver_role.institution_id != self.institution_id:
            errors["approver_role"] = "Approver role must belong to the same institution."
        if self.approver_user_id and self.institution_id:
            if not self.approver_user.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                errors["approver_user"] = "Approver must belong to the same institution."
        if self.approver_type == self.ApproverType.USER and not self.approver_user_id:
            errors["approver_user"] = "Choose the person who approves this step."
        if self.approver_type == self.ApproverType.ROLE and not self.approver_role_id:
            errors["approver_role"] = "Choose the role that approves this step."
        if self.approver_role_id and self.approver_role.is_read_only:
            errors["approver_role"] = "A read-only role cannot approve requests."
        if self.approver_user_id and self.institution_id and self.approver_user.memberships.filter(
            institution_id=self.institution_id, role__is_read_only=True
        ).exists():
            errors["approver_user"] = "This user has a read-only role and cannot approve requests."
        if errors:
            raise ValidationError(errors)


class ApprovalRequest(TenantOwnedModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        RETURNED = "RETURNED", "Returned for changes"
        CANCELLED = "CANCELLED", "Cancelled"

    institution = models.ForeignKey(
        Institution, on_delete=models.PROTECT, related_name="approval_requests"
    )
    workflow = models.ForeignKey(
        ApprovalWorkflowDefinition, on_delete=models.PROTECT, related_name="requests"
    )
    entity_type = models.CharField(max_length=150)
    entity_id = models.UUIDField()
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="approval_requests_created",
    )
    current_step = models.ForeignKey(
        ApprovalWorkflowStep,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="current_requests",
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    due_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("institution", "status")),
            models.Index(fields=("entity_type", "entity_id")),
        ]

    def clean(self):
        errors = {}
        if self.workflow_id and self.workflow.institution_id != self.institution_id:
            errors["workflow"] = "Workflow must belong to the same institution."
        if self.current_step_id and self.current_step.institution_id != self.institution_id:
            errors["current_step"] = "Current step must belong to the same institution."
        if (
            self.current_step_id
            and self.workflow_id
            and self.current_step.workflow_id != self.workflow_id
        ):
            errors["current_step"] = "Current step must belong to the selected workflow."
        if self.requested_by_id and self.institution_id:
            if not self.requested_by.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                errors["requested_by"] = "Requester must belong to the same institution."
        if errors:
            raise ValidationError(errors)


class ApprovalAction(TenantOwnedModel):
    class Action(models.TextChoices):
        APPROVE = "APPROVE", "Approve"
        REJECT = "REJECT", "Reject"
        RETURN = "RETURN", "Return"
        CANCEL = "CANCEL", "Cancel"

    institution = models.ForeignKey(
        Institution, on_delete=models.PROTECT, related_name="approval_actions"
    )
    request = models.ForeignKey(
        ApprovalRequest, on_delete=models.CASCADE, related_name="actions"
    )
    step = models.ForeignKey(
        ApprovalWorkflowStep, on_delete=models.PROTECT, related_name="actions"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="approval_actions",
    )
    action = models.CharField(max_length=10, choices=Action.choices)
    comments = models.TextField(blank=True)
    acted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("acted_at",)
        indexes = [models.Index(fields=("institution", "acted_at"))]

    def clean(self):
        errors = {}
        if self.request_id and self.request.institution_id != self.institution_id:
            errors["request"] = "Request must belong to the same institution."
        if self.step_id and self.step.institution_id != self.institution_id:
            errors["step"] = "Step must belong to the same institution."
        if (
            self.request_id
            and self.step_id
            and self.step.workflow_id != self.request.workflow_id
        ):
            errors["step"] = "Step must belong to the request workflow."
        if self.actor_id and self.institution_id:
            if not self.actor.memberships.filter(
                institution_id=self.institution_id
            ).exists():
                errors["actor"] = "Actor must belong to the same institution."
        if errors:
            raise ValidationError(errors)
