from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.audit.services import record_audit_event
from apps.institutions.services import record_user_activity
from apps.compensation.models import (
    EmployeeCompensation,
    EmployeePayComponent,
    PayComponent,
)


MONEY_QUANTUM = Decimal("0.01")


def _assert_active_member(actor, institution):
    if actor is None or not actor.memberships.filter(
        institution=institution, status="ACTIVE"
    ).exists():
        raise ValidationError({"actor": "Actor must be an active institution member."})


@transaction.atomic
def change_current_compensation(
    *,
    institution,
    employee,
    salary_structure,
    base_salary,
    currency,
    effective_from,
    actor,
    pay_basis=EmployeeCompensation.PayBasis.PAYROLL_PERIOD,
):
    _assert_active_member(actor, institution)
    if employee.institution_id != institution.id:
        raise ValidationError({"employee": "Employee must belong to the selected institution."})
    if salary_structure.institution_id != institution.id:
        raise ValidationError(
            {"salary_structure": "Salary structure must belong to the selected institution."}
        )
    if not salary_structure.is_active:
        raise ValidationError({"salary_structure": "Salary structure is inactive."})
    current = (
        EmployeeCompensation.objects.select_for_update()
        .filter(employee=employee, is_current=True)
        .first()
    )
    previous_end = effective_from - timedelta(days=1)
    if current:
        if effective_from <= current.effective_from:
            raise ValidationError(
                {"effective_from": "Replacement compensation must start after the current record."}
            )
        if current.component_overrides.filter(effective_from__gt=previous_end).exists():
            raise ValidationError(
                {
                    "effective_from": (
                        "Replacement compensation cannot start before an existing component override."
                    )
                }
            )
        current.is_current = False
        current.effective_to = previous_end
        current.save(update_fields=("is_current", "effective_to", "updated_at"))
        current.component_overrides.filter(
            Q(effective_to__isnull=True) | Q(effective_to__gt=previous_end)
        ).update(is_active=False, effective_to=previous_end, updated_at=timezone.now())

    compensation = EmployeeCompensation(
        institution=institution,
        employee=employee,
        salary_structure=salary_structure,
        base_salary=base_salary,
        pay_basis=pay_basis,
        currency=currency,
        effective_from=effective_from,
        is_current=True,
    )
    compensation.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=compensation,
        action="compensation.employee.changed",
        metadata={"replaced_compensation_id": str(current.id) if current else None},
    )
    record_user_activity(
        actor=actor,
        institution=institution,
        activity_code="compensation.change",
        entity=compensation,
    )
    return compensation


@transaction.atomic
def set_employee_pay_component(
    *,
    institution,
    employee_compensation,
    pay_component,
    effective_from,
    actor,
    amount=None,
    percentage=None,
):
    _assert_active_member(actor, institution)
    compensation = EmployeeCompensation.objects.select_for_update().get(
        pk=employee_compensation.pk
    )
    if compensation.institution_id != institution.id:
        raise ValidationError(
            {"employee_compensation": "Compensation belongs to another institution."}
        )
    if not compensation.is_current:
        raise ValidationError(
            {"employee_compensation": "Historical compensation cannot be modified."}
        )
    if pay_component.institution_id != institution.id:
        raise ValidationError({"pay_component": "Pay component belongs to another institution."})
    if not pay_component.is_active:
        raise ValidationError({"pay_component": "Pay component is inactive."})
    latest = (
        EmployeePayComponent.objects.select_for_update()
        .filter(
            employee_compensation=compensation,
            pay_component=pay_component,
        )
        .order_by("-effective_from")
        .first()
    )
    if latest:
        latest_boundary = latest.effective_to or latest.effective_from
        if effective_from <= latest_boundary:
            raise ValidationError(
                {"effective_from": "A new override must start after the latest override period."}
            )
        if latest.is_active:
            latest.is_active = False
            latest.effective_to = effective_from - timedelta(days=1)
            latest.save(update_fields=("is_active", "effective_to", "updated_at"))
    override = EmployeePayComponent(
        institution=institution,
        employee_compensation=compensation,
        pay_component=pay_component,
        amount=amount,
        percentage=percentage,
        effective_from=effective_from,
        is_active=True,
    )
    override.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=override,
        action="compensation.component.override.changed",
        metadata={"replaced_override_id": str(latest.id) if latest else None},
    )
    return override


@transaction.atomic
def deactivate_employee_pay_component(*, override, actor, effective_to):
    override = EmployeePayComponent.objects.select_for_update().get(pk=override.pk)
    _assert_active_member(actor, override.institution)
    if not override.employee_compensation.is_current:
        raise ValidationError({"employee_compensation": "Historical compensation cannot be modified."})
    if not override.is_active:
        raise ValidationError({"is_active": "The override is already inactive."})
    if effective_to < override.effective_from:
        raise ValidationError({"effective_to": "End date cannot precede the start date."})
    override.is_active = False
    override.effective_to = effective_to
    override.save(update_fields=("is_active", "effective_to", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=override.institution,
        entity=override,
        action="compensation.component.override.ended",
    )
    return override


def compensation_for(employee, as_of_date=None):
    as_of_date = as_of_date or date.today()
    return (
        EmployeeCompensation.objects.filter(
            employee=employee,
            effective_from__lte=as_of_date,
        )
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=as_of_date))
        .select_related("employee", "salary_structure")
        .order_by("-effective_from")
        .first()
    )


def resolve_compensation(compensation, as_of_date=None):
    as_of_date = as_of_date or date.today()
    if as_of_date < compensation.effective_from or (
        compensation.effective_to and as_of_date > compensation.effective_to
    ):
        raise ValidationError({"as_of": "Date is outside this compensation period."})

    structure_rows = list(
        compensation.salary_structure.components.select_related(
            "pay_component", "percentage_base_component"
        ).order_by("sequence", "created_at")
    )
    structure_by_component = {row.pay_component_id: row for row in structure_rows}
    overrides = list(
        compensation.component_overrides.filter(
            effective_from__lte=as_of_date,
        )
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=as_of_date))
        .select_related("pay_component")
        .order_by("pay_component_id", "-effective_from")
    )
    override_by_component = {}
    for override in overrides:
        override_by_component.setdefault(override.pay_component_id, override)

    components = {
        row.pay_component_id: row.pay_component for row in structure_rows
    }
    components.update(
        {override.pay_component_id: override.pay_component for override in overrides}
    )
    resolved = {}
    visiting = set()

    def resolve_amount(component_id):
        if component_id in resolved:
            return resolved[component_id]["resolved_amount"]
        if component_id in visiting:
            raise ValidationError(
                {"salary_structure": "Percentage component bases contain a cycle."}
            )
        visiting.add(component_id)
        component = components[component_id]
        structure_row = structure_by_component.get(component_id)
        override = override_by_component.get(component_id)
        amount = None
        percentage = None
        percentage_base_component_id = None
        source = "UNCONFIGURED"
        if override:
            amount = override.amount
            percentage = override.percentage
            source = "EMPLOYEE_OVERRIDE"
        elif structure_row:
            amount = structure_row.default_amount
            percentage = structure_row.default_percentage
            source = "SALARY_STRUCTURE"
        if structure_row:
            percentage_base_component_id = structure_row.percentage_base_component_id

        resolved_amount = None
        if component.calculation_type == PayComponent.CalculationType.FIXED:
            if amount is not None:
                resolved_amount = Decimal(amount).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
        elif percentage is not None:
            if percentage_base_component_id:
                if percentage_base_component_id not in components:
                    raise ValidationError(
                        {"salary_structure": "Percentage base component is not configured."}
                    )
                base_amount = resolve_amount(percentage_base_component_id)
            else:
                base_amount = compensation.base_salary
            if base_amount is not None:
                resolved_amount = (
                    Decimal(base_amount) * Decimal(percentage) / Decimal("100")
                ).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)

        resolved[component_id] = {
            "pay_component_id": component.id,
            "code": component.code,
            "name": component.name,
            "component_type": component.component_type,
            "calculation_type": component.calculation_type,
            "amount": amount,
            "percentage": percentage,
            "percentage_base_component_id": percentage_base_component_id,
            "resolved_amount": resolved_amount,
            "source": source,
            "is_required": structure_row.is_required if structure_row else False,
        }
        visiting.remove(component_id)
        return resolved_amount

    for component_id in components:
        resolve_amount(component_id)
    ordered_ids = [row.pay_component_id for row in structure_rows]
    ordered_ids.extend(
        component_id for component_id in components if component_id not in structure_by_component
    )
    return {
        "employee_compensation_id": compensation.id,
        "employee_id": compensation.employee_id,
        "salary_structure_id": compensation.salary_structure_id,
        "base_salary": compensation.base_salary,
        "currency": compensation.currency,
        "as_of": as_of_date,
        "components": [resolved[component_id] for component_id in ordered_ids],
    }
