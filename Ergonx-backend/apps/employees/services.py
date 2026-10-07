from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_audit_event
from apps.employees.models import EmergencyContact, Employee, EmployeeOffboarding, EmployeeOnboarding, Employment
from apps.institutions.models import InstitutionMembership
from apps.institutions.services import update_membership
from common.exceptions import CodedValidationError


def ensure_not_self_hr_mutation(*, actor, employee):
    """Keep HR administration separate from employee self-service."""
    if actor is not None and employee.user_id == actor.id:
        raise CodedValidationError(
            {"employee": "Use Profile, Preferences, Security, or other self-service tools for your own account."},
            api_code="self_hr_record_edit_not_allowed",
        )


@transaction.atomic
def create_employment(*, institution, employee, **values):
    if employee.institution_id != institution.id:
        raise ValidationError(
            {"employee": "Employee must belong to the selected institution."}
        )
    employment = Employment(
        institution=institution,
        employee=employee,
        **values,
    )
    employment.full_clean()
    employment.save()
    return employment


@transaction.atomic
def change_current_employment(*, institution, employee, start_date, **values):
    locked_employee = Employee.objects.select_for_update().get(pk=employee.pk)
    if locked_employee.institution_id != institution.id:
        raise ValidationError(
            {"employee": "Employee must belong to the selected institution."}
        )

    current = (
        Employment.objects.select_for_update()
        .filter(employee=locked_employee, is_current=True)
        .first()
    )
    if current:
        if start_date <= current.start_date:
            raise ValidationError(
                {"start_date": "A new current employment must start after the current record."}
            )
        current.is_current = False
        current.status = Employment.Status.ENDED
        current.end_date = start_date - timedelta(days=1)
        current.save(update_fields=("is_current", "status", "end_date", "updated_at"))

    employment = Employment(
        institution=institution,
        employee=locked_employee,
        start_date=start_date,
        is_current=True,
        **values,
    )
    employment.full_clean()
    employment.save()
    return employment


@transaction.atomic
def save_emergency_contact(*, institution, employee, instance=None, **values):
    """Creates or updates one tenant-scoped emergency contact safely.

    The database permits one primary contact per employee. Demoting the
    previous primary inside this transaction makes the API convenient for the
    profile UI without weakening that invariant or exposing cross-tenant data.
    """
    locked_employee = Employee.objects.select_for_update().get(pk=employee.pk)
    if locked_employee.institution_id != institution.id:
        raise ValidationError({"employee": "Employee belongs to another institution."})

    contact = instance or EmergencyContact(
        institution=institution,
        employee=locked_employee,
    )
    for field, value in values.items():
        setattr(contact, field, value)
    contact.institution = institution
    contact.employee = locked_employee

    if contact.is_primary:
        list(
            EmergencyContact.objects.select_for_update()
            .filter(employee=locked_employee, is_primary=True)
            .exclude(pk=contact.pk)
        )
        EmergencyContact.objects.filter(
            employee=locked_employee,
            is_primary=True,
        ).exclude(pk=contact.pk).update(is_primary=False)

    contact.full_clean()
    contact.save()
    return contact


@transaction.atomic
def start_employee_onboarding(*, institution, employee, actor):
    locked_employee = Employee.objects.select_for_update().get(pk=employee.pk)
    if locked_employee.institution_id != institution.id:
        raise ValidationError({"employee": "Employee belongs to another institution."})
    onboarding = EmployeeOnboarding.objects.for_institution(institution).filter(
        employee=locked_employee,
        status__in=(EmployeeOnboarding.Status.NOT_STARTED, EmployeeOnboarding.Status.IN_PROGRESS, EmployeeOnboarding.Status.BLOCKED, EmployeeOnboarding.Status.READY_FOR_ACTIVATION),
    ).order_by("-created_at").first()
    if onboarding is None:
        onboarding = EmployeeOnboarding(institution=institution, employee=locked_employee)
    onboarding.status = EmployeeOnboarding.Status.IN_PROGRESS
    onboarding.started_at = onboarding.started_at or timezone.now()
    onboarding.save()
    record_audit_event(actor=actor, institution=institution, entity=onboarding, action="employee.onboarding.started")
    return onboarding


@transaction.atomic
def complete_employee_onboarding(*, institution, employee, actor):
    onboarding = start_employee_onboarding(institution=institution, employee=employee, actor=actor)
    locked_employee = Employee.objects.select_for_update().get(pk=employee.pk)
    has_current_employment = Employment.objects.filter(employee=locked_employee, is_current=True, status=Employment.Status.ACTIVE).exists()
    if not has_current_employment:
        onboarding.status = EmployeeOnboarding.Status.BLOCKED
        onboarding.notes = "A current active employment record is required before activation."
        onboarding.save(update_fields=("status", "notes", "updated_at"))
        return onboarding
    onboarding.status = EmployeeOnboarding.Status.COMPLETED
    onboarding.completed_at = timezone.now()
    onboarding.save(update_fields=("status", "completed_at", "updated_at"))
    membership = InstitutionMembership.objects.filter(institution=institution, user=locked_employee.user).first() if locked_employee.user_id else None
    if membership and membership.status == InstitutionMembership.Status.INVITED:
        update_membership(
            membership=membership,
            institution=institution,
            actor=actor,
            status=InstitutionMembership.Status.ACTIVE,
        )
    record_audit_event(actor=actor, institution=institution, entity=onboarding, action="employee.onboarding.completed")
    return onboarding


@transaction.atomic
def initiate_employee_offboarding(*, institution, employee, actor, last_working_day=None, reason="", notes=""):
    locked_employee = Employee.objects.select_for_update().get(pk=employee.pk)
    if locked_employee.institution_id != institution.id:
        raise ValidationError({"employee": "Employee belongs to another institution."})
    if locked_employee.status == Employee.Status.TERMINATED:
        raise ValidationError({"employee": "Employee is already terminated."})
    offboarding = EmployeeOffboarding.objects.for_institution(institution).filter(
        employee=locked_employee,
        status__in=(EmployeeOffboarding.Status.NOT_STARTED, EmployeeOffboarding.Status.IN_PROGRESS, EmployeeOffboarding.Status.BLOCKED, EmployeeOffboarding.Status.READY_TO_TERMINATE),
    ).order_by("-created_at").first()
    if offboarding is None:
        offboarding = EmployeeOffboarding(institution=institution, employee=locked_employee)
    offboarding.status = EmployeeOffboarding.Status.IN_PROGRESS
    offboarding.initiated_at = offboarding.initiated_at or timezone.now()
    offboarding.last_working_day = last_working_day or offboarding.last_working_day
    offboarding.reason = reason or offboarding.reason
    offboarding.notes = notes or offboarding.notes
    offboarding.save()
    record_audit_event(actor=actor, institution=institution, entity=offboarding, action="employee.offboarding.initiated")
    return offboarding


@transaction.atomic
def complete_employee_offboarding(*, institution, employee, actor):
    offboarding = initiate_employee_offboarding(institution=institution, employee=employee, actor=actor)
    locked_employee = Employee.objects.select_for_update().get(pk=employee.pk)
    blockers = []
    from apps.leave.models import LeaveRequest
    if LeaveRequest.objects.for_institution(institution).filter(employee=locked_employee, status=LeaveRequest.Status.PENDING).exists():
        blockers.append("Pending leave requests must be resolved.")
    if blockers:
        offboarding.status = EmployeeOffboarding.Status.BLOCKED
        offboarding.notes = " ".join(blockers)
        offboarding.save(update_fields=("status", "notes", "updated_at"))
        return offboarding
    end_date = offboarding.last_working_day or timezone.localdate()
    current = Employment.objects.select_for_update().filter(employee=locked_employee, is_current=True).first()
    if current:
        if end_date < current.start_date:
            raise ValidationError({"last_working_day": "Last working day cannot precede employment start date."})
        current.is_current = False
        current.status = Employment.Status.ENDED
        current.end_date = end_date
        current.save(update_fields=("is_current", "status", "end_date", "updated_at"))
    if locked_employee.user_id:
        membership = InstitutionMembership.objects.filter(institution=institution, user=locked_employee.user).first()
        if membership and membership.status == InstitutionMembership.Status.ACTIVE:
            update_membership(membership=membership, institution=institution, actor=actor, status=InstitutionMembership.Status.INACTIVE)
    locked_employee.status = Employee.Status.TERMINATED
    locked_employee.save(update_fields=("status", "updated_at"))
    offboarding.status = EmployeeOffboarding.Status.COMPLETED
    offboarding.completed_at = timezone.now()
    offboarding.last_working_day = end_date
    offboarding.save(update_fields=("status", "completed_at", "last_working_day", "updated_at"))
    record_audit_event(actor=actor, institution=institution, entity=offboarding, action="employee.offboarding.completed")
    return offboarding


@transaction.atomic
def rehire_employee(*, institution, employee, actor, department, position, grade, location, employment_type, staff_category, start_date):
    locked_employee = Employee.objects.select_for_update().get(pk=employee.pk)
    if locked_employee.institution_id != institution.id:
        raise ValidationError({"employee": "Employee belongs to another institution."})
    if locked_employee.status not in (Employee.Status.TERMINATED, Employee.Status.INACTIVE):
        raise ValidationError({"employee": "Only terminated or inactive employees can be rehired."})
    if Employment.objects.select_for_update().filter(employee=locked_employee, is_current=True).exists():
        raise ValidationError({"employee": "Employee already has a current employment record."})
    employment = Employment(institution=institution, employee=locked_employee, department=department, position=position, grade=grade, location=location, employment_type=employment_type, staff_category=staff_category, start_date=start_date, status=Employment.Status.ACTIVE, is_current=True)
    employment.full_clean()
    employment.save()
    locked_employee.status = Employee.Status.ACTIVE
    locked_employee.save(update_fields=("status", "updated_at"))
    if locked_employee.user_id:
        membership = InstitutionMembership.objects.filter(institution=institution, user=locked_employee.user).first()
        if membership and membership.status == InstitutionMembership.Status.INACTIVE:
            update_membership(membership=membership, institution=institution, actor=actor, status=InstitutionMembership.Status.INVITED)
    onboarding = EmployeeOnboarding.objects.create(institution=institution, employee=locked_employee, status=EmployeeOnboarding.Status.IN_PROGRESS, started_at=timezone.now(), notes="Rehire onboarding started.")
    record_audit_event(actor=actor, institution=institution, entity=employment, action="employee.rehired", metadata={"employee_id": str(locked_employee.id), "start_date": str(start_date)})
    return employment, onboarding
