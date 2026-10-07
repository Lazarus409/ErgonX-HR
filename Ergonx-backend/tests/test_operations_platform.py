from datetime import date

import pytest
from django.core.management import call_command

from apps.employees.models import Employee
from apps.attendance.models import AttendanceRecord
from apps.notifications.models import Notification
from apps.operations.models import BackgroundJob, ExportJob, ImportJob, ImportRowResult
from apps.operations.services import enqueue_background_job


@pytest.mark.django_db
def test_employee_import_commit_and_notification_worker(institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="OPS-HOME")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    item = ImportJob.objects.create(institution=institution, import_type="EMPLOYEE", file_reference="private://employees.csv", initiated_by=user, status=ImportJob.Status.COMMITTING)
    ImportRowResult.objects.create(institution=institution, import_job=item, row_number=2, status=ImportRowResult.Status.VALID, normalized_data={"employee_number": "imp-1", "first_name": "Import", "last_name": "User", "hire_date": date.today().isoformat()})
    notification = Notification.objects.create(institution=institution, user=user, notification_type="TEST", title="Pending", message="Pending", channel=Notification.Channel.IN_APP)
    enqueue_background_job(job_type="IMPORT_COMMIT", institution=institution, initiated_by=user, metadata={"import_job_id": str(item.id)})
    enqueue_background_job(job_type="NOTIFICATION_DELIVERY", institution=institution, initiated_by=user)
    call_command("run_background_jobs")
    assert Employee.objects.filter(institution=institution, employee_number="IMP-1").exists()
    item.refresh_from_db(); notification.refresh_from_db()
    assert item.status == ImportJob.Status.COMPLETED
    assert notification.status == Notification.Status.SENT
    assert BackgroundJob.objects.filter(status=BackgroundJob.Status.SUCCEEDED).count() == 2


@pytest.mark.django_db
def test_report_export_worker_generates_tenant_scoped_csv(institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="OPS-EXPORT")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="FINANCE_MANAGER", is_primary=True)
    item = ExportJob.objects.create(
        institution=institution,
        export_type="REPORT_WORKFORCE_COST",
        initiated_by=user,
    )
    enqueue_background_job(
        job_type="EXPORT_GENERATE",
        institution=institution,
        initiated_by=user,
        metadata={"export_job_id": str(item.id)},
    )

    call_command("run_background_jobs")

    item.refresh_from_db()
    assert item.status == ExportJob.Status.COMPLETED
    assert "status,employee_count" in item.result_content
    assert item.result_reference.startswith("export:REPORT_WORKFORCE_COST:")


@pytest.mark.django_db
def test_import_confirm_requires_create_permission(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="OPS-CONFIRM")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="AUDITOR", is_primary=True)
    item = ImportJob.objects.create(
        institution=institution,
        import_type="EMPLOYEE",
        file_reference="private://employees.csv",
        initiated_by=user,
        status=ImportJob.Status.READY,
    )

    api_client.force_authenticate(user=user)
    response = api_client.post(f"/api/v1/import-jobs/{item.id}/confirm/")

    assert response.status_code == 403
    item.refresh_from_db()
    assert item.status == ImportJob.Status.READY


@pytest.mark.django_db
def test_attendance_import_commits_tenant_employee_rows_and_skips_duplicates(
    institution_factory, user_factory, membership_factory, employee_factory,
):
    institution = institution_factory(code="OPS-ATTENDANCE")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    employee = employee_factory(institution, employee_number="ATT-001")
    item = ImportJob.objects.create(
        institution=institution,
        import_type="ATTENDANCE",
        file_reference="private://attendance.csv",
        initiated_by=user,
        status=ImportJob.Status.COMMITTING,
    )
    ImportRowResult.objects.create(
        institution=institution,
        import_job=item,
        row_number=2,
        status=ImportRowResult.Status.VALID,
        normalized_data={
            "employee_number": employee.employee_number,
            "attendance_date": date.today().isoformat(),
            "status": "PRESENT",
            "worked_minutes": 480,
            "notes": "Imported terminal record",
        },
    )
    ImportRowResult.objects.create(
        institution=institution,
        import_job=item,
        row_number=3,
        status=ImportRowResult.Status.VALID,
        normalized_data={
            "employee_number": employee.employee_number,
            "attendance_date": date.today().isoformat(),
            "status": "PRESENT",
        },
    )
    ImportRowResult.objects.create(
        institution=institution,
        import_job=item,
        row_number=4,
        status=ImportRowResult.Status.VALID,
        normalized_data={
            "employee_number": "NOT-IN-THIS-TENANT",
            "attendance_date": date.today().isoformat(),
            "status": "PRESENT",
        },
    )
    enqueue_background_job(
        job_type="IMPORT_COMMIT",
        institution=institution,
        initiated_by=user,
        metadata={"import_job_id": str(item.id)},
    )

    call_command("run_background_jobs")

    record = AttendanceRecord.objects.get(institution=institution, employee=employee)
    assert record.source == AttendanceRecord.Source.IMPORT
    assert record.worked_minutes == 480
    assert record.notes == "Imported terminal record"
    item.refresh_from_db()
    assert item.status == ImportJob.Status.COMPLETED
    assert item.valid_rows == 1
    assert item.invalid_rows == 2
    duplicate = item.row_results.get(row_number=3)
    assert duplicate.status == ImportRowResult.Status.SKIPPED
    assert duplicate.errors == ["Attendance already exists for this employee and date."]
    missing_employee = item.row_results.get(row_number=4)
    assert missing_employee.status == ImportRowResult.Status.SKIPPED
    assert missing_employee.errors == ["Employee number was not found in this institution."]
