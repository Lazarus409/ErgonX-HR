import uuid
from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.attendance.models import AttendanceRecord
from apps.compensation.models import EmployeeCompensation, SalaryStructure
from apps.documents.models import Document
from apps.employees.models import Employment
from apps.institutions.models import InstitutionModule
from apps.leave.models import LeavePolicy, LeaveType
from apps.notifications.serializers import NotificationSerializer
from apps.payroll.models import PayrollItem
from apps.payroll.services import calculate_payroll_run, configure_payroll, create_payroll_period, create_payroll_run

pytestmark = pytest.mark.django_db


def _enable(institution, *modules):
    institution.modules.filter(module_code__in=modules).update(is_enabled=True)


def _employ(institution, employee, organization_factory, assignment_dimensions_factory):
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    Employment.objects.create(
        institution=institution, employee=employee, department=department, position=position,
        grade=grade, location=location, employment_type=Employment.EmploymentType.PERMANENT,
        start_date=date(2026, 1, 1),
    )
    return department


CUSTOM_RULES = {
    "income_tax": {
        "method": "PROGRESSIVE",
        "name": "PAYE",
        "basis": "TAXABLE_INCOME",
        "bands": [{"upper_bound": "1000", "rate": "0"}, {"upper_bound": None, "rate": "10"}],
    },
    "contributions": [{"name": "Staff pension", "basis": "BASE_SALARY", "employee_rate": "5", "employer_rate": "13"}],
}


def test_custom_payroll_rules_drive_the_calculation(
    api_client, institution_factory, user_factory, membership_factory, employee_factory,
    organization_factory, assignment_dimensions_factory,
):
    institution = institution_factory()
    _enable(institution, InstitutionModule.ModuleCode.PAYROLL)
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee = employee_factory(institution, first_name="Ama", last_name="Mensah")
    _employ(institution, employee, organization_factory, assignment_dimensions_factory)
    structure = SalaryStructure.objects.create(institution=institution, name="Standard", code="STD")
    EmployeeCompensation.objects.create(
        institution=institution, employee=employee, salary_structure=structure,
        base_salary=Decimal("3000.00"), currency="GHS", effective_from=date(2026, 1, 1),
    )

    configuration = configure_payroll(
        institution=institution, actor=hr, country_code="GH", currency="GHS",
        payroll_frequency="MONTHLY", payroll_setup_mode="CUSTOM", custom_rules=CUSTOM_RULES,
        pay_day_rule={"type": "DAY_OF_MONTH", "day": "25"},
    )
    assert configuration.pay_day_rule == {"type": "DAY_OF_MONTH", "day": 25}
    assert configuration.custom_rules["contributions"][0]["code"] == "STAFF_PENSION"

    period = create_payroll_period(
        institution=institution, actor=hr, name="September 2026",
        start_date=date(2026, 9, 1), end_date=date(2026, 9, 30), pay_date=date(2026, 9, 25),
    )
    run = create_payroll_run(institution=institution, payroll_period=period, actor=hr, idempotency_key="custom-1")
    assert run.statutory_snapshot["configuration"]["custom_rules"] == configuration.custom_rules
    run = calculate_payroll_run(payroll_run=run, actor=hr)

    record = run.records.get()
    # Tax: 10% of the 2,000 above the 1,000 band. Pension: 5% employee, 13% employer of 3,000.
    assert record.total_deductions == Decimal("200.00")
    assert record.employee_contributions == Decimal("150.00")
    assert record.employer_contributions == Decimal("390.00")
    assert record.net_pay == Decimal("2650.00")
    assert set(record.items.filter(source=PayrollItem.Source.STATUTORY).values_list("component_code_snapshot", flat=True)) == {
        "INCOME_TAX", "STAFF_PENSION_EMPLOYEE", "STAFF_PENSION_EMPLOYER",
    }

    api_client.force_authenticate(hr)
    listed = api_client.get("/api/v1/payroll-records/", {"payroll_run": str(run.id)})
    assert listed.status_code == 200, listed.data
    assert listed.data["results"][0]["employee_name"] == "Ama Mensah"
    assert listed.data["results"][0]["employee_number"] == employee.employee_number


def test_custom_payroll_rules_are_validated_and_cleared_for_presets(institution_factory, user_factory, membership_factory):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    base = dict(institution=institution, actor=hr, country_code="GH", currency="GHS", payroll_frequency="MONTHLY", payroll_setup_mode="CUSTOM")

    with pytest.raises(ValidationError):
        configure_payroll(**base, custom_rules={"income_tax": {"method": "PROGRESSIVE", "bands": [{"upper_bound": "500", "rate": "0"}, {"upper_bound": "400", "rate": "5"}, {"upper_bound": None, "rate": "10"}]}})
    with pytest.raises(ValidationError):
        configure_payroll(**base, custom_rules={"income_tax": {"method": "FLAT", "rate": "150"}})
    with pytest.raises(ValidationError):
        configure_payroll(**base, custom_rules={"contributions": [{"name": "Pension", "employee_rate": "0", "employer_rate": "0"}]})

    assert configure_payroll(**base, custom_rules={"income_tax": {"method": "NONE"}}).custom_rules == {}


def test_hr_admin_no_longer_reads_the_audit_trail(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory()
    hr, admin = user_factory(), user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN")

    api_client.force_authenticate(hr)
    assert api_client.get("/api/v1/audit/").status_code == 403
    api_client.force_authenticate(admin)
    assert api_client.get("/api/v1/audit/").status_code == 200


def test_notifications_link_to_the_record_they_are_about():
    record_id = str(uuid.uuid4())
    route = NotificationSerializer.route_for
    assert route("LEAVE_APPROVAL_REQUIRED", {"leave_request_id": record_id}) == f"/leave/requests/{record_id}"
    assert route("LEAVE_APPROVED", {"leave_request_id": record_id}) == "/me/leave"
    assert route("PAYSLIP_AVAILABLE", {"payslip_id": record_id}) == "/me/payslips"
    assert route("PAYROLL_ACTION_REQUIRED", {"payroll_run_id": record_id}) == f"/payroll/runs/{record_id}"
    assert route("ACCOUNTING_ACTION_REQUIRED", {"journal_entry_id": record_id}) == f"/accounting/journals/{record_id}"
    assert route("ACCOUNTING_ACTION_REQUIRED", {"expense_id": record_id}) == "/accounting/expenses"
    assert route("RECRUITMENT_OFFER_EXTENDED", {"entity_type": "recruitment.Offer", "entity_id": record_id}) == f"/recruitment/offers/{record_id}"
    # Anything that is not a well-formed id never becomes part of a link.
    assert route("PAYROLL_ACTION_REQUIRED", {"payroll_run_id": "../../settings"}) is None
    assert route("SOMETHING_ELSE", {}) is None


def test_employees_upload_download_and_remove_their_own_documents(
    api_client, settings, tmp_path, institution_factory, user_factory, membership_factory, employee_factory,
):
    settings.MEDIA_ROOT = tmp_path
    institution = institution_factory()
    staff, colleague, hr = user_factory(), user_factory(), user_factory()
    membership_factory(user=staff, institution=institution, role_code="EMPLOYEE")
    membership_factory(user=colleague, institution=institution, role_code="EMPLOYEE")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee = employee_factory(institution, user=staff)
    employee_factory(institution, user=colleague)
    shared = Document.objects.create(
        institution=institution, uploaded_by=hr, file_reference="external:contract", original_filename="contract.pdf",
        content_type="application/pdf", size_bytes=10, category="Contract", entity_type="EMPLOYEE", entity_id=employee.id,
    )

    api_client.force_authenticate(staff)
    upload = api_client.post(
        "/api/v1/employees/me/documents/",
        {"category": "Certificate", "uploaded_file": SimpleUploadedFile("degree.pdf", b"%PDF-1.4 degree", content_type="application/pdf")},
        format="multipart",
    )
    assert upload.status_code == 201, upload.data
    assert upload.data["category"] == "Certificate"
    assert upload.data["classification"] == "CONFIDENTIAL"
    document_id = upload.data["id"]
    assert {item["id"] for item in api_client.get("/api/v1/employees/me/documents/").data} == {document_id, str(shared.id)}
    download = api_client.get(f"/api/v1/employees/me/documents/{document_id}/")
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == b"%PDF-1.4 degree"

    bad = api_client.post("/api/v1/employees/me/documents/", {"category": "Payslip hack", "uploaded_file": SimpleUploadedFile("x.txt", b"x")}, format="multipart")
    assert bad.status_code == 400
    assert api_client.delete(f"/api/v1/employees/me/documents/{shared.id}/").status_code == 403

    api_client.force_authenticate(colleague)
    assert api_client.get(f"/api/v1/employees/me/documents/{document_id}/").status_code == 404

    api_client.force_authenticate(staff)
    assert api_client.delete(f"/api/v1/employees/me/documents/{document_id}/").status_code == 204
    assert [item["id"] for item in api_client.get("/api/v1/employees/me/documents/").data] == [str(shared.id)]


def test_new_institutions_start_with_the_standard_leave_types(institution_factory):
    institution = institution_factory()
    codes = set(LeaveType.objects.filter(institution=institution).values_list("code", flat=True))
    assert {"ANNUAL", "SICK", "MATERNITY", "PATERNITY", "COMPASSIONATE", "STUDY", "CASUAL", "UNPAID"} <= codes
    maternity = LeavePolicy.objects.get(institution=institution, leave_type__code="MATERNITY")
    assert maternity.annual_entitlement == Decimal("84")
    assert list(maternity.gender_eligibilities.values_list("gender", flat=True)) == ["FEMALE"]
    assert LeaveType.objects.get(institution=institution, code="UNPAID").is_paid is False
    assert all(LeavePolicy.objects.filter(institution=institution, leave_type=leave_type).exists() for leave_type in LeaveType.objects.filter(institution=institution))


def test_report_rows_open_to_the_records_they_count(
    api_client, institution_factory, user_factory, membership_factory, employee_factory,
    organization_factory, assignment_dimensions_factory,
):
    institution = institution_factory()
    _enable(institution, InstitutionModule.ModuleCode.ATTENDANCE, InstitutionModule.ModuleCode.REPORTS)
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    absent = employee_factory(institution, first_name="Kofi", last_name="Boateng")
    present = employee_factory(institution, first_name="Esi", last_name="Owusu")
    department = _employ(institution, absent, organization_factory, assignment_dimensions_factory)
    _employ(institution, present, organization_factory, assignment_dimensions_factory)
    for employee, status in ((absent, "ABSENT"), (present, "PRESENT")):
        AttendanceRecord.objects.create(
            institution=institution, employee=employee, attendance_date=date(2026, 9, 10),
            status=status, source=AttendanceRecord.Source.MANUAL,
        )

    api_client.force_authenticate(hr)
    summary = api_client.get("/api/v1/reports/attendance/")
    assert {row["status"] for row in summary.data["rows"]} == {"ABSENT", "PRESENT"}

    details = api_client.get("/api/v1/reports/attendance/", {"group": "ABSENT"})
    assert details.status_code == 200, details.data
    assert details.data["group"] == ["ABSENT"]
    assert len(details.data["rows"]) == 1
    row = details.data["rows"][0]
    assert row["employee"] == "Kofi Boateng"
    assert row["employee_number"] == absent.employee_number
    assert row["department"] == department.name
    assert row["date"] == date(2026, 9, 10)

    exported = api_client.get("/api/v1/reports/attendance/", {"group": "ABSENT", "export": "csv"})
    assert exported.status_code == 200
    assert "Kofi Boateng" in exported.content.decode()
    assert exported["Content-Disposition"] == 'attachment; filename="attendance-absent.csv"'

    assert api_client.get("/api/v1/reports/accounting/", {"group": "MANUAL"}).status_code in (400, 403)
    assert api_client.get("/api/v1/reports/attendance/", {"group": ["ABSENT", "EXTRA"]}).status_code == 400


def test_system_roles_are_resynced_to_the_code_on_migrate(api_client, institution_factory, user_factory, membership_factory, employee_factory):
    from apps.institutions.models import Permission, Role
    from apps.institutions.services import sync_system_role_permissions
    from apps.organization.models import Department

    institution = institution_factory()
    head = user_factory()
    membership_factory(user=head, institution=institution, role_code="DEPARTMENT_HEAD")
    employee = employee_factory(institution, user=head)
    Department.objects.create(institution=institution, name="Operations", code="OPS", head=employee)
    role = Role.objects.get(institution=institution, code="DEPARTMENT_HEAD")
    # Drift as seen on a deployed database: the dashboard permission went missing.
    role.permissions.remove(Permission.objects.get(code="dashboard.department.view"))
    api_client.force_authenticate(head)
    assert api_client.get("/api/v1/dashboards/department/").status_code == 403

    changes = sync_system_role_permissions()
    assert changes["DEPARTMENT_HEAD"] == {"added": ["dashboard.department.view"], "removed": []}
    assert api_client.get("/api/v1/dashboards/department/").status_code == 200
    assert sync_system_role_permissions() == {}


def test_platform_overview_says_whether_invitations_are_emailed(api_client, settings):
    from apps.accounts.models import User

    admin = User.objects.create_superuser(email="root@example.com", password="StrongPass123!")
    api_client.force_authenticate(admin)
    settings.EMAIL_DELIVERY_ENABLED = False
    assert api_client.get("/api/v1/platform/overview/").data["email_delivery_enabled"] is False
    settings.EMAIL_DELIVERY_ENABLED = True
    assert api_client.get("/api/v1/platform/overview/").data["email_delivery_enabled"] is True
