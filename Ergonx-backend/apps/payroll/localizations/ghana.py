from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db.models import Q, Sum

from apps.employees.models import Employment
from apps.payroll.models import (
    EmployeePayrollProfile,
    PayrollItem,
    TaxRule,
)
from apps.payroll.selectors import (
    approved_tax_relief_claims_for_employee,
    effective_contribution_rule,
    effective_special_income_rule,
    finalized_employee_payroll_items_ytd,
    finalized_employee_payroll_records_ytd,
)


MONEY_QUANTUM = Decimal("0.01")


def _money(value):
    return Decimal(value).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def _item(code, name, amount, effect, *, rate=None, metadata=None):
    return {
        "code": code,
        "name": name,
        "source": PayrollItem.Source.STATUTORY,
        "amount": _money(amount),
        "effect": effect,
        "rate": rate,
        "metadata": metadata or {},
    }


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
            taxable_in_band = max(Decimal("0"), min(basis_amount, upper) - lower)
            cursor = upper
        total += taxable_in_band * band.rate / Decimal("100")
        if upper is None or basis_amount <= upper:
            break
    return _money(total)


def _earning_items(record, codes):
    items = []
    for item in record.items.filter(component_code_snapshot__in=codes):
        if item.metadata.get("effect") == "EARNING":
            items.append(item)
    return items


def _relief_items(payroll_run, record, chargeable_income):
    remaining_basis = chargeable_income
    items = []
    claims = approved_tax_relief_claims_for_employee(
        institution=payroll_run.institution,
        employee=record.employee,
        preset_version=payroll_run.preset_version,
        tax_year=payroll_run.payroll_period.end_date.year,
    )
    prior_items = finalized_employee_payroll_items_ytd(
        institution=payroll_run.institution,
        payroll_run=payroll_run,
        employee=record.employee,
    ).filter(source=PayrollItem.Source.STATUTORY)
    applied_by_claim = {}
    for prior_item in prior_items:
        claim_id = prior_item.metadata.get("relief_claim_id")
        if claim_id:
            applied_by_claim[claim_id] = applied_by_claim.get(
                claim_id, Decimal("0")
            ) + prior_item.amount
    for claim in claims.order_by("relief_definition__code"):
        previously_applied = applied_by_claim.get(str(claim.id), Decimal("0"))
        available = max(Decimal("0"), claim.approved_amount - previously_applied)
        applied = _money(min(available, remaining_basis))
        if not applied:
            continue
        remaining_basis -= applied
        items.append(
            _item(
                f"GH_RELIEF_{claim.relief_definition.code}",
                claim.relief_definition.name,
                applied,
                "TAX_RELIEF",
                metadata={
                    "relief_claim_id": str(claim.id),
                    "relief_definition_id": str(claim.relief_definition_id),
                    "approved_amount": str(claim.approved_amount),
                    "previously_applied": str(_money(previously_applied)),
                },
            )
        )
    return _money(remaining_basis), items


def _pension(payroll_run, compensation):
    rule = effective_contribution_rule(
        institution=payroll_run.institution,
        payroll_run=payroll_run,
        code="GH_MANDATORY_PENSION",
    )
    if rule is None:
        raise ValidationError(
            {"preset_version": "Ghana preset has no effective pension rule."}
        )
    basis = Decimal(compensation.base_salary)
    if rule.minimum_basis is not None:
        basis = max(basis, rule.minimum_basis)
    if rule.maximum_basis is not None:
        basis = min(basis, rule.maximum_basis)
    employee_amount = _money(basis * rule.employee_rate / Decimal("100"))
    employer_amount = _money(basis * rule.employer_rate / Decimal("100"))
    allocations = [
        {
            "code": allocation.code,
            "rate": str(allocation.rate),
            "amount": str(_money(basis * allocation.rate / Decimal("100"))),
            "destination_type": allocation.destination_type,
            "destination_reference": allocation.destination_reference,
        }
        for allocation in rule.allocations.order_by("code")
    ]
    items = [
        _item(
            "GH_MANDATORY_PENSION_EMPLOYEE",
            "Mandatory pension - employee",
            employee_amount,
            "EMPLOYEE_CONTRIBUTION",
            rate=rule.employee_rate,
            metadata={
                "contribution_rule_id": str(rule.id),
                "basis": str(_money(basis)),
                "allocations": allocations,
            },
        ),
        _item(
            "GH_MANDATORY_PENSION_EMPLOYER",
            "Mandatory pension - employer",
            employer_amount,
            "EMPLOYER_CONTRIBUTION",
            rate=rule.employer_rate,
            metadata={
                "contribution_rule_id": str(rule.id),
                "basis": str(_money(basis)),
                "allocations": allocations,
            },
        ),
    ]
    return employee_amount, employer_amount, items


def calculate_statutory(
    *, payroll_run, record, compensation, gross_pay, taxable_income, configuration
):
    if configuration.country_code != "GH" or configuration.currency != "GHS":
        raise ValidationError(
            {"configuration": "The Ghana preset requires country GH and currency GHS."}
        )
    if configuration.payroll_frequency != "MONTHLY":
        raise ValidationError(
            {"configuration": "GH-2026.1 currently supports monthly payroll only."}
        )
    try:
        profile = record.employee.payroll_profile
    except ObjectDoesNotExist as exc:
        raise ValidationError(
            {
                "employee_payroll_profile": (
                    f"{record.employee.employee_number} requires an explicit tax residency."
                )
            }
        ) from exc
    employment = (
        record.employee.employments.filter(
            start_date__lte=payroll_run.payroll_period.end_date
        )
        .filter(
            Q(end_date__isnull=True)
            | Q(end_date__gte=payroll_run.payroll_period.end_date)
        )
        .order_by("-is_current", "-start_date")
        .first()
    )
    if employment is None:
        raise ValidationError({"employee": "An effective employment record is required."})

    employee_pension, employer_pension, items = _pension(payroll_run, compensation)
    statutory_tax = Decimal("0")
    regular_basis = max(Decimal("0"), Decimal(taxable_income) - employee_pension)

    bonus_rule = effective_special_income_rule(
        institution=payroll_run.institution,
        payroll_run=payroll_run,
        income_type="BONUS",
    )
    bonus_codes = (
        bonus_rule.calculation_json.get("component_codes", ["BONUS"])
        if bonus_rule
        else ["BONUS"]
    )
    bonus_items = _earning_items(record, bonus_codes)
    bonus_amount = sum((item.amount for item in bonus_items), Decimal("0"))
    bonus_in_regular_basis = sum(
        (item.amount for item in bonus_items if item.metadata.get("taxable")),
        Decimal("0"),
    )
    overtime_items = list(
        record.items.filter(
            source=PayrollItem.Source.ATTENDANCE,
            metadata__effect="EARNING",
        )
    )
    overtime_amount = sum((item.amount for item in overtime_items), Decimal("0"))
    overtime_in_regular_basis = sum(
        (item.amount for item in overtime_items if item.metadata.get("taxable")),
        Decimal("0"),
    )

    if employment.employment_type == Employment.EmploymentType.CASUAL:
        casual_rule = effective_special_income_rule(
            institution=payroll_run.institution,
            payroll_run=payroll_run,
            income_type="CASUAL",
        )
        if casual_rule is None:
            raise ValidationError({"preset_version": "Ghana casual-worker rule is missing."})
        rate = Decimal(casual_rule.calculation_json["rate"])
        casual_tax = _money(Decimal(gross_pay) * rate / Decimal("100"))
        statutory_tax += casual_tax
        items.append(
            _item(
                casual_rule.code,
                casual_rule.name,
                casual_tax,
                "DEDUCTION",
                rate=rate,
                metadata={"basis": str(_money(gross_pay)), "worker_type": "CASUAL"},
            )
        )
        return {
            "statutory_deductions": _money(statutory_tax),
            "employee_contributions": employee_pension,
            "employer_contributions": employer_pension,
            "items": items,
        }

    if profile.tax_residency == EmployeePayrollProfile.TaxResidency.NON_RESIDENT:
        special_incomes = (
            ("BONUS", bonus_amount, bonus_in_regular_basis, bonus_rule),
            (
                "OVERTIME",
                overtime_amount,
                overtime_in_regular_basis,
                effective_special_income_rule(
                    institution=payroll_run.institution,
                    payroll_run=payroll_run,
                    income_type="OVERTIME",
                ),
            ),
        )
        for income_type, amount, amount_in_regular_basis, rule in special_incomes:
            if not amount:
                continue
            if rule is None:
                raise ValidationError(
                    {
                        "preset_version": (
                            f"Ghana {income_type.lower()} rule is missing."
                        )
                    }
                )
            try:
                special_rate = Decimal(rule.calculation_json["non_resident_rate"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValidationError(
                    {
                        "preset_version": (
                            f"Ghana {income_type.lower()} rule has no valid "
                            "non-resident rate."
                        )
                    }
                ) from exc
            regular_basis -= amount_in_regular_basis
            special_tax = _money(amount * special_rate / Decimal("100"))
            statutory_tax += special_tax
            items.append(
                _item(
                    f"GH_NON_RESIDENT_{income_type}_TAX",
                    f"Non-resident {income_type.lower()} tax",
                    special_tax,
                    "DEDUCTION",
                    rate=special_rate,
                    metadata={
                        "basis": str(_money(amount)),
                        "special_income_rule_id": str(rule.id),
                        "tax_residency": profile.tax_residency,
                    },
                )
            )
        tax_rule = payroll_run.preset_version.tax_rules.get(
            code="GH_PAYE_NON_RESIDENT", active=True
        )
        regular_tax = _money(max(Decimal("0"), regular_basis) * tax_rule.rate / Decimal("100"))
        statutory_tax += regular_tax
        items.append(
            _item(
                tax_rule.code,
                tax_rule.name,
                regular_tax,
                "DEDUCTION",
                rate=tax_rule.rate,
                metadata={
                    "basis": str(_money(max(Decimal("0"), regular_basis))),
                    "tax_residency": profile.tax_residency,
                },
            )
        )
        return {
            "statutory_deductions": _money(statutory_tax),
            "employee_contributions": employee_pension,
            "employer_contributions": employer_pension,
            "items": items,
        }

    if bonus_amount:
        if bonus_rule is None:
            raise ValidationError({"preset_version": "Ghana bonus rule is missing."})
        annual_salary_multiplier = Decimal(
            bonus_rule.calculation_json["annual_salary_multiplier"]
        )
        concession_rate = Decimal(bonus_rule.calculation_json["concession_rate"])
        threshold_rate = Decimal(bonus_rule.calculation_json["annual_threshold_rate"])
        annual_basic_salary = compensation.base_salary * annual_salary_multiplier
        annual_threshold = annual_basic_salary * threshold_rate / Decimal("100")
        prior_bonus = (
            finalized_employee_payroll_items_ytd(
                institution=payroll_run.institution,
                payroll_run=payroll_run,
                employee=record.employee,
            ).filter(
                component_code_snapshot__in=bonus_codes,
            ).aggregate(total=Sum("amount"))["total"]
            or Decimal("0")
        )
        concession_basis = min(
            bonus_amount, max(Decimal("0"), annual_threshold - prior_bonus)
        )
        concession_tax = _money(concession_basis * concession_rate / Decimal("100"))
        regular_basis -= min(concession_basis, bonus_in_regular_basis)
        statutory_tax += concession_tax
        items.append(
            _item(
                bonus_rule.code,
                bonus_rule.name,
                concession_tax,
                "DEDUCTION",
                rate=concession_rate,
                metadata={
                    "basis": str(_money(concession_basis)),
                    "annual_threshold": str(_money(annual_threshold)),
                    "prior_bonus": str(_money(prior_bonus)),
                },
            )
        )

    if overtime_amount:
        overtime_rule = effective_special_income_rule(
            institution=payroll_run.institution,
            payroll_run=payroll_run,
            income_type="OVERTIME",
        )
        if overtime_rule is None:
            raise ValidationError({"preset_version": "Ghana overtime rule is missing."})
        if overtime_rule.requires_validation:
            raise ValidationError(
                {
                    "ghana_overtime_rule": (
                        "The GHS 18,000 eligibility threshold requires legal validation."
                    )
                }
            )
        annual_income_limit = Decimal(overtime_rule.eligibility_json["annual_income_limit"])
        ytd_income = (
            finalized_employee_payroll_records_ytd(
                institution=payroll_run.institution,
                payroll_run=payroll_run,
                employee=record.employee,
            ).aggregate(
                total=Sum("taxable_income")
            )["total"]
            or Decimal("0")
        ) + Decimal(taxable_income)
        qualifies = (
            employment.staff_category == Employment.StaffCategory.JUNIOR
            and ytd_income <= annual_income_limit
        )
        if qualifies:
            lower_rate = Decimal(overtime_rule.calculation_json["lower_rate"])
            upper_rate = Decimal(overtime_rule.calculation_json["upper_rate"])
            threshold = compensation.base_salary * Decimal(
                overtime_rule.calculation_json["monthly_basic_threshold_rate"]
            ) / Decimal("100")
            lower_basis = min(overtime_amount, threshold)
            upper_basis = max(Decimal("0"), overtime_amount - threshold)
            overtime_tax = _money(
                lower_basis * lower_rate / Decimal("100")
                + upper_basis * upper_rate / Decimal("100")
            )
            regular_basis -= overtime_in_regular_basis
            statutory_tax += overtime_tax
            items.append(
                _item(
                    overtime_rule.code,
                    overtime_rule.name,
                    overtime_tax,
                    "DEDUCTION",
                    metadata={
                        "basis": str(_money(overtime_amount)),
                        "lower_rate": str(lower_rate),
                        "upper_rate": str(upper_rate),
                        "monthly_threshold": str(_money(threshold)),
                        "qualifying_ytd_income": str(_money(ytd_income)),
                    },
                )
            )

    regular_basis, relief_items = _relief_items(
        payroll_run, record, max(Decimal("0"), regular_basis)
    )
    items.extend(relief_items)
    resident_rule = payroll_run.preset_version.tax_rules.get(
        code="GH_PAYE_RESIDENT", active=True
    )
    if resident_rule.method != TaxRule.Method.PROGRESSIVE:
        raise ValidationError({"preset_version": "Resident PAYE rule must be progressive."})
    paye = _progressive_tax(resident_rule, regular_basis)
    statutory_tax += paye
    items.append(
        _item(
            resident_rule.code,
            resident_rule.name,
            paye,
            "DEDUCTION",
            metadata={
                "basis": str(_money(regular_basis)),
                "employee_pension_deduction": str(employee_pension),
                "tax_residency": profile.tax_residency,
            },
        )
    )
    return {
        "statutory_deductions": _money(statutory_tax),
        "employee_contributions": employee_pension,
        "employer_contributions": employer_pension,
        "items": items,
    }
