from django.core.exceptions import ValidationError
from django.db import transaction

from apps.organization.models import Position


@transaction.atomic
def create_position(*, institution, department=None, title, code="", **values):
    # A blank code is filled in on save (AutoCodeMixin), like other organization records.
    if department is not None and department.institution_id != institution.id:
        raise ValidationError(
            {"department": "Department must belong to the selected institution."}
        )
    position = Position(
        institution=institution,
        department=department,
        title=title,
        code=code,
        **values,
    )
    position.full_clean()
    position.save()
    return position


@transaction.atomic
def update_position(*, position, **changes):
    for field, value in changes.items():
        setattr(position, field, value)
    position.full_clean()
    position.save()
    return position
