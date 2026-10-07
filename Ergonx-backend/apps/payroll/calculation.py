from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db.models import Q

from apps.attendance.models import OvertimeRecord
from apps.compensation.models import EmployeeCompensation, PayComponent
from apps.compensation.services import compensation_for, resolve_compensation
from apps.employees.models import Employment
from apps.leave.models import LeaveRequest
from apps.payroll.custom_rules import progressive_tax
from apps.payroll.localizations import calculate_localized_statutory
from apps.payroll.models import (
    ContributionRule,
    PayrollAdjustment,
    PayrollItem,
    PayrollRecord,
    PayrollRun,
    TaxRule,
)
from apps.payroll.selectors import approved_tax_relief_claims_for_employee
from apps.scheduling.services import schedule_assignment_for, schedule_expectation


MONEY_QUANTUM = Decimal("0.01")
RATE_QUANTUM = Decimal("0.000001")


def money(value):
    return Decimal(value).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def _dates(start_date, end_date):
    current = start_date
    while current <= end_date:
        yield current
        current += timedelta(days=1)


def _employment_on(employee, on_date):
    return (
        Employment.objects.filter(employee=employee, start_date__lte=on_date)
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=on_date))
        .order_by("-is_current", "-start_date")
        .first()
    )


def _schedule_totals(employee, period):
    working_dates = []
    required_minutes = 0
    for work_date in _dates(period.start_date, period.end_date):
        assignment = schedule_assignment_for(employee, work_date)
        if assignment is None:
            continue
        expectation = schedule_expectation(assignment, work_date)
        if expectation["off_day"]:
            continue
        working_dates.append(work_date)
        required_minutes += expectation["required_minutes"]
    return working_dates, required_minutes


def _basis_value(basis, *, compensation, gross_pay, taxable_income):
    values = {
        TaxRule.Basis.BASE_SALARY: compensation.base_salary,
        TaxRule.Basis.GROSS_PAY: gross_pay,
        TaxRule.Basis.TAXABLE_INCOME: taxable_income,
    }
    return Decimal(values[basis])


def _progressive_tax(rule, basis_amount):
    bands = list(rule.bands.order_by("sequence"))
    if not bands:
        raise ValidationError({"preset_version": f"Tax rule {rule.code} has no bands."})
    total = Decimal("0")
    cursor = Decimal("0")
    for band in bands:
        lower = band.lower_bound if band.lower_bound is not None else cursor
        upper = band.upper_bound
        if upper is None and band.band_amount is not None:
            upper = lower + band.band_amount
        if upper is None:
            taxable_in_band = max(Decimal("0"), basis_amount - lower)
        else:
            taxable_in_band = max(
                Decimal("0"), min(basis_amount, upper) - lower
            )
            cursor = upper
        total += taxable_in_band * band.rate / Decimal("100")
        if upper is None or basis_amount <= upper:
            break
    return money(total)


def _create_item(
    record,
    *,
    code,
    name,
    source,
    amount,
    effect,
    pay_component=None,
    quantity=None,
    rate=None,
    metadata=None,
):
    details = dict(metadata or {})
    details["effect"] = effect
    return PayrollItem.objects.create(
        payroll_record=record,
        pay_component=pay_component,
        component_code_snapshot=code,
        component_name_snapshot=name,
        source=source,
        quantity=quantity,
        rate=(
            Decimal(rate).quantize(RATE_QUANTUM, rounding=ROUND_HALF_UP)
            if rate is not None
            else None
        ),
        amount=money(amount),
        metadata=details,
    )


def _apply_custom_rules(record, *, payroll_run, compensation, gross_pay, taxable_income):
    """Evaluate a CUSTOM configuration's own rules, as frozen on the run's snapshot."""
    rules = (payroll_run.statutory_snapshot or {}).get("configuration", {}).get("custom_rules") or {}
    statutory_deductions = Decimal("0")
    employee_contributions = Decimal("0")
    employer_contributions = Decimal("0")

    def basis_of(basis):
        return _basis_value(basis, compensation=compensation, gross_pay=gross_pay, taxable_income=taxable_income)

    tax = rules.get("income_tax") or {}
    if tax.get("method") in ("FLAT", "PROGRESSIVE"):
        basis = max(Decimal("0"), basis_of(tax["basis"]) - Decimal(tax.get("threshold") or "0"))
        if tax["method"] == "FLAT":
            amount = money(basis * Decimal(tax["rate"]) / Decimal("100"))
        else:
            amount = money(progressive_tax(tax["bands"], basis))
        if amount:
            statutory_deductions += amount
            _create_item(
                record,
                code="INCOME_TAX",
                name=tax.get("name") or "Income tax",
                source=PayrollItem.Source.STATUTORY,
                amount=amount,
                effect="DEDUCTION",
                rate=tax.get("rate"),
                metadata={"custom_rule": "income_tax", "basis": tax["basis"], "method": tax["method"]},
            )

    for rule in rules.get("contributions") or []:
        basis = basis_of(rule["basis"])
        if rule.get("maximum_basis") is not None:
            basis = min(basis, Decimal(rule["maximum_basis"]))
        for side, rate_key, effect in (
            ("employee", "employee_rate", "EMPLOYEE_CONTRIBUTION"),
            ("employer", "employer_rate", "EMPLOYER_CONTRIBUTION"),
        ):
            rate = Decimal(rule[rate_key])
            amount = money(basis * rate / Decimal("100"))
            if not amount:
                continue
            if side == "employee":
                employee_contributions += amount
            else:
                employer_contributions += amount
            _create_item(
                record,
                code=f"{rule['code']}_{side.upper()}",
                name=f"{rule['name']} - {side}",
                source=PayrollItem.Source.STATUTORY,
                amount=amount,
                effect=effect,
                rate=rate,
                metadata={"custom_rule": rule["code"], "basis": rule["basis"]},
            )
    return statutory_deductions, employee_contributions, employer_contributions


def _apply_statutory_rules(
    record,
    *,
    payroll_run,
    compensation,
    gross_pay,
    taxable_income,
):
    employee_contributions = Decimal("0")
    employer_contributions = Decimal("0")
    statutory_deductions = Decimal("0")
    preset_version = payroll_run.preset_version
    if preset_version is None:
        return _apply_custom_rules(
            record,
            payroll_run=payroll_run,
            compensation=compensation,
            gross_pay=gross_pay,
            taxable_income=taxable_income,
        )

    evaluator_code = preset_version.source_metadata.get("evaluator")
    if evaluator_code:
        result = calculate_localized_statutory(
            evaluator_code,
            payroll_run=payroll_run,
            record=record,
            compensation=compensation,
            gross_pay=gross_pay,
            taxable_income=taxable_income,
            configuration=payroll_run.institution.payroll_configuration,
        )
        for item in result["items"]:
            _create_item(record, **item)
        return (
            result["statutory_deductions"],
            result["employee_contributions"],
            result["employer_contributions"],
        )

    if approved_tax_relief_claims_for_employee(
        institution=payroll_run.institution,
        employee=record.employee,
        preset_version=preset_version,
        tax_year=payroll_run.payroll_period.end_date.year,
    ).exists():
        raise ValidationError(
            {
                "tax_relief": (
                    "Approved relief claims require a localized year-to-date evaluator."
                )
            }
        )

    tax_rules = preset_version.tax_rules.filter(active=True).order_by("sequence", "code")
    for rule in tax_rules:
        if rule.residency not in {"ANY", "ALL"}:
            raise ValidationError(
                {
                    "preset_version": (
                        f"Tax rule {rule.code} requires an employee residency profile."
                    )
                }
            )
        basis = _basis_value(
            rule.basis,
            compensation=compensation,
            gross_pay=gross_pay,
            taxable_income=taxable_income,
        )
        basis = max(Decimal("0"), basis - (rule.threshold or Decimal("0")))
        if rule.method == TaxRule.Method.FLAT:
            amount = money(basis * rule.rate / Decimal("100"))
        elif rule.method == TaxRule.Method.PROGRESSIVE:
            amount = _progressive_tax(rule, basis)
        else:
            raise ValidationError(
                {
                    "preset_version": (
                        f"Special tax rule {rule.code} requires a localized evaluator."
                    )
                }
            )
        statutory_deductions += amount
        _create_item(
            record,
            code=rule.code,
            name=rule.name,
            source=PayrollItem.Source.STATUTORY,
            amount=amount,
            effect="DEDUCTION",
            rate=rule.rate,
            metadata={"tax_rule_id": str(rule.id), "basis": rule.basis},
        )

    contribution_rules = preset_version.contribution_rules.filter(
        effective_from__lte=payroll_run.payroll_period.end_date
    ).filter(
        Q(effective_to__isnull=True)
        | Q(effective_to__gte=payroll_run.payroll_period.end_date)
    )
    for rule in contribution_rules.order_by("code", "effective_from"):
        basis = _basis_value(
            rule.basis,
            compensation=compensation,
            gross_pay=gross_pay,
            taxable_income=taxable_income,
        )
        if rule.minimum_basis is not None:
            basis = max(basis, rule.minimum_basis)
        if rule.maximum_basis is not None:
            basis = min(basis, rule.maximum_basis)
        employee_amount = money(basis * rule.employee_rate / Decimal("100"))
        employer_amount = money(basis * rule.employer_rate / Decimal("100"))
        if employee_amount:
            employee_contributions += employee_amount
            _create_item(
                record,
                code=f"{rule.code}_EMPLOYEE",
                name=f"{rule.name} - employee",
                source=PayrollItem.Source.STATUTORY,
                amount=employee_amount,
                effect="EMPLOYEE_CONTRIBUTION",
                rate=rule.employee_rate,
                metadata={"contribution_rule_id": str(rule.id), "basis": rule.basis},
            )
        if employer_amount:
            employer_contributions += employer_amount
            _create_item(
                record,
                code=f"{rule.code}_EMPLOYER",
                name=f"{rule.name} - employer",
                source=PayrollItem.Source.STATUTORY,
                amount=employer_amount,
                effect="EMPLOYER_CONTRIBUTION",
                rate=rule.employer_rate,
                metadata={"contribution_rule_id": str(rule.id), "basis": rule.basis},
            )
    return statutory_deductions, employee_contributions, employer_contributions


def calculate_employee_record(payroll_run, employee, configuration):
    period = payroll_run.payroll_period
    compensation = compensation_for(employee, period.end_date)
    if compensation is None:
        raise ValidationError(
            {"employee": f"{employee.employee_number} has no compensation for the period end."}
        )
    if compensation.effective_from > period.start_date:
        raise ValidationError(
            {
                "employee": (
                    f"{employee.employee_number} requires an explicit mid-period salary proration rule."
                )
            }
        )
    if _employment_on(employee, period.end_date) is None:
        raise ValidationError(
            {"employee": f"{employee.employee_number} has no employment at period end."}
        )
    if compensation.currency != configuration.currency:
        raise ValidationError(
            {
                "currency": (
                    f"{employee.employee_number} compensation currency does not match payroll."
                )
            }
        )
    if compensation.pay_basis != EmployeeCompensation.PayBasis.PAYROLL_PERIOD:
        raise ValidationError(
            {
                "pay_basis": (
                    "This payroll engine supports compensation expressed per configured "
                    "payroll period only; convert the amount before processing."
                )
            }
        )

    record = PayrollRecord.objects.create(
        institution=payroll_run.institution,
        payroll_run=payroll_run,
        employee=employee,
        gross_pay=Decimal("0"),
        taxable_income=Decimal("0"),
        total_deductions=Decimal("0"),
        employee_contributions=Decimal("0"),
        employer_contributions=Decimal("0"),
        net_pay=Decimal("0"),
        currency=configuration.currency,
    )
    gross_pay = money(compensation.base_salary)
    taxable_income = money(compensation.base_salary)
    total_deductions = Decimal("0")
    employer_contributions = Decimal("0")
    _create_item(
        record,
        code="BASE_SALARY",
        name="Base salary",
        source=PayrollItem.Source.COMPENSATION,
        amount=compensation.base_salary,
        effect="EARNING",
        metadata={
            "employee_compensation_id": str(compensation.id),
            "taxable": True,
        },
    )

    resolved = resolve_compensation(compensation, period.end_date)
    pay_components = PayComponent.objects.in_bulk(
        component["pay_component_id"] for component in resolved["components"]
    )
    for component in resolved["components"]:
        if component["resolved_amount"] is None:
            if component["is_required"]:
                raise ValidationError(
                    {
                        "salary_structure": (
                            f"Required component {component['code']} has no configured value."
                        )
                    }
                )
            continue
        pay_component = pay_components[component["pay_component_id"]]
        amount = money(component["resolved_amount"])
        effect = pay_component.component_type
        _create_item(
            record,
            code=pay_component.code,
            name=pay_component.name,
            source=PayrollItem.Source.COMPENSATION,
            amount=amount,
            effect=effect,
            pay_component=pay_component,
            rate=component["percentage"],
            metadata={
                "calculation_type": pay_component.calculation_type,
                "resolution_source": component["source"],
                "taxable": pay_component.taxable,
                "percentage_base_component_id": (
                    str(component["percentage_base_component_id"])
                    if component["percentage_base_component_id"]
                    else None
                ),
            },
        )
        if effect == PayComponent.ComponentType.EARNING:
            gross_pay += amount
            if pay_component.taxable:
                taxable_income += amount
        elif effect == PayComponent.ComponentType.DEDUCTION:
            total_deductions += amount
        else:
            employer_contributions += amount

    working_dates, scheduled_minutes = _schedule_totals(employee, period)
    working_date_set = set(working_dates)
    unpaid_dates = set()
    unpaid_requests = LeaveRequest.objects.filter(
        institution=payroll_run.institution,
        employee=employee,
        leave_type__is_paid=False,
        status=LeaveRequest.Status.APPROVED,
        start_date__lte=period.end_date,
        end_date__gte=period.start_date,
    )
    for leave_request in unpaid_requests:
        for leave_date in _dates(
            max(leave_request.start_date, period.start_date),
            min(leave_request.end_date, period.end_date),
        ):
            if leave_date in working_date_set:
                unpaid_dates.add(leave_date)
    if unpaid_requests.exists() and not working_dates:
        raise ValidationError(
            {"schedule": f"{employee.employee_number} needs a schedule for unpaid leave."}
        )
    if unpaid_dates:
        unpaid_amount = money(
            compensation.base_salary * len(unpaid_dates) / len(working_dates)
        )
        total_deductions += unpaid_amount
        _create_item(
            record,
            code="UNPAID_LEAVE",
            name="Unpaid leave",
            source=PayrollItem.Source.LEAVE,
            amount=unpaid_amount,
            effect="DEDUCTION",
            quantity=Decimal(len(unpaid_dates)),
            rate=money(compensation.base_salary / len(working_dates)),
            metadata={"leave_dates": [value.isoformat() for value in sorted(unpaid_dates)]},
        )

    overtime_rows = OvertimeRecord.objects.filter(
        institution=payroll_run.institution,
        employee=employee,
        status=OvertimeRecord.Status.APPROVED,
        approved_minutes__gt=0,
        attendance_record__attendance_date__gte=period.start_date,
        attendance_record__attendance_date__lte=period.end_date,
    ).select_related("attendance_record")
    if overtime_rows.exists() and not scheduled_minutes:
        raise ValidationError(
            {"schedule": f"{employee.employee_number} needs a schedule for overtime valuation."}
        )
    overtime_component = PayComponent.objects.filter(
        institution=payroll_run.institution,
        code="OVERTIME",
        component_type=PayComponent.ComponentType.EARNING,
    ).first()
    if scheduled_minutes:
        base_rate = compensation.base_salary / Decimal(scheduled_minutes)
        for overtime in overtime_rows:
            rate = base_rate * overtime.rate_multiplier
            overtime_amount = money(rate * overtime.approved_minutes)
            gross_pay += overtime_amount
            if overtime_component and overtime_component.taxable:
                taxable_income += overtime_amount
            _create_item(
                record,
                code=overtime_component.code if overtime_component else "OVERTIME",
                name=overtime_component.name if overtime_component else "Approved overtime",
                source=PayrollItem.Source.ATTENDANCE,
                amount=overtime_amount,
                effect="EARNING",
                pay_component=overtime_component,
                quantity=Decimal(overtime.approved_minutes),
                rate=rate,
                metadata={
                    "overtime_record_id": str(overtime.id),
                    "attendance_date": overtime.attendance_record.attendance_date.isoformat(),
                    "rate_multiplier": str(overtime.rate_multiplier),
                    "taxable": bool(overtime_component and overtime_component.taxable),
                },
            )

    adjustments = PayrollAdjustment.objects.filter(
        institution=payroll_run.institution,
        employee=employee,
        payroll_period=period,
    ).filter(
        Q(status=PayrollAdjustment.Status.APPROVED)
        | Q(status=PayrollAdjustment.Status.APPLIED, applied_run=payroll_run)
    ).select_related("pay_component")
    for adjustment in adjustments:
        amount = money(adjustment.amount)
        component = adjustment.pay_component
        effect = component.component_type
        _create_item(
            record,
            code=component.code,
            name=component.name,
            source=PayrollItem.Source.ADJUSTMENT,
            amount=amount,
            effect=effect,
            pay_component=component,
            metadata={
                "payroll_adjustment_id": str(adjustment.id),
                "reason": adjustment.reason,
                "taxable": component.taxable,
            },
        )
        if effect == PayComponent.ComponentType.EARNING:
            gross_pay += amount
            if component.taxable:
                taxable_income += amount
        elif effect == PayComponent.ComponentType.DEDUCTION:
            total_deductions += amount
        else:
            employer_contributions += amount
        if adjustment.status == PayrollAdjustment.Status.APPROVED:
            adjustment.status = PayrollAdjustment.Status.APPLIED
            adjustment.applied_run = payroll_run
            adjustment.save(update_fields=("status", "applied_run", "updated_at"))

    statutory, employee_contributions, statutory_employer = _apply_statutory_rules(
        record,
        payroll_run=payroll_run,
        compensation=compensation,
        gross_pay=gross_pay,
        taxable_income=taxable_income,
    )
    total_deductions += statutory
    employer_contributions += statutory_employer
    record.gross_pay = money(gross_pay)
    record.taxable_income = money(max(Decimal("0"), taxable_income))
    record.total_deductions = money(total_deductions)
    record.employee_contributions = money(employee_contributions)
    record.employer_contributions = money(employer_contributions)
    record.net_pay = money(gross_pay - total_deductions - employee_contributions)
    record.save(
        update_fields=(
            "gross_pay",
            "taxable_income",
            "total_deductions",
            "employee_contributions",
            "employer_contributions",
            "net_pay",
            "updated_at",
        )
    )
    return record
