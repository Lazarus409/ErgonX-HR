from datetime import date

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.urls import reverse
from drf_spectacular.generators import SchemaGenerator

from apps.documents.models import Document
from apps.employees.models import Employee, Employment
from apps.employees.services import change_current_employment
from apps.institutions.models import InstitutionMembership, InstitutionModule
from apps.institutions.services import create_membership
from apps.operations.models import BackgroundJob
from apps.organization.models import Department, Position
from apps.organization.services import create_position


pytestmark = pytest.mark.django_db


def authenticate(client, user, institution=None):
    client.force_authenticate(user=user)
    if institution:
        client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))


def test_unauthenticated_response_has_stable_error_code(api_client):
    response = api_client.get(reverse("v1:employee-list"))

    assert response.status_code == 401
    assert response.json()["code"] == "authentication_required"

    api_client.credentials(HTTP_AUTHORIZATION="Bearer invalid-token")
    invalid_token = api_client.get(reverse("v1:employee-list"))

    assert invalid_token.status_code == 401
    assert invalid_token.json()["code"] == "authentication_failed"


def test_required_tenant_roles_are_seeded(institution_factory):
    institution = institution_factory()

    assert set(institution.roles.values_list("code", flat=True)) == {
        "INSTITUTION_ADMIN",
        "HR_ADMIN",
        "DIRECTOR",
        "EMPLOYEE",
        "ACCOUNTANT",
        "FINANCE_MANAGER",
        "AUDITOR",
        "DEPARTMENT_HEAD",
    }


def test_global_background_job_is_supported():
    job = BackgroundJob.objects.create(job_type="SYSTEM_MAINTENANCE")

    assert job.institution_id is None


def test_shared_document_rejects_cross_tenant_uploader(
    institution_factory, user_factory, membership_factory
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    foreign_user = user_factory()
    membership_factory(user=foreign_user, institution=institution_b)

    with pytest.raises(ValidationError):
        Document.objects.create(
            institution=institution_a,
            uploaded_by=foreign_user,
            file_reference="private://document",
            original_filename="document.pdf",
            content_type="application/pdf",
            size_bytes=1,
        )


def test_duplicate_institution_membership_is_blocked(
    institution_factory, user_factory, membership_factory
):
    institution = institution_factory()
    user = user_factory()
    membership_factory(user=user, institution=institution)

    with pytest.raises(IntegrityError), transaction.atomic():
        membership_factory(user=user, institution=institution, role_code="EMPLOYEE")


def test_employee_number_is_tenant_scoped(institution_factory, employee_factory):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")

    employee_factory(institution_a, employee_number="001")
    employee_factory(institution_b, employee_number="001")

    with pytest.raises(IntegrityError), transaction.atomic():
        employee_factory(institution_a, employee_number="001")


def test_only_one_current_employment_per_employee(
    institution_factory,
    organization_factory,
    assignment_dimensions_factory,
    employee_factory,
):
    institution = institution_factory()
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    employee = employee_factory(institution)
    values = {
        "institution": institution,
        "employee": employee,
        "department": department,
        "position": position,
        "grade": grade,
        "location": location,
        "employment_type": Employment.EmploymentType.PERMANENT,
        "start_date": date(2026, 1, 1),
        "is_current": True,
    }
    Employment.objects.create(**values)

    with pytest.raises(IntegrityError), transaction.atomic():
        Employment.objects.create(**values)


def test_cross_tenant_organization_relations_are_rejected(institution_factory):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    foreign_department = Department.objects.create(
        institution=institution_b, name="Finance", code="FIN"
    )
    position = Position(
        institution=institution_a,
        department=foreign_department,
        title="Accountant",
        code="ACC",
    )

    with pytest.raises(ValidationError):
        position.full_clean()


def test_cross_tenant_employment_relations_are_rejected_by_api(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    organization_factory,
    assignment_dimensions_factory,
    employee_factory,
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    user = user_factory()
    membership_factory(user=user, institution=institution_a, is_primary=True)
    employee = employee_factory(institution_a)
    foreign_department, foreign_position = organization_factory(institution_b)
    foreign_grade, foreign_location = assignment_dimensions_factory(institution_b)
    authenticate(api_client, user)

    response = api_client.post(
        reverse("v1:employment-list"),
        {
            "employee": employee.id,
            "department": foreign_department.id,
            "position": foreign_position.id,
            "grade": foreign_grade.id,
            "location": foreign_location.id,
            "employment_type": "PERMANENT",
            "start_date": "2026-01-01",
            "is_current": True,
        },
        format="json",
    )

    assert response.status_code == 400
    assert response.data["code"] == "validation_error"
    assert response.data["errors"]["department"]


def test_tenant_cannot_retrieve_other_tenant_employee(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    user = user_factory()
    membership_factory(user=user, institution=institution_a, is_primary=True)
    employee_b = employee_factory(institution_b)
    authenticate(api_client, user)

    response = api_client.get(reverse("v1:employee-detail", args=(employee_b.id,)))

    assert response.status_code == 404
    assert response.data["code"] == "not_found"


def test_tenant_cannot_modify_other_tenant_organization_record(
    api_client, institution_factory, user_factory, membership_factory
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    user = user_factory()
    membership_factory(user=user, institution=institution_a, is_primary=True)
    department_b = Department.objects.create(
        institution=institution_b, name="Finance", code="FIN"
    )
    authenticate(api_client, user)

    response = api_client.patch(
        reverse("v1:department-detail", args=(department_b.id,)),
        {"name": "Changed"},
        format="json",
    )

    assert response.status_code == 404
    department_b.refresh_from_db()
    assert department_b.name == "Finance"


def test_employee_role_cannot_perform_hr_admin_operations(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory()
    user = user_factory()
    membership_factory(
        user=user, institution=institution, role_code="EMPLOYEE", is_primary=True
    )
    authenticate(api_client, user)

    response = api_client.post(
        reverse("v1:employee-list"),
        {
            "employee_number": "E100",
            "first_name": "Ama",
            "last_name": "Mensah",
            "hire_date": "2026-01-01",
        },
        format="json",
    )

    assert response.status_code == 403
    assert response.data["code"] == "permission_denied"


def test_disabled_modules_are_not_active_capabilities(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory()
    user = user_factory()
    membership_factory(user=user, institution=institution, is_primary=True)
    InstitutionModule.objects.filter(
        institution=institution, module_code=InstitutionModule.ModuleCode.CORE_HR
    ).update(is_enabled=False)
    authenticate(api_client, user)

    current = api_client.get(reverse("v1:current"))
    employees = api_client.get(reverse("v1:employee-list"))

    assert current.status_code == 200
    assert "CORE_HR" not in current.json()["data"]["active_capabilities"]
    assert employees.status_code == 403
    assert employees.json()["code"] == "module_disabled"


def test_arbitrary_institution_id_cannot_select_tenant_context(
    api_client, institution_factory, user_factory, membership_factory
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    user = user_factory()
    membership_factory(user=user, institution=institution_a, is_primary=True)
    authenticate(api_client, user, institution_b)

    response = api_client.get(reverse("v1:current"))

    assert response.status_code == 403
    assert response.json()["code"] == "tenant_mismatch"


def test_login_and_me_use_email_and_response_envelope(api_client, user_factory):
    user = user_factory(email="admin@example.com", password="StrongPass123!")

    login = api_client.post(
        reverse("v1:login"),
        {"email": "admin@example.com", "password": "StrongPass123!"},
        format="json",
    )
    assert login.status_code == 200
    assert login.json()["success"] is True
    access = login.json()["data"]["access"]

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    me = api_client.get(reverse("v1:me"))

    assert me.status_code == 200
    assert me.json()["data"]["id"] == str(user.id)


def test_current_employment_change_preserves_history(
    institution_factory,
    organization_factory,
    assignment_dimensions_factory,
    employee_factory,
):
    institution = institution_factory()
    department, first_position = organization_factory(institution)
    second_position = Position.objects.create(
        institution=institution,
        department=department,
        title="Senior Position",
        code="SENIOR",
    )
    grade, location = assignment_dimensions_factory(institution)
    employee = employee_factory(institution)

    first = change_current_employment(
        institution=institution,
        employee=employee,
        department=department,
        position=first_position,
        grade=grade,
        location=location,
        employment_type=Employment.EmploymentType.PERMANENT,
        staff_category=Employment.StaffCategory.JUNIOR,
        start_date=date(2026, 1, 1),
    )
    second = change_current_employment(
        institution=institution,
        employee=employee,
        department=department,
        position=second_position,
        grade=grade,
        location=location,
        employment_type=Employment.EmploymentType.PERMANENT,
        staff_category=Employment.StaffCategory.SENIOR,
        start_date=date(2026, 7, 1),
    )

    first.refresh_from_db()
    assert Employment.objects.filter(employee=employee).count() == 2
    assert first.is_current is False
    assert first.status == Employment.Status.ENDED
    assert first.end_date == date(2026, 6, 30)
    assert second.is_current is True


def test_platform_admin_is_not_tenant_membership(
    api_client, user_factory
):
    platform_admin = user_factory(is_platform_admin=True)
    authenticate(api_client, platform_admin)

    assert api_client.get(reverse("v1:current")).status_code == 403
    assert api_client.get(reverse("v1:employee-list")).status_code == 403


def test_cross_tenant_grade_assignment_fails_on_direct_write(
    institution_factory,
    organization_factory,
    assignment_dimensions_factory,
    employee_factory,
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    department, position = organization_factory(institution_a)
    _, location = assignment_dimensions_factory(institution_a)
    foreign_grade, _ = assignment_dimensions_factory(institution_b)
    employee = employee_factory(institution_a)

    with pytest.raises(ValidationError):
        Employment.objects.create(
            institution=institution_a,
            employee=employee,
            department=department,
            position=position,
            grade=foreign_grade,
            location=location,
            employment_type=Employment.EmploymentType.PERMANENT,
            start_date=date(2026, 1, 1),
        )


def test_cross_tenant_location_assignment_fails_on_direct_write(
    institution_factory,
    organization_factory,
    assignment_dimensions_factory,
    employee_factory,
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    department, position = organization_factory(institution_a)
    grade, _ = assignment_dimensions_factory(institution_a)
    _, foreign_location = assignment_dimensions_factory(institution_b)
    employee = employee_factory(institution_a)

    with pytest.raises(ValidationError):
        Employment.objects.create(
            institution=institution_a,
            employee=employee,
            department=department,
            position=position,
            grade=grade,
            location=foreign_location,
            employment_type=Employment.EmploymentType.PERMANENT,
            start_date=date(2026, 1, 1),
        )


def test_cross_tenant_reports_to_fails_on_direct_write(
    institution_factory,
    organization_factory,
    assignment_dimensions_factory,
    employee_factory,
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    department_a, position_a = organization_factory(institution_a)
    grade_a, location_a = assignment_dimensions_factory(institution_a)
    department_b, position_b = organization_factory(institution_b)
    grade_b, location_b = assignment_dimensions_factory(institution_b)
    employee_a = employee_factory(institution_a)
    manager_b = employee_factory(institution_b)
    manager_employment = Employment.objects.create(
        institution=institution_b,
        employee=manager_b,
        department=department_b,
        position=position_b,
        grade=grade_b,
        location=location_b,
        employment_type=Employment.EmploymentType.PERMANENT,
        start_date=date(2026, 1, 1),
    )

    with pytest.raises(ValidationError):
        Employment.objects.create(
            institution=institution_a,
            employee=employee_a,
            department=department_a,
            position=position_a,
            grade=grade_a,
            location=location_a,
            reports_to=manager_employment,
            employment_type=Employment.EmploymentType.PERMANENT,
            start_date=date(2026, 1, 1),
        )


def test_membership_rejects_role_from_another_institution(
    institution_factory, user_factory
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    user = user_factory()
    foreign_role = institution_b.roles.get(code="HR_ADMIN")

    with pytest.raises(ValidationError):
        InstitutionMembership.objects.create(
            user=user,
            institution=institution_a,
            role=foreign_role,
            status=InstitutionMembership.Status.ACTIVE,
        )
    with pytest.raises(ValidationError):
        create_membership(
            user=user,
            institution=institution_a,
            role=foreign_role,
            status=InstitutionMembership.Status.ACTIVE,
        )


def test_position_direct_and_service_writes_reject_foreign_department(
    institution_factory
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    foreign_department = Department.objects.create(
        institution=institution_b, name="Foreign", code="FOREIGN"
    )

    with pytest.raises(ValidationError):
        Position.objects.create(
            institution=institution_a,
            department=foreign_department,
            title="Invalid",
            code="INVALID1",
        )
    with pytest.raises(ValidationError):
        create_position(
            institution=institution_a,
            department=foreign_department,
            title="Invalid",
            code="INVALID2",
        )


def test_employee_field_filtering_uses_current_employment(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    organization_factory,
    assignment_dimensions_factory,
    employee_factory,
):
    institution = institution_factory()
    user = user_factory()
    membership_factory(user=user, institution=institution, is_primary=True)
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    matching = employee_factory(institution, status=Employee.Status.ACTIVE)
    employee_factory(institution, status=Employee.Status.SUSPENDED)
    change_current_employment(
        institution=institution,
        employee=matching,
        department=department,
        position=position,
        grade=grade,
        location=location,
        employment_type=Employment.EmploymentType.CASUAL,
        staff_category=Employment.StaffCategory.JUNIOR,
        start_date=date(2026, 1, 1),
    )
    authenticate(api_client, user)

    response = api_client.get(
        reverse("v1:employee-list"),
        {
            "status": "ACTIVE",
            "department": department.id,
            "grade": grade.id,
            "location": location.id,
            "employment_type": "CASUAL",
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["count"] == 1
    assert payload["results"][0]["id"] == str(matching.id)


def test_openapi_documents_success_and_error_envelopes():
    schema = SchemaGenerator().get_schema(request=None, public=True)
    responses = schema["paths"]["/api/v1/employees/"]["get"]["responses"]
    success = responses["200"]["content"]["application/json"]["schema"]

    assert set(success["required"]) == {"success", "data", "message", "errors"}
    assert success["properties"]["success"]["enum"] == [True]
    assert responses["401"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorEnvelope"
    }
    assert schema["components"]["schemas"]["ErrorEnvelope"]["properties"][
        "success"
    ]["enum"] == [False]
    assert set(schema["components"]["schemas"]["ErrorEnvelope"]["required"]) == {
        "success",
        "data",
        "message",
        "code",
        "errors",
    }
    assert schema["components"]["schemas"]["ErrorEnvelope"]["properties"][
        "code"
    ]["type"] == "string"
    assert "module_disabled" in schema["components"]["schemas"]["ErrorEnvelope"][
        "properties"
    ]["code"]["enum"]


def test_cors_is_restricted_to_configured_origin(
    api_client, settings
):
    settings.CORS_ALLOWED_ORIGINS = ["https://app.example.com"]

    allowed = api_client.get(
        reverse("v1:me"), HTTP_ORIGIN="https://app.example.com"
    )
    denied = api_client.get(
        reverse("v1:me"), HTTP_ORIGIN="https://evil.example.com"
    )

    assert allowed.headers["access-control-allow-origin"] == "https://app.example.com"
    assert "access-control-allow-origin" not in denied.headers


@pytest.mark.postgresql
def test_postgresql_conditional_employment_constraint(
    institution_factory,
    organization_factory,
    assignment_dimensions_factory,
    employee_factory,
):
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL-specific verification runs in the PostgreSQL CI job")
    institution = institution_factory()
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    employee = employee_factory(institution)
    values = {
        "institution": institution,
        "employee": employee,
        "department": department,
        "position": position,
        "grade": grade,
        "location": location,
        "employment_type": Employment.EmploymentType.PERMANENT,
        "start_date": date(2026, 1, 1),
        "is_current": True,
    }
    Employment.objects.create(**values)

    with pytest.raises(IntegrityError), transaction.atomic():
        Employment.objects.create(**values)
