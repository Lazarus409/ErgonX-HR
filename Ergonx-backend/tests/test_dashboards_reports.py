from datetime import date, timedelta
from decimal import Decimal

import pytest

from apps.attendance.models import AttendanceRecord
from apps.accounting.models import Account, AccountingPeriod, BankAccount, FiscalYear, JournalEntry, JournalLine
from apps.employees.models import Employee, Employment
from apps.institutions.models import InstitutionModule


@pytest.mark.django_db
def test_executive_dashboard_omits_disabled_module_rollups(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="DASHBOARD-GATES")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="DIRECTOR", is_primary=True)
    InstitutionModule.objects.filter(institution=institution).exclude(
        module_code=InstitutionModule.ModuleCode.CORE_HR
    ).update(is_enabled=False)

    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    response = api_client.get("/api/v1/dashboards/executive/")

    assert response.status_code == 200
    assert "pending_leave_requests" not in response.data
    assert "attendance_today" not in response.data
    assert "payroll_cost" not in response.data
    assert "financial_position" not in response.data
    assert "recruitment_summary" not in response.data


@pytest.mark.django_db
def test_hr_dashboard_and_csv_export_are_tenant_scoped(
    api_client, institution_factory, user_factory, membership_factory, employee_factory,
    organization_factory, assignment_dimensions_factory,
):
    institution = institution_factory(code="DASHBOARD-HOME")
    foreign = institution_factory(code="DASHBOARD-FOREIGN")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    employee_factory(foreign)
    # CSV reports live under the Reports module (Wave 0 decision BQ-05).
    institution.modules.filter(module_code="REPORTS").update(is_enabled=True)

    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))

    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    employee = employee_factory(institution, first_name="Ada", last_name="Source")
    Employment.objects.create(
        institution=institution,
        employee=employee,
        department=department,
        position=position,
        grade=grade,
        location=location,
        employment_type=Employment.EmploymentType.PERMANENT,
        start_date=employee.hire_date,
    )

    dashboard = api_client.get("/api/v1/dashboards/hr/")
    assert dashboard.status_code == 200
    assert dashboard.data["total_employees"] == 1
    assert dashboard.data["active_employees"] == 1
    assert dashboard.data["by_department"] == [{"department__name": department.name, "count": 1}]
    assert dashboard.data["by_grade"] == [{"grade__name": grade.name, "count": 1}]
    assert dashboard.data["by_location"] == [{"location__name": location.name, "count": 1}]
    assert dashboard.data["by_employment_type"] == [{"employment_type": "PERMANENT", "count": 1}]
    assert str(dashboard.data["recent_hires"][0]["id"]) == str(employee.id)

    report = api_client.get("/api/v1/reports/workforce-cost/?export=csv")
    assert report.status_code == 200
    assert report["Content-Type"].startswith("text/csv")
    assert "gross_pay" in report.content.decode()


@pytest.mark.django_db
def test_finance_manager_receives_finance_dashboard_and_report_access(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="DASHBOARD-FINANCE")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="FINANCE_MANAGER", is_primary=True)
    InstitutionModule.objects.filter(institution=institution).update(is_enabled=True)

    api_client.force_authenticate(user)
    response = api_client.get("/api/v1/dashboards/finance/")
    assert response.status_code == 200
    assert set(response.data) == {
        "pending_journals", "accounts_payable", "accounts_receivable", "expenses",
        "accounts_payable_aging", "accounts_receivable_aging", "journals_by_status",
        "profit_and_loss_trend", "bank_balance", "registered_bank_accounts", "cash_flow_trend",
        "expenses_by_account", "unreconciled_bank_lines",
        # Accounting dashboard concept workspace.
        "range_months", "range_start", "cash_flow_range", "reconciliation_exceptions", "pending_approvals",
        "pending_approvals_breakdown", "unposted_journals", "close_status", "needs_attention", "needs_attention_total",
        "recent_journals", "controls",
    }
    assert len(response.data["accounts_payable_aging"]) == 4
    assert len(response.data["accounts_receivable_aging"]) == 4
    assert response.data["profit_and_loss_trend"] == []
    assert response.data["bank_balance"] == 0
    assert response.data["registered_bank_accounts"] == 0
    assert response.data["cash_flow_trend"] == []

    report = api_client.get("/api/v1/reports/accounting/")
    assert report.status_code == 200
    assert report.data == {"report": "accounting", "rows": []}

    # Recruitment data needs candidate.view, which finance roles do not hold.
    assert api_client.get("/api/v1/reports/recruitment/?export=csv").status_code == 403

    expenses_report = api_client.get("/api/v1/reports/expenses/?export=csv")
    assert expenses_report.status_code == 200
    assert expenses_report["Content-Type"].startswith("text/csv")
    # The common exporter labels an otherwise empty report truthfully; it does
    # not manufacture a row merely to populate a CSV header.
    assert expenses_report.content.decode() == "empty\r\n"

    filtered_accounting = api_client.get("/api/v1/reports/accounting/?status=POSTED")
    assert filtered_accounting.status_code == 200
    assert filtered_accounting.data == {"report": "accounting", "rows": []}


@pytest.mark.django_db
def test_executive_dashboard_returns_tenant_scoped_visual_rollups(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="DASHBOARD-EXECUTIVE")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="DIRECTOR", is_primary=True)
    InstitutionModule.objects.filter(institution=institution).update(is_enabled=True)

    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    response = api_client.get("/api/v1/dashboards/executive/")

    assert response.status_code == 200
    assert response.data["attendance_today"] == {
        "present": 0, "late": 0, "absent": 0, "on_leave": 0,
    }
    assert response.data["financial_position"] == {
        "bank_balance": 0, "registered_bank_accounts": 0,
        "accounts_payable": 0, "accounts_receivable": 0, "posted_expenses": 0,
    }
    assert response.data["recruitment_summary"] == {
        "open_jobs": 0,
        "active_candidates": 0,
        "applications": 0,
        "scheduled_interviews": 0,
        "offers_extended": 0,
    }
    assert response.data["payroll_by_period"] == []
    assert response.data["profit_and_loss_trend"] == []
    assert response.data["cash_flow_trend"] == []


@pytest.mark.django_db
def test_finance_and_executive_dashboards_derive_profit_and_loss_from_posted_ledger(
    api_client, institution_factory, user_factory, membership_factory,
):
    institution = institution_factory(code="DASHBOARD-PL")
    user = user_factory()
    director = user_factory()
    membership_factory(user=user, institution=institution, role_code="FINANCE_MANAGER", is_primary=True)
    membership_factory(user=director, institution=institution, role_code="DIRECTOR", is_primary=True)
    InstitutionModule.objects.filter(institution=institution).update(is_enabled=True)
    fiscal_year = FiscalYear.objects.create(
        institution=institution, name="FY2026", start_date=date(2026, 1, 1), end_date=date(2026, 12, 31)
    )
    period = AccountingPeriod.objects.create(
        institution=institution, fiscal_year=fiscal_year, name="September 2026",
        start_date=date(2026, 9, 1), end_date=date(2026, 9, 30),
    )
    income = Account.objects.create(
        institution=institution, code="4000", name="Revenue", account_type=Account.AccountType.INCOME,
        normal_balance=Account.NormalBalance.CREDIT,
    )
    expense = Account.objects.create(
        institution=institution, code="5000", name="Operations", account_type=Account.AccountType.EXPENSE,
        normal_balance=Account.NormalBalance.DEBIT,
    )
    cash = Account.objects.create(
        institution=institution, code="1000", name="Cash", account_type=Account.AccountType.ASSET,
        normal_balance=Account.NormalBalance.DEBIT,
    )
    BankAccount.objects.create(
        institution=institution,
        name="Operating account",
        bank_name="Example Bank",
        masked_account_number="****0001",
        currency="GHS",
        ledger_account=cash,
    )
    revenue_journal = JournalEntry.objects.create(
        institution=institution, journal_number="JE-REV", accounting_period=period, entry_date=date(2026, 9, 10),
        description="Revenue", created_by=user,
    )
    JournalLine.objects.create(journal_entry=revenue_journal, account=cash, debit=1000, credit=0)
    JournalLine.objects.create(journal_entry=revenue_journal, account=income, debit=0, credit=1000)
    expense_journal = JournalEntry.objects.create(
        institution=institution, journal_number="JE-EXP", accounting_period=period, entry_date=date(2026, 9, 15),
        description="Expense", created_by=user,
    )
    JournalLine.objects.create(journal_entry=expense_journal, account=expense, debit=400, credit=0)
    JournalLine.objects.create(journal_entry=expense_journal, account=cash, debit=0, credit=400)
    JournalEntry.objects.filter(pk__in=(revenue_journal.pk, expense_journal.pk)).update(status=JournalEntry.Status.POSTED)

    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    finance = api_client.get("/api/v1/dashboards/finance/")
    expected = [{"month": "2026-09-01", "income": Decimal("1000"), "expenses": Decimal("400"), "net_income": Decimal("600")}]
    assert finance.status_code == 200
    assert finance.data["profit_and_loss_trend"] == expected
    assert finance.data["bank_balance"] == Decimal("600")
    assert finance.data["registered_bank_accounts"] == 1
    assert finance.data["cash_flow_trend"] == [
        {"month": "2026-09-01", "inflow": Decimal("1000"), "outflow": Decimal("400"), "net_movement": Decimal("600")}
    ]

    api_client.force_authenticate(director)
    executive = api_client.get("/api/v1/dashboards/executive/")
    assert executive.status_code == 200
    assert executive.data["profit_and_loss_trend"] == expected
    assert executive.data["financial_position"]["bank_balance"] == Decimal("600")
    assert executive.data["financial_position"]["registered_bank_accounts"] == 1
    assert executive.data["cash_flow_trend"] == finance.data["cash_flow_trend"]

    payroll = api_client.get("/api/v1/dashboards/payroll/")
    assert payroll.status_code == 200
    assert payroll.data["finalized_gross_pay"] == 0
    assert payroll.data["finalized_net_pay"] == 0
    assert payroll.data["finalized_deductions"] == 0
    assert payroll.data["employer_contributions"] == 0
    assert payroll.data["runs_by_status"] == []
    assert payroll.data["payroll_by_period"] == []

    leave = api_client.get("/api/v1/dashboards/leave/")
    assert leave.status_code == 200
    assert leave.data["by_leave_type"] == []
    assert len(leave.data["monthly_approved_leave"]) == 6
    assert all(item["request_count"] == 0 for item in leave.data["monthly_approved_leave"])
    assert leave.data["balance_utilisation"] == {
        "year": date.today().year,
        "entitlement_days": Decimal("0"),
        "used_days": Decimal("0"),
        "available_days": Decimal("0"),
        "utilisation_percent": None,
    }


@pytest.mark.django_db
def test_attendance_dashboard_returns_source_backed_weekly_and_department_rollups(
    api_client, institution_factory, user_factory, membership_factory, employee_factory,
    organization_factory, assignment_dimensions_factory,
):
    institution = institution_factory(code="DASHBOARD-ATTENDANCE")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="DIRECTOR", is_primary=True)
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    employee = employee_factory(institution)
    Employment.objects.create(
        institution=institution,
        employee=employee,
        department=department,
        position=position,
        grade=grade,
        location=location,
        employment_type=Employment.EmploymentType.PERMANENT,
        start_date=employee.hire_date,
    )
    AttendanceRecord.objects.create(
        institution=institution,
        employee=employee,
        attendance_date=date.today(),
        status=AttendanceRecord.Status.PRESENT,
        source=AttendanceRecord.Source.MANUAL,
        overtime_minutes=30,
    )
    AttendanceRecord.objects.create(
        institution=institution,
        employee=employee,
        attendance_date=date.today() - timedelta(days=1),
        status=AttendanceRecord.Status.ABSENT,
        source=AttendanceRecord.Source.MANUAL,
    )

    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    response = api_client.get("/api/v1/dashboards/attendance/")

    assert response.status_code == 200
    assert response.data["present"] == 1
    assert response.data["weekly_attendance"][-1] == {
        "date": date.today().isoformat(), "present": 1, "late": 0,
        "absent": 0, "on_leave": 0, "overtime_minutes": 30,
    }
    assert response.data["by_department"] == [{
        "employee__employments__department__name": department.name,
        "present": 1, "late": 0, "absent": 0, "on_leave": 0, "total": 1,
    }]


@pytest.mark.django_db
def test_employee_cannot_access_dashboard_or_reports(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="DASHBOARD-DENIED")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="EMPLOYEE", is_primary=True)
    api_client.force_authenticate(user)

    assert api_client.get("/api/v1/dashboards/hr/").status_code == 403
    assert api_client.get("/api/v1/reports/leave/").status_code == 403
