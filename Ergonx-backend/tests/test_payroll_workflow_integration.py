from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.compensation.models import PayComponent
from apps.institutions.models import InstitutionModule
from apps.notifications.models import Notification
from apps.payroll.models import (
    EmployeeTaxReliefClaim,
    PayrollAdjustment,
    PayrollPeriod,
    PayrollPreset,
    PayrollPresetVersion,
    PayrollRun,
    TaxReliefDefinition,
)
from apps.payroll.services import (
    configure_payroll,
    create_payroll_adjustment,
    create_tax_relief_claim,
)


pytestmark = pytest.mark.django_db

TEST_IP = "203.0.113.42"
TEST_USER_AGENT = "ErgonX-Workflow-Contract/1.0"


def _enable_payroll(institution):
    module = institution.modules.get(module_code=InstitutionModule.ModuleCode.PAYROLL)
    module.is_enabled = True
    module.save(update_fields=("is_enabled", "updated_at"))


def _post(api_client, url, data=None):
    return api_client.post(
        url,
        data or {},
        format="json",
        REMOTE_ADDR=TEST_IP,
        HTTP_USER_AGENT=TEST_USER_AGENT,
    )


def _actors(institution, user_factory, membership_factory):
    hr = user_factory(email="workflow-hr@example.com")
    finalizer = user_factory(email="workflow-finalizer@example.com")
    employee_user = user_factory(email="workflow-employee@example.com")
    membership_factory(
        user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True
    )
    membership_factory(
        user=finalizer,
        institution=institution,
        role_code="FINANCE_MANAGER",
        is_primary=True,
    )
    membership_factory(
        user=employee_user,
        institution=institution,
        role_code="EMPLOYEE",
        is_primary=True,
    )
    return hr, finalizer, employee_user


def _period(institution):
    return PayrollPeriod.objects.create(
        institution=institution,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )


def _assert_transition_audit(entity, action, before, after):
    events = AuditLog.objects.filter(
        entity_type=entity._meta.label,
        entity_id=entity.id,
        action=action,
    )
    assert events.count() == 1
    event = events.get()
    assert event.metadata["before"] == {"status": before}
    assert event.metadata["after"] == {"status": after}
    assert event.ip_address == TEST_IP
    assert event.user_agent == TEST_USER_AGENT
    return event


def test_adjustment_submission_and_decision_are_audited_and_retry_safe(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory(code="ADJUSTMENT-WORKFLOW")
    _enable_payroll(institution)
    hr, approver, _ = _actors(institution, user_factory, membership_factory)
    employee = employee_factory(institution)
    period = _period(institution)
    component = PayComponent.objects.create(
        institution=institution,
        name="Correction",
        code="CORRECTION",
        component_type=PayComponent.ComponentType.EARNING,
        calculation_type=PayComponent.CalculationType.FIXED,
    )
    adjustment = create_payroll_adjustment(
        institution=institution,
        actor=hr,
        employee=employee,
        payroll_period=period,
        pay_component=component,
        amount=Decimal("25.00"),
        reason="Contract integration test",
    )
    api_client.force_authenticate(hr)

    submit_url = reverse("v1:payroll-adjustment-submit", args=(adjustment.id,))
    assert _post(api_client, submit_url).status_code == 200
    assert _post(api_client, submit_url).status_code == 200
    _assert_transition_audit(
        adjustment,
        "payroll.adjustment.submitted",
        PayrollAdjustment.Status.DRAFT,
        PayrollAdjustment.Status.PENDING,
    )
    approval_requests = Notification.objects.filter(
        institution=institution,
        user=approver,
        notification_type="PAYROLL_ACTION_REQUIRED",
    )
    assert approval_requests.count() == 1
    assert approval_requests.get().metadata == {
        "payroll_adjustment_id": str(adjustment.id)
    }

    approve_url = reverse("v1:payroll-adjustment-approve", args=(adjustment.id,))
    assert _post(api_client, approve_url).status_code == 200
    assert _post(api_client, approve_url).status_code == 200
    _assert_transition_audit(
        adjustment,
        "payroll.adjustment.approved",
        PayrollAdjustment.Status.PENDING,
        PayrollAdjustment.Status.APPROVED,
    )


def test_run_approval_notifies_finalizers_and_is_audited_once_on_retry(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
):
    institution = institution_factory(code="RUN-WORKFLOW")
    _enable_payroll(institution)
    hr, finalizer, _ = _actors(institution, user_factory, membership_factory)
    period = _period(institution)
    run = PayrollRun.objects.create(
        institution=institution,
        payroll_period=period,
        run_number=1,
        status=PayrollRun.Status.UNDER_REVIEW,
        # Prepared by the finalizer so HR, a different person, may approve (BQ-04).
        started_by=finalizer,
        started_at=timezone.now(),
    )
    api_client.force_authenticate(hr)

    approve_url = reverse("v1:payroll-run-approve", args=(run.id,))
    assert _post(api_client, approve_url).status_code == 200
    assert _post(api_client, approve_url).status_code == 200
    _assert_transition_audit(
        run,
        "payroll.run.approved",
        PayrollRun.Status.UNDER_REVIEW,
        PayrollRun.Status.APPROVED,
    )
    finalization_requests = Notification.objects.filter(
        institution=institution,
        user=finalizer,
        notification_type="PAYROLL_ACTION_REQUIRED",
    )
    assert finalization_requests.count() == 1
    assert finalization_requests.get().metadata == {"payroll_run_id": str(run.id)}


def test_relief_submission_and_decisions_notify_and_audit_once_on_retry(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory(code="RELIEF-WORKFLOW")
    _enable_payroll(institution)
    hr, approver, employee_user = _actors(
        institution, user_factory, membership_factory
    )
    employee = employee_factory(institution, user=employee_user)
    preset = PayrollPreset.objects.create(
        code="RELIEF-WORKFLOW-PRESET", country_code="GH", name="Relief workflow"
    )
    version = PayrollPresetVersion.objects.create(
        payroll_preset=preset,
        version_code="RELIEF-WORKFLOW-1",
        effective_from=date(2026, 1, 1),
        status=PayrollPresetVersion.Status.ACTIVE,
    )
    relief = TaxReliefDefinition.objects.create(
        preset_version=version,
        code="WORKFLOW_RELIEF",
        name="Workflow relief",
        calculation_method="APPROVED_AMOUNT",
    )
    configure_payroll(
        institution=institution,
        actor=hr,
        country_code="GH",
        currency="GHS",
        payroll_frequency="MONTHLY",
        payroll_setup_mode="PRESET",
        selected_payroll_preset_version=version,
    )

    claim = create_tax_relief_claim(
        institution=institution,
        actor=employee_user,
        employee=employee,
        relief_definition=relief,
        tax_year=2026,
        claimed_amount=Decimal("80.00"),
    )
    api_client.force_authenticate(employee_user)
    submit_url = reverse("v1:employee-tax-relief-claim-submit", args=(claim.id,))
    assert _post(api_client, submit_url).status_code == 200
    assert _post(api_client, submit_url).status_code == 200
    _assert_transition_audit(
        claim,
        "payroll.tax_relief_claim.submitted",
        EmployeeTaxReliefClaim.Status.DRAFT,
        EmployeeTaxReliefClaim.Status.PENDING,
    )
    review_requests = Notification.objects.filter(
        institution=institution,
        user=approver,
        notification_type="TAX_RELIEF_ACTION_REQUIRED",
    )
    assert review_requests.count() == 1
    assert review_requests.get().metadata == {"tax_relief_claim_id": str(claim.id)}

    api_client.force_authenticate(hr)
    approve_url = reverse("v1:employee-tax-relief-claim-approve", args=(claim.id,))
    assert _post(api_client, approve_url, {"approved_amount": "60.00"}).status_code == 200
    assert _post(api_client, approve_url, {"approved_amount": "60.00"}).status_code == 200
    approved_event = _assert_transition_audit(
        claim,
        "payroll.tax_relief_claim.approved",
        EmployeeTaxReliefClaim.Status.PENDING,
        EmployeeTaxReliefClaim.Status.APPROVED,
    )
    assert approved_event.metadata["approved_amount"] == "60.00"
    assert Notification.objects.filter(
        institution=institution,
        user=employee_user,
        notification_type="TAX_RELIEF_CLAIM_APPROVED",
    ).count() == 1

    rejected_claim = create_tax_relief_claim(
        institution=institution,
        actor=employee_user,
        employee=employee,
        relief_definition=relief,
        tax_year=2027,
        claimed_amount=Decimal("40.00"),
    )
    api_client.force_authenticate(employee_user)
    rejected_submit_url = reverse(
        "v1:employee-tax-relief-claim-submit", args=(rejected_claim.id,)
    )
    assert _post(api_client, rejected_submit_url).status_code == 200
    api_client.force_authenticate(hr)
    reject_url = reverse(
        "v1:employee-tax-relief-claim-reject", args=(rejected_claim.id,)
    )
    assert _post(api_client, reject_url).status_code == 200
    assert _post(api_client, reject_url).status_code == 200
    rejected_event = _assert_transition_audit(
        rejected_claim,
        "payroll.tax_relief_claim.rejected",
        EmployeeTaxReliefClaim.Status.PENDING,
        EmployeeTaxReliefClaim.Status.REJECTED,
    )
    assert rejected_event.metadata["approved_amount"] == "0.00"
    assert Notification.objects.filter(
        institution=institution,
        user=employee_user,
        notification_type="TAX_RELIEF_CLAIM_REJECTED",
    ).count() == 1
