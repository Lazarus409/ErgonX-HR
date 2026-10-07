"""Seed the isolated, development-only integrated ErgonX demonstration tenant.

The command intentionally grows in dependency order.  It does not import the
workbook at runtime; the reviewed workbook is represented by deterministic
constants and domain-service calls.
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import models, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.employees.models import Employee, Employment
from apps.employees.services import create_employment
from apps.institutions.models import Institution, InstitutionMembership, InstitutionModule, Role, UserActivityEvent
from apps.institutions.services import (
    SELF_SERVICE_PERMISSIONS,
    bootstrap_institution,
    create_custom_role,
    create_membership,
    effective_permission_codes,
    record_user_activity,
    update_custom_role,
)
from apps.organization.models import Department, Grade, Location, Position
from apps.organization.services import create_position
from apps.compensation.models import EmployeeCompensation, PayComponent, SalaryStructure
from apps.compensation.services import change_current_compensation
from apps.payroll.models import EmployeePayrollProfile, InstitutionPayrollConfiguration, PayrollAdjustment, PayrollPeriod, PayrollPresetVersion, PayrollRun
from apps.payroll.services import approve_payroll_run, calculate_payroll_run, configure_employee_payroll_profile, configure_payroll, create_payroll_adjustment, create_payroll_period, create_payroll_run, decide_payroll_adjustment, finalize_payroll_run, submit_payroll_adjustment, submit_payroll_run_for_review
from apps.recruitment.models import Application, Candidate, Interview, JobPosting, Offer, RecruitmentStage
from apps.recruitment.services import (
    decide_offer,
    extend_offer,
    hire_candidate,
    move_application_stage,
    publish_job_posting,
    reject_application,
    submit_application,
    update_interview_status,
)
from apps.leave.models import LeavePolicy, LeaveRequest, LeaveType
from apps.leave.services import approve_leave_request, configure_policy, create_leave_request, submit_leave_request
from apps.attendance.models import AttendanceRecord, OvertimeRecord
from apps.attendance.services import classify_attendance_date, clock_in, clock_out, decide_overtime
from apps.scheduling.models import FlexibleWorkRule, ScheduleAssignment, Shift, ShiftPattern, ShiftPatternDay, WorkSchedule
from apps.scheduling.services import create_schedule_assignment
from apps.accounting.models import AccountingPeriod, AccountingPresetVersion, BankAccount, Customer, Expense, FiscalYear, Invoice, PayComponentAccountMapping, PayrollAccountMappingTemplate, Vendor, VendorBill
from apps.accounting.services import apply_accounting_preset, approve_journal, approve_vendor_bill, create_accounting_period, create_bank_account, create_customer, create_expense, create_fiscal_year, create_invoice, create_payment, create_receipt, create_vendor, create_vendor_bill, generate_payroll_journal, issue_invoice, post_journal, post_vendor_bill, submit_expense, submit_journal, submit_vendor_bill


DEMO_INSTITUTION_CODE = "CSA-DEMO"
DEMO_ADMIN_EMAIL = "kwame.mensah@csa.test"
DEMO_DIRECTOR_EMAIL = "evelyn.darko@csa.test"
# Keep the CSA-DEMO credential aligned with the development credential used by
# the onboarding/demo documentation and local UI smoke tests. This is only for
# synthetic development accounts; production seeding is explicitly blocked.
DEFAULT_DEMO_PASSWORD = "ErgonxDemo!2026"

MODULE_CODES = (
    InstitutionModule.ModuleCode.CORE_HR,
    InstitutionModule.ModuleCode.RECRUITMENT,
    InstitutionModule.ModuleCode.LEAVE,
    InstitutionModule.ModuleCode.ATTENDANCE,
    InstitutionModule.ModuleCode.PAYROLL,
    InstitutionModule.ModuleCode.ACCOUNTING,
    InstitutionModule.ModuleCode.REPORTS,
)

ORGANIZATION = {
    "departments": (
        ("DPT-001", "Executive", None),
        ("DPT-002", "Human Resources", "DPT-001"),
        ("DPT-003", "Finance", "DPT-001"),
        ("DPT-004", "Information Technology", "DPT-001"),
        ("DPT-005", "Operations", "DPT-001"),
        ("DPT-006", "Sales & Marketing", "DPT-001"),
    ),
    "grades": (
        ("GRD-01", "Executive", 1),
        ("GRD-02", "Manager", 2),
        ("GRD-03", "Senior Officer", 3),
        ("GRD-04", "Officer", 4),
        ("GRD-05", "Junior Officer", 5),
    ),
    "locations": (
        ("LOC-ACC-HQ", "Accra Head Office", "Accra", False),
        ("LOC-TEM-01", "Tema Operations Centre", "Tema", False),
        ("LOC-REMOTE", "Remote / Hybrid", "Accra", True),
    ),
    "positions": (
        ("POS-001", "Managing Director", "DPT-001"),
        ("POS-002", "HR Manager", "DPT-002"),
        ("POS-003", "HR Officer", "DPT-002"),
        ("POS-004", "Recruitment Officer", "DPT-002"),
        ("POS-005", "Finance Manager", "DPT-003"),
        ("POS-006", "Accountant", "DPT-003"),
        ("POS-007", "Payroll Officer", "DPT-003"),
        ("POS-008", "IT Manager", "DPT-004"),
        ("POS-009", "Software Engineer", "DPT-004"),
        ("POS-010", "Systems Administrator", "DPT-004"),
        ("POS-011", "Operations Manager", "DPT-005"),
        ("POS-012", "Operations Officer", "DPT-005"),
        ("POS-013", "Shift Supervisor", "DPT-005"),
        ("POS-014", "Sales Manager", "DPT-006"),
        ("POS-015", "Sales Executive", "DPT-006"),
        ("POS-016", "Marketing Officer", "DPT-006"),
    ),
}

CUSTOM_ROLES = {
    "PAYROLL_OFFICER": (
        "Payroll Officer",
        ("home.view", "payroll.view", "payroll.prepare", "payslip.view", *SELF_SERVICE_PERMISSIONS),
    ),
    "RECRUITMENT_OFFICER": (
        "Recruitment Officer",
        ("home.view", "job_posting.view", "job_posting.create", "job_posting.update", "candidate.view", "candidate.create", "candidate.update", "interview.view", "interview.manage", "candidate_evaluation.create", *SELF_SERVICE_PERMISSIONS),
    ),
    "SHIFT_SUPERVISOR": (
        "Shift Supervisor",
        ("home.view", "attendance.view", "attendance.approve", "schedule.view", "schedule.manage", *SELF_SERVICE_PERMISSIONS),
    ),
}

# Workbook dates are retained as Excel serials and converted once.  This keeps
# the source values readable while avoiding an Excel runtime dependency.
EXCEL_EPOCH = date(1899, 12, 30)
EMPLOYEES = (
    # number, first, last, phone, birth serial, gender, hire serial, role
    ("EMP-000101", "Kwame", "Mensah", "+233201000000", 30317, "MALE", 44562, "INSTITUTION_ADMIN"),
    ("EMP-000102", "Ama", "Owusu", "+233201000001", 30714, "FEMALE", 45018, "HR_ADMIN"),
    ("EMP-000103", "Kofi", "Boateng", "+233201000002", 31109, "MALE", 45476, "EMPLOYEE"),
    ("EMP-000104", "Abena", "Asare", "+233201000003", 31506, "FEMALE", 45934, "RECRUITMENT_OFFICER"),
    ("EMP-000105", "Yaw", "Osei", "+233201000004", 31902, "MALE", 44566, "FINANCE_MANAGER"),
    ("EMP-000106", "Akosua", "Acheampong", "+233201000005", 32300, "FEMALE", 45022, "ACCOUNTANT"),
    ("EMP-000107", "Kojo", "Addo", "+233201000006", 32696, "MALE", 45480, "PAYROLL_OFFICER"),
    ("EMP-000108", "Efua", "Agyeman", "+233201000007", 33093, "FEMALE", 45938, "DEPARTMENT_HEAD"),
    ("EMP-000109", "Nana", "Nyarko", "+233201000008", 33490, "MALE", 44570, "EMPLOYEE"),
    ("EMP-000110", "Adwoa", "Amankwah", "+233201000009", 33887, "FEMALE", 45026, "EMPLOYEE"),
    ("EMP-000111", "Fiifi", "Tetteh", "+233201000010", 34284, "MALE", 45484, "EMPLOYEE"),
    ("EMP-000112", "Esi", "Quaye", "+233201000011", 34680, "FEMALE", 45942, "DEPARTMENT_HEAD"),
    ("EMP-000113", "Sena", "Arthur", "+233201000012", 34712, "MALE", 44574, "EMPLOYEE"),
    ("EMP-000114", "Mabel", "Boadu", "+233201000013", 35109, "FEMALE", 45030, "EMPLOYEE"),
    ("EMP-000115", "Richmond", "Darko", "+233201000014", 35504, "MALE", 45488, "SHIFT_SUPERVISOR"),
    ("EMP-000116", "Priscilla", "Amoako", "+233201000015", 35901, "FEMALE", 45946, "EMPLOYEE"),
    ("EMP-000117", "Kelvin", "Annan", "+233201000016", 30453, "MALE", 44578, "EMPLOYEE"),
    ("EMP-000118", "Vida", "Gyamfi", "+233201000017", 30851, "FEMALE", 45034, "DEPARTMENT_HEAD"),
    ("EMP-000119", "Elvis", "Frimpong", "+233201000018", 31247, "MALE", 45492, "EMPLOYEE"),
    ("EMP-000120", "Belinda", "Sarpong", "+233201000019", 31644, "FEMALE", 45950, "EMPLOYEE"),
    ("EMP-000121", "Eric", "Adjei", "+233201000020", 32041, "MALE", 44581, "EMPLOYEE"),
    ("EMP-000122", "Doreen", "Baah", "+233201000021", 32438, "FEMALE", 45036, "EMPLOYEE"),
    ("EMP-000123", "Daniel", "Danso", "+233201000022", 32835, "MALE", 45493, "EMPLOYEE"),
    ("EMP-000124", "Sandra", "Appiah", "+233201000023", 33231, "FEMALE", 45950, "AUDITOR"),
    ("EMP-000125", "Michael", "Kwarteng", "+233201000024", 33263, "MALE", 44581, "EMPLOYEE"),
    ("EMP-000126", "Patricia", "Marfo", "+233201000025", 33660, "FEMALE", 45036, "EMPLOYEE"),
    ("EMP-000127", "Joseph", "Ansah", "+233201000026", 34055, "MALE", 45493, "EMPLOYEE"),
    ("EMP-000128", "Rebecca", "Opoku", "+233201000027", 34425, "FEMALE", 45931, "EMPLOYEE"),
    ("EMP-000129", "Samuel", "Antwi", "+233201000028", 34821, "MALE", 44563, "EMPLOYEE"),
    ("EMP-000130", "Linda", "Bonsu", "+233201000029", 35219, "FEMALE", 45019, "EMPLOYEE"),
)

# Department code -> employee number of its head (Department.head).
DEPARTMENT_HEADS = {
    "DPT-001": "EMP-000101",
    "DPT-002": "EMP-000102",
    "DPT-003": "EMP-000105",
    "DPT-004": "EMP-000108",
    "DPT-005": "EMP-000112",
    "DPT-006": "EMP-000118",
}

EMPLOYMENT_ASSIGNMENTS = (
    # employee, department, position, grade, location, manager, type, category, start serial
    ("EMP-000101", "DPT-001", "POS-001", "GRD-01", "LOC-ACC-HQ", None, "PERMANENT", "SENIOR", 44562),
    ("EMP-000102", "DPT-002", "POS-002", "GRD-02", "LOC-ACC-HQ", "EMP-000101", "PERMANENT", "SENIOR", 45018),
    ("EMP-000103", "DPT-002", "POS-003", "GRD-03", "LOC-ACC-HQ", "EMP-000102", "PERMANENT", "SENIOR", 45476),
    ("EMP-000104", "DPT-002", "POS-004", "GRD-03", "LOC-ACC-HQ", "EMP-000102", "PERMANENT", "SENIOR", 45934),
    ("EMP-000105", "DPT-003", "POS-005", "GRD-02", "LOC-ACC-HQ", "EMP-000101", "PERMANENT", "SENIOR", 44566),
    ("EMP-000106", "DPT-003", "POS-006", "GRD-03", "LOC-ACC-HQ", "EMP-000105", "PERMANENT", "SENIOR", 45022),
    ("EMP-000107", "DPT-003", "POS-007", "GRD-03", "LOC-ACC-HQ", "EMP-000105", "PERMANENT", "SENIOR", 45480),
    ("EMP-000108", "DPT-004", "POS-008", "GRD-02", "LOC-ACC-HQ", "EMP-000101", "PERMANENT", "SENIOR", 45938),
    ("EMP-000109", "DPT-004", "POS-009", "GRD-03", "LOC-REMOTE", "EMP-000108", "PERMANENT", "SENIOR", 44570),
    ("EMP-000110", "DPT-004", "POS-009", "GRD-04", "LOC-REMOTE", "EMP-000108", "PERMANENT", "SENIOR", 45026),
    ("EMP-000111", "DPT-004", "POS-010", "GRD-03", "LOC-ACC-HQ", "EMP-000108", "PERMANENT", "SENIOR", 45484),
    ("EMP-000112", "DPT-005", "POS-011", "GRD-02", "LOC-TEM-01", "EMP-000101", "PERMANENT", "SENIOR", 45942),
    ("EMP-000113", "DPT-005", "POS-012", "GRD-04", "LOC-TEM-01", "EMP-000112", "PERMANENT", "JUNIOR", 44574),
    ("EMP-000114", "DPT-005", "POS-012", "GRD-04", "LOC-TEM-01", "EMP-000112", "PERMANENT", "JUNIOR", 45030),
    ("EMP-000115", "DPT-005", "POS-013", "GRD-03", "LOC-TEM-01", "EMP-000112", "PERMANENT", "SENIOR", 45488),
    ("EMP-000116", "DPT-005", "POS-012", "GRD-05", "LOC-TEM-01", "EMP-000112", "CONTRACT", "JUNIOR", 45946),
    ("EMP-000117", "DPT-005", "POS-012", "GRD-05", "LOC-TEM-01", "EMP-000112", "CONTRACT", "JUNIOR", 44578),
    ("EMP-000118", "DPT-006", "POS-014", "GRD-02", "LOC-ACC-HQ", "EMP-000101", "PERMANENT", "SENIOR", 45034),
    ("EMP-000119", "DPT-006", "POS-015", "GRD-04", "LOC-ACC-HQ", "EMP-000118", "PERMANENT", "JUNIOR", 45492),
    ("EMP-000120", "DPT-006", "POS-015", "GRD-04", "LOC-ACC-HQ", "EMP-000118", "PERMANENT", "JUNIOR", 45950),
    ("EMP-000121", "DPT-006", "POS-016", "GRD-04", "LOC-ACC-HQ", "EMP-000118", "PERMANENT", "JUNIOR", 44581),
    ("EMP-000122", "DPT-002", "POS-003", "GRD-04", "LOC-ACC-HQ", "EMP-000102", "TEMPORARY", "JUNIOR", 45036),
    ("EMP-000123", "DPT-004", "POS-009", "GRD-04", "LOC-REMOTE", "EMP-000108", "CONTRACT", "SENIOR", 45493),
    ("EMP-000124", "DPT-003", "POS-006", "GRD-04", "LOC-ACC-HQ", "EMP-000105", "PERMANENT", "SENIOR", 45950),
    ("EMP-000125", "DPT-005", "POS-012", "GRD-05", "LOC-TEM-01", "EMP-000112", "CASUAL", "JUNIOR", 44581),
    ("EMP-000126", "DPT-006", "POS-015", "GRD-05", "LOC-ACC-HQ", "EMP-000118", "INTERN", "JUNIOR", 45036),
    ("EMP-000127", "DPT-004", "POS-009", "GRD-05", "LOC-REMOTE", "EMP-000108", "INTERN", "JUNIOR", 45493),
    ("EMP-000128", "DPT-005", "POS-012", "GRD-05", "LOC-TEM-01", "EMP-000112", "TEMPORARY", "JUNIOR", 45931),
    ("EMP-000129", "DPT-002", "POS-003", "GRD-04", "LOC-ACC-HQ", "EMP-000102", "PERMANENT", "SENIOR", 44563),
    ("EMP-000130", "DPT-006", "POS-015", "GRD-04", "LOC-ACC-HQ", "EMP-000118", "PERMANENT", "JUNIOR", 45019),
)

COMPENSATION_AMOUNTS = (
    "18000", "12000", "7500", "7200", "14000", "9000", "8500", "13500", "10000", "8200",
    "8800", "12500", "6000", "5900", "7800", "4800", "4700", "11500", "6500", "6400",
    "6200", "5200", "7600", "7000", "3900", "2500", "2800", "4300", "6800", "6100",
)


class Command(BaseCommand):
    help = "Seed the isolated, idempotent CSA-DEMO foundation for the integrated ErgonX demo."

    def add_arguments(self, parser):
        parser.add_argument("--password", default=DEFAULT_DEMO_PASSWORD, help="Development-only password for newly created demo accounts.")
        parser.add_argument(
            "--reset-passwords",
            action="store_true",
            help="Development-only: reset passwords for the synthetic CSA-DEMO users to --password.",
        )
        parser.add_argument("--validate-only", action="store_true", help="Validate the current CSA-DEMO foundation without writing data.")

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_ergonx_demo is development-only and refuses to run when DEBUG=False.")

        if options["validate_only"]:
            self._validate_existing()
            self.stdout.write(self.style.SUCCESS("CSA-DEMO integrated dataset validation passed without mutation."))
            return

        with transaction.atomic():
            result = self._seed_foundation(
                options["password"], reset_passwords=options["reset_passwords"]
            )

        self.stdout.write(self.style.SUCCESS("ErgonX integrated demo dataset is ready."))
        self.stdout.write(f"Institution: {result['institution'].code}")
        self.stdout.write(f"Modules enabled: {result['module_count']}")
        self.stdout.write(f"Organization: {result['department_count']} departments, {result['position_count']} positions")
        self.stdout.write("Workflow and financial scenarios, including a posted payroll journal, are ready.")

    def _validate_existing(self):
        institution = Institution.objects.filter(code=DEMO_INSTITUTION_CODE).first()
        if institution is None:
            raise CommandError("CSA-DEMO does not exist; validation cannot create it.")
        if institution.name != "Cyber Security Authority" or institution.country_code != "GH" or institution.default_currency != "GHS":
            raise CommandError("CSA-DEMO institution profile has drifted; use the normal seed only after reviewing the demo tenant.")
        if institution.modules.filter(module_code__in=MODULE_CODES, is_enabled=True).count() != len(MODULE_CODES):
            raise CommandError("CSA-DEMO module baseline is incomplete.")
        if not InstitutionMembership.objects.filter(institution=institution, user__email=DEMO_ADMIN_EMAIL, role__code="INSTITUTION_ADMIN", status=InstitutionMembership.Status.ACTIVE).exists():
            raise CommandError("CSA-DEMO requires its active institution-admin seed membership.")
        if not InstitutionMembership.objects.filter(institution=institution, user__email=DEMO_DIRECTOR_EMAIL, role__code="DIRECTOR", status=InstitutionMembership.Status.ACTIVE).exists():
            raise CommandError("CSA-DEMO requires its active Director setup-owner membership.")
        self._validate_organization(institution)
        if institution.employees.count() != len(EMPLOYEES):
            raise CommandError("CSA-DEMO employee baseline is incomplete.")
        required_job_codes = {"JOB-2026-00018", "JOB-2026-00019", "JOB-2026-00020"}
        required_candidate_emails = {
            "amina.bello@csa.test",
            "david.asamoah@csa.test",
            "grace.nartey@csa.test",
            "ibrahim.sule@csa.test",
            "lydia.mensima@csa.test",
            "mark.ofori@csa.test",
            "linda.bonsu.candidate@csa.test",
            "rita.adu@csa.test",
        }
        seeded_job_codes = set(
            institution.job_postings.filter(code__in=required_job_codes).values_list(
                "code", flat=True
            )
        )
        seeded_candidate_emails = set(
            institution.candidates.filter(
                email__in=required_candidate_emails
            ).values_list("email", flat=True)
        )
        # The rolling activity seed intentionally adds historical candidates.
        # Verify the fixed recruitment fixtures by their stable identities
        # instead of rejecting those additional, dashboard-supporting records.
        if seeded_job_codes != required_job_codes or seeded_candidate_emails != required_candidate_emails:
            raise CommandError("CSA-DEMO recruitment baseline is incomplete.")
        required_leave_references = {
            "LR-2026-00041",
            "LR-2026-00042",
            "LR-2026-00043",
            "LR-2026-00044",
        }
        seeded_leave_references = set(
            institution.leave_requests.filter(
                reason__in=required_leave_references
            ).values_list("reason", flat=True)
        )
        # Rolling activity adds operational leave requests for dashboard data.
        # The fixed seed is complete when its named scenarios remain present.
        if seeded_leave_references != required_leave_references:
            raise CommandError("CSA-DEMO leave baseline is incomplete.")
        if institution.schedule_assignments.filter(is_current=True).count() != len(EMPLOYEES):
            raise CommandError("CSA-DEMO current schedule-assignment baseline is incomplete.")
        if not institution.overtime_records.filter(
            employee__employee_number="EMP-000113",
            attendance_record__attendance_date=date(2026, 9, 12),
        ).exists():
            raise CommandError("CSA-DEMO overtime baseline is incomplete.")
        run = institution.payroll_runs.filter(
            payroll_period__start_date=date(2026, 9, 1),
            payroll_period__end_date=date(2026, 9, 30),
        ).first()
        if run is None or run.status != PayrollRun.Status.FINALIZED or run.records.count() != len(EMPLOYEES):
            raise CommandError("CSA-DEMO finalized September payroll baseline is incomplete.")
        journal = run.accounting_journal_entry if run else None
        if journal is None or journal.status != journal.Status.POSTED:
            raise CommandError("CSA-DEMO payroll journal is missing or not posted.")
        if journal.lines.aggregate(debits=models.Sum("debit"))["debits"] != journal.lines.aggregate(credits=models.Sum("credit"))["credits"]:
            raise CommandError("CSA-DEMO payroll journal is not balanced.")
        if institution.vendor_bills.filter(bill_number="BILL-2026-000087", status=VendorBill.Status.PAID).count() != 1:
            raise CommandError("CSA-DEMO vendor-bill payment scenario is incomplete.")
        if institution.invoices.filter(invoice_number="INV-2026-000184", status=Invoice.Status.PART_PAID).count() != 1:
            raise CommandError("CSA-DEMO invoice receipt scenario is incomplete.")
        if institution.expenses.filter(description="EXP-2026-000112 Travel expense", status=Expense.Status.PENDING).count() != 1:
            raise CommandError("CSA-DEMO pending expense scenario is incomplete.")
        self._validate_home_activity(institution)
        self._validate_role_access(institution)

    def _validate_role_access(self, institution):
        policies = {
            "HR_ADMIN": {
                "required": {
                    "employee.view",
                    "leave.view",
                    "attendance.view",
                    "payroll.view",
                    "candidate.view",
                },
                "forbidden": {"account.view"},
            },
            "FINANCE_MANAGER": {
                "required": {
                    "account.view",
                    "journal.view",
                    "payroll.view",
                    "payroll.approve",
                    "payroll.finalize",
                },
                "forbidden": {"employee.view", "candidate.view"},
            },
            "ACCOUNTANT": {
                "required": {
                    "account.view",
                    "journal.view",
                    "payroll.view",
                    "payroll.prepare",
                },
                "forbidden": {
                    "employee.view",
                    "candidate.view",
                    "payroll.approve",
                    "payroll.finalize",
                },
            },
            "INSTITUTION_ADMIN": {
                "required": {
                    "employee.view",
                    "leave.view",
                    "attendance.view",
                    "payroll.view",
                    "account.view",
                    "candidate.view",
                },
                "forbidden": set(),
            },
            "DEPARTMENT_HEAD": {
                "required": {"employee.view", "leave.approve", "attendance.view", "dashboard.department.view"},
                "forbidden": {"dashboard.hr.view", "payroll.view", "compensation.manage", "employee.update", "account.view"},
            },
            "EMPLOYEE": {
                "required": {"home.view", "leave.request", "attendance.view", "payslip.view"},
                "forbidden": {"account.view", "candidate.view"},
            },
        }
        for role_code, policy in policies.items():
            membership = institution.memberships.filter(
                role__code=role_code,
                status=InstitutionMembership.Status.ACTIVE,
            ).first()
            if membership is None:
                raise CommandError(f"CSA-DEMO requires an active {role_code} role scenario.")
            permissions = set(effective_permission_codes(membership))
            missing = sorted(policy["required"] - permissions)
            forbidden = sorted(policy["forbidden"] & permissions)
            if missing or forbidden:
                details = []
                if missing:
                    details.append(f"missing {', '.join(missing)}")
                if forbidden:
                    details.append(f"unexpected {', '.join(forbidden)}")
                raise CommandError(
                    f"CSA-DEMO {role_code} access policy has drifted: {'; '.join(details)}."
                )

    def _seed_foundation(self, password, *, reset_passwords=False):
        institution, _ = Institution.objects.update_or_create(
            code=DEMO_INSTITUTION_CODE,
            defaults={
                "name": "Cyber Security Authority",
                "email": DEMO_ADMIN_EMAIL,
                "country_code": "GH",
                "default_currency": "GHS",
                "timezone": "Africa/Accra",
                "is_active": True,
            },
        )
        bootstrap_institution(institution)
        admin = self._ensure_admin(password, reset_passwords=reset_passwords)
        admin_role = institution.roles.get(code="INSTITUTION_ADMIN")
        self._ensure_active_membership(user=admin, institution=institution, role=admin_role, is_primary=True)
        self._enable_modules(institution, admin)
        self._ensure_organization(institution)
        self._ensure_custom_roles(institution, admin)
        self._ensure_employees(
            institution, password, reset_passwords=reset_passwords
        )
        self._ensure_director(
            institution, password, reset_passwords=reset_passwords
        )
        self._ensure_compensation_and_payroll_profiles(institution, admin)
        self._ensure_recruitment(institution, admin)
        self._ensure_leave(institution, admin)
        self._ensure_attendance(institution, admin)
        self._ensure_payroll_run(institution, admin)
        self._ensure_accounting_foundation(institution, admin)
        self._ensure_accounting_operations(institution, admin)
        self._ensure_home_activity(institution, admin)
        self._validate_existing()
        return {
            "institution": institution,
            "module_count": len(MODULE_CODES),
            "department_count": len(ORGANIZATION["departments"]),
            "position_count": len(ORGANIZATION["positions"]),
        }

    def _ensure_home_activity(self, institution, admin):
        """Give the authorized demo personas real, resumable Home activity.

        These records point at data created by the deterministic seed; they do
        not introduce separate dashboard data or additional financial effects.
        The existence check makes reruns idempotent while retaining the first
        recorded timestamp for a stable demonstration history.
        """
        employee = institution.employees.get(employee_number="EMP-000102")
        candidate = institution.candidates.order_by("created_at").first()
        leave_request = institution.leave_requests.order_by("created_at").first()
        payroll_run = institution.payroll_runs.filter(
            status=PayrollRun.Status.FINALIZED
        ).select_related("accounting_journal_entry").first()
        journal = payroll_run.accounting_journal_entry if payroll_run else None
        recruiter = institution.employees.get(employee_number="EMP-000104").user
        requester = leave_request.employee.user if leave_request else None

        # Earlier seed revisions labelled the posted payroll journal as a
        # manual journal creation. Remove only that known synthetic event;
        # CSA-DEMO has no manual journal scenario using this entity.
        if journal is not None:
            UserActivityEvent.objects.filter(
                institution=institution,
                user=admin,
                activity_code="journal.create",
                entity_id=journal.id,
            ).delete()

        activities = (
            (admin, "employee.create", employee),
            (recruiter, "candidate.create", candidate),
            (requester, "leave.request", leave_request),
            (admin, "journal.approve", journal),
        )
        for actor, activity_code, entity in activities:
            if actor is None or entity is None:
                raise CommandError(
                    f"CSA-DEMO cannot seed Home activity {activity_code}; its source record is missing."
                )
            if UserActivityEvent.objects.filter(
                institution=institution,
                user=actor,
                activity_code=activity_code,
                entity_id=entity.id,
            ).exists():
                continue
            record_user_activity(
                actor=actor,
                institution=institution,
                activity_code=activity_code,
                entity=entity,
            )

    def _validate_home_activity(self, institution):
        """Verify that seeded Home records retain both tenant and entity scope."""
        candidate = institution.candidates.order_by("created_at").first()
        leave_request = institution.leave_requests.order_by("created_at").first()
        payroll_run = institution.payroll_runs.filter(
            status=PayrollRun.Status.FINALIZED
        ).select_related("accounting_journal_entry").first()
        required = {
            "employee.create": institution.employees.get(employee_number="EMP-000102").id,
            "candidate.create": candidate.id if candidate else None,
            "leave.request": leave_request.id if leave_request else None,
            "journal.approve": payroll_run.accounting_journal_entry_id if payroll_run else None,
        }
        for activity_code, entity_id in required.items():
            if not entity_id or not UserActivityEvent.objects.filter(
                institution=institution,
                activity_code=activity_code,
                entity_id=entity_id,
            ).exists():
                raise CommandError(
                    f"CSA-DEMO Home activity baseline is missing {activity_code}."
                )

    def _ensure_compensation_and_payroll_profiles(self, institution, admin):
        preset = PayrollPresetVersion.objects.select_related("payroll_preset").get(
            payroll_preset__code="GH-PAYROLL",
            version_code="GH-2026.1",
            status=PayrollPresetVersion.Status.ACTIVE,
        )
        configuration = getattr(institution, "payroll_configuration", None)
        if not (
            configuration
            and configuration.country_code == "GH"
            and configuration.currency == "GHS"
            and configuration.payroll_frequency == InstitutionPayrollConfiguration.Frequency.MONTHLY
            and configuration.payroll_setup_mode == InstitutionPayrollConfiguration.SetupMode.PRESET
            and configuration.selected_payroll_preset_version_id == preset.id
            and configuration.is_configured
        ):
            configure_payroll(
                institution=institution,
                actor=admin,
                country_code="GH",
                currency="GHS",
                payroll_frequency=InstitutionPayrollConfiguration.Frequency.MONTHLY,
                payroll_setup_mode=InstitutionPayrollConfiguration.SetupMode.PRESET,
                selected_payroll_preset_version=preset,
            )

        structure, _ = SalaryStructure.objects.get_or_create(
            institution=institution,
            code="APEX-MONTHLY",
            defaults={"name": "Apex Monthly Salary", "description": "Base monthly compensation for the integrated demo.", "is_active": True},
        )
        if not structure.is_active:
            raise CommandError("APEX-MONTHLY salary structure is inactive; refusing to seed compensation.")
        effective_from = date(2026, 1, 1)
        for person, amount in zip(EMPLOYEES, COMPENSATION_AMOUNTS, strict=True):
            number = person[0]
            employee = institution.employees.get(employee_number=number)
            compensation = EmployeeCompensation.objects.filter(employee=employee, is_current=True).first()
            salary = Decimal(amount)
            if compensation is None:
                change_current_compensation(
                    institution=institution,
                    employee=employee,
                    salary_structure=structure,
                    base_salary=salary,
                    currency="GHS",
                    effective_from=effective_from,
                    actor=admin,
                )
            elif (
                compensation.salary_structure_id != structure.id
                or compensation.base_salary != salary
                or compensation.currency != "GHS"
                or compensation.effective_from != effective_from
            ):
                raise CommandError(f"Current compensation for {number} has drifted; refusing to rewrite effective-dated history.")

            residency = (
                EmployeePayrollProfile.TaxResidency.NON_RESIDENT
                if number == "EMP-000123"
                else EmployeePayrollProfile.TaxResidency.RESIDENT
            )
            profile = EmployeePayrollProfile.objects.filter(employee=employee).first()
            expected_tin = f"TIN-DEMO-{1000 + int(number[-3:]) - 101}"
            if profile is None:
                configure_employee_payroll_profile(
                    institution=institution,
                    employee=employee,
                    actor=admin,
                    tax_residency=residency,
                    tax_identification_number=expected_tin,
                )
            elif profile.tax_residency != residency or profile.tax_identification_number != expected_tin:
                raise CommandError(f"Payroll profile for {number} has drifted; refusing to rewrite it.")

        module = institution.modules.get(module_code=InstitutionModule.ModuleCode.PAYROLL)
        if module.configuration_status != InstitutionModule.ConfigurationStatus.READY:
            module.configuration_status = InstitutionModule.ConfigurationStatus.READY
            module.save(update_fields=("configuration_status", "updated_at"))

    def _ensure_recruitment(self, institution, admin):
        stages = {}
        for sequence, name in enumerate(("Applied", "Screening", "Shortlisted", "Interview", "Final Review", "Offer"), start=1):
            stage, _ = RecruitmentStage.objects.get_or_create(
                institution=institution, sequence=sequence,
                defaults={"name": name, "is_active": True},
            )
            if stage.name != name or not stage.is_active:
                raise CommandError(f"Recruitment stage {sequence} has drifted.")
            stages[name] = stage
        assignments = (
            ("JOB-2026-00018", "Senior Software Engineer", "DPT-004", "POS-009", "LOC-REMOTE"),
            ("JOB-2026-00019", "Finance Analyst", "DPT-003", "POS-006", "LOC-ACC-HQ"),
            ("JOB-2026-00020", "Operations Assistant", "DPT-005", "POS-012", "LOC-TEM-01"),
        )
        postings = {}
        for code, title, department_code, position_code, location_code in assignments:
            posting, _ = JobPosting.objects.get_or_create(
                institution=institution, code=code,
                defaults={"title": title, "department": institution.departments.get(code=department_code), "position": institution.positions.get(code=position_code), "location": institution.locations.get(code=location_code), "hiring_manager": admin, "employment_type": "PERMANENT", "description": "CSA-DEMO recruitment scenario."},
            )
            if posting.status == JobPosting.Status.DRAFT:
                # Demo history: the requisition was approved before publishing (BQ-06 removed
                # the draft shortcut).
                JobPosting.objects.filter(pk=posting.pk).update(status=JobPosting.Status.APPROVED, approved_by=admin, approved_at=timezone.now())
                posting.refresh_from_db()
                publish_job_posting(job_posting=posting, actor=admin)
            postings[code] = posting

        scenario_rows = (
            ("APP-2026-00121", "Amina", "Bello", "amina.bello@csa.test", "JOB-2026-00018", "Screening", "ACTIVE"),
            ("APP-2026-00122", "David", "Asamoah", "david.asamoah@csa.test", "JOB-2026-00019", "Shortlisted", "ACTIVE"),
            ("APP-2026-00123", "Grace", "Nartey", "grace.nartey@csa.test", "JOB-2026-00018", "Interview", "ACTIVE"),
            ("APP-2026-00124", "Ibrahim", "Sule", "ibrahim.sule@csa.test", "JOB-2026-00020", "Final Review", "ACTIVE"),
            ("APP-2026-00125", "Lydia", "Mensima", "lydia.mensima@csa.test", "JOB-2026-00019", "Offer", "OFFERED"),
            ("APP-2026-00126", "Mark", "Ofori", "mark.ofori@csa.test", "JOB-2026-00020", "Applied", "REJECTED"),
            ("APP-2026-00127", "Linda", "Bonsu", "linda.bonsu.candidate@csa.test", "JOB-2026-00018", "Offer", "HIRED"),
            ("APP-2026-00128", "Rita", "Adu", "rita.adu@csa.test", "JOB-2026-00018", "Applied", "ACTIVE"),
        )
        applications = {}
        for reference, first_name, last_name, email, job_code, stage_name, target_status in scenario_rows:
            candidate, _ = Candidate.objects.get_or_create(institution=institution, email=email, defaults={"first_name": first_name, "last_name": last_name, "source": "CSA-DEMO"})
            application, _ = Application.objects.get_or_create(institution=institution, job_posting=postings[job_code], candidate=candidate, defaults={"notes": reference})
            if application.status == Application.Status.DRAFT:
                application = submit_application(application=application, actor=admin)
            if application.status == Application.Status.ACTIVE and application.current_stage_id != stages[stage_name].id:
                move_application_stage(application=application, stage=stages[stage_name], actor=admin, comment=reference)
            if target_status == "REJECTED" and application.status != Application.Status.REJECTED:
                reject_application(application=application, actor=admin, reason="CSA-DEMO scenario")
            applications[reference] = application
            if not candidate.location and not candidate.current_title:
                # Application profile shown on Candidate detail, only while blank.
                index = len(applications)
                candidate.location = ("Accra, Ghana", "Kumasi, Ghana", "Tema, Ghana", "Takoradi, Ghana")[index % 4]
                candidate.employment_status = Candidate.EmploymentStatus.EMPLOYED if index % 3 else Candidate.EmploymentStatus.UNEMPLOYED
                candidate.current_title = postings[job_code].title if index % 3 else ""
                candidate.current_employer = "CSA-DEMO previous employer" if index % 3 else ""
                candidate.years_experience = 2 + index % 7
                candidate.highest_qualification = (Candidate.Qualification.BACHELORS, Candidate.Qualification.MASTERS, Candidate.Qualification.PROFESSIONAL)[index % 3]
                candidate.field_of_study = "Business Administration"
                candidate.education_institution = "University of Ghana"
                candidate.notice_period_weeks = 4
                candidate.save()

        for reference in ("APP-2026-00123", "APP-2026-00124", "APP-2026-00125", "APP-2026-00127"):
            application = applications[reference]
            interview, _ = Interview.objects.get_or_create(institution=institution, application=application, notes=reference, defaults={"scheduled_at": timezone.now(), "duration_minutes": 60, "interview_type": "Panel", "location_or_link": "CSA-DEMO", "interviewer": admin})
            if interview.status == Interview.Status.SCHEDULED:
                update_interview_status(interview=interview, actor=admin, status=Interview.Status.COMPLETED)

        structure = institution.salary_structures.get(code="APEX-MONTHLY")
        for reference, employee_number, accepted in (("APP-2026-00125", None, False), ("APP-2026-00127", "EMP-000130", True)):
            application = applications[reference]
            offer, _ = Offer.objects.get_or_create(
                institution=institution, application=application,
                defaults={"proposed_start_date": date(2026, 1, 1), "employment_type": "PERMANENT", "department": application.job_posting.department, "position": application.job_posting.position, "grade": institution.grades.get(code="GRD-04"), "location": application.job_posting.location, "staff_category": "JUNIOR", "salary_structure": structure, "base_salary": Decimal("6100"), "currency": "GHS", "terms": reference},
            )
            if offer.status == Offer.Status.DRAFT:
                offer = extend_offer(offer=offer, actor=admin)
            if accepted and offer.status == Offer.Status.EXTENDED:
                offer = decide_offer(offer=offer, actor=admin, accepted=True)
            if accepted and offer.status == Offer.Status.ACCEPTED:
                hire_candidate(offer=offer, actor=admin, existing_employee=institution.employees.get(employee_number=employee_number))

    def _ensure_leave(self, institution, admin):
        annual, _ = LeaveType.objects.get_or_create(
            institution=institution, code="ANNUAL",
            defaults={"name": "Annual Leave", "is_paid": True, "requires_approval": True, "is_active": True},
        )
        sick, _ = LeaveType.objects.get_or_create(
            institution=institution, code="SICK",
            defaults={"name": "Sick Leave", "is_paid": True, "requires_approval": True, "is_active": True},
        )
        policies = ((annual, "APEX Annual Leave", Decimal("20")), (sick, "APEX Sick Leave", Decimal("10")))
        for leave_type, name, entitlement in policies:
            policy = LeavePolicy.objects.filter(institution=institution, leave_type=leave_type, name=name).first()
            if policy is None:
                configure_policy(
                    institution=institution,
                    leave_type=leave_type,
                    name=name,
                    annual_entitlement=entitlement,
                    accrual_method=LeavePolicy.AccrualMethod.ANNUAL,
                    accrual_rate=Decimal("0"),
                    max_carry_forward=Decimal("0"),
                    min_service_days=0,
                    allow_negative_balance=False,
                    effective_from=date(2026, 1, 1),
                    is_active=True,
                )

        requests = (
            ("LR-2026-00041", "EMP-000109", annual, date(2026, 9, 21), date(2026, 9, 23), Decimal("3"), "PENDING"),
            ("LR-2026-00042", "EMP-000119", annual, date(2026, 9, 14), date(2026, 9, 15), Decimal("2"), "APPROVED"),
            ("LR-2026-00043", "EMP-000113", sick, date(2026, 9, 10), date(2026, 9, 11), Decimal("2"), "APPROVED"),
            ("LR-2026-00044", "EMP-000103", annual, date(2026, 10, 5), date(2026, 10, 9), Decimal("5"), "DRAFT"),
        )
        for reference, employee_number, leave_type, start_date, end_date, days, target_status in requests:
            employee = institution.employees.get(employee_number=employee_number)
            request = LeaveRequest.objects.filter(institution=institution, employee=employee, reason=reference).first()
            if request is None:
                request = create_leave_request(
                    institution=institution,
                    actor=employee.user,
                    employee=employee,
                    leave_type=leave_type,
                    start_date=start_date,
                    end_date=end_date,
                    requested_days=days,
                    reason=reference,
                )
            if target_status in {"PENDING", "APPROVED"} and request.status == LeaveRequest.Status.DRAFT:
                request = submit_leave_request(leave_request=request, actor=employee.user)
            if target_status == "APPROVED" and request.status == LeaveRequest.Status.PENDING:
                for approval in request.approvals.filter(status="PENDING").order_by("sequence"):
                    request = approve_leave_request(leave_request=request, actor=approval.approver, comment="CSA-DEMO approval")
            if request.status != target_status:
                # Leave requests are operational workflow records. A user may
                # have legitimately progressed a seeded scenario after the
                # initial demo load; preserve that history instead of making
                # an idempotent rerun fail or silently resetting it.
                self.stdout.write(
                    self.style.WARNING(
                        f"Preserving progressed leave scenario {reference}: "
                        f"{request.status} (fixture baseline: {target_status})."
                    )
                )

    def _ensure_attendance(self, institution, admin):
        def shift(code, name, start, end, overnight=False):
            return Shift.objects.get_or_create(
                institution=institution, code=code,
                defaults={"name": name, "start_time": start, "end_time": end, "crosses_midnight": overnight, "break_minutes": 30, "grace_period_minutes": 5, "is_active": True},
            )[0]

        hq_shift = shift("SH-HQ", "HQ Standard", time(8, 30), time(17, 0))
        day_shift = shift("SH-TEMA-DAY", "Tema Day Shift", time(6, 0), time(14, 0))
        night_shift = shift("SH-TEMA-NIGHT", "Tema Night Shift", time(22, 0), time(6, 0), True)
        patterns = {}
        for code, name, selected_shift in (("PAT-TEMA-DAY", "Tema Day Pattern", day_shift), ("PAT-TEMA-NIGHT", "Tema Night Pattern", night_shift)):
            pattern, _ = ShiftPattern.objects.get_or_create(institution=institution, code=code, defaults={"name": name, "cycle_length_days": 1, "is_active": True})
            ShiftPatternDay.objects.get_or_create(institution=institution, shift_pattern=pattern, day_index=0, defaults={"shift": selected_shift, "is_off_day": False})
            patterns[code] = pattern
        flexible, _ = FlexibleWorkRule.objects.get_or_create(
            institution=institution, name="IT Hybrid Flexible",
            defaults={"earliest_start": time(9, 0), "latest_start": time(9, 30), "earliest_end": time(17, 0), "latest_end": time(17, 30), "required_minutes": 480, "core_start": time(10, 0), "core_end": time(16, 0), "is_active": True},
        )
        schedule_specs = (
            ("SCH-000021", "HQ Standard", WorkSchedule.ScheduleType.FIXED, {"fixed_shift": hq_shift}),
            ("SCH-000022", "Tema Day Shift", WorkSchedule.ScheduleType.SHIFT_PATTERN, {"shift_pattern": patterns["PAT-TEMA-DAY"]}),
            ("SCH-000023", "Tema Night Shift", WorkSchedule.ScheduleType.SHIFT_PATTERN, {"shift_pattern": patterns["PAT-TEMA-NIGHT"]}),
            ("SCH-000024", "IT Hybrid Flexible", WorkSchedule.ScheduleType.FLEXIBLE, {"flexible_rule": flexible}),
        )
        schedules = {}
        for code, name, schedule_type, configuration in schedule_specs:
            schedule, _ = WorkSchedule.objects.get_or_create(institution=institution, code=code, defaults={"name": name, "schedule_type": schedule_type, "effective_from": date(2026, 1, 1), "timezone": "Africa/Accra", "is_active": True, **configuration})
            schedules[code] = schedule
        for employee in institution.employees.all():
            employment = employee.employments.get(is_current=True)
            code = "SCH-000021"
            if employment.department.code == "DPT-005":
                code = "SCH-000023" if employee.employee_number == "EMP-000115" else "SCH-000022"
            elif employment.department.code == "DPT-004" and employment.location.is_remote:
                code = "SCH-000024"
            if not ScheduleAssignment.objects.filter(employee=employee, is_current=True).exists():
                create_schedule_assignment(institution=institution, employee=employee, work_schedule=schedules[code], effective_from=date(2026, 1, 1), is_current=True, assigned_by=admin)

        zone = timezone.get_current_timezone()
        def stamp(day, hour, minute=0):
            return timezone.make_aware(datetime.combine(day, time(hour, minute)), zone)
        def worked(employee_number, day, start_hour, start_minute, end_hour, end_minute=0):
            employee = institution.employees.get(employee_number=employee_number)
            record = AttendanceRecord.objects.filter(employee=employee, attendance_date=day).first()
            if record is None:
                record = clock_in(employee=employee, actor=admin, at=stamp(day, start_hour, start_minute))
                end_day = day + timedelta(days=1) if (end_hour, end_minute) <= (start_hour, start_minute) else day
                record = clock_out(attendance_record=record, actor=admin, at=stamp(end_day, end_hour, end_minute))
            return record
        record_113 = worked("EMP-000113", date(2026, 9, 12), 6, 0, 18, 0)
        worked("EMP-000114", date(2026, 9, 13), 6, 30, 17, 30)
        worked("EMP-000115", date(2026, 9, 12), 22, 0, 6, 0)
        employee_119 = institution.employees.get(employee_number="EMP-000119")
        if not AttendanceRecord.objects.filter(employee=employee_119, attendance_date=date(2026, 9, 14)).exists():
            classify_attendance_date(employee=employee_119, attendance_date=date(2026, 9, 14), actor=admin)
        OvertimeRecord.objects.get_or_create(
            attendance_record=record_113,
            defaults={"institution": institution, "employee": record_113.employee, "calculated_minutes": 240, "approved_minutes": 0, "status": OvertimeRecord.Status.PENDING},
        )

    def _ensure_payroll_run(self, institution, admin):
        # The 12 September overtime (EMP-000113) is paid through payroll adjustment
        # PADJ-2026-00011 below, so the attendance overtime row stays undecided:
        # approving it as well would pay it twice, and approved attendance cannot
        # change once September payroll is finalized (LC-ATT-01).
        period, _ = PayrollPeriod.objects.get_or_create(
            institution=institution, start_date=date(2026, 9, 1), end_date=date(2026, 9, 30),
            defaults={"name": "September 2026", "pay_date": date(2026, 9, 30), "status": PayrollPeriod.Status.OPEN},
        )
        component, _ = PayComponent.objects.get_or_create(
            institution=institution, code="APEX-OVERTIME",
            defaults={"name": "Apex approved overtime", "component_type": PayComponent.ComponentType.EARNING, "calculation_type": PayComponent.CalculationType.FIXED, "taxable": True, "pensionable": False, "cash_or_kind": PayComponent.CashOrKind.CASH, "recurring": False, "is_active": True},
        )
        for employee_number, amount, reason, approve in (("EMP-000113", Decimal("480"), "PADJ-2026-00011 approved overtime", True), ("EMP-000119", Decimal("500"), "PADJ-2026-00013 pending bonus", False)):
            employee = institution.employees.get(employee_number=employee_number)
            adjustment = PayrollAdjustment.objects.filter(institution=institution, employee=employee, payroll_period=period, reason=reason).first()
            if adjustment is None:
                adjustment = create_payroll_adjustment(institution=institution, actor=admin, employee=employee, payroll_period=period, pay_component=component, amount=amount, reason=reason)
            if adjustment.status == PayrollAdjustment.Status.DRAFT:
                adjustment = submit_payroll_adjustment(adjustment=adjustment, actor=admin)
            if approve and adjustment.status == PayrollAdjustment.Status.PENDING:
                decide_payroll_adjustment(adjustment=adjustment, actor=admin, approve=True)
        run = create_payroll_run(institution=institution, payroll_period=period, actor=admin, idempotency_key="apex-demo-2026-09-v1")
        if run.status == PayrollRun.Status.DRAFT:
            run = calculate_payroll_run(payroll_run=run, actor=admin)
        if run.status == PayrollRun.Status.CALCULATED:
            run = submit_payroll_run_for_review(payroll_run=run, actor=admin)
        if run.status == PayrollRun.Status.UNDER_REVIEW:
            # Preparer != approver (BQ-04): the Finance Manager approves.
            run = approve_payroll_run(payroll_run=run, actor=institution.memberships.select_related("user").get(role__code="FINANCE_MANAGER", status="ACTIVE").user)
        if run.status == PayrollRun.Status.APPROVED:
            run = finalize_payroll_run(payroll_run=run, actor=admin)

    def _ensure_accounting_foundation(self, institution, admin):
        version = AccountingPresetVersion.objects.select_related("accounting_preset").get(
            accounting_preset__code="GH-COMMERCIAL", version_code="GH-COMMERCIAL-2026.1", status=AccountingPresetVersion.Status.ACTIVE
        )
        configuration = getattr(institution, "accounting_configuration", None)
        if configuration is None:
            apply_accounting_preset(institution=institution, actor=admin, preset_version=version, base_currency="GHS", fiscal_year_start_month=1)
        elif configuration.selected_accounting_preset_version_id != version.id:
            raise CommandError("CSA-DEMO accounting preset has drifted; refusing to migrate its financial configuration.")
        fiscal_year, _ = FiscalYear.objects.get_or_create(
            institution=institution, name="FY2026",
            defaults={"start_date": date(2026, 1, 1), "end_date": date(2026, 12, 31)},
        )
        period, _ = AccountingPeriod.objects.get_or_create(
            institution=institution, name="September 2026",
            defaults={"fiscal_year": fiscal_year, "start_date": date(2026, 9, 1), "end_date": date(2026, 9, 30)},
        )
        overtime_component = institution.pay_components.get(code="APEX-OVERTIME")
        debit_account = institution.accounts.get(code="5110")
        credit_account = institution.accounts.get(code="2340")
        mapping, _ = PayComponentAccountMapping.objects.get_or_create(
            institution=institution,
            pay_component=overtime_component,
            effective_from=date(2026, 1, 1),
            defaults={"debit_account": debit_account, "credit_account": credit_account, "is_active": True},
        )
        if mapping.debit_account_id != debit_account.id or mapping.credit_account_id != credit_account.id or not mapping.is_active:
            raise CommandError("APEX-OVERTIME accounting mapping has drifted; refusing to rewrite it.")
        casual_worker_tax_mapping = PayrollAccountMappingTemplate.objects.filter(
            accounting_preset_version=version,
            payroll_component_code="GH_CASUAL_WORKER_TAX",
        ).first()
        if (
            casual_worker_tax_mapping is None
            or casual_worker_tax_mapping.debit_account_mapping_code != "NET_PAY_PAYABLE"
            or casual_worker_tax_mapping.credit_account_mapping_code != "PAYE_PAYABLE"
        ):
            raise CommandError(
                "GH_CASUAL_WORKER_TAX preset mapping has drifted; refusing to rewrite it."
            )
        # Activity seeding deliberately adds finalized historical runs.  The
        # accounting fixture is tied to the fixed September 2026 demo run.
        run = institution.payroll_runs.get(
            status=PayrollRun.Status.FINALIZED,
            payroll_period__start_date=date(2026, 9, 1),
            payroll_period__end_date=date(2026, 9, 30),
        )
        journal = run.accounting_journal_entry or generate_payroll_journal(payroll_run=run, actor=admin)
        if journal.status == journal.Status.DRAFT:
            journal = submit_journal(journal=journal, actor=admin)
        if journal.status == journal.Status.PENDING_APPROVAL:
            journal = approve_journal(journal=journal, actor=admin, system=True)  # demo seed: recorded history, not a live approval
        if journal.status == journal.Status.APPROVED:
            post_journal(journal=journal, actor=admin)

    def _ensure_accounting_operations(self, institution, admin):
        period = institution.accounting_periods.get(name="September 2026")
        rent = institution.accounts.get(code="5200")
        revenue = institution.accounts.get(code="4100")
        bank_ledger = institution.accounts.get(code="1110")
        vendor, _ = Vendor.objects.get_or_create(institution=institution, vendor_code="VND-APEX-001", defaults={"name": "Apex Office Supplies Ltd.", "email": "supplies@csa.test", "country_code": "GH", "is_active": True})
        customer, _ = Customer.objects.get_or_create(institution=institution, customer_code="CUS-APEX-001", defaults={"name": "Blue Coast Logistics Ltd.", "email": "accounts@bluecoast.test", "country_code": "GH", "is_active": True})
        bank, _ = BankAccount.objects.get_or_create(institution=institution, name="Apex Operating Account", defaults={"bank_name": "Apex Demo Bank", "masked_account_number": "****-001", "currency": "GHS", "ledger_account": bank_ledger, "is_active": True})
        bill = VendorBill.objects.filter(institution=institution, vendor=vendor, bill_number="BILL-2026-000087").first()
        if bill is None:
            bill = create_vendor_bill(institution=institution, actor=admin, vendor=vendor, bill_number="BILL-2026-000087", bill_date=date(2026, 9, 8), due_date=date(2026, 9, 30), currency="GHS", accounting_period=period, lines=[{"description": "Office equipment", "expense_account": rent, "quantity": Decimal("1"), "unit_price": Decimal("14500")}])
        if bill.status == VendorBill.Status.DRAFT:
            bill = submit_vendor_bill(bill=bill, actor=admin)
        if bill.status == VendorBill.Status.PENDING:
            bill = approve_vendor_bill(bill=bill, actor=admin)
        if bill.status == VendorBill.Status.APPROVED:
            bill = post_vendor_bill(bill=bill, actor=admin)
        if not bill.payments.exists():
            create_payment(institution=institution, actor=admin, payment_number="PAY-2026-000065", payment_date=date(2026, 9, 18), amount=Decimal("14500"), currency="GHS", payment_method="BANK_TRANSFER", bank_account=bank, vendor_bill=bill)
        invoice = Invoice.objects.filter(institution=institution, customer=customer, invoice_number="INV-2026-000184").first()
        if invoice is None:
            invoice = create_invoice(institution=institution, actor=admin, customer=customer, invoice_number="INV-2026-000184", invoice_date=date(2026, 9, 10), due_date=date(2026, 9, 30), currency="GHS", accounting_period=period, lines=[{"description": "Implementation services", "income_account": revenue, "quantity": Decimal("1"), "unit_price": Decimal("32000")}])
        if invoice.status == Invoice.Status.DRAFT:
            invoice = issue_invoice(invoice=invoice, actor=admin)
        if not invoice.receipts.exists():
            create_receipt(institution=institution, actor=admin, receipt_number="RCT-2026-000073", receipt_date=date(2026, 9, 20), amount=Decimal("12000"), currency="GHS", payment_method="BANK_TRANSFER", bank_account=bank, invoice=invoice)
        expense = Expense.objects.filter(institution=institution, description="EXP-2026-000112 Travel expense").first()
        if expense is None:
            expense = create_expense(institution=institution, actor=admin, expense_date=date(2026, 9, 22), account=rent, amount=Decimal("1850"), currency="GHS", description="EXP-2026-000112 Travel expense")
        if expense.status == Expense.Status.DRAFT:
            submit_expense(expense=expense, actor=admin)

    @staticmethod
    def _workbook_date(serial):
        return EXCEL_EPOCH + timedelta(days=serial)

    def _ensure_employees(self, institution, password, *, reset_passwords=False):
        """Create the 30 linked people first, then their current employment."""
        employees = {}
        for number, first_name, last_name, phone, dob, gender, hire_date, role_code in EMPLOYEES:
            email = f"{first_name.lower()}.{last_name.lower()}@csa.test"
            user, created = User.objects.get_or_create(
                email=email,
                defaults={"first_name": first_name, "last_name": last_name, "is_active": True},
            )
            user_changes = []
            for field, value in {"first_name": first_name, "last_name": last_name, "is_active": True}.items():
                if getattr(user, field) != value:
                    setattr(user, field, value)
                    user_changes.append(field)
            if created or reset_passwords:
                user.set_password(password)
                user_changes.append("password")
            if user_changes:
                user.save(update_fields=tuple(dict.fromkeys((*user_changes, "updated_at"))))
            role = institution.roles.get(code=role_code)
            self._ensure_active_membership(user=user, institution=institution, role=role)
            values = {
                "user": user,
                "first_name": first_name,
                "last_name": last_name,
                "work_email": email,
                "personal_email": email,
                "phone": phone,
                "date_of_birth": self._workbook_date(dob),
                "gender": gender,
                "hire_date": self._workbook_date(hire_date),
                "status": Employee.Status.ACTIVE,
            }
            employee = Employee.objects.filter(institution=institution, employee_number=number).first()
            if employee is None:
                employee = Employee(institution=institution, employee_number=number, **values)
                employee.full_clean()
                employee.save()
            elif any(getattr(employee, field) != value for field, value in values.items()):
                raise CommandError(f"Demo employee {number} has drifted; use a future --reset implementation rather than rewriting employee history.")
            employees[number] = employee

        departments = {item.code: item for item in institution.departments.all()}
        positions = {item.code: item for item in institution.positions.all()}
        grades = {item.code: item for item in institution.grades.all()}
        locations = {item.code: item for item in institution.locations.all()}
        current_employments = {}
        for number, department_code, position_code, grade_code, location_code, _, employment_type, staff_category, start_date in EMPLOYMENT_ASSIGNMENTS:
            employee = employees[number]
            current = Employment.objects.filter(employee=employee, is_current=True).first()
            if current is None:
                current = create_employment(
                    institution=institution,
                    employee=employee,
                    department=departments[department_code],
                    position=positions[position_code],
                    grade=grades[grade_code],
                    location=locations[location_code],
                    employment_type=employment_type,
                    staff_category=staff_category,
                    start_date=self._workbook_date(start_date),
                    status=Employment.Status.ACTIVE,
                    is_current=True,
                )
            elif (
                current.department_id != departments[department_code].id
                or current.position_id != positions[position_code].id
                or current.grade_id != grades[grade_code].id
                or current.location_id != locations[location_code].id
                or current.employment_type != employment_type
                or current.staff_category != staff_category
                or current.start_date != self._workbook_date(start_date)
                or current.status != Employment.Status.ACTIVE
            ):
                raise CommandError(f"Current demo employment for {number} has drifted; refusing to overwrite history.")
            current_employments[number] = current

        for number, _, _, _, _, manager_number, _, _, _ in EMPLOYMENT_ASSIGNMENTS:
            employment = current_employments[number]
            manager = current_employments.get(manager_number) if manager_number else None
            if employment.reports_to_id != (manager.id if manager else None):
                employment.reports_to = manager
                employment.full_clean()
                employment.save(update_fields=("reports_to", "updated_at"))

        self._seed_profile_terms(current_employments)

        for department_code, head_number in DEPARTMENT_HEADS.items():
            department = institution.departments.get(code=department_code)
            head = current_employments[head_number].employee
            if department.head_id != head.id:
                department.head = head
                department.full_clean()
                department.save(update_fields=("head", "updated_at"))

    def _seed_profile_terms(self, current_employments):
        """Fill the profile/terms fields shown on Employee detail, only while blank."""
        for employment in current_employments.values():
            employee = employment.employee
            if not employee.preferred_name and not employee.office_location:
                employee.preferred_name = employee.first_name
                employee.office_location = employment.location.name
                employee.save(update_fields=("preferred_name", "office_location", "updated_at"))
            if employment.cost_centre:
                continue
            remote = "remote" in employment.location.name.lower()
            employment.working_pattern = (
                Employment.WorkingPattern.PART_TIME
                if employment.employment_type == Employment.EmploymentType.INTERN
                else Employment.WorkingPattern.FULL_TIME
            )
            employment.work_arrangement = Employment.WorkArrangement.HYBRID if remote else Employment.WorkArrangement.ON_SITE
            employment.office_days = ["TUE", "WED", "THU"] if remote else ["MON", "TUE", "WED", "THU", "FRI"]
            employment.time_zone = "Africa/Accra"
            employment.team = f"{employment.department.name} team"
            employment.cost_centre = f"{employment.department.code}-01"
            probation_end = employment.start_date + timedelta(days=182)
            employment.probation_end_date = probation_end
            employment.probation_status = (
                Employment.ProbationStatus.COMPLETED if probation_end <= timezone.localdate() else Employment.ProbationStatus.IN_PROGRESS
            )
            employment.notice_period_weeks = 4 if employment.employment_type == Employment.EmploymentType.PERMANENT else 2
            employment.full_clean()
            employment.save()

    def _ensure_admin(self, password, *, reset_passwords=False):
        user, created = User.objects.get_or_create(
            email=DEMO_ADMIN_EMAIL,
            defaults={"first_name": "Kwame", "last_name": "Mensah", "is_active": True},
        )
        changes = []
        for field, value in {"first_name": "Kwame", "last_name": "Mensah", "is_active": True}.items():
            if getattr(user, field) != value:
                setattr(user, field, value)
                changes.append(field)
        if created or reset_passwords:
            user.set_password(password)
            changes.append("password")
        if changes:
            user.save(update_fields=tuple(dict.fromkeys((*changes, "updated_at"))))
        return user

    def _ensure_director(self, institution, password, *, reset_passwords=False):
        user, created = User.objects.get_or_create(
            email=DEMO_DIRECTOR_EMAIL,
            defaults={"first_name": "Evelyn", "last_name": "Darko", "is_active": True},
        )
        changes = []
        for field, value in {"first_name": "Evelyn", "last_name": "Darko", "is_active": True}.items():
            if getattr(user, field) != value:
                setattr(user, field, value)
                changes.append(field)
        if created or reset_passwords:
            user.set_password(password)
            changes.append("password")
        if changes:
            user.save(update_fields=tuple(dict.fromkeys((*changes, "updated_at"))))
        self._ensure_active_membership(
            user=user,
            institution=institution,
            role=institution.roles.get(code="DIRECTOR"),
        )
        return user

    def _ensure_active_membership(self, *, user, institution, role, is_primary=False):
        membership = InstitutionMembership.objects.filter(user=user, institution=institution).first()
        if membership is None:
            return create_membership(user=user, institution=institution, role=role, status=InstitutionMembership.Status.ACTIVE, is_primary=is_primary, joined_at=timezone.now())
        changed = []
        expected = {"role": role, "status": InstitutionMembership.Status.ACTIVE, "is_primary": is_primary, "ended_at": None}
        for field, value in expected.items():
            if getattr(membership, field) != value:
                setattr(membership, field, value)
                changed.append(field)
        if changed:
            membership.full_clean()
            membership.save(update_fields=tuple((*changed, "updated_at")))
        return membership

    def _enable_modules(self, institution, admin):
        for module_code in MODULE_CODES:
            module = institution.modules.get(module_code=module_code)
            changed = []
            if not module.is_enabled:
                module.is_enabled = True
                module.enabled_at = timezone.now()
                changed.extend(("is_enabled", "enabled_at"))
            if module.enabled_by_id != admin.id:
                module.enabled_by = admin
                changed.append("enabled_by")
            if changed:
                module.full_clean()
                module.save(update_fields=tuple((*changed, "updated_at")))

    def _ensure_organization(self, institution):
        departments = {}
        for code, name, parent_code in ORGANIZATION["departments"]:
            parent = departments.get(parent_code)
            department, _ = Department.objects.update_or_create(institution=institution, code=code, defaults={"name": name, "parent": parent, "is_active": True})
            departments[code] = department
        for code, name, level in ORGANIZATION["grades"]:
            Grade.objects.update_or_create(institution=institution, code=code, defaults={"name": name, "level": level, "is_active": True})
        for code, name, city, is_remote in ORGANIZATION["locations"]:
            Location.objects.update_or_create(institution=institution, code=code, defaults={"name": name, "city": city, "country": "GH", "timezone": "Africa/Accra", "is_remote": is_remote, "is_active": True})
        for code, title, department_code in ORGANIZATION["positions"]:
            position = Position.objects.filter(institution=institution, code=code).first()
            if position is None:
                create_position(institution=institution, department=departments[department_code], title=title, code=code, is_active=True)
            elif (position.title, position.department_id, position.is_active) != (title, departments[department_code].id, True):
                raise CommandError(f"Demo position {code} has drifted; refusing to rewrite organization history.")

    def _ensure_custom_roles(self, institution, admin):
        for code, (name, permission_codes) in CUSTOM_ROLES.items():
            role = Role.objects.filter(institution=institution, code=code).first()
            if role is None:
                create_custom_role(institution=institution, actor=admin, code=code, name=name, description="CSA-DEMO role for persona demonstrations.", permission_codes=permission_codes)
                continue
            actual = set(role.permissions.values_list("code", flat=True))
            expected = set(permission_codes)
            # Older seeds created these roles with a subset of today's grants
            # (no home.view / self-service); only ever add, never remove.
            if role.is_custom and actual < expected:
                update_custom_role(
                    role=role,
                    institution=institution,
                    actor=admin,
                    permission_codes=permission_codes,
                )
                continue
            if not role.is_custom or actual != expected:
                raise CommandError(f"Demo custom role {code} has drifted; refusing to overwrite its permissions.")

    def _validate_organization(self, institution):
        expected = ORGANIZATION
        if institution.departments.filter(code__in=[row[0] for row in expected["departments"]]).count() != len(expected["departments"]):
            raise CommandError("CSA-DEMO department baseline is incomplete.")
        if institution.positions.filter(code__in=[row[0] for row in expected["positions"]]).count() != len(expected["positions"]):
            raise CommandError("CSA-DEMO position baseline is incomplete.")
        if institution.grades.filter(code__in=[row[0] for row in expected["grades"]]).count() != len(expected["grades"]):
            raise CommandError("CSA-DEMO grade baseline is incomplete.")
        if institution.locations.filter(code__in=[row[0] for row in expected["locations"]]).count() != len(expected["locations"]):
            raise CommandError("CSA-DEMO location baseline is incomplete.")
        if institution.employees.filter(employee_number__in=[row[0] for row in EMPLOYEES]).count() not in (0, len(EMPLOYEES)):
            raise CommandError("CSA-DEMO employee baseline is incomplete.")
