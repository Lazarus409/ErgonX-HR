from datetime import date

from django.core.exceptions import ValidationError
from django.db.models import Q

from apps.compensation.models import EmployeeCompensation
from apps.payroll.models import (
    ComplianceDeadline,
    ContributionRule,
    EmployeeTaxReliefClaim,
    InstitutionPayrollConfiguration,
    PayrollItem,
    PayrollPresetVersion,
    PayrollRecord,
    PayrollRun,
    SpecialIncomeRule,
)


def _require_tenant(record, institution, field_name):
    if record.institution_id != institution.id:
        raise ValidationError(
            {field_name: "Referenced record belongs to another institution."}
        )


def active_payroll_preset_versions_for_institution(*, institution, as_of=None):
    as_of = as_of or date.today()
    return (
        PayrollPresetVersion.objects.filter(
            payroll_preset__country_code=institution.country_code,
            status=PayrollPresetVersion.Status.ACTIVE,
            effective_from__lte=as_of,
        )
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=as_of))
        .select_related("payroll_preset")
        .order_by("payroll_preset__code", "-effective_from")
    )


def eligible_employees_for_payroll_run(*, institution, payroll_run):
    _require_tenant(payroll_run, institution, "payroll_run")
    period = payroll_run.payroll_period
    compensation_rows = EmployeeCompensation.objects.filter(
        institution=institution,
        effective_from__lte=period.end_date,
    ).filter(Q(effective_to__isnull=True) | Q(effective_to__gte=period.end_date))
    return (
        institution.employees.filter(id__in=compensation_rows.values("employee_id"))
        .order_by("employee_number")
        .distinct()
    )


def approved_tax_relief_claims_for_employee(
    *, institution, employee, preset_version, tax_year
):
    _require_tenant(employee, institution, "employee")
    return EmployeeTaxReliefClaim.objects.filter(
        institution=institution,
        employee=employee,
        relief_definition__preset_version=preset_version,
        tax_year=tax_year,
        status=EmployeeTaxReliefClaim.Status.APPROVED,
        approved_amount__gt=0,
    ).select_related("relief_definition")


def finalized_employee_payroll_records_ytd(*, institution, payroll_run, employee):
    _require_tenant(payroll_run, institution, "payroll_run")
    _require_tenant(employee, institution, "employee")
    period_end = payroll_run.payroll_period.end_date
    return PayrollRecord.objects.filter(
        institution=institution,
        employee=employee,
        payroll_run__status=PayrollRun.Status.FINALIZED,
        payroll_run__payroll_period__end_date__year=period_end.year,
        payroll_run__payroll_period__end_date__lt=period_end,
    ).select_related("payroll_run__payroll_period")


def finalized_employee_payroll_items_ytd(*, institution, payroll_run, employee):
    records = finalized_employee_payroll_records_ytd(
        institution=institution,
        payroll_run=payroll_run,
        employee=employee,
    )
    return PayrollItem.objects.filter(payroll_record__in=records).select_related(
        "payroll_record"
    )


def effective_special_income_rule(*, institution, payroll_run, income_type):
    _require_tenant(payroll_run, institution, "payroll_run")
    if payroll_run.preset_version_id is None:
        return None
    period_end = payroll_run.payroll_period.end_date
    return (
        SpecialIncomeRule.objects.filter(
            preset_version=payroll_run.preset_version,
            income_type=income_type,
            effective_from__lte=period_end,
        )
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=period_end))
        .order_by("-effective_from")
        .first()
    )


def effective_contribution_rule(*, institution, payroll_run, code):
    _require_tenant(payroll_run, institution, "payroll_run")
    if payroll_run.preset_version_id is None:
        return None
    period_end = payroll_run.payroll_period.end_date
    return (
        ContributionRule.objects.filter(
            preset_version=payroll_run.preset_version,
            code=code,
            effective_from__lte=period_end,
        )
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=period_end))
        .prefetch_related("allocations")
        .order_by("-effective_from")
        .first()
    )


def effective_compliance_deadlines_for_period(*, institution, payroll_period):
    _require_tenant(payroll_period, institution, "payroll_period")
    configuration = (
        InstitutionPayrollConfiguration.objects.filter(institution=institution)
        .select_related("selected_payroll_preset_version")
        .first()
    )
    if configuration is None or not configuration.selected_payroll_preset_version_id:
        return ComplianceDeadline.objects.none()
    return (
        ComplianceDeadline.objects.filter(
            preset_version=configuration.selected_payroll_preset_version,
            effective_from__lte=payroll_period.end_date,
        )
        .filter(
            Q(effective_to__isnull=True)
            | Q(effective_to__gte=payroll_period.end_date)
        )
        .order_by("code")
    )


def payroll_records_with_items(*, institution, payroll_run):
    _require_tenant(payroll_run, institution, "payroll_run")
    return (
        PayrollRecord.objects.filter(
            institution=institution,
            payroll_run=payroll_run,
        )
        .select_related("employee")
        .prefetch_related("items")
    )
