from datetime import date

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.employees.models import Employee
from apps.institutions.models import Institution, InstitutionMembership
from apps.organization.models import Department, Grade, Location, Position


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def institution_factory(db):
    counter = {"value": 0}

    def create(**kwargs):
        counter["value"] += 1
        number = counter["value"]
        return Institution.objects.create(
            name=kwargs.pop("name", f"Institution {number}"),
            code=kwargs.pop("code", f"INST{number}"),
            **kwargs,
        )

    return create


@pytest.fixture
def user_factory(db):
    counter = {"value": 0}

    def create(**kwargs):
        counter["value"] += 1
        number = counter["value"]
        password = kwargs.pop("password", "StrongPass123!")
        return User.objects.create_user(
            email=kwargs.pop("email", f"user{number}@example.com"),
            password=password,
            **kwargs,
        )

    return create


@pytest.fixture
def membership_factory(db):
    def create(*, user, institution, role_code="HR_ADMIN", **kwargs):
        role = institution.roles.get(code=role_code)
        return InstitutionMembership.objects.create(
            user=user,
            institution=institution,
            role=role,
            status=kwargs.pop("status", InstitutionMembership.Status.ACTIVE),
            is_primary=kwargs.pop("is_primary", False),
            **kwargs,
        )

    return create


@pytest.fixture
def organization_factory(db):
    counter = {"value": 0}

    def create(institution):
        counter["value"] += 1
        number = counter["value"]
        department = Department.objects.create(
            institution=institution, name=f"Department {number}", code=f"DEP{number}"
        )
        position = Position.objects.create(
            institution=institution,
            department=department,
            title=f"Position {number}",
            code=f"POS{number}",
        )
        return department, position

    return create


@pytest.fixture
def assignment_dimensions_factory(db):
    counter = {"value": 0}

    def create(institution):
        counter["value"] += 1
        number = counter["value"]
        grade = Grade.objects.create(
            institution=institution,
            name=f"Grade {number}",
            code=f"GRD{number}",
            level=number,
        )
        location = Location.objects.create(
            institution=institution,
            name=f"Location {number}",
            code=f"LOC{number}",
            timezone="Africa/Accra",
        )
        return grade, location

    return create


@pytest.fixture
def employee_factory(db):
    counter = {"value": 0}

    def create(institution, **kwargs):
        counter["value"] += 1
        number = counter["value"]
        return Employee.objects.create(
            institution=institution,
            employee_number=kwargs.pop("employee_number", f"EMP{number}"),
            first_name=kwargs.pop("first_name", "Test"),
            last_name=kwargs.pop("last_name", f"Employee{number}"),
            hire_date=kwargs.pop("hire_date", date(2026, 1, 1)),
            **kwargs,
        )

    return create
