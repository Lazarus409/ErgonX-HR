from datetime import date, time
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.urls import reverse
from django.utils import timezone
from drf_spectacular.generators import SchemaGenerator

from apps.audit.models import AuditLog
from common.exceptions import CodedValidationError
from apps.attendance.models import AttendanceRecord, OvertimeRecord
from apps.compensation.models import EmployeeCompensation, PayComponent, SalaryStructure
from apps.accounting.models import (
    Account,
    AccountingPeriod,
    FiscalYear,
    JournalEntry,
    PayComponentAccountMapping,
)
from apps.accounting.services import approve_journal, generate_payroll_journal, post_journal, submit_journal
from apps.documents.models import Document
from apps.employees.models import Employment
from apps.institutions.models import InstitutionModule, Permission, UserActivityEvent
from apps.payroll.models import (
    ComplianceDeadline,
    ContributionRule,
    EmployeeTaxReliefClaim,
    PayrollAdjustment,
    PayrollItem,
    PayrollPeriod,
    PayrollPreset,
    PayrollPresetVersion,
    PayrollRecord,
    PayrollRun,
    TaxBand,
    TaxReliefDefinition,
    TaxRule,
)
from apps.payroll.services import (
    approve_payroll_run,
    calculate_payroll_run,
    configure_payroll,
    create_payroll_adjustment,
    create_payroll_period,
    create_payroll_run,
    decide_payroll_adjustment,
    finalize_payroll_run,
    reconcile_payroll_run,
    submit_payroll_adjustment,
    submit_payroll_run_for_review,
)
from apps.scheduling.models import ScheduleAssignment, Shift, WorkSchedule


pytestmark = pytest.mark.django_db


def _enable_payroll(institution):
    module = institution.modules.get(module_code=InstitutionModule.ModuleCode.PAYROLL)
    module.is_enabled = True
    module.save(update_fields=("is_enabled", "updated_at"))


def _employee_with_pay(
    institution,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
    *,
    employee_number="EMP001",
    user=None,
    base_salary=Decimal("3000.00"),
):
    employee = employee_factory(
        institution, employee_number=employee_number, user=user
    )
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    Employment.objects.create(
        institution=institution,
        employee=employee,
        department=department,
        position=position,
        grade=grade,
        location=location,
        employment_type=Employment.EmploymentType.PERMANENT,
        start_date=date(2026, 1, 1),
    )
    structure = SalaryStructure.objects.create(
        institution=institution,
        name=f"Structure {employee_number}",
        code=f"STR-{employee_number}",
    )
    EmployeeCompensation.objects.create(
        institution=institution,
        employee=employee,
        salary_structure=structure,
        base_salary=base_salary,
        currency="GHS",
        effective_from=date(2026, 1, 1),
    )
    return employee


def _preset_with_generic_rules():
    preset = PayrollPreset.objects.create(
        code="TEST-PAYROLL",
        country_code="GH",
        name="Generic Test Payroll",
    )
    version = PayrollPresetVersion.objects.create(
        payroll_preset=preset,
        version_code="TEST-2026.1",
        effective_from=date(2026, 1, 1),
    )
    TaxRule.objects.create(
        preset_version=version,
        code="PAYE",
        name="Income tax",
        method=TaxRule.Method.FLAT,
        residency="ANY",
        rate=Decimal("10.0000"),
        basis=TaxRule.Basis.TAXABLE_INCOME,
    )
    ContributionRule.objects.create(
        preset_version=version,
        code="PENSION",
        name="Pension",
        basis=TaxRule.Basis.BASE_SALARY,
        employee_rate=Decimal("5.0000"),
        employer_rate=Decimal("10.0000"),
        effective_from=date(2026, 1, 1),
    )
    relief = TaxReliefDefinition.objects.create(
        preset_version=version,
        code="TRAINING",
        name="Training relief",
        calculation_method="APPROVED_AMOUNT",
        default_amount=Decimal("100.00"),
    )
    ComplianceDeadline.objects.create(
        preset_version=version,
        code="PAYE_RETURN",
        authority="Revenue Authority",
        event_type="MONTHLY_RETURN",
        calculation_rule={"period": "FOLLOWING_MONTH"},
        day_of_month=15,
        effective_from=date(2026, 1, 1),
    )
    version.status = PayrollPresetVersion.Status.ACTIVE
    version.save(update_fields=("status", "updated_at"))
    return version, relief


def test_payroll_module_gate_and_role_permissions(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory()
    accountant = user_factory()
    membership = membership_factory(
        user=accountant,
        institution=institution,
        role_code="ACCOUNTANT",
        is_primary=True,
    )
    api_client.force_authenticate(accountant)

    disabled = api_client.get(reverse("v1:payroll-period-list"))
    _enable_payroll(institution)
    enabled = api_client.get(reverse("v1:payroll-period-list"))

    assert disabled.status_code == 403
    assert enabled.status_code == 200
    assert membership.role.permissions.filter(code="payroll.prepare").exists()
    assert not membership.role.permissions.filter(code="payroll.finalize").exists()
    assert Permission.objects.get(code="payroll.finalize").module_code == "PAYROLL"


def test_payroll_api_returns_stable_workflow_error_codes(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
):
    institution = institution_factory(code="ERROR-CODES")
    _enable_payroll(institution)
    hr = user_factory()
    membership_factory(
        user=hr,
        institution=institution,
        role_code="HR_ADMIN",
        is_primary=True,
    )
    version, _ = _preset_with_generic_rules()
    configure_payroll(
        institution=institution,
        actor=hr,
        country_code="GH",
        currency="GHS",
        payroll_frequency="MONTHLY",
        payroll_setup_mode="PRESET",
        selected_payroll_preset_version=version,
    )
    september = create_payroll_period(
        institution=institution,
        actor=hr,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )
    october = create_payroll_period(
        institution=institution,
        actor=hr,
        name="October 2026",
        start_date=date(2026, 10, 1),
        end_date=date(2026, 10, 31),
        pay_date=date(2026, 10, 31),
    )
    run = create_payroll_run(
        institution=institution,
        payroll_period=september,
        actor=hr,
        idempotency_key="stable-run-key",
    )
    api_client.force_authenticate(hr)

    invalid_transition = api_client.post(
        reverse("v1:payroll-run-approve", args=(run.id,)),
        format="json",
    )
    duplicate_operation = api_client.post(
        reverse("v1:payroll-run-list"),
        {
            "payroll_period": str(october.id),
            "idempotency_key": "stable-run-key",
        },
        format="json",
    )
    PayrollRun.objects.filter(pk=run.pk).update(status=PayrollRun.Status.FINALIZED)
    immutable = api_client.post(
        reverse("v1:payroll-run-calculate", args=(run.id,)),
        format="json",
    )
    PayrollPeriod.objects.filter(pk=october.pk).update(
        status=PayrollPeriod.Status.CLOSED
    )
    period_closed = api_client.post(
        reverse("v1:payroll-run-list"),
        {
            "payroll_period": str(october.id),
            "idempotency_key": "closed-period-key",
        },
        format="json",
    )

    assert invalid_transition.status_code == 400
    assert invalid_transition.json()["code"] == "invalid_state_transition"
    assert "status" in invalid_transition.json()["errors"]
    assert duplicate_operation.status_code == 400
    assert duplicate_operation.json()["code"] == "duplicate_operation"
    assert immutable.status_code == 400
    assert immutable.json()["code"] == "record_immutable"
    assert period_closed.status_code == 400
    assert period_closed.json()["code"] == "period_closed"


def test_finalized_payroll_generates_one_mapped_draft_journal_and_posts_it(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory(code="PAYROLL-GL")
    _enable_payroll(institution)
    accounting_module = institution.modules.get(
        module_code=InstitutionModule.ModuleCode.ACCOUNTING
    )
    accounting_module.is_enabled = True
    accounting_module.save(update_fields=("is_enabled", "updated_at"))
    actor = user_factory()
    membership_factory(
        user=actor,
        institution=institution,
        role_code="FINANCE_MANAGER",
        is_primary=True,
    )
    employee = employee_factory(institution)
    payroll_period = PayrollPeriod.objects.create(
        institution=institution,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )
    run = PayrollRun.objects.create(
        institution=institution,
        payroll_period=payroll_period,
        run_number=1,
        started_by=actor,
        started_at=timezone.now(),
    )
    PayrollRun.objects.filter(pk=run.pk).update(status=PayrollRun.Status.FINALIZED)
    record = PayrollRecord.objects.create(
        institution=institution,
        payroll_run=run,
        employee=employee,
        gross_pay=Decimal("1200.00"),
        taxable_income=Decimal("1200.00"),
        total_deductions=Decimal("0.00"),
        employee_contributions=Decimal("0.00"),
        employer_contributions=Decimal("0.00"),
        net_pay=Decimal("1200.00"),
        currency="GHS",
    )
    component = PayComponent.objects.create(
        institution=institution,
        name="Basic pay",
        code="BASIC",
        component_type=PayComponent.ComponentType.EARNING,
        calculation_type=PayComponent.CalculationType.FIXED,
    )
    PayrollItem.objects.create(
        payroll_record=record,
        pay_component=component,
        component_code_snapshot="BASIC",
        component_name_snapshot="Basic pay",
        source=PayrollItem.Source.COMPENSATION,
        amount=Decimal("1200.00"),
        metadata={"effect": "EARNING"},
    )
    fiscal_year = FiscalYear.objects.create(
        institution=institution,
        name="FY2026",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
    )
    AccountingPeriod.objects.create(
        institution=institution,
        fiscal_year=fiscal_year,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
    )
    salaries = Account.objects.create(
        institution=institution,
        code="5100",
        name="Salaries expense",
        account_type=Account.AccountType.EXPENSE,
        normal_balance=Account.NormalBalance.DEBIT,
    )
    payable = Account.objects.create(
        institution=institution,
        code="2340",
        name="Payroll payable",
        account_type=Account.AccountType.LIABILITY,
        normal_balance=Account.NormalBalance.CREDIT,
    )
    PayComponentAccountMapping.objects.create(
        institution=institution,
        pay_component=component,
        debit_account=salaries,
        credit_account=payable,
        effective_from=date(2026, 1, 1),
    )

    journal = generate_payroll_journal(payroll_run=run, actor=actor)
    retry = generate_payroll_journal(payroll_run=run, actor=actor)

    assert journal.id == retry.id
    assert journal.source == JournalEntry.Source.PAYROLL
    assert journal.status == JournalEntry.Status.DRAFT
    assert list(journal.lines.values_list("debit", "credit")) == [
        (Decimal("1200.00"), Decimal("0.00")),
        (Decimal("0.00"), Decimal("1200.00")),
    ]
    journal = submit_journal(journal=journal, actor=actor)
    journal = approve_journal(journal=journal, actor=actor)
    journal = post_journal(journal=journal, actor=actor)
    run.refresh_from_db()
    assert journal.status == JournalEntry.Status.POSTED
    assert run.accounting_journal_entry_id == journal.id

    api_client.force_authenticate(actor)
    response = api_client.post(
        reverse("v1:payroll-run-generate-accounting-journal", args=(run.id,)),
        format="json",
    )
    assert response.status_code == 200
    assert response.data["id"] == str(journal.id)


def test_payroll_openapi_operations_are_frontend_ready():
    schema = SchemaGenerator().get_schema(request=None, public=True)
    payroll_prefixes = (
        "payroll",
        "employee-payroll",
        "employee-tax-relief",
        "tax-",
        "contribution-",
        "special-income",
        "statutory-threshold",
        "compliance-deadline",
        "payslip",
    )
    operations = []
    for path, path_item in schema["paths"].items():
        if not path.removeprefix("/api/v1/").startswith(payroll_prefixes):
            continue
        for method, operation in path_item.items():
            if method in {"get", "post", "put", "patch", "delete"}:
                operations.append((path, method, operation))

    assert operations
    for path, _, operation in operations:
        assert operation["summary"]
        assert "Requires an authenticated user" in operation["description"]
        assert (
            "`PAYROLL` module enabled" in operation["description"]
            or "`ACCOUNTING` module enabled" in operation["description"]
        )
        assert operation["x-error-codes"]

    profile_list = schema["paths"]["/api/v1/employee-payroll-profiles/"]["get"]
    assert "`payroll.configure` permission" in profile_list["description"]

    calculate = schema["paths"]["/api/v1/payroll-runs/{id}/calculate/"]["post"]
    assert calculate["summary"] == "Calculate payroll run"
    assert "requestBody" not in calculate
    assert [(parameter["in"], parameter["name"]) for parameter in calculate["parameters"]] == [
        ("path", "id")
    ]
    assert "invalid_state_transition" in calculate["x-error-codes"]
    assert "record_immutable" in calculate["x-error-codes"]
    assert "inspect code and errors" in calculate["responses"]["400"]["description"]

    deadlines = schema["paths"][
        "/api/v1/payroll-periods/{id}/compliance-deadlines/"
    ]["get"]
    assert [(parameter["in"], parameter["name"]) for parameter in deadlines["parameters"]] == [
        ("path", "id")
    ]
    deadline_data = deadlines["responses"]["200"]["content"]["application/json"][
        "schema"
    ]["properties"]["data"]
    assert deadline_data["type"] == "array"
    assert deadline_data["items"] == {
        "$ref": "#/components/schemas/PayrollComplianceDeadline"
    }

    relief_approve = schema["paths"][
        "/api/v1/employee-tax-relief-claims/{id}/approve/"
    ]["post"]
    assert relief_approve["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/TaxReliefDecision"
    }
    adjustment_submit = schema["paths"][
        "/api/v1/payroll-adjustments/{id}/submit/"
    ]["post"]
    assert "requestBody" not in adjustment_submit

    run_create = schema["paths"]["/api/v1/payroll-runs/"]["post"]
    assert run_create["requestBody"]["content"]["application/json"]["examples"]
    choices = schema["paths"]["/api/v1/payroll-configurations/choices/"]["get"]
    assert choices["responses"]["200"]["content"]["application/json"]["examples"]
    reconciliation = schema["paths"]["/api/v1/payroll-runs/{id}/reconcile/"]["get"]
    assert reconciliation["responses"]["200"]["content"]["application/json"][
        "examples"
    ]
    assert schema["components"]["schemas"]["ErrorEnvelope"]["example"]["code"] == (
        "module_disabled"
    )


def test_payroll_periods_reject_active_overlap_per_tenant(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="HOME")
    other = institution_factory(code="OTHER")
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    configure_payroll(
        institution=institution,
        actor=hr,
        country_code="GH",
        currency="GHS",
        payroll_frequency="MONTHLY",
        payroll_setup_mode="CUSTOM",
    )

    create_payroll_period(
        institution=institution,
        actor=hr,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )
    with pytest.raises(ValidationError, match="cannot overlap"):
        create_payroll_period(
            institution=institution,
            actor=hr,
            name="Overlapping",
            start_date=date(2026, 9, 15),
            end_date=date(2026, 10, 14),
            pay_date=date(2026, 10, 14),
        )

    PayrollPeriod.objects.create(
        institution=other,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )


def test_generic_payroll_calculation_lifecycle_snapshot_and_immutability(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    _enable_payroll(institution)
    hr = user_factory()
    employee_user = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    membership_factory(
        user=employee_user,
        institution=institution,
        role_code="EMPLOYEE",
        is_primary=True,
    )
    employee = _employee_with_pay(
        institution,
        employee_factory,
        organization_factory,
        assignment_dimensions_factory,
        user=employee_user,
    )
    version, _ = _preset_with_generic_rules()
    configure_payroll(
        institution=institution,
        actor=hr,
        country_code="GH",
        currency="GHS",
        payroll_frequency="MONTHLY",
        payroll_setup_mode="PRESET",
        selected_payroll_preset_version=version,
    )
    period = create_payroll_period(
        institution=institution,
        actor=hr,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )

    run = create_payroll_run(
        institution=institution,
        payroll_period=period,
        actor=hr,
        idempotency_key="sept-2026-v1",
    )
    retry = create_payroll_run(
        institution=institution,
        payroll_period=period,
        actor=hr,
        idempotency_key="sept-2026-v1",
    )
    assert retry.id == run.id
    assert UserActivityEvent.objects.filter(
        institution=institution,
        user=hr,
        activity_code="payroll.prepare",
        entity_id=run.id,
    ).count() == 1
    assert run.statutory_snapshot["version"]["version_code"] == "TEST-2026.1"
    assert run.statutory_snapshot["relief_definitions"][0]["code"] == "TRAINING"
    assert run.statutory_snapshot["compliance_deadlines"][0]["code"] == "PAYE_RETURN"

    run = calculate_payroll_run(payroll_run=run, actor=hr)
    record = run.records.get(employee=employee)
    assert record.gross_pay == Decimal("3000.00")
    assert record.taxable_income == Decimal("3000.00")
    assert record.total_deductions == Decimal("300.00")
    assert record.employee_contributions == Decimal("150.00")
    assert record.employer_contributions == Decimal("300.00")
    assert record.net_pay == Decimal("2550.00")
    assert set(record.items.values_list("component_code_snapshot", flat=True)) == {
        "BASE_SALARY",
        "PAYE",
        "PENSION_EMPLOYEE",
        "PENSION_EMPLOYER",
    }
    assert reconcile_payroll_run(run)["discrepancy_count"] == 0

    run = submit_payroll_run_for_review(payroll_run=run, actor=hr)
    # Separation of duties (BQ-04): the preparer cannot approve.
    with pytest.raises(CodedValidationError, match="separation of duties"):
        approve_payroll_run(payroll_run=run, actor=hr)
    approver = user_factory(email="payroll.approver@example.com")
    membership_factory(user=approver, institution=institution, role_code="FINANCE_MANAGER")
    run = approve_payroll_run(payroll_run=run, actor=approver)
    run = finalize_payroll_run(payroll_run=run, actor=hr)
    retry = finalize_payroll_run(payroll_run=run, actor=hr)
    record.refresh_from_db()
    period.refresh_from_db()
    assert retry.id == run.id
    assert record.status == "FINALIZED"
    assert period.status == PayrollPeriod.Status.CLOSED
    assert record.payslip.checksum
    assert run.records.count() == 1

    api_client.force_authenticate(employee_user)
    payslip_response = api_client.get(
        reverse("v1:payslip-detail", args=(record.payslip.id,))
    )
    assert payslip_response.status_code == 200
    assert payslip_response.data["payload"]["net_pay"] == "2550.00"
    assert len(payslip_response.data["payload"]["items"]) == 4
    assert payslip_response.data["payroll_period"] == {
        "id": str(period.id),
        "name": period.name,
        "start_date": period.start_date.isoformat(),
        "end_date": period.end_date.isoformat(),
        "pay_date": period.pay_date.isoformat(),
        "status": period.status,
        "created_at": payslip_response.data["payroll_period"]["created_at"],
        "updated_at": payslip_response.data["payroll_period"]["updated_at"],
    }

    payslip = record.payslip
    document = Document.objects.create(
        institution=institution,
        uploaded_by=hr,
        file_reference="payslips/2026-09/emp001.pdf",
        original_filename="emp001-september-2026.pdf",
        content_type="application/pdf",
        size_bytes=100,
        checksum=payslip.checksum,
    )
    payslip.document_reference = document
    payslip.save(update_fields=("document_reference", "updated_at"))
    replacement = Document.objects.create(
        institution=institution,
        uploaded_by=hr,
        file_reference="payslips/2026-09/replacement.pdf",
        original_filename="replacement.pdf",
        content_type="application/pdf",
        size_bytes=100,
    )
    payslip.document_reference = replacement
    with pytest.raises(ValidationError, match="immutable"):
        payslip.save(update_fields=("document_reference", "updated_at"))

    record.net_pay = Decimal("1.00")
    with pytest.raises(ValidationError, match="immutable"):
        record.save()
    item = record.items.first()
    item.amount = Decimal("1.00")
    with pytest.raises(ValidationError, match="immutable"):
        item.save()


def test_only_approved_overtime_and_adjustments_feed_calculation(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee = _employee_with_pay(
        institution,
        employee_factory,
        organization_factory,
        assignment_dimensions_factory,
    )
    configure_payroll(
        institution=institution,
        actor=hr,
        country_code="GH",
        currency="GHS",
        payroll_frequency="MONTHLY",
        payroll_setup_mode="CUSTOM",
    )
    period = create_payroll_period(
        institution=institution,
        actor=hr,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )
    shift = Shift.objects.create(
        institution=institution,
        name="Day",
        code="DAY",
        start_time=time(8),
        end_time=time(16),
    )
    schedule = WorkSchedule.objects.create(
        institution=institution,
        name="Daily",
        code="DAILY",
        schedule_type=WorkSchedule.ScheduleType.FIXED,
        effective_from=date(2026, 1, 1),
        fixed_shift=shift,
    )
    assignment = ScheduleAssignment.objects.create(
        institution=institution,
        employee=employee,
        work_schedule=schedule,
        effective_from=date(2026, 1, 1),
        assigned_by=hr,
    )
    approved_attendance = AttendanceRecord.objects.create(
        institution=institution,
        employee=employee,
        schedule_assignment=assignment,
        attendance_date=date(2026, 9, 10),
        overtime_minutes=60,
        status=AttendanceRecord.Status.PRESENT,
        source=AttendanceRecord.Source.MANUAL,
    )
    OvertimeRecord.objects.create(
        institution=institution,
        employee=employee,
        attendance_record=approved_attendance,
        calculated_minutes=60,
        approved_minutes=60,
        rate_multiplier=Decimal("1.50"),
        status=OvertimeRecord.Status.APPROVED,
        approved_by=hr,
        approved_at=timezone.now(),
    )
    pending_attendance = AttendanceRecord.objects.create(
        institution=institution,
        employee=employee,
        schedule_assignment=assignment,
        attendance_date=date(2026, 9, 11),
        overtime_minutes=120,
        status=AttendanceRecord.Status.PRESENT,
        source=AttendanceRecord.Source.MANUAL,
    )
    OvertimeRecord.objects.create(
        institution=institution,
        employee=employee,
        attendance_record=pending_attendance,
        calculated_minutes=120,
        approved_minutes=0,
    )
    deduction = PayComponent.objects.create(
        institution=institution,
        name="Loan",
        code="LOAN",
        component_type=PayComponent.ComponentType.DEDUCTION,
        calculation_type=PayComponent.CalculationType.FIXED,
    )
    adjustment = create_payroll_adjustment(
        institution=institution,
        actor=hr,
        employee=employee,
        payroll_period=period,
        pay_component=deduction,
        amount=Decimal("75.00"),
        reason="Approved loan deduction",
    )
    adjustment = submit_payroll_adjustment(adjustment=adjustment, actor=hr)
    decide_payroll_adjustment(adjustment=adjustment, actor=hr, approve=True)

    run = create_payroll_run(
        institution=institution,
        payroll_period=period,
        actor=hr,
        idempotency_key="inputs-2026-09",
    )
    run = calculate_payroll_run(payroll_run=run, actor=hr)
    record = run.records.get(employee=employee)
    adjustment.refresh_from_db()

    assert record.gross_pay == Decimal("3018.75")
    assert record.taxable_income == Decimal("3000.00")
    assert record.total_deductions == Decimal("75.00")
    assert record.net_pay == Decimal("2943.75")
    assert record.items.filter(source=PayrollItem.Source.ATTENDANCE).count() == 1
    assert adjustment.status == PayrollAdjustment.Status.APPLIED
    assert adjustment.applied_run_id == run.id
    applied_event = AuditLog.objects.get(
        action="payroll.adjustment.applied", entity_id=adjustment.id
    )
    assert applied_event.metadata == {
        "before": {"status": PayrollAdjustment.Status.APPROVED},
        "after": {"status": PayrollAdjustment.Status.APPLIED},
        "payroll_run_id": str(run.id),
    }
    assert UserActivityEvent.objects.filter(
        institution=institution,
        entity_id=adjustment.id,
        activity_code="payroll.adjustment",
    ).count() == 2
    assert UserActivityEvent.objects.filter(
        institution=institution,
        entity_id=adjustment.id,
        activity_code="payroll.adjustment.review",
    ).count() == 1


def test_progressive_tax_bands_are_calculated_in_sequence(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee = _employee_with_pay(
        institution,
        employee_factory,
        organization_factory,
        assignment_dimensions_factory,
        base_salary=Decimal("1000.00"),
    )
    preset = PayrollPreset.objects.create(
        code="PROGRESSIVE", country_code="GH", name="Progressive"
    )
    version = PayrollPresetVersion.objects.create(
        payroll_preset=preset,
        version_code="PROGRESSIVE-1",
        effective_from=date(2026, 1, 1),
    )
    tax_rule = TaxRule.objects.create(
        preset_version=version,
        code="PAYE",
        name="Progressive income tax",
        method=TaxRule.Method.PROGRESSIVE,
        residency="ANY",
        basis=TaxRule.Basis.TAXABLE_INCOME,
    )
    TaxBand.objects.create(
        tax_rule=tax_rule,
        sequence=1,
        band_amount=Decimal("500.00"),
        rate=Decimal("0.0000"),
    )
    TaxBand.objects.create(
        tax_rule=tax_rule,
        sequence=2,
        rate=Decimal("20.0000"),
    )
    version.status = PayrollPresetVersion.Status.ACTIVE
    version.save(update_fields=("status", "updated_at"))
    configure_payroll(
        institution=institution,
        actor=hr,
        country_code="GH",
        currency="GHS",
        payroll_frequency="MONTHLY",
        payroll_setup_mode="PRESET",
        selected_payroll_preset_version=version,
    )
    period = create_payroll_period(
        institution=institution,
        actor=hr,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )
    run = create_payroll_run(
        institution=institution,
        payroll_period=period,
        actor=hr,
        idempotency_key="progressive-2026-09",
    )

    calculate_payroll_run(payroll_run=run, actor=hr)
    record = run.records.get(employee=employee)

    assert record.total_deductions == Decimal("100.00")
    assert record.net_pay == Decimal("900.00")


def test_employee_tax_relief_claims_are_preset_bound_and_self_scoped(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory()
    _enable_payroll(institution)
    hr = user_factory(email="hr@example.com")
    employee_user = user_factory(email="employee@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    membership_factory(
        user=employee_user,
        institution=institution,
        role_code="EMPLOYEE",
        is_primary=True,
    )
    employee = employee_factory(institution, user=employee_user)
    version, relief = _preset_with_generic_rules()
    configure_payroll(
        institution=institution,
        actor=hr,
        country_code="GH",
        currency="GHS",
        payroll_frequency="MONTHLY",
        payroll_setup_mode="PRESET",
        selected_payroll_preset_version=version,
    )
    other_preset = PayrollPreset.objects.create(
        code="OTHER-PAYROLL", country_code="GH", name="Other"
    )
    other_version = PayrollPresetVersion.objects.create(
        payroll_preset=other_preset,
        version_code="OTHER-1",
        effective_from=date(2026, 1, 1),
        status=PayrollPresetVersion.Status.ACTIVE,
    )
    unrelated_relief = TaxReliefDefinition.objects.create(
        preset_version=other_version,
        code="OTHER",
        name="Other relief",
        calculation_method="APPROVED_AMOUNT",
    )
    api_client.force_authenticate(employee_user)

    rejected = api_client.post(
        reverse("v1:employee-tax-relief-claim-list"),
        {
            "employee": str(employee.id),
            "relief_definition": str(unrelated_relief.id),
            "tax_year": 2026,
            "claimed_amount": "50.00",
        },
        format="json",
    )
    created = api_client.post(
        reverse("v1:employee-tax-relief-claim-list"),
        {
            "employee": str(employee.id),
            "relief_definition": str(relief.id),
            "tax_year": 2026,
            "claimed_amount": "80.00",
        },
        format="json",
    )

    assert rejected.status_code == 400
    assert created.status_code == 201
    claim = EmployeeTaxReliefClaim.objects.get(pk=created.data["id"])
    submitted = api_client.post(
        reverse("v1:employee-tax-relief-claim-submit", args=(claim.id,)),
        format="json",
    )
    assert submitted.status_code == 200

    api_client.force_authenticate(hr)
    approved = api_client.post(
        reverse("v1:employee-tax-relief-claim-approve", args=(claim.id,)),
        {"approved_amount": "60.00"},
        format="json",
    )
    claim.refresh_from_db()
    assert approved.status_code == 200
    assert claim.status == EmployeeTaxReliefClaim.Status.APPROVED
    assert claim.approved_amount == Decimal("60.00")


def test_payroll_api_hides_cross_tenant_records(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    home = institution_factory(code="HOME")
    foreign = institution_factory(code="FOREIGN")
    _enable_payroll(home)
    _enable_payroll(foreign)
    hr = user_factory()
    foreign_hr = user_factory()
    membership_factory(user=hr, institution=home, role_code="HR_ADMIN", is_primary=True)
    membership_factory(user=foreign_hr, institution=foreign, role_code="HR_ADMIN")
    foreign_period = PayrollPeriod.objects.create(
        institution=foreign,
        name="Foreign period",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )
    foreign_employee = employee_factory(foreign)
    foreign_run = PayrollRun.objects.create(
        institution=foreign,
        payroll_period=foreign_period,
        run_number=1,
        started_by=foreign_hr,
        started_at=timezone.now(),
    )
    foreign_record = PayrollRecord.objects.create(
        institution=foreign,
        payroll_run=foreign_run,
        employee=foreign_employee,
        gross_pay=Decimal("100.00"),
        taxable_income=Decimal("100.00"),
        total_deductions=Decimal("0.00"),
        employee_contributions=Decimal("0.00"),
        employer_contributions=Decimal("0.00"),
        net_pay=Decimal("100.00"),
        currency="GHS",
    )
    foreign_item = PayrollItem.objects.create(
        payroll_record=foreign_record,
        component_code_snapshot="BASE_SALARY",
        component_name_snapshot="Base salary",
        source=PayrollItem.Source.COMPENSATION,
        amount=Decimal("100.00"),
        metadata={"effect": "EARNING", "taxable": True},
    )
    api_client.force_authenticate(hr)

    response = api_client.get(
        reverse("v1:payroll-period-detail", args=(foreign_period.id,))
    )
    record_response = api_client.get(
        reverse("v1:payroll-record-detail", args=(foreign_record.id,))
    )
    item_response = api_client.get(
        reverse("v1:payroll-item-detail", args=(foreign_item.id,))
    )

    assert response.status_code == 404
    assert record_response.status_code == 404
    assert item_response.status_code == 404
