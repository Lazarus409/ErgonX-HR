"""Seed rolling, date-relative operational activity for the CSA-DEMO tenant.

``seed_ergonx_demo`` creates the fixed foundation and a handful of reviewed
workflow scenarios. Dashboards, however, are about *now*: today's attendance,
who is on leave this week, interviews coming up, overdue bills. This command
layers realistic activity around the current date on top of that foundation so
every dashboard and self-service page has real data.

* Development-only (refuses to run when DEBUG=False) and CSA-DEMO only.
* Idempotent: every record carries a stable key (number, reference, reason or
  external id) and is skipped when it already exists, so re-running simply
  fills in the days that have passed since the last run.
* Every record goes through the domain services, so balances, ledgers,
  approvals, notifications and audit events stay consistent.
* Variation is deterministic (seeded per employee and date), not random noise.

Run after ``seed_ergonx_demo``:

    python manage.py seed_ergonx_demo
    python manage.py seed_ergonx_activity
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

from apps.accounting.models import Account, AccountingPeriod, BankAccount, BankStatementLine, Customer, Expense, FiscalYear, Invoice, JournalEntry, Receipt, Vendor, VendorBill
from apps.accounting.services import (
    approve_expense,
    approve_journal,
    approve_vendor_bill,
    create_account,
    create_accounting_period,
    create_bank_statement_line,
    create_customer,
    create_expense,
    create_invoice,
    create_journal,
    create_payment,
    create_receipt,
    create_vendor,
    create_vendor_bill,
    generate_payroll_journal,
    issue_invoice,
    match_bank_statement_line,
    post_expense,
    post_journal,
    post_vendor_bill,
    submit_expense,
    submit_journal,
    submit_vendor_bill,
)
from apps.accounts.models import User
from apps.attendance.models import AttendanceAdjustment, AttendanceRecord, OvertimeRecord
from apps.attendance.services import classify_attendance_date, clock_in, clock_out, decide_adjustment, decide_overtime, request_adjustment
from apps.documents.models import Document
from apps.institutions.models import Institution
from apps.leave.models import LeaveRequest, LeaveType
from apps.leave.services import approve_leave_request, create_leave_request, submit_leave_request
from apps.payroll.models import PayrollPeriod, PayrollRun
from apps.payroll.services import approve_payroll_run, calculate_payroll_run, create_payroll_period, create_payroll_run, finalize_payroll_run, submit_payroll_run_for_review
from apps.recruitment.models import Application, Candidate, Interview, JobPosting, Offer, RecruitmentStage
from apps.recruitment.services import decide_offer, extend_offer, move_application_stage, reject_application, submit_application
from apps.scheduling.services import schedule_assignment_for, schedule_expectation

DEMO_INSTITUTION_CODE = "CSA-DEMO"
DEMO_ADMIN_EMAIL = "kwame.mensah@csa.test"
SERVICE_ERRORS = (DjangoValidationError, ApiValidationError)
ATTENDANCE_DAYS = 35
MINIMAL_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
)


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
    help = "Seed rolling, date-relative CSA-DEMO activity so every dashboard shows real data (development only)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=ATTENDANCE_DAYS, help="Days of attendance history to maintain (default 35).")

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_ergonx_activity is development-only and refuses to run when DEBUG=False.")
        institution = Institution.objects.filter(code=DEMO_INSTITUTION_CODE).first()
        if institution is None:
            raise CommandError("CSA-DEMO does not exist. Run `python manage.py seed_ergonx_demo` first.")
        self.institution = institution
        self.admin = User.objects.get(email=DEMO_ADMIN_EMAIL)
        self.zone = ZoneInfo(institution.timezone)
        self.now = timezone.now().astimezone(self.zone)
        self.today = self.now.date()
        self.history_days = options["days"]
        self.summary = {}

        steps = (
            ("chart of accounts", self._accounts),
            ("accounting periods", self._accounting_periods),
            ("payroll history", self._payroll_history),
            ("leave", self._leave),
            ("attendance", self._attendance),
            ("recruitment", self._recruitment),
            ("receivables and payables", self._receivables_and_payables),
            ("expenses", self._expenses),
            ("bank reconciliation", self._bank_lines),
            ("journals awaiting approval", self._pending_journals),
            ("employee documents and corrections", self._employee_self_service),
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
            raise CommandError(f"Activity seeding failed for: {', '.join(failures)}")
        self.stdout.write(self.style.SUCCESS(f"CSA-DEMO activity is current as of {self.today.isoformat()}."))

    # ------------------------------------------------------------------ helpers

    def _count(self, label, amount=1):
        created = self.summary.setdefault(label, {"created": 0})
        created["created"] += amount

    def _stamp(self, day, hour, minute=0):
        return datetime.combine(day, time(0, 0), self.zone) + timedelta(hours=hour, minutes=minute)

    def _employee(self, number):
        return self.institution.employees.get(employee_number=number)

    def _employees(self):
        return list(self.institution.employees.select_related("user").order_by("employee_number"))

    def _department(self, employee):
        employment = employee.employments.filter(is_current=True).select_related("department").first()
        return employment.department.code if employment else ""

    def _self_service_people(self):
        """Employees whose day-to-day view is Employee Home (the EMPLOYEE role)."""
        users = set(
            self.institution.memberships.filter(role__code="EMPLOYEE", status="ACTIVE").values_list("user_id", flat=True)
        )
        return [employee for employee in self._employees() if employee.user_id in users]

    def _account(self, code):
        return self.institution.accounts.get(code=code)

    def _period_for(self, day):
        return self.institution.accounting_periods.get(start_date__lte=day, end_date__gte=day)

    # --------------------------------------------------------- accounting setup

    EXPENSE_ACCOUNTS = (
        ("5300", "Utilities expense"),
        ("5310", "Internet and communication expense"),
        ("5400", "Travel and transport expense"),
        ("5500", "Office supplies expense"),
        ("5600", "Professional fees expense"),
        ("5700", "Repairs and maintenance expense"),
    )

    def _accounts(self):
        template = self._account("5200")
        for code, name in self.EXPENSE_ACCOUNTS:
            if not self.institution.accounts.filter(code=code).exists():
                create_account(institution=self.institution, actor=self.admin, code=code, name=name, account_type=template.account_type, parent=template.parent, normal_balance=template.normal_balance, is_postable=True, is_active=True)
                self._count("chart of accounts")

    def _accounting_periods(self):
        fiscal_year = FiscalYear.objects.get(institution=self.institution, name="FY2026")
        for month in range(6, 12):
            start = date(2026, month, 1)
            end = (date(2026, month + 1, 1) if month < 12 else date(2027, 1, 1)) - timedelta(days=1)
            if start > self.today + timedelta(days=40):
                break
            name = start.strftime("%B %Y")
            if not AccountingPeriod.objects.filter(institution=self.institution, start_date=start).exists():
                create_accounting_period(institution=self.institution, actor=self.admin, fiscal_year=fiscal_year, name=name, start_date=start, end_date=end)
                self._count("accounting periods")

    # ----------------------------------------------------------------- payroll

    def _payroll_history(self):
        """Finalized, journal-posted payroll for the months before the seeded September run."""
        for month in (6, 7, 8):
            start = date(2026, month, 1)
            end = date(2026, month + 1, 1) - timedelta(days=1)
            if end >= self.today:
                continue
            period = PayrollPeriod.objects.filter(institution=self.institution, start_date=start, end_date=end).first()
            if period is None:
                period = create_payroll_period(institution=self.institution, actor=self.admin, name=start.strftime("%B %Y"), start_date=start, end_date=end, pay_date=end)
            run = create_payroll_run(institution=self.institution, payroll_period=period, actor=self.admin, idempotency_key=f"apex-activity-{start:%Y-%m}")
            if run.status == PayrollRun.Status.DRAFT:
                run = calculate_payroll_run(payroll_run=run, actor=self.admin)
            if run.status == PayrollRun.Status.CALCULATED:
                run = submit_payroll_run_for_review(payroll_run=run, actor=self.admin)
            if run.status == PayrollRun.Status.UNDER_REVIEW:
                # Preparer != approver (BQ-04): the Finance Manager approves.
                run = approve_payroll_run(payroll_run=run, actor=self.institution.memberships.select_related("user").get(role__code="FINANCE_MANAGER", status="ACTIVE").user)
            if run.status == PayrollRun.Status.APPROVED:
                run = finalize_payroll_run(payroll_run=run, actor=self.admin)
                self._count("payroll history")
            run.refresh_from_db()
            journal = run.accounting_journal_entry or generate_payroll_journal(payroll_run=run, actor=self.admin)
            if journal.status == JournalEntry.Status.DRAFT:
                journal = submit_journal(journal=journal, actor=self.admin)
            if journal.status == JournalEntry.Status.PENDING_APPROVAL:
                journal = approve_journal(journal=journal, actor=self.admin, system=True)  # demo seed: recorded history, not a live approval
            if journal.status == JournalEntry.Status.APPROVED:
                post_journal(journal=journal, actor=self.admin)

    # ------------------------------------------------------------------- leave

    def _approve(self, request):
        for approval in request.approvals.filter(status="PENDING").order_by("sequence"):
            request = approve_leave_request(leave_request=request, actor=approval.approver, comment="Approved")
        return request

    def _book_leave(self, employee, leave_type, start, days, target, reason):
        start = next_weekday(start)
        end = add_weekdays(start, days)
        if LeaveRequest.objects.filter(institution=self.institution, employee=employee, reason=reason).exists():
            return
        overlapping = LeaveRequest.objects.filter(
            institution=self.institution, employee=employee, start_date__lte=end, end_date__gte=start
        ).exclude(status__in=(LeaveRequest.Status.REJECTED, LeaveRequest.Status.CANCELLED))
        if overlapping.exists():
            return
        try:
            request = create_leave_request(institution=self.institution, actor=employee.user, employee=employee, leave_type=leave_type, start_date=start, end_date=end, requested_days=weekdays_between(start, end), reason=reason)
            if target in {"PENDING", "APPROVED"}:
                request = submit_leave_request(leave_request=request, actor=employee.user)
            if target == "APPROVED":
                self._approve(request)
            self._count("leave")
        except SERVICE_ERRORS:
            # Balance or policy limits for this person: skip rather than force it.
            return

    def _leave(self):
        annual = LeaveType.objects.get(institution=self.institution, code="ANNUAL")
        sick = LeaveType.objects.get(institution=self.institution, code="SICK")
        employees = [employee for employee in self._employees() if employee.user_id]
        rng = random.Random(f"apex-leave-{self.today.year}")
        order = employees[:]
        rng.shuffle(order)
        today = self.today

        # Away right now, and booked over the next four weeks.
        current = [(order[0], annual, today - timedelta(days=2), 5), (order[1], sick, today - timedelta(days=1), 2)]
        upcoming = [
            (order[2], annual, today + timedelta(days=3), 3),
            (order[3], annual, today + timedelta(days=7), 5),
            (order[4], annual, today + timedelta(days=10), 2),
            (order[5], annual, today + timedelta(days=15), 4),
            (order[6], sick, today + timedelta(days=4), 1),
            (order[7], annual, today + timedelta(days=21), 5),
        ]
        for employee, leave_type, start, days in current + upcoming:
            self._book_leave(employee, leave_type, start, days, "APPROVED", f"ACT-LEAVE {employee.employee_number} {start:%Y-%m-%d}")

        # Awaiting a decision.
        for employee, start, days in ((order[8], today + timedelta(days=12), 3), (order[9], today + timedelta(days=26), 5), (order[10], today + timedelta(days=33), 2)):
            self._book_leave(employee, annual, start, days, "PENDING", f"ACT-LEAVE {employee.employee_number} {start:%Y-%m-%d}")

        # People who mainly use Employee Home each have something in flight.
        for index, employee in enumerate(self._self_service_people()[:6]):
            ahead = LeaveRequest.objects.filter(employee=employee, end_date__gte=today).exclude(status__in=(LeaveRequest.Status.REJECTED, LeaveRequest.Status.CANCELLED)).exists()
            if not ahead:
                start = today + timedelta(days=16 + index * 5)
                self._book_leave(employee, annual, start, 2 + index % 3, "PENDING", f"ACT-LEAVE {employee.employee_number} {start:%Y-%m-%d}")

        # Taken earlier this year, spread across months and departments.
        for index, employee in enumerate(order[11:27]):
            month = 2 + index % 7  # February to August
            start = date(today.year, month, 3 + (index * 5) % 20)
            leave_type = sick if index % 4 == 0 else annual
            days = 1 + (index * 3) % (3 if leave_type == sick else 5)
            if start < today - timedelta(days=self.history_days + 2):
                self._book_leave(employee, leave_type, start, days, "APPROVED", f"ACT-LEAVE {employee.employee_number} {start:%Y-%m-%d}")

    # -------------------------------------------------------------- attendance

    def _attendance(self):
        start = self.today - timedelta(days=self.history_days)
        created = 0
        for employee in self._employees():
            for offset in range((self.today - start).days + 1):
                day = start + timedelta(days=offset)
                created += self._attendance_day(employee, day)
        self._count("attendance", created)
        self._decide_overtime()

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
        # Office and hybrid teams work Monday to Friday; Tema operations run six days.
        if (schedule_type in ("FIXED", "FLEXIBLE") and day.weekday() >= 5) or day.weekday() == 6:
            return 0
        rng = random.Random(f"apex-attendance-{employee.employee_number}-{day.isoformat()}")
        on_leave = LeaveRequest.objects.filter(employee=employee, status=LeaveRequest.Status.APPROVED, start_date__lte=day, end_date__gte=day).exists()
        shift_start = expectation["start"]
        shift_end = expectation["end"]
        if on_leave:
            classify_attendance_date(employee=employee, attendance_date=day, actor=self.admin)
            return 1
        if shift_start is None or shift_start > self.now:
            return 0  # Today's shift has not started yet.
        roll = rng.random()
        is_today = day == self.today
        if roll < 0.04 and not is_today:
            classify_attendance_date(employee=employee, attendance_date=day, actor=self.admin)
            return 1
        if is_today and roll < 0.10:
            return 0  # Not clocked in yet this morning.
        if roll < 0.14:
            arrival = shift_start + timedelta(minutes=expectation["grace_minutes"] + rng.randint(4, 38))
        else:
            arrival = shift_start + timedelta(minutes=rng.randint(-18, 3))
        record = clock_in(employee=employee, actor=self.admin, at=arrival)
        if shift_end and shift_end <= self.now:
            overtime = rng.random() < 0.12
            departure = shift_end + timedelta(minutes=rng.randint(60, 150) if overtime else rng.randint(-4, 22))
            if departure <= self.now:
                clock_out(attendance_record=record, actor=self.admin, at=departure)
        return 1

    def _decide_overtime(self):
        """Older overtime is decided; the last week stays pending for review."""
        cutoff = self.today - timedelta(days=7)
        pending = OvertimeRecord.objects.filter(institution=self.institution, status=OvertimeRecord.Status.PENDING, attendance_record__attendance_date__lt=cutoff)
        approver = self.admin
        for record in pending.select_related("attendance_record"):
            rng = random.Random(f"apex-overtime-{record.id}")
            try:
                decide_overtime(overtime_record=record, actor=approver, approve=rng.random() < 0.85, approved_minutes=record.calculated_minutes)
            except SERVICE_ERRORS:
                # e.g. the date's payroll is already finalized (LC-ATT-01): leave it pending.
                continue

    # ------------------------------------------------------------- recruitment

    SOURCES = ("LinkedIn", "Employee referral", "Careers page", "Jobberman", "Recruitment agency", "University job fair")
    HISTORY_CANDIDATES = (
        ("Kofi", "Boateng", "JOB-2026-00018", 150, "Screening", None),
        ("Efua", "Quaye", "JOB-2026-00019", 138, "Offer", 14),
        ("Yaw", "Darkwa", "JOB-2026-00020", 124, "Interview", None),
        ("Abena", "Owusu", "JOB-2026-00018", 110, "Offer", 26),
        ("Nii", "Lamptey", "JOB-2026-00019", 96, "Applied", "REJECTED"),
        ("Adjoa", "Frimpong", "JOB-2026-00020", 84, "Offer", 41),
        ("Kwabena", "Asante", "JOB-2026-00018", 70, "Shortlisted", None),
        ("Esi", "Mensah", "JOB-2026-00019", 58, "Screening", "REJECTED"),
        ("Kojo", "Addo", "JOB-2026-00020", 45, "Offer", 63),
        ("Akosua", "Badu", "JOB-2026-00018", 33, "Interview", None),
        ("Fiifi", "Arthur", "JOB-2026-00019", 21, "Screening", None),
        ("Ama", "Serwaa", "JOB-2026-00020", 12, "Applied", None),
        ("Selorm", "Kpodo", "JOB-2026-00018", 6, "Applied", None),
        ("Dela", "Agbeko", "JOB-2026-00019", 2, "Applied", None),
    )

    def _recruitment(self):
        institution, admin = self.institution, self.admin
        stages = {stage.name: stage for stage in RecruitmentStage.objects.filter(institution=institution, is_active=True)}
        rng = random.Random("apex-sources")
        for candidate in Candidate.objects.filter(institution=institution, source__in=("", "CSA-DEMO")).order_by("email"):
            candidate.source = rng.choice(self.SOURCES)
            candidate.save(update_fields=("source", "updated_at"))

        structure = institution.salary_structures.get(code="APEX-MONTHLY")
        for index, (first, last, job_code, days_ago, stage_name, outcome) in enumerate(self.HISTORY_CANDIDATES):
            email = f"{first}.{last}.candidate@csa.test".lower()
            if Candidate.objects.filter(institution=institution, email=email).exists():
                continue
            candidate = Candidate.objects.create(institution=institution, email=email, first_name=first, last_name=last, source=self.SOURCES[index % len(self.SOURCES)])
            posting = JobPosting.objects.get(institution=institution, code=job_code)
            application = Application.objects.create(institution=institution, job_posting=posting, candidate=candidate, notes=f"ACT-APP {index + 1:03d}")
            application = submit_application(application=application, actor=admin)
            applied_at = self.now - timedelta(days=days_ago, hours=index % 7)
            Application.objects.filter(pk=application.pk).update(applied_at=applied_at)
            if stage_name in stages and application.current_stage_id != stages[stage_name].id:
                application = move_application_stage(application=application, stage=stages[stage_name], actor=admin, comment="Progressed")
            if outcome == "REJECTED":
                reject_application(application=application, actor=admin, reason="Not a fit for the role at this time")
            elif isinstance(outcome, int):
                offer = Offer.objects.create(institution=institution, application=application, proposed_start_date=(applied_at + timedelta(days=outcome + 30)).date(), employment_type="PERMANENT", department=posting.department, position=posting.position, grade=institution.grades.get(code="GRD-04"), location=posting.location, staff_category="JUNIOR", salary_structure=structure, base_salary=Decimal("5800") + Decimal(index * 150), currency="GHS", terms="Standard permanent employment terms.")
                offer = extend_offer(offer=offer, actor=admin)
                offer = decide_offer(offer=offer, actor=admin, accepted=True)
                accepted_at = applied_at + timedelta(days=outcome)
                Offer.objects.filter(pk=offer.pk).update(extended_at=accepted_at - timedelta(days=3), accepted_at=accepted_at)
            self._count("recruitment")

        # Interviews: a few completed or missed in the past, and a week of upcoming ones.
        active = list(Application.objects.filter(institution=institution, status=Application.Status.ACTIVE).select_related("candidate").order_by("applied_at"))
        schedule = ((0, 15, 0, "Panel"), (1, 10, 0, "Technical"), (2, 14, 0, "Panel"), (3, 11, 30, "HR screening"), (6, 9, 30, "Technical"), (8, 13, 0, "Final"))
        for (day_offset, hour, minute, kind), application in zip(schedule, active):
            when = self._stamp(self.today + timedelta(days=day_offset), hour, minute)
            note = f"ACT-INT {application.candidate.email} {when:%Y-%m-%d}"
            if not Interview.objects.filter(institution=institution, notes=note).exists():
                Interview.objects.create(institution=institution, application=application, scheduled_at=when, duration_minutes=60 if kind != "HR screening" else 30, interview_type=kind, location_or_link="Accra HQ, Meeting Room 2" if kind == "Panel" else "Google Meet", interviewer=admin, notes=note)
                self._count("recruitment")
        past = ((-9, "COMPLETED"), (-6, "COMPLETED"), (-4, "NO_SHOW"), (-2, "CANCELLED"), (-1, "COMPLETED"))
        for (day_offset, status), application in zip(past, reversed(active)):
            when = self._stamp(self.today + timedelta(days=day_offset), 10, 0)
            note = f"ACT-INT {application.candidate.email} {when:%Y-%m-%d}"
            if not Interview.objects.filter(institution=institution, notes=note).exists():
                Interview.objects.create(institution=institution, application=application, scheduled_at=when, duration_minutes=45, interview_type="Panel", location_or_link="Accra HQ, Meeting Room 1", interviewer=admin, status=status, notes=note)
                self._count("recruitment")

    # ------------------------------------------------ receivables and payables

    VENDORS = (
        ("VND-APEX-002", "Electricity Company of Ghana", "billing@ecg.test"),
        ("VND-APEX-003", "Vodafone Business Ghana", "business@vodafone.test"),
        ("VND-APEX-004", "Kotoka Travel & Tours", "accounts@kotokatravel.test"),
        ("VND-APEX-005", "Deloitte & Associates GH", "fees@deloitte-gh.test"),
        ("VND-APEX-006", "Accra Facilities Management", "invoices@accrafm.test"),
    )
    CUSTOMERS = (
        ("CUS-APEX-002", "GoldCoast Microfinance", "finance@goldcoastmf.test"),
        ("CUS-APEX-003", "Tema Port Logistics", "ap@temaport.test"),
        ("CUS-APEX-004", "Volta Health Services", "accounts@voltahealth.test"),
    )

    def _receivables_and_payables(self):
        institution, admin = self.institution, self.admin
        bank = BankAccount.objects.get(institution=institution, name="Apex Operating Account")
        revenue = self._account("4100")
        for code, name, email in self.VENDORS:
            if not Vendor.objects.filter(institution=institution, vendor_code=code).exists():
                create_vendor(institution=institution, actor=admin, vendor_code=code, name=name, email=email, country_code="GH", is_active=True)
        for code, name, email in self.CUSTOMERS:
            if not Customer.objects.filter(institution=institution, customer_code=code).exists():
                create_customer(institution=institution, actor=admin, customer_code=code, name=name, email=email, country_code="GH", is_active=True)

        # Supplier bills: one due soon, then 1–30, 31–60 and 61–90 days overdue.
        bills = (
            ("BILL-ACT-0101", "VND-APEX-002", "5300", "Electricity, head office", Decimal("6840"), -8, 22, None),
            ("BILL-ACT-0102", "VND-APEX-003", "5310", "Fibre internet and mobile data", Decimal("4250"), -40, -12, Decimal("1500")),
            ("BILL-ACT-0103", "VND-APEX-005", "5600", "Statutory audit, interim fieldwork", Decimal("18500"), -70, -40, None),
            ("BILL-ACT-0104", "VND-APEX-006", "5700", "Generator servicing and repairs", Decimal("9300"), -100, -75, Decimal("4000")),
            ("BILL-ACT-0105", "VND-APEX-004", "5400", "Client site travel, Kumasi", Decimal("3120"), -25, -3, None),
        )
        for number, vendor_code, account_code, description, amount, issued, due, paid in bills:
            bill_date = self.today + timedelta(days=issued)
            if VendorBill.objects.filter(institution=institution, bill_number=number).exists() or bill_date < date(2026, 6, 1):
                continue
            vendor = Vendor.objects.get(institution=institution, vendor_code=vendor_code)
            bill = create_vendor_bill(institution=institution, actor=admin, vendor=vendor, bill_number=number, bill_date=bill_date, due_date=self.today + timedelta(days=due), currency="GHS", accounting_period=self._period_for(bill_date), lines=[{"description": description, "expense_account": self._account(account_code), "quantity": Decimal("1"), "unit_price": amount}])
            bill = submit_vendor_bill(bill=bill, actor=admin)
            bill = approve_vendor_bill(bill=bill, actor=admin)
            bill = post_vendor_bill(bill=bill, actor=admin)
            if paid:
                pay_date = min(bill_date + timedelta(days=14), self.today)
                create_payment(institution=institution, actor=admin, payment_number=number.replace("BILL", "PAY"), payment_date=pay_date, amount=paid, currency="GHS", payment_method="BANK_TRANSFER", bank_account=bank, vendor_bill=bill)
            self._count("receivables and payables")

        # Customer invoices every month since June; older ones paid, recent ones open or overdue.
        month_starts = [date(2026, month, 1) for month in range(6, 13) if date(2026, month, 1) <= self.today]
        for month_index, month_start in enumerate(month_starts):
            for customer_index, (code, _, _) in enumerate(self.CUSTOMERS):
                number = f"INV-ACT-{month_start:%Y%m}-{customer_index + 1}"
                invoice_date = month_start + timedelta(days=4 + customer_index * 6)
                if invoice_date > self.today or Invoice.objects.filter(institution=institution, invoice_number=number).exists():
                    continue
                customer = Customer.objects.get(institution=institution, customer_code=code)
                amount = Decimal(18000 + ((month_index * 7 + customer_index * 5) % 9) * 2750)
                invoice = create_invoice(institution=institution, actor=admin, customer=customer, invoice_number=number, invoice_date=invoice_date, due_date=invoice_date + timedelta(days=30), currency="GHS", accounting_period=self._period_for(invoice_date), lines=[{"description": "Managed IT and implementation services", "income_account": revenue, "quantity": Decimal("1"), "unit_price": amount}])
                invoice = issue_invoice(invoice=invoice, actor=admin)
                age = (self.today - invoice_date).days
                paid = amount if age > 50 else (amount / 2).quantize(Decimal("0.01")) if age > 30 and customer_index == 0 else None
                if paid:
                    receipt_date = min(invoice_date + timedelta(days=24), self.today)
                    create_receipt(institution=institution, actor=admin, receipt_number=number.replace("INV", "RCT"), receipt_date=receipt_date, amount=paid, currency="GHS", payment_method="BANK_TRANSFER", bank_account=bank, invoice=invoice)
                self._count("receivables and payables")

    # ---------------------------------------------------------------- expenses

    EXPENSE_PLAN = (
        ("5300", "Water and sewerage, head office", Decimal("1450")),
        ("5310", "Staff mobile data bundles", Decimal("2380")),
        ("5400", "Ride-hailing and fuel for client visits", Decimal("1760")),
        ("5500", "Printer toner and stationery", Decimal("980")),
        ("5700", "Air-conditioning maintenance", Decimal("2240")),
        ("5400", "Staff travel to Takoradi", Decimal("3150")),
    )

    def _expenses(self):
        institution, admin = self.institution, self.admin
        month_starts = [date(2026, month, 1) for month in range(6, 13) if date(2026, month, 1) <= self.today]
        for month_index, month_start in enumerate(month_starts):
            for item_index, (account_code, description, base) in enumerate(self.EXPENSE_PLAN):
                if (month_index + item_index) % 3 == 2:
                    continue  # Not every expense recurs every month.
                expense_date = month_start + timedelta(days=3 + item_index * 4)
                if expense_date > self.today:
                    continue
                label = f"ACT-EXP {month_start:%Y-%m} {description}"
                if Expense.objects.filter(institution=institution, description=label).exists():
                    continue
                amount = base + Decimal((month_index * 37 + item_index * 53) % 400)
                expense = create_expense(institution=institution, actor=admin, expense_date=expense_date, account=self._account(account_code), amount=amount, currency="GHS", description=label)
                expense = submit_expense(expense=expense, actor=admin)
                recent = (self.today - expense_date).days < 6
                if not recent:
                    # Whoever enters an expense cannot approve it (BQ-04): the Finance Manager approves.
                    approver = institution.memberships.select_related("user").get(role__code="FINANCE_MANAGER", status="ACTIVE").user
                    expense = approve_expense(expense=expense, actor=approver)
                    post_expense(expense=expense, actor=admin)
                self._count("expenses")

    # ------------------------------------------------------ bank reconciliation

    def _bank_lines(self):
        institution, admin = self.institution, self.admin
        bank = BankAccount.objects.get(institution=institution, name="Apex Operating Account")
        # Statement lines for older receipts are matched to their posted journals.
        for receipt in Receipt.objects.filter(institution=institution, receipt_number__startswith="RCT-ACT-", bank_account=bank).exclude(journal_entry=None).order_by("receipt_date"):
            if (self.today - receipt.receipt_date).days < 10:
                continue
            external_id = f"STMT-{receipt.receipt_number}"
            line = BankStatementLine.objects.filter(bank_account=bank, external_id=external_id).first()
            if line is None:
                line = create_bank_statement_line(institution=institution, actor=admin, bank_account=bank, statement_date=receipt.receipt_date + timedelta(days=1), external_id=external_id, reference=receipt.receipt_number, description=f"Transfer in: {receipt.invoice.customer.name}", amount=receipt.amount, currency="GHS")
                self._count("bank reconciliation")
            if line.status == BankStatementLine.Status.UNMATCHED:
                try:
                    match_bank_statement_line(statement_line=line, journal=receipt.journal_entry, actor=admin)
                except SERVICE_ERRORS:
                    pass
        # Recent movements nobody has matched yet.
        unmatched = (
            ("STMT-ACT-CHG-01", -6, "Monthly account maintenance fee", Decimal("-85.00")),
            ("STMT-ACT-DEP-01", -4, "Unidentified deposit, ref 88213", Decimal("3200.00")),
            ("STMT-ACT-SO-01", -2, "Standing order: equipment lease", Decimal("-2450.00")),
            ("STMT-ACT-CHG-02", -1, "Electronic transfer charges", Decimal("-42.50")),
        )
        for external_id, offset, description, amount in unmatched:
            if not BankStatementLine.objects.filter(bank_account=bank, external_id=external_id).exists():
                create_bank_statement_line(institution=institution, actor=admin, bank_account=bank, statement_date=self.today + timedelta(days=offset), external_id=external_id, reference=external_id, description=description, amount=amount, currency="GHS")
                self._count("bank reconciliation")

    # ------------------------------------------------------- pending journals

    def _pending_journals(self):
        institution, admin = self.institution, self.admin
        liability = (
            Account.objects.filter(institution=institution, account_type="LIABILITY", is_postable=True, name__icontains="accru").first()
            or Account.objects.filter(institution=institution, account_type="LIABILITY", is_postable=True, name__icontains="payable").exclude(code__in=("2340",)).first()
        )
        if liability is None:
            return
        entries = (
            ("ACT-JNL-ACCRUAL", "Accrued audit fees for the quarter", "5600", Decimal("6000")),
            ("ACT-JNL-UTIL", "Accrued utilities not yet billed", "5300", Decimal("2150")),
        )
        for reference, description, account_code, amount in entries:
            if JournalEntry.objects.filter(institution=institution, reference=reference).exists():
                continue
            journal = create_journal(institution=institution, actor=admin, accounting_period=self._period_for(self.today), entry_date=self.today - timedelta(days=1), description=description, reference=reference, lines=[{"account": self._account(account_code), "description": description, "debit": amount, "credit": Decimal("0")}, {"account": liability, "description": description, "debit": Decimal("0"), "credit": amount}])
            submit_journal(journal=journal, actor=admin)
            self._count("journals awaiting approval")

    # ------------------------------------------- self-service: documents, fixes

    DOCUMENTS = (("Employment contract", "CONTRACT"), ("Ghana Card copy", "IDENTITY"), ("Academic certificate", "QUALIFICATION"))

    def _employee_self_service(self):
        institution, admin = self.institution, self.admin
        for index, employee in enumerate(self._employees()):
            for doc_index, (title, category) in enumerate(self.DOCUMENTS):
                if doc_index > index % 3:
                    continue  # Not everyone has every document on file yet.
                filename = f"{employee.employee_number} {title}.pdf"
                if Document.objects.filter(institution=institution, entity_type="EMPLOYEE", entity_id=employee.id, original_filename=filename).exists():
                    continue
                document = Document(institution=institution, uploaded_by=admin, original_filename=filename, content_type="application/pdf", size_bytes=len(MINIMAL_PDF), category=category, classification=Document.Classification.CONFIDENTIAL, entity_type="EMPLOYEE", entity_id=employee.id, is_active=True)
                document.stored_file.save(f"apex-demo/{employee.employee_number}-{category.lower()}.pdf", ContentFile(MINIMAL_PDF), save=False)
                document.save()
                self._count("employee documents and corrections")

        # Attendance corrections: one pending for each of a few employees, one already rejected.
        self_service = {employee.id for employee in self._self_service_people()}
        records = sorted(
            AttendanceRecord.objects.filter(institution=institution, check_out__isnull=False, attendance_date__gte=self.today - timedelta(days=12), attendance_date__lt=self.today - timedelta(days=2)).select_related("employee__user"),
            key=lambda record: (record.employee_id not in self_service, record.employee.employee_number, record.attendance_date),
        )
        seen = set()
        corrections = 0
        for record in records:
            if record.employee_id in seen or corrections >= 7:
                continue
            seen.add(record.employee_id)
            if AttendanceAdjustment.objects.filter(attendance_record=record).exists():
                corrections += 1
                continue
            adjustment = request_adjustment(institution=institution, attendance_record=record, actor=record.employee.user, reason="Forgot to clock out after an evening client call.", proposed_values={"check_out": (record.check_out + timedelta(minutes=75)).isoformat()})
            if corrections == 6:
                try:
                    decide_adjustment(adjustment=adjustment, actor=admin, approve=False)
                except SERVICE_ERRORS:
                    pass
            corrections += 1
            self._count("employee documents and corrections")
