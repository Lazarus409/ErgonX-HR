from uuid import uuid4

import pytest
from django.core.exceptions import PermissionDenied

from apps.workflows.models import ApprovalRequest, ApprovalWorkflowDefinition, ApprovalWorkflowStep
from apps.workflows.services import decide_approval_request, submit_approval_request


@pytest.mark.django_db
def test_generalized_approval_progression_and_role_isolation(institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="APPROVAL-HOME")
    foreign = institution_factory(code="APPROVAL-FOREIGN")
    requester = user_factory(); approver = user_factory(); outsider = user_factory()
    membership_factory(user=requester, institution=institution, role_code="EMPLOYEE", is_primary=True)
    membership_factory(user=approver, institution=institution, role_code="HR_ADMIN")
    membership_factory(user=outsider, institution=foreign, role_code="HR_ADMIN", is_primary=True)
    workflow = ApprovalWorkflowDefinition.objects.create(institution=institution, code="GENERIC", name="Generic approval", workflow_type="GENERIC", entity_type="example.Record")
    step = ApprovalWorkflowStep.objects.create(institution=institution, workflow=workflow, order=1, name="HR review", approver_role=institution.roles.get(code="HR_ADMIN"))
    request = submit_approval_request(institution=institution, workflow=workflow, entity_type="example.Record", entity_id=uuid4(), requested_by=requester)
    with pytest.raises(PermissionDenied):
        decide_approval_request(request=request, actor=outsider, action="APPROVE")
    result = decide_approval_request(request=request, actor=approver, action="APPROVE", comments="Approved")
    assert result.status == ApprovalRequest.Status.APPROVED
    assert result.current_step is None
    assert result.actions.get().actor_id == approver.id
