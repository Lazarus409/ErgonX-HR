"""Seed a large, HR-only demonstration organization for the ErgonX HR edition.

BOST Energy (BOST-DEMO) is a demonstration organization modelled on a Ghanaian
petroleum storage and transportation company: about 110 people across nine
departments, the Accra head office and three fuel depots. All people, emails and
records are synthetic. The command covers
every module ErgonX HR offers: Core HR (structure, people, emergency contacts,
documents, onboarding and exits), Leave, Attendance (schedules, shifts,
corrections and overtime) and Recruitment (requisitions through to hires).

* Development-only: refuses to run when DEBUG=False.
* Every record goes through the domain services, so approvals, balances,
  notifications and audit history stay consistent.
* Deterministic and idempotent: names and dates come from seeded random
  generators and each record has a stable key, so a rerun only fills in what
  is missing (for example, the attendance days since the last run).

    python manage.py seed_ergonx_hr_demo
    python manage.py seed_ergonx_hr_demo --days 30   # shorter attendance history
"""

import random
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError as ApiValidationError

from apps.accounts.models import User
from apps.attendance.models import AttendanceAdjustment, AttendanceRecord, OvertimeRecord
from apps.attendance.services import classify_attendance_date, clock_in, clock_out, decide_adjustment, decide_overtime, request_adjustment
from apps.documents.models import Document
from apps.employees.models import EmergencyContact, Employee, EmployeeOnboarding, Employment
from apps.employees.services import (
    complete_employee_offboarding,
    complete_employee_onboarding,
    create_employment,
    initiate_employee_offboarding,
    save_emergency_contact,
    start_employee_onboarding,
)
from apps.institutions.models import Institution, InstitutionMembership, InstitutionOnboarding, Role
from apps.institutions.services import (
    SELF_SERVICE_PERMISSIONS,
    bootstrap_institution,
    create_custom_role,
    create_membership,
    set_module_enabled,
    validate_institution_onboarding,
)
from apps.leave.models import LeaveRequest, LeaveType
from apps.leave.services import (
    approve_leave_request,
    cancel_leave_request,
    create_leave_request,
    reject_leave_request,
    submit_leave_request,
)
from apps.organization.models import Department, Grade, Location, Position
from apps.organization.services import create_position
from apps.recruitment.models import Application, Candidate, Interview, JobPosting, Offer, RecruitmentStage
from apps.recruitment.services import (
    approve_job_posting,
    close_job_posting,
    decide_offer,
    extend_offer,
    hire_candidate,
    move_application_stage,
    publish_job_posting,
    reject_application,
    submit_application,
    submit_job_posting_for_approval,
    withdraw_application,
)
from apps.scheduling.models import FlexibleWorkRule, ScheduleAssignment, Shift, ShiftPattern, ShiftPatternDay, WorkSchedule
from apps.scheduling.services import create_schedule_assignment, schedule_assignment_for, schedule_expectation

INSTITUTION_CODE = "BOST-DEMO"
EMAIL_DOMAIN = "bostenergy.com.gh"
ADMIN_EMAIL = f"akua.mensah@{EMAIL_DOMAIN}"
DEFAULT_PASSWORD = "ErgonxHR!2026"
ATTENDANCE_DAYS = 45
SERVICE_ERRORS = (DjangoValidationError, ApiValidationError)
MINIMAL_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
)

MODULES = ("CORE_HR", "LEAVE", "ATTENDANCE", "RECRUITMENT", "REPORTS")

DEPARTMENTS = (
    # code, name, parent
    ("DPT-EXE", "Executive Office", None),
    ("DPT-HR", "Human Resources", "DPT-EXE"),
    ("DPT-FIN", "Finance & Administration", "DPT-EXE"),
    ("DPT-OPS", "Operations", "DPT-EXE"),
    ("DPT-DEP", "Depot Operations", "DPT-OPS"),
    ("DPT-PIP", "Pipeline & Transport", "DPT-OPS"),
    ("DPT-COM", "Commercial & Customer Service", "DPT-EXE"),
    ("DPT-IT", "Information Technology", "DPT-EXE"),
    ("DPT-HSE", "Health, Safety, Security & Environment", "DPT-OPS"),
)

GRADES = (
    ("GRD-01", "Executive", 1),
    ("GRD-02", "Senior Manager", 2),
    ("GRD-03", "Manager", 3),
    ("GRD-04", "Senior Officer", 4),
    ("GRD-05", "Officer", 5),
    ("GRD-06", "Associate", 6),
)

LOCATIONS = (
    # code, name, city, remote
    ("LOC-ACC", "Head Office, Accra", "Accra", False),
    ("LOC-APD", "Accra Plains Depot", "Accra", False),
    ("LOC-KSI", "Kumasi Depot", "Kumasi", False),
    ("LOC-BUI", "Buipe Depot", "Buipe", False),
    ("LOC-REM", "Remote / Hybrid", "Accra", True),
)

POSITIONS = (
    # code, title, department
    ("POS-001", "Managing Director", "DPT-EXE"),
    ("POS-002", "Executive Assistant", "DPT-EXE"),
    ("POS-003", "HR Director", "DPT-HR"),
    ("POS-004", "HR Business Partner", "DPT-HR"),
    ("POS-005", "HR Officer", "DPT-HR"),
    ("POS-006", "Recruitment Specialist", "DPT-HR"),
    ("POS-007", "Learning & Development Officer", "DPT-HR"),
    ("POS-008", "Finance & Admin Manager", "DPT-FIN"),
    ("POS-009", "Administrative Officer", "DPT-FIN"),
    ("POS-010", "Procurement Officer", "DPT-FIN"),
    ("POS-011", "Operations Director", "DPT-OPS"),
    ("POS-012", "Operations Planner", "DPT-OPS"),
    ("POS-013", "Depot Manager", "DPT-DEP"),
    ("POS-014", "Depot Shift Supervisor", "DPT-DEP"),
    ("POS-015", "Depot Operator", "DPT-DEP"),
    ("POS-016", "Product Stock Controller", "DPT-DEP"),
    ("POS-017", "Pipeline & Transport Manager", "DPT-PIP"),
    ("POS-018", "Product Movement Coordinator", "DPT-PIP"),
    ("POS-019", "Tanker Driver", "DPT-PIP"),
    ("POS-020", "Pipeline Maintenance Technician", "DPT-PIP"),
    ("POS-021", "Commercial Manager", "DPT-COM"),
    ("POS-022", "Commercial Officer", "DPT-COM"),
    ("POS-023", "Customer Service Officer", "DPT-COM"),
    ("POS-024", "IT Manager", "DPT-IT"),
    ("POS-025", "Software Developer", "DPT-IT"),
    ("POS-026", "IT Support Technician", "DPT-IT"),
    ("POS-027", "Data Analyst", "DPT-IT"),
    ("POS-028", "HSSE Manager", "DPT-HSE"),
    ("POS-029", "HSSE Officer", "DPT-HSE"),
)

# Department headcount plan: (department, position, grade, location, count, staff category, employment-type mix)
STAFFING = (
    ("DPT-EXE", "POS-002", "GRD-05", "LOC-ACC", 2, "SENIOR", "P"),
    ("DPT-HR", "POS-004", "GRD-04", "LOC-ACC", 2, "SENIOR", "P"),
    ("DPT-HR", "POS-005", "GRD-05", "LOC-ACC", 3, "SENIOR", "PPT"),
    ("DPT-HR", "POS-006", "GRD-05", "LOC-ACC", 2, "SENIOR", "P"),
    ("DPT-HR", "POS-007", "GRD-05", "LOC-ACC", 1, "SENIOR", "P"),
    ("DPT-FIN", "POS-009", "GRD-05", "LOC-ACC", 3, "SENIOR", "PPC"),
    ("DPT-FIN", "POS-010", "GRD-05", "LOC-ACC", 2, "SENIOR", "P"),
    ("DPT-OPS", "POS-012", "GRD-05", "LOC-APD", 4, "SENIOR", "P"),
    ("DPT-DEP", "POS-014", "GRD-04", "LOC-APD", 4, "SENIOR", "P"),
    ("DPT-DEP", "POS-015", "GRD-06", "LOC-APD", 16, "JUNIOR", "PPPPCCTA"),
    ("DPT-DEP", "POS-015", "GRD-06", "LOC-KSI", 6, "JUNIOR", "PPCA"),
    ("DPT-DEP", "POS-016", "GRD-05", "LOC-APD", 3, "SENIOR", "P"),
    ("DPT-PIP", "POS-018", "GRD-05", "LOC-APD", 3, "SENIOR", "P"),
    ("DPT-PIP", "POS-019", "GRD-06", "LOC-APD", 10, "JUNIOR", "PPPC"),
    ("DPT-PIP", "POS-019", "GRD-06", "LOC-BUI", 5, "JUNIOR", "PPC"),
    ("DPT-PIP", "POS-020", "GRD-05", "LOC-APD", 4, "JUNIOR", "PPC"),
    ("DPT-COM", "POS-022", "GRD-04", "LOC-ACC", 5, "SENIOR", "P"),
    ("DPT-COM", "POS-023", "GRD-06", "LOC-ACC", 7, "JUNIOR", "PPPCI"),
    ("DPT-COM", "POS-023", "GRD-06", "LOC-KSI", 3, "JUNIOR", "PC"),
    ("DPT-COM", "POS-022", "GRD-05", "LOC-BUI", 2, "SENIOR", "P"),
    ("DPT-IT", "POS-025", "GRD-04", "LOC-REM", 5, "SENIOR", "PPPC"),
    ("DPT-IT", "POS-026", "GRD-05", "LOC-ACC", 3, "SENIOR", "PPI"),
    ("DPT-IT", "POS-027", "GRD-05", "LOC-REM", 2, "SENIOR", "P"),
    ("DPT-HSE", "POS-029", "GRD-05", "LOC-APD", 4, "SENIOR", "PPC"),
)
EMPLOYMENT_TYPE_CODES = {"P": "PERMANENT", "C": "CONTRACT", "T": "TEMPORARY", "I": "INTERN", "A": "CASUAL"}

# Leaders: number, first, last, gender, department, position, grade, role.
LEADERS = (
    ("BOST-0001", "Kwesi", "Appiah", "MALE", "DPT-EXE", "POS-001", "GRD-01", "DIRECTOR"),
    ("BOST-0002", "Akua", "Mensah", "FEMALE", "DPT-HR", "POS-003", "GRD-02", "INSTITUTION_ADMIN"),
    ("BOST-0003", "Edem", "Kpodo", "MALE", "DPT-FIN", "POS-008", "GRD-03", "DEPARTMENT_HEAD"),
    ("BOST-0004", "Comfort", "Agyei", "FEMALE", "DPT-OPS", "POS-011", "GRD-02", "DEPARTMENT_HEAD"),
    ("BOST-0005", "Ibrahim", "Mahama", "MALE", "DPT-DEP", "POS-013", "GRD-03", "DEPARTMENT_HEAD"),
    ("BOST-0006", "Yaw", "Darkwa", "MALE", "DPT-PIP", "POS-017", "GRD-03", "DEPARTMENT_HEAD"),
    ("BOST-0007", "Esi", "Ampofo", "FEMALE", "DPT-COM", "POS-021", "GRD-03", "DEPARTMENT_HEAD"),
    ("BOST-0008", "Selorm", "Agbeko", "MALE", "DPT-IT", "POS-024", "GRD-03", "DEPARTMENT_HEAD"),
    ("BOST-0009", "Naa", "Lamptey", "FEMALE", "DPT-HSE", "POS-028", "GRD-03", "DEPARTMENT_HEAD"),
)

CUSTOM_ROLES = {
    "RECRUITMENT_OFFICER": (
        "Recruitment Officer",
        ("home.view", "job_posting.view", "job_posting.create", "job_posting.update", "candidate.view", "candidate.create", "candidate.update", "interview.view", "interview.manage", "candidate_evaluation.create"),
    ),
    "SHIFT_SUPERVISOR": (
        "Shift Supervisor",
        ("home.view", "attendance.view", "attendance.approve", "schedule.view", "schedule.manage"),
    ),
}

MALE_NAMES = ("Kofi", "Kwame", "Kwabena", "Kojo", "Yaw", "Kwaku", "Fiifi", "Nana", "Kweku", "Ebo", "Elikem", "Delali", "Mawuli", "Senyo", "Nii", "Tetteh", "Abdul", "Issah", "Sulemana", "Daniel", "Samuel", "Emmanuel", "Isaac", "Prince", "Richmond", "Michael", "Joseph", "Eric", "Felix", "Bernard")
FEMALE_NAMES = ("Ama", "Akosua", "Abena", "Adwoa", "Afua", "Yaa", "Efua", "Esi", "Araba", "Adjoa", "Akos", "Enyonam", "Dzifa", "Sena", "Mawusi", "Naa", "Dede", "Ayeley", "Fatima", "Zainab", "Mariam", "Gifty", "Priscilla", "Belinda", "Linda", "Vida", "Mabel", "Joyce", "Grace", "Patience")
SURNAMES = ("Owusu", "Boateng", "Asante", "Osei", "Addo", "Amoah", "Ofori", "Sarpong", "Antwi", "Frimpong", "Tetteh", "Quaye", "Ankrah", "Nyarko", "Asamoah", "Bonsu", "Acheampong", "Agyeman", "Adjei", "Danso", "Opoku", "Mensah", "Appiah", "Gyamfi", "Kyei", "Badu", "Yeboah", "Ntim", "Amponsah", "Dogbe", "Agbenyega", "Fuseini", "Alhassan", "Abubakar", "Arthur", "Essien", "Quansah", "Hagan", "Kumi", "Baah")
RELATIONSHIPS = ("Spouse", "Mother", "Father", "Brother", "Sister", "Uncle", "Aunt", "Cousin")
DOCUMENTS = (("Employment contract", "CONTRACT"), ("Ghana Card copy", "IDENTITY"), ("Academic certificate", "QUALIFICATION"), ("Medical fitness certificate", "OTHER"))

REQUISITIONS = (
    # code, title, department, position, location, target status, openings, hiring reason, days since opened
    ("BOST-JOB-001", "Depot Operator (Accra Plains)", "DPT-DEP", "POS-015", "LOC-APD", "OPEN", 4, "EXPANSION", 40),
    ("BOST-JOB-002", "Tanker Driver", "DPT-PIP", "POS-019", "LOC-BUI", "OPEN", 3, "EXPANSION", 32),
    ("BOST-JOB-003", "Software Developer", "DPT-IT", "POS-025", "LOC-REM", "OPEN", 1, "NEW_ROLE", 25),
    ("BOST-JOB-004", "Customer Service Officer", "DPT-COM", "POS-023", "LOC-KSI", "OPEN", 2, "REPLACEMENT", 20),
    ("BOST-JOB-005", "HSSE Officer", "DPT-HSE", "POS-029", "LOC-APD", "OPEN", 1, "REPLACEMENT", 14),
    ("BOST-JOB-006", "Data Analyst", "DPT-IT", "POS-027", "LOC-REM", "OPEN", 1, "NEW_ROLE", 8),
    ("BOST-JOB-007", "Pipeline Maintenance Technician", "DPT-PIP", "POS-020", "LOC-APD", "CLOSED", 1, "REPLACEMENT", 90),
    ("BOST-JOB-008", "Product Stock Controller", "DPT-DEP", "POS-016", "LOC-KSI", "APPROVED", 1, "EXPANSION", 0),
    ("BOST-JOB-009", "Learning & Development Officer", "DPT-HR", "POS-007", "LOC-ACC", "PENDING_APPROVAL", 1, "NEW_ROLE", 0),
    ("BOST-JOB-010", "Procurement Officer", "DPT-FIN", "POS-010", "LOC-ACC", "DRAFT", 1, "TEMPORARY_COVER", 0),
)
SOURCES = ("LinkedIn", "Employee referral", "Careers page", "Jobberman", "Recruitment agency", "University job fair", "Walk-in")
STAGES = ("Applied", "Screening", "Shortlisted", "Interview", "Final Review", "Offer")


def weekdays_between(start, end):
    days, cursor = 0, start
    while cursor <= end:
        if cursor.weekday() < 5:
            days += 1
        cursor += timedelta(days=1)
    return Decimal(days)


def next_weekday(day):
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def add_weekdays(day, count):
    """The date that closes a span of `count` weekdays starting at `day`."""
    day = next_weekday(day)
    remaining = count - 1
    while remaining > 0:
        day += timedelta(days=1)
        if day.weekday() < 5:
            remaining -= 1
    return day


class Command(BaseCommand):
    help = "Seed the BOST-DEMO HR-only demonstration organization (development only)."

    def add_arguments(self, parser):
        parser.add_argument("--password", default=DEFAULT_PASSWORD, help="Password for newly created demo accounts.")
        parser.add_argument("--days", type=int, default=ATTENDANCE_DAYS, help=f"Days of attendance history to keep (default {ATTENDANCE_DAYS}).")
        parser.add_argument("--no-documents", action="store_true", help="Skip employee document files (for hosts whose disk is wiped on deploy).")

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_ergonx_hr_demo is development-only and refuses to run when DEBUG=False.")
        self.password = options["password"]
        self.history_days = options["days"]
        self.with_documents = not options["no_documents"]
        self.summary = {}

        with transaction.atomic():
            self._foundation()
        self.zone = ZoneInfo(self.institution.timezone)
        self.now = timezone.now().astimezone(self.zone)
        self.today = self.now.date()

        steps = (
            ("people", self._people),
            ("emergency contacts", self._emergency_contacts),
            ("schedules", self._schedules),
            ("leave", self._leave),
            ("attendance", self._attendance),
            ("attendance corrections and overtime", self._corrections_and_overtime),
            ("recruitment", self._recruitment),
            ("documents", self._documents),
            ("joiners and leavers", self._lifecycle),
            ("onboarding checklist", self._finish_onboarding),
        )
        failures = []
        for label, step in steps:
            try:
                with transaction.atomic():
                    step()
                self.stdout.write(f"  ok      {label}: {self.summary.get(label, 'up to date')}")
            except Exception as exc:  # noqa: BLE001 - report and continue with independent sections
                failures.append(label)
                self.stdout.write(self.style.ERROR(f"  FAILED  {label}: {exc}"))
        if failures:
            raise CommandError(f"HR demo seeding failed for: {', '.join(failures)}")
        institution = self.institution
        self.stdout.write(self.style.SUCCESS(f"{institution.name} ({institution.code}) is ready."))
        self.stdout.write(f"  Employees: {institution.employees.count()} · Leave requests: {institution.leave_requests.count()} · Attendance records: {institution.attendance_records.count()} · Candidates: {institution.candidates.count()}")
        self.stdout.write(f"  Sign in as {ADMIN_EMAIL} (Institution Admin). Every demo account uses the password given with --password (default {DEFAULT_PASSWORD}).")

    # ------------------------------------------------------------------ helpers

    def _count(self, label, amount=1):
        self.summary.setdefault(label, {"created": 0})["created"] += amount

    def _stamp(self, day, hour, minute=0):
        return datetime.combine(day, time(0, 0), self.zone) + timedelta(hours=hour, minutes=minute)

    def _user(self, first_name, last_name, email):
        user, created = User.objects.get_or_create(email=email, defaults={"first_name": first_name, "last_name": last_name, "is_active": True})
        if created:
            user.set_password(self.password)
            user.save(update_fields=("password", "updated_at"))
        return user

    def _membership(self, user, role_code, *, is_primary=True):
        membership = InstitutionMembership.objects.filter(user=user, institution=self.institution).first()
        if membership is None:
            role = self.institution.roles.get(code=role_code)
            membership = create_membership(user=user, institution=self.institution, role=role, status=InstitutionMembership.Status.ACTIVE, is_primary=is_primary, joined_at=timezone.now())
        return membership

    def _active_employees(self):
        return list(self.institution.employees.filter(status=Employee.Status.ACTIVE, user__isnull=False).select_related("user").order_by("employee_number"))

    # --------------------------------------------------------------- foundation

    def _foundation(self):
        institution, _ = Institution.objects.update_or_create(
            code=INSTITUTION_CODE,
            defaults={
                "name": "BOST Energy",
                "email": f"hr@{EMAIL_DOMAIN}",
                "phone": "+233302900100",
                "address": "Head Office, Accra, Ghana",
                "country_code": "GH",
                "default_currency": "GHS",
                "timezone": "Africa/Accra",
                "institution_type": Institution.InstitutionType.GOVERNMENT,
                "employee_size": "51-200",
                "website": "https://bostenergy.com.gh",
                "is_active": True,
            },
        )
        self.institution = institution
        bootstrap_institution(institution)
        self.admin = self._user("Akua", "Mensah", ADMIN_EMAIL)
        self._membership(self.admin, "INSTITUTION_ADMIN")
        for code in MODULES:
            module = institution.modules.get(module_code=code)
            if not module.is_enabled:
                set_module_enabled(module=module, institution=institution, actor=self.admin, is_enabled=True)

        departments = {}
        for code, name, parent in DEPARTMENTS:
            departments[code], _ = Department.objects.update_or_create(institution=institution, code=code, defaults={"name": name, "parent": departments.get(parent), "is_active": True})
        for code, name, level in GRADES:
            Grade.objects.update_or_create(institution=institution, code=code, defaults={"name": name, "level": level, "is_active": True})
        for code, name, city, remote in LOCATIONS:
            Location.objects.update_or_create(institution=institution, code=code, defaults={"name": name, "city": city, "country": "GH", "timezone": "Africa/Accra", "is_remote": remote, "is_active": True})
        for code, title, department in POSITIONS:
            if not Position.objects.filter(institution=institution, code=code).exists():
                create_position(institution=institution, department=departments[department], title=title, code=code, is_active=True)
        for code, (name, permissions) in CUSTOM_ROLES.items():
            if not Role.objects.filter(institution=institution, code=code).exists():
                create_custom_role(institution=institution, actor=self.admin, code=code, name=name, description="BOST Energy demo role.", permission_codes=(*permissions, *SELF_SERVICE_PERMISSIONS))

    # ------------------------------------------------------------------- people

    def _people(self):
        institution = self.institution
        departments = {item.code: item for item in institution.departments.all()}
        positions = {item.code: item for item in institution.positions.all()}
        grades = {item.code: item for item in institution.grades.all()}
        locations = {item.code: item for item in institution.locations.all()}
        rng = random.Random("bost-people")
        used_emails = set(User.objects.filter(email__endswith=f"@{EMAIL_DOMAIN}").values_list("email", flat=True))
        heads = {}

        def person(number, first, last, gender, role_code, department, position, grade, location, employment_type, category, hire_date):
            employee = Employee.objects.filter(institution=institution, employee_number=number).first()
            if employee is not None:
                return employee
            email = f"{first}.{last}@{EMAIL_DOMAIN}".lower()
            if number != "BOST-0002":
                suffix = 2
                while email in used_emails:
                    email = f"{first}.{last}{suffix}@{EMAIL_DOMAIN}".lower()
                    suffix += 1
            used_emails.add(email)
            user = self.admin if number == "BOST-0002" else self._user(first, last, email)
            self._membership(user, role_code)
            employee = Employee(
                institution=institution, employee_number=number, user=user, first_name=first, last_name=last,
                preferred_name=first, work_email=email, 
                phone=f"+23324{rng.randint(1000000, 9999999)}", mobile_phone=f"+23320{rng.randint(1000000, 9999999)}",
                date_of_birth=date(rng.randint(1970, 2002), rng.randint(1, 12), rng.randint(1, 28)), gender=gender,
                hire_date=hire_date, office_location=locations[location].name, status=Employee.Status.ACTIVE,
            )
            employee.full_clean()
            employee.save()
            remote = locations[location].is_remote
            shift_based = department in ("DPT-DEP", "DPT-PIP")
            employment = create_employment(
                institution=institution, employee=employee, department=departments[department], position=positions[position],
                grade=grades[grade], location=locations[location], employment_type=employment_type, staff_category=category,
                start_date=hire_date, status=Employment.Status.ACTIVE, is_current=True,
            )
            employment.working_pattern = Employment.WorkingPattern.SHIFT if shift_based else (Employment.WorkingPattern.PART_TIME if employment_type == "INTERN" else Employment.WorkingPattern.FULL_TIME)
            employment.work_arrangement = Employment.WorkArrangement.HYBRID if remote else Employment.WorkArrangement.ON_SITE
            employment.office_days = ["TUE", "WED", "THU"] if remote else ["MON", "TUE", "WED", "THU", "FRI"]
            employment.time_zone = "Africa/Accra"
            employment.team = f"{departments[department].name} team"
            employment.cost_centre = f"{department}-{location[-3:]}"
            employment.probation_end_date = hire_date + timedelta(days=182)
            employment.probation_status = Employment.ProbationStatus.COMPLETED if employment.probation_end_date <= self.today else Employment.ProbationStatus.IN_PROGRESS
            employment.notice_period_weeks = 4 if employment_type == "PERMANENT" else 2
            employment.full_clean()
            employment.save()
            self._count("people")
            return employee

        for number, first, last, gender, department, position, grade, role_code in LEADERS:
            hire = date(rng.randint(2012, 2020), rng.randint(1, 12), rng.randint(1, 28))
            heads[department] = person(number, first, last, gender, role_code, department, position, grade, "LOC-ACC" if department not in ("DPT-DEP", "DPT-PIP", "DPT-HSE", "DPT-OPS") else "LOC-APD", "PERMANENT", "SENIOR", hire)

        number = 10
        hr_admins = 0
        recruiters = 0
        supervisors = 0
        for department, position, grade, location, count, category, mix in STAFFING:
            for index in range(count):
                gender = "FEMALE" if rng.random() < (0.55 if department in ("DPT-HR", "DPT-COM") else 0.3) else "MALE"
                first = rng.choice(FEMALE_NAMES if gender == "FEMALE" else MALE_NAMES)
                last = rng.choice(SURNAMES)
                employment_type = EMPLOYMENT_TYPE_CODES[mix[index % len(mix)]]
                role_code = "EMPLOYEE"
                if position == "POS-004" and hr_admins < 2:
                    role_code, hr_admins = "HR_ADMIN", hr_admins + 1
                elif position == "POS-006" and recruiters < 2:
                    role_code, recruiters = "RECRUITMENT_OFFICER", recruiters + 1
                elif position == "POS-014" and supervisors < 3:
                    role_code, supervisors = "SHIFT_SUPERVISOR", supervisors + 1
                elif position == "POS-009" and index == 0:
                    role_code = "AUDITOR"
                # Most staff joined over the last eight years; a few joined in the last two months.
                if number % 23 == 0:
                    hire = self.today - timedelta(days=rng.randint(10, 60))
                else:
                    hire = date(rng.randint(2017, 2025), rng.randint(1, 12), rng.randint(1, 28))
                person(f"BOST-{number:04d}", first, last, gender, role_code, department, position, grade, location, employment_type, category, hire)
                number += 1

        # Reporting lines: department staff report to their head; heads report to the Managing Director.
        managing_director = heads["DPT-EXE"]
        director_employment = managing_director.employments.get(is_current=True)
        for employment in Employment.objects.filter(institution=institution, is_current=True).select_related("department", "employee"):
            head = heads.get(employment.department.code)
            manager = director_employment if head is None or head.id == employment.employee_id else head.employments.get(is_current=True)
            if employment.employee_id == managing_director.id:
                manager = None
            if employment.reports_to_id != (manager.id if manager else None):
                employment.reports_to = manager
                employment.save(update_fields=("reports_to", "updated_at"))
        for code, head in heads.items():
            department = institution.departments.get(code=code)
            if department.head_id != head.id:
                department.head = head
                department.save(update_fields=("head", "updated_at"))

    def _emergency_contacts(self):
        rng = random.Random("bost-contacts")
        for employee in self.institution.employees.order_by("employee_number"):
            if EmergencyContact.objects.filter(employee=employee).exists():
                continue
            if rng.random() < 0.08:
                continue  # A few records are still incomplete.
            gender_names = FEMALE_NAMES + MALE_NAMES
            save_emergency_contact(
                institution=self.institution, employee=employee,
                full_name=f"{rng.choice(gender_names)} {employee.last_name if rng.random() < 0.6 else rng.choice(SURNAMES)}",
                relationship=rng.choice(RELATIONSHIPS), phone=f"+23327{rng.randint(1000000, 9999999)}",
                address=f"{rng.randint(1, 80)} {rng.choice(('Ring Road', 'Liberation Road', 'Oxford Street', 'Harbour Road', 'Adum High Street'))}, Ghana",
                is_primary=True,
            )
            self._count("emergency contacts")

    # --------------------------------------------------------------- schedules

    def _schedules(self):
        institution, admin = self.institution, self.admin

        def shift(code, name, start, end, overnight=False):
            return Shift.objects.get_or_create(
                institution=institution, code=code,
                defaults={"name": name, "start_time": start, "end_time": end, "crosses_midnight": overnight, "break_minutes": 30, "grace_period_minutes": 10, "is_active": True},
            )[0]

        office = shift("SH-OFFICE", "Office Hours", time(8, 0), time(17, 0))
        day = shift("SH-DEPOT-DAY", "Depot Day Shift", time(6, 0), time(14, 0))
        late = shift("SH-DEPOT-LATE", "Depot Late Shift", time(14, 0), time(22, 0))
        night = shift("SH-DEPOT-NIGHT", "Depot Night Shift", time(22, 0), time(6, 0), True)
        patterns = {}
        for code, name, selected in (("PAT-DAY", "Depot Day Pattern", day), ("PAT-LATE", "Depot Late Pattern", late), ("PAT-NIGHT", "Depot Night Pattern", night)):
            pattern, _ = ShiftPattern.objects.get_or_create(institution=institution, code=code, defaults={"name": name, "cycle_length_days": 1, "is_active": True})
            ShiftPatternDay.objects.get_or_create(institution=institution, shift_pattern=pattern, day_index=0, defaults={"shift": selected, "is_off_day": False})
            patterns[code] = pattern
        flexible, _ = FlexibleWorkRule.objects.get_or_create(
            institution=institution, name="Hybrid Flexible Hours",
            defaults={"earliest_start": time(7, 30), "latest_start": time(10, 0), "earliest_end": time(15, 30), "latest_end": time(19, 0), "required_minutes": 480, "core_start": time(10, 0), "core_end": time(15, 0), "is_active": True},
        )
        effective = date(self.today.year - 1, 1, 1)
        specs = (
            ("SCH-OFFICE", "Office Hours", WorkSchedule.ScheduleType.FIXED, {"fixed_shift": office}),
            ("SCH-DAY", "Depot Day Shift", WorkSchedule.ScheduleType.SHIFT_PATTERN, {"shift_pattern": patterns["PAT-DAY"]}),
            ("SCH-LATE", "Depot Late Shift", WorkSchedule.ScheduleType.SHIFT_PATTERN, {"shift_pattern": patterns["PAT-LATE"]}),
            ("SCH-NIGHT", "Depot Night Shift", WorkSchedule.ScheduleType.SHIFT_PATTERN, {"shift_pattern": patterns["PAT-NIGHT"]}),
            ("SCH-FLEX", "Hybrid Flexible Hours", WorkSchedule.ScheduleType.FLEXIBLE, {"flexible_rule": flexible}),
        )
        schedules = {}
        for code, name, schedule_type, configuration in specs:
            schedules[code], _ = WorkSchedule.objects.get_or_create(institution=institution, code=code, defaults={"name": name, "schedule_type": schedule_type, "effective_from": effective, "timezone": "Africa/Accra", "is_active": True, **configuration})

        rng = random.Random("bost-schedules")
        for employee in institution.employees.filter(status=Employee.Status.ACTIVE).order_by("employee_number"):
            if ScheduleAssignment.objects.filter(employee=employee, is_current=True).exists():
                continue
            employment = employee.employments.select_related("department", "location", "position").get(is_current=True)
            code = "SCH-OFFICE"
            if employment.location.is_remote:
                code = "SCH-FLEX"
            elif employment.department.code in ("DPT-DEP", "DPT-PIP") and employment.position.code not in ("POS-013", "POS-017"):
                roll = rng.random()
                code = "SCH-NIGHT" if roll < 0.2 else ("SCH-LATE" if roll < 0.45 else "SCH-DAY")
            create_schedule_assignment(institution=institution, employee=employee, work_schedule=schedules[code], effective_from=max(effective, employment.start_date), is_current=True, assigned_by=admin)
            self._count("schedules")

    # -------------------------------------------------------------------- leave

    def _approve(self, request):
        for approval in request.approvals.filter(status="PENDING").order_by("sequence"):
            request = approve_leave_request(leave_request=request, actor=approval.approver, comment="Approved. Enjoy your time off.")
        return request

    def _book_leave(self, employee, leave_type, start, days, target):
        start = next_weekday(start)
        end = add_weekdays(start, days)
        reason = f"BOST-LEAVE {employee.employee_number} {start:%Y-%m-%d}"
        if start.year != self.today.year or LeaveRequest.objects.filter(institution=self.institution, employee=employee, reason=reason).exists():
            return
        if start < employee.hire_date:
            return
        overlapping = LeaveRequest.objects.filter(employee=employee, start_date__lte=end, end_date__gte=start).exclude(status__in=(LeaveRequest.Status.REJECTED, LeaveRequest.Status.CANCELLED))
        if overlapping.exists():
            return
        try:
            request = create_leave_request(institution=self.institution, actor=employee.user, employee=employee, leave_type=leave_type, start_date=start, end_date=end, requested_days=weekdays_between(start, end), reason=reason)
            if target != "DRAFT":
                request = submit_leave_request(leave_request=request, actor=employee.user)
            if target in ("APPROVED", "CANCELLED"):
                request = self._approve(request)
            if target == "CANCELLED" and request.status == LeaveRequest.Status.APPROVED and start > self.today:
                cancel_leave_request(leave_request=request, actor=employee.user)
            if target == "REJECTED":
                approval = request.approvals.filter(status="PENDING").order_by("sequence").first()
                if approval:
                    reject_leave_request(leave_request=request, actor=approval.approver, comment="Peak operational period; please choose other dates.")
            self._count("leave")
        except SERVICE_ERRORS:
            return  # Balance, eligibility or policy limit for this person: skip rather than force it.

    def _leave(self):
        types = {leave_type.code: leave_type for leave_type in LeaveType.objects.filter(institution=self.institution)}
        employees = self._active_employees()
        rng = random.Random(f"bost-leave-{self.today.year}")
        order = employees[:]
        rng.shuffle(order)
        today = self.today
        year_start = date(today.year, 1, 6)
        cursor = 0

        def take(n):
            nonlocal cursor
            chosen = order[cursor:cursor + n]
            cursor += n
            return chosen

        # Taken earlier this year: most people have one or two approved breaks behind them.
        for index, employee in enumerate(order):
            for trip in range(1 + index % 2):
                start = year_start + timedelta(days=rng.randint(0, max(1, (today - year_start).days - self.history_days - 10)))
                leave_type = types["SICK"] if rng.random() < 0.25 else (types["CASUAL"] if rng.random() < 0.15 else types["ANNUAL"])
                days = rng.randint(1, 2) if leave_type.code != "ANNUAL" else rng.randint(2, 5)
                self._book_leave(employee, leave_type, start, days, "APPROVED")
        # Away right now.
        for employee in take(7):
            self._book_leave(employee, types["ANNUAL"] if rng.random() < 0.7 else types["SICK"], today - timedelta(days=rng.randint(0, 3)), rng.randint(2, 6), "APPROVED")
        # Booked over the coming weeks.
        for employee in take(14):
            self._book_leave(employee, types["ANNUAL"], today + timedelta(days=rng.randint(3, 50)), rng.randint(2, 5), "APPROVED")
        # Awaiting a decision.
        for employee in take(16):
            self._book_leave(employee, rng.choice((types["ANNUAL"], types["ANNUAL"], types["STUDY"], types["COMPASSIONATE"])), today + timedelta(days=rng.randint(5, 45)), rng.randint(1, 5), "PENDING")
        # Declined, withdrawn and still being drafted.
        for employee in take(6):
            self._book_leave(employee, types["ANNUAL"], today + timedelta(days=rng.randint(8, 40)), rng.randint(3, 5), "REJECTED")
        for employee in take(4):
            self._book_leave(employee, types["ANNUAL"], today + timedelta(days=rng.randint(10, 40)), rng.randint(2, 4), "CANCELLED")
        for employee in take(3):
            self._book_leave(employee, types["ANNUAL"], today + timedelta(days=rng.randint(20, 60)), rng.randint(3, 5), "DRAFT")
        # Family leave.
        mothers = [employee for employee in order[cursor:] if employee.gender == "FEMALE"][:2]
        fathers = [employee for employee in order[cursor:] if employee.gender == "MALE"][:2]
        if mothers:
            self._book_leave(mothers[0], types["MATERNITY"], today - timedelta(days=30), 60, "APPROVED")
        if len(mothers) > 1:
            self._book_leave(mothers[1], types["MATERNITY"], today + timedelta(days=24), 60, "PENDING")
        for employee in fathers:
            self._book_leave(employee, types["PATERNITY"], today + timedelta(days=rng.randint(-10, 30)), 5, "APPROVED")

    # --------------------------------------------------------------- attendance

    def _attendance(self):
        start = self.today - timedelta(days=self.history_days)
        created = 0
        for employee in self._active_employees():
            first_day = max(start, employee.hire_date)
            for offset in range((self.today - first_day).days + 1):
                created += self._attendance_day(employee, first_day + timedelta(days=offset))
        self._count("attendance", created)

    def _attendance_day(self, employee, day):
        if AttendanceRecord.objects.filter(employee=employee, attendance_date=day).exists():
            return 0
        assignment = schedule_assignment_for(employee, day)
        if assignment is None:
            return 0
        try:
            expectation = schedule_expectation(assignment, day)
        except SERVICE_ERRORS:
            return 0
        if expectation["off_day"]:
            return 0
        schedule_type = assignment.work_schedule.schedule_type
        # Office and hybrid staff work Monday to Friday; the depot runs six days.
        if (schedule_type in ("FIXED", "FLEXIBLE") and day.weekday() >= 5) or day.weekday() == 6:
            return 0
        rng = random.Random(f"bost-attendance-{employee.employee_number}-{day.isoformat()}")
        on_leave = LeaveRequest.objects.filter(employee=employee, status=LeaveRequest.Status.APPROVED, start_date__lte=day, end_date__gte=day).exists()
        shift_start, shift_end = expectation["start"], expectation["end"]
        try:
            if on_leave:
                classify_attendance_date(employee=employee, attendance_date=day, actor=self.admin)
                return 1
            if shift_start is None or shift_start > self.now:
                return 0  # This shift has not started yet.
            roll = rng.random()
            is_today = day == self.today
            if roll < 0.035 and not is_today:
                classify_attendance_date(employee=employee, attendance_date=day, actor=self.admin)  # Absent.
                return 1
            if is_today and roll < 0.08:
                return 0  # Not clocked in yet.
            flexible = expectation["flexible_rule"]
            on_time_window = (datetime.combine(day, flexible.latest_start, self.zone) - shift_start).seconds // 60 if flexible else expectation["grace_minutes"]
            late = roll < 0.13
            if late:
                arrival = shift_start + timedelta(minutes=on_time_window + rng.randint(3, 45))
            else:
                arrival = shift_start + timedelta(minutes=rng.randint(0, on_time_window))  # Inside the grace window: on time.
            if arrival > self.now:
                return 0  # Not in yet.
            record = clock_in(employee=employee, actor=self.admin, at=arrival)
            # A normal day covers exactly the required hours plus the break, so it shows no
            # overtime; late arrivals still leave at the shift end; one day in ten runs over.
            full_day = arrival + timedelta(minutes=expectation["required_minutes"] + expectation["break_minutes"])
            if rng.random() < 0.1:
                departure = full_day + timedelta(minutes=rng.randint(60, 180))
            elif late and not flexible:
                departure = shift_end
            else:
                departure = full_day
            if departure <= self.now and rng.random() >= 0.015:  # A few people forget to clock out.
                clock_out(attendance_record=record, actor=self.admin, at=departure)
            return 1
        except SERVICE_ERRORS:
            return 0

    def _corrections_and_overtime(self):
        institution, admin = self.institution, self.admin
        records = list(
            AttendanceRecord.objects.filter(institution=institution, check_out__isnull=False, attendance_date__gte=self.today - timedelta(days=20), attendance_date__lt=self.today - timedelta(days=1), employee__status=Employee.Status.ACTIVE)
            .select_related("employee__user").order_by("employee__employee_number", "attendance_date")
        )
        rng = random.Random("bost-corrections")
        rng.shuffle(records)
        seen = set()
        made = 0
        reasons = ("Forgot to clock out after a late product receipt.", "Badge reader at the depot gate was offline.", "Clocked in late from the Kumasi depot; arrived on time.", "Stayed back for tank gauging; clock-out not captured.")
        for record in records:
            if made >= 18 or record.employee_id in seen or not record.employee.user_id:
                continue
            seen.add(record.employee_id)
            if AttendanceAdjustment.objects.filter(attendance_record=record).exists():
                made += 1
                continue
            try:
                adjustment = request_adjustment(institution=institution, attendance_record=record, actor=record.employee.user, reason=reasons[made % len(reasons)], proposed_values={"check_out": (record.check_out + timedelta(minutes=30 + 15 * (made % 5))).isoformat()})
                if made % 3 == 1:
                    decide_adjustment(adjustment=adjustment, actor=admin, approve=True, comment="Confirmed with the supervisor.")
                elif made % 6 == 2:
                    decide_adjustment(adjustment=adjustment, actor=admin, approve=False, comment="No evidence of extra hours on the shift log.")
            except SERVICE_ERRORS:
                continue
            made += 1
            self._count("attendance corrections and overtime")

        cutoff = self.today - timedelta(days=7)
        for record in OvertimeRecord.objects.filter(institution=institution, status=OvertimeRecord.Status.PENDING, attendance_record__attendance_date__lt=cutoff):
            try:
                decide_overtime(overtime_record=record, actor=admin, approve=random.Random(f"bost-ot-{record.id}").random() < 0.85, approved_minutes=record.calculated_minutes)
                self._count("attendance corrections and overtime")
            except SERVICE_ERRORS:
                continue

    # -------------------------------------------------------------- recruitment

    def _recruitment(self):
        institution, admin = self.institution, self.admin
        approver = self.institution.employees.get(employee_number="BOST-0001").user  # Managing Director approves requisitions.
        hr_partner = InstitutionMembership.objects.filter(institution=institution, role__code="HR_ADMIN", status="ACTIVE").select_related("user").order_by("user__email").first()
        submitter = hr_partner.user if hr_partner else admin
        stages = {}
        for sequence, name in enumerate(STAGES, start=1):
            stages[name], _ = RecruitmentStage.objects.get_or_create(institution=institution, sequence=sequence, defaults={"name": name, "is_active": True})

        postings = {}
        for code, title, department, position, location, target, openings, reason, opened_days_ago in REQUISITIONS:
            posting = JobPosting.objects.filter(institution=institution, code=code).first()
            if posting is None:
                department_obj = institution.departments.get(code=department)
                head = department_obj.head.user if department_obj.head and department_obj.head.user_id else admin
                posting = JobPosting(
                    institution=institution, code=code, title=title, department=department_obj, position=institution.positions.get(code=position),
                    location=institution.locations.get(code=location), hiring_manager=head, employment_type="PERMANENT", openings=openings,
                    hiring_reason=reason, target_start_date=self.today + timedelta(days=45), interview_plan=JobPosting.InterviewPlan.TWO_STAGE,
                    description=f"BOST Energy is hiring a {title} to support safe, reliable petroleum storage and supply across Ghana.",
                    responsibilities="Deliver day-to-day duties safely and to standard; work with the team to meet service levels; keep accurate records.",
                    qualifications_essential="Relevant qualification or equivalent experience; strong communication; commitment to safety.",
                    qualifications_desirable="Experience in the downstream petroleum sector.",
                )
                posting.full_clean()
                posting.save()
                self._count("recruitment")
            if target != "DRAFT" and posting.status == JobPosting.Status.DRAFT:
                posting = submit_job_posting_for_approval(job_posting=posting, actor=submitter)
            if target in ("APPROVED", "OPEN", "CLOSED") and posting.status == JobPosting.Status.PENDING_APPROVAL:
                posting = approve_job_posting(job_posting=posting, actor=approver, comment="Budgeted headcount. Approved.")
            if target in ("OPEN", "CLOSED") and posting.status == JobPosting.Status.APPROVED:
                posting = publish_job_posting(job_posting=posting, actor=submitter)
                JobPosting.objects.filter(pk=posting.pk).update(opens_on=self.today - timedelta(days=opened_days_ago))
            postings[code] = posting

        rng = random.Random("bost-candidates")
        # Pipeline per open posting: (stage, outcome) pairs; outcomes: None, REJECTED, WITHDRAWN, OFFER, DECLINED, HIRED
        pipeline = (
            ("Applied", None), ("Applied", None), ("Applied", "REJECTED"), ("Screening", None), ("Screening", "REJECTED"),
            ("Shortlisted", None), ("Interview", None), ("Interview", "WITHDRAWN"), ("Final Review", None), ("Offer", "OFFER"),
        )
        extra = {"BOST-JOB-001": (("Offer", "HIRED"), ("Interview", None), ("Applied", None)), "BOST-JOB-002": (("Offer", "DECLINED"), ("Shortlisted", None)), "BOST-JOB-007": ()}
        hire_number = 900
        for code, posting in postings.items():
            if posting.status not in (JobPosting.Status.OPEN, JobPosting.Status.CLOSED):
                continue
            if code == "BOST-JOB-007":
                plan = (("Offer", "HIRED"), ("Interview", "REJECTED"), ("Final Review", "REJECTED"), ("Screening", "REJECTED"))
            else:
                plan = pipeline + extra.get(code, ())
            for index, (stage_name, outcome) in enumerate(plan):
                first = rng.choice(FEMALE_NAMES + MALE_NAMES)
                last = rng.choice(SURNAMES)
                email = f"{first}.{last}.{code[-3:]}{index:02d}@applicants.bostenergy.com.gh".lower()
                candidate = Candidate.objects.filter(institution=institution, email=email).first()
                if candidate is not None:
                    continue
                candidate = Candidate.objects.create(
                    institution=institution, email=email, first_name=first, last_name=last, phone=f"+23355{rng.randint(1000000, 9999999)}",
                    source=rng.choice(SOURCES), location=rng.choice(("Accra, Ghana", "Tema, Ghana", "Kumasi, Ghana", "Buipe, Ghana", "Takoradi, Ghana")),
                    years_experience=rng.randint(0, 12), highest_qualification=rng.choice((Candidate.Qualification.BACHELORS, Candidate.Qualification.MASTERS, Candidate.Qualification.PROFESSIONAL)),
                    field_of_study=rng.choice(("Petroleum Engineering", "Logistics & Supply Chain", "Business Administration", "Computer Science", "Mechanical Engineering", "Human Resource Management")),
                    education_institution=rng.choice(("University of Ghana", "KNUST", "University of Cape Coast", "Ghana Institute of Management and Public Administration", "Accra Technical University")),
                    notice_period_weeks=rng.choice((0, 2, 4, 4, 8)),
                )
                was_open = posting.status == JobPosting.Status.OPEN
                if not was_open:
                    JobPosting.objects.filter(pk=posting.pk).update(status=JobPosting.Status.OPEN)
                application = Application.objects.create(institution=institution, job_posting=posting, candidate=candidate, notes=f"Source: {candidate.source}")
                application = submit_application(application=application, actor=admin)
                if not was_open:
                    JobPosting.objects.filter(pk=posting.pk).update(status=posting.status)
                applied_at = self.now - timedelta(days=rng.randint(1, 35), hours=rng.randint(0, 9))
                Application.objects.filter(pk=application.pk).update(applied_at=applied_at)
                for name in STAGES[1:STAGES.index(stage_name) + 1]:
                    application = move_application_stage(application=application, stage=stages[name], actor=admin, comment=f"Moved to {name}.")
                if STAGES.index(stage_name) >= STAGES.index("Interview"):
                    interview_day = self.today - timedelta(days=rng.randint(2, 15))
                    Interview.objects.create(
                        institution=institution, application=application, scheduled_at=self._stamp(interview_day, rng.choice((9, 10, 11, 14, 15))),
                        duration_minutes=45, interview_type="First round interview", interview_stage=Interview.Stage.FIRST_ROUND, mode=Interview.Mode.IN_PERSON,
                        location_or_link="Head Office, Boardroom", interviewer=admin, status=Interview.Status.COMPLETED if outcome != "WITHDRAWN" else Interview.Status.NO_SHOW,
                        notes="Panel interview",
                    )
                if outcome == "REJECTED":
                    reject_application(application=application, actor=admin, reason="Another candidate was a closer match for the role.")
                elif outcome == "WITHDRAWN":
                    withdraw_application(application=application, actor=admin)
                elif outcome in ("OFFER", "DECLINED", "HIRED"):
                    offer = Offer.objects.create(
                        institution=institution, application=application, proposed_start_date=self.today + timedelta(days=rng.randint(14, 40)),
                        employment_type="PERMANENT", department=posting.department, position=posting.position, grade=institution.grades.get(code="GRD-06" if posting.position.code in ("POS-015", "POS-019", "POS-023") else "GRD-05"),
                        location=posting.location, staff_category="JUNIOR", terms="Standard BOST Energy terms: six-month probation, 15 days annual leave.",
                    )
                    offer = extend_offer(offer=offer, actor=admin)
                    if outcome == "DECLINED":
                        decide_offer(offer=offer, actor=admin, accepted=False, note="Accepted a counter-offer from current employer.")
                    elif outcome == "HIRED":
                        offer = decide_offer(offer=offer, actor=admin, accepted=True, note="Signed offer letter received.")
                        while Employee.objects.filter(institution=institution, employee_number=f"BOST-{hire_number:04d}").exists():
                            hire_number += 1
                        hire_candidate(offer=offer, actor=admin, employee_number=f"BOST-{hire_number:04d}")
                        hire_number += 1
                self._count("recruitment")
            if code == "BOST-JOB-007" and posting.status == JobPosting.Status.OPEN:
                close_job_posting(job_posting=posting, actor=submitter)

        # Upcoming interviews for the active pipeline.
        upcoming = list(Application.objects.filter(institution=institution, status=Application.Status.ACTIVE, current_stage__name__in=("Shortlisted", "Interview", "Final Review")).select_related("candidate").order_by("applied_at"))
        panel = [admin, submitter]
        for index, application in enumerate(upcoming[:12]):
            when = self._stamp(next_weekday(self.today + timedelta(days=1 + index // 3)), 9 + (index % 3) * 2, 30 if index % 2 else 0)
            note = f"BOST-INT {application.candidate.email} {when:%Y-%m-%d}"
            if Interview.objects.filter(institution=institution, notes=note).exists():
                continue
            stage = (Interview.Stage.SCREENING, Interview.Stage.FIRST_ROUND, Interview.Stage.SECOND_ROUND, Interview.Stage.FINAL)[index % 4]
            interview = Interview.objects.create(
                institution=institution, application=application, scheduled_at=when, duration_minutes=30 if stage == Interview.Stage.SCREENING else 60,
                interview_type=dict(Interview.Stage.choices)[stage], interview_stage=stage, mode=Interview.Mode.VIDEO if index % 2 else Interview.Mode.IN_PERSON,
                location_or_link="https://meet.bostenergy.com.gh/interview" if index % 2 else "Head Office, Meeting Room 2",
                interviewer=panel[index % 2], status=Interview.Status.SCHEDULED, notes=note,
            )
            interview.panel.set(panel)
            self._count("recruitment")

    # ---------------------------------------------------------------- documents

    def _documents(self):
        if not self.with_documents:
            self.summary["documents"] = "skipped (--no-documents)"
            return
        institution, admin = self.institution, self.admin
        for index, employee in enumerate(institution.employees.order_by("employee_number")):
            for doc_index, (title, category) in enumerate(DOCUMENTS):
                if doc_index > index % 4:
                    continue  # Not everyone has every document on file yet.
                filename = f"{employee.employee_number} {title}.pdf"
                if Document.objects.filter(institution=institution, entity_type="EMPLOYEE", entity_id=employee.id, original_filename=filename).exists():
                    continue
                document = Document(institution=institution, uploaded_by=admin, original_filename=filename, content_type="application/pdf", size_bytes=len(MINIMAL_PDF), category=category, classification=Document.Classification.CONFIDENTIAL, entity_type="EMPLOYEE", entity_id=employee.id, is_active=True)
                document.stored_file.save(f"bost-demo/{employee.employee_number}-{category.lower()}-{doc_index}.pdf", ContentFile(MINIMAL_PDF), save=False)
                document.save()
                self._count("documents")

    # ------------------------------------------------------- joiners and leavers

    def _lifecycle(self):
        institution, admin = self.institution, self.admin
        # Recent joiners are mid-onboarding; everyone else completed it long ago.
        recent = institution.employees.filter(hire_date__gte=self.today - timedelta(days=60)).order_by("employee_number")
        for index, employee in enumerate(recent):
            if EmployeeOnboarding.objects.filter(employee=employee).exclude(status=EmployeeOnboarding.Status.NOT_STARTED).exists():
                continue
            if index % 3 == 0:
                complete_employee_onboarding(institution=institution, employee=employee, actor=admin)
            else:
                start_employee_onboarding(institution=institution, employee=employee, actor=admin)
            self._count("joiners and leavers")

        # A few people left this year, two are serving notice and one is suspended.
        candidates = [employee for employee in institution.employees.filter(status=Employee.Status.ACTIVE, user__isnull=False, employee_number__gt="BOST-0020").order_by("employee_number") if not employee.employments.filter(is_current=True, department__head=employee).exists()]
        rng = random.Random("bost-lifecycle")
        rng.shuffle(candidates)
        if institution.employees.filter(status=Employee.Status.TERMINATED).count() < 4:
            reasons = ("Resignation: relocating abroad", "Resignation: further studies", "End of fixed-term contract", "Retirement")
            for index, employee in enumerate(candidates[:4]):
                if LeaveRequest.objects.filter(employee=employee, status=LeaveRequest.Status.PENDING).exists():
                    continue
                last_day = self.today - timedelta(days=20 + index * 35)
                current = employee.employments.filter(is_current=True).first()
                if current and last_day < current.start_date:
                    continue
                initiate_employee_offboarding(institution=institution, employee=employee, actor=admin, last_working_day=last_day, reason=reasons[index])
                complete_employee_offboarding(institution=institution, employee=employee, actor=admin)
                self._count("joiners and leavers")
            for employee in candidates[4:6]:
                initiate_employee_offboarding(institution=institution, employee=employee, actor=admin, last_working_day=self.today + timedelta(days=21), reason="Resignation: new opportunity")
                self._count("joiners and leavers")
            suspended = candidates[6] if len(candidates) > 6 else None
            if suspended:
                Employee.objects.filter(pk=suspended.pk).update(status=Employee.Status.SUSPENDED)
                self._count("joiners and leavers")

    def _finish_onboarding(self):
        validate_institution_onboarding(institution=self.institution, actor=self.admin)
        self.institution.refresh_from_db()
        onboarding = InstitutionOnboarding.objects.get(institution=self.institution)
        self.summary["onboarding checklist"] = f"{onboarding.status} ({onboarding.completion_percentage}%)"
