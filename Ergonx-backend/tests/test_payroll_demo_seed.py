from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.test import override_settings

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.employees.models import Employee
from apps.institutions.models import Institution, InstitutionMembership
from apps.notifications.models import Notification
from apps.payroll.management.commands.seed_payroll_demo import (
    DEMO_ADMIN_EMAIL,
    DEMO_INSTITUTION_CODE,
    DEMO_NON_RESIDENT_EMAIL,
    DEMO_RESIDENT_EMAIL,
    DEMO_RUN_KEY,
)
from apps.payroll.models import (
    EmployeePayrollProfile,
    EmployeeTaxReliefClaim,
    PayrollAdjustment,
    PayrollPeriod,
    PayrollRun,
    Payslip,
)


pytestmark = pytest.mark.django_db


def test_payroll_demo_seed_refuses_non_debug_settings():
    with pytest.raises(CommandError, match="development-only"):
        call_command("seed_payroll_demo", stdout=StringIO())

    assert not Institution.objects.filter(code=DEMO_INSTITUTION_CODE).exists()


@override_settings(DEBUG=True)
def test_payroll_demo_seed_is_complete_and_idempotent():
    first_output = StringIO()
    call_command("seed_payroll_demo", stdout=first_output)

    institution = Institution.objects.get(code=DEMO_INSTITUTION_CODE)
    run = PayrollRun.objects.get(
        institution=institution,
        idempotency_key=DEMO_RUN_KEY,
    )
    first_counts = {
        "users": User.objects.filter(
            email__in=(
                DEMO_ADMIN_EMAIL,
                DEMO_RESIDENT_EMAIL,
                DEMO_NON_RESIDENT_EMAIL,
            )
        ).count(),
        "memberships": InstitutionMembership.objects.filter(
            institution=institution
        ).count(),
        "employees": Employee.objects.filter(institution=institution).count(),
        "profiles": EmployeePayrollProfile.objects.filter(
            institution=institution
        ).count(),
        "periods": PayrollPeriod.objects.filter(institution=institution).count(),
        "runs": PayrollRun.objects.filter(institution=institution).count(),
        "records": run.records.count(),
        "payslips": Payslip.objects.filter(institution=institution).count(),
        "adjustments": PayrollAdjustment.objects.filter(
            institution=institution
        ).count(),
        "claims": EmployeeTaxReliefClaim.objects.filter(
            institution=institution
        ).count(),
        "notifications": Notification.objects.filter(institution=institution).count(),
        "audits": AuditLog.objects.filter(institution=institution).count(),
    }

    second_output = StringIO()
    call_command("seed_payroll_demo", stdout=second_output)
    run.refresh_from_db()
    second_counts = {
        "users": User.objects.filter(
            email__in=(
                DEMO_ADMIN_EMAIL,
                DEMO_RESIDENT_EMAIL,
                DEMO_NON_RESIDENT_EMAIL,
            )
        ).count(),
        "memberships": InstitutionMembership.objects.filter(
            institution=institution
        ).count(),
        "employees": Employee.objects.filter(institution=institution).count(),
        "profiles": EmployeePayrollProfile.objects.filter(
            institution=institution
        ).count(),
        "periods": PayrollPeriod.objects.filter(institution=institution).count(),
        "runs": PayrollRun.objects.filter(institution=institution).count(),
        "records": run.records.count(),
        "payslips": Payslip.objects.filter(institution=institution).count(),
        "adjustments": PayrollAdjustment.objects.filter(
            institution=institution
        ).count(),
        "claims": EmployeeTaxReliefClaim.objects.filter(
            institution=institution
        ).count(),
        "notifications": Notification.objects.filter(institution=institution).count(),
        "audits": AuditLog.objects.filter(institution=institution).count(),
    }

    assert first_counts == second_counts
    assert first_counts == {
        "users": 3,
        "memberships": 4,  # + the payroll approver (BQ-04)
        "employees": 2,
        "profiles": 2,
        "periods": 1,
        "runs": 1,
        "records": 2,
        "payslips": 2,
        "adjustments": 1,
        "claims": 1,
        "notifications": 15,  # the Finance Manager approver is notified too
        "audits": 18,
    }
    assert {
        "payroll.adjustment.submitted",
        "payroll.adjustment.applied",
        "payroll.tax_relief_claim.submitted",
    }.issubset(
        AuditLog.objects.filter(institution=institution).values_list(
            "action", flat=True
        )
    )
    assert {
        "TAX_RELIEF_ACTION_REQUIRED",
        "TAX_RELIEF_CLAIM_APPROVED",
    }.issubset(
        Notification.objects.filter(institution=institution).values_list(
            "notification_type", flat=True
        )
    )
    for email in (DEMO_ADMIN_EMAIL, DEMO_RESIDENT_EMAIL, DEMO_NON_RESIDENT_EMAIL):
        assert User.objects.get(email=email).check_password("ErgonX-Demo-2026!")
    assert run.status == PayrollRun.Status.FINALIZED
    assert run.payroll_period.status == PayrollPeriod.Status.CLOSED
    assert set(run.records.values_list("employee__employee_number", flat=True)) == {
        "GH-DEMO-001",
        "GH-DEMO-002",
    }
    assert PayrollAdjustment.objects.get(institution=institution).status == "APPLIED"
    assert EmployeeTaxReliefClaim.objects.get(institution=institution).status == "APPROVED"
    assert "Deterministic Ghana payroll demo is ready." in first_output.getvalue()
    assert "FINALIZED" in second_output.getvalue()
