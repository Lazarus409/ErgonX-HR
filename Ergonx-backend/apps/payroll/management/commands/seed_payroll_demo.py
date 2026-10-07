from datetime import date
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.compensation.models import (
    EmployeeCompensation,
    PayComponent,
    SalaryStructure,
    SalaryStructureComponent,
)
from apps.compensation.services import change_current_compensation
from apps.documents.models import Document
from apps.employees.models import Employee, Employment
from apps.employees.services import create_employment
from apps.institutions.models import (
    Institution,
    InstitutionMembership,
    InstitutionModule,
)
from apps.institutions.services import bootstrap_institution
from apps.organization.models import Department, Grade, Location, Position
from apps.payroll.models import (
    EmployeePayrollProfile,
    EmployeeTaxReliefClaim,
    InstitutionPayrollConfiguration,
    PayrollAdjustment,
    PayrollPeriod,
    PayrollPresetVersion,
    PayrollRun,
)
from apps.payroll.services import (
    approve_payroll_run,
    calculate_payroll_run,
    configure_employee_payroll_profile,
    configure_payroll,
    create_payroll_adjustment,
    create_payroll_period,
    create_payroll_run,
    create_tax_relief_claim,
    decide_payroll_adjustment,
    decide_tax_relief_claim,
    finalize_payroll_run,
    submit_payroll_adjustment,
    submit_payroll_run_for_review,
    submit_tax_relief_claim,
)


DEMO_INSTITUTION_CODE = "ERGONX-DEMO-GH"
DEMO_ADMIN_EMAIL = "demo.admin@ergonx.local"
DEMO_APPROVER_EMAIL = "payroll.approver@ergonx.local"
DEMO_RESIDENT_EMAIL = "demo.resident@ergonx.local"
DEMO_NON_RESIDENT_EMAIL = "demo.nonresident@ergonx.local"
DEMO_RUN_KEY = "ergonx-demo-gh-2026-09-regular-v1"


class Command(BaseCommand):
    help = (
        "Create an idempotent, development-only Ghana payroll dataset with a "
        "finalized run and payslips."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default="ErgonX-Demo-2026!",
            help="Password assigned to newly created demo users.",
        )

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError(
                "seed_payroll_demo is development-only and refuses to run when DEBUG=False."
            )
        try:
            with transaction.atomic():
                result = self._seed(options["password"])
        except ValidationError as exc:
            raise CommandError(f"Demo payroll validation failed: {exc}") from exc

        self.stdout.write(self.style.SUCCESS("Deterministic Ghana payroll demo is ready."))
        self.stdout.write(f"Institution: {result['institution'].code}")
        self.stdout.write(f"Admin login: {DEMO_ADMIN_EMAIL}")
        self.stdout.write(
            f"Employee logins: {DEMO_RESIDENT_EMAIL}, {DEMO_NON_RESIDENT_EMAIL}"
        )
        self.stdout.write(f"Payroll period: {result['period'].name}")
        self.stdout.write(
            f"Payroll run: {result['run'].id} ({result['run'].status})"
        )
        self.stdout.write(f"Records: {result['run'].records.count()}")
        self.stdout.write(f"Payslips: {result['run'].records.filter(payslip__isnull=False).count()}")

    def _ensure_user(self, email, password, *, first_name, last_name):
        user, created = User.objects.get_or_create(
            email=email,
            defaults={"first_name": first_name, "last_name": last_name},
        )
        changed_fields = []
        if user.first_name != first_name:
            user.first_name = first_name
            changed_fields.append("first_name")
        if user.last_name != last_name:
            user.last_name = last_name
            changed_fields.append("last_name")
        if created or not user.check_password(password):
            user.set_password(password)
            changed_fields.append("password")
        if changed_fields:
            changed_fields.append("updated_at")
            user.save(update_fields=changed_fields)
        return user

    def _ensure_membership(self, user, institution, role_code):
        role = institution.roles.get(code=role_code)
        membership, created = InstitutionMembership.objects.get_or_create(
            user=user,
            institution=institution,
            defaults={
                "role": role,
                "status": InstitutionMembership.Status.ACTIVE,
                "is_primary": True,
                "joined_at": timezone.now(),
                "ended_at": None,
            },
        )
        if not created:
            changed = []
            expected = {
                "role": role,
                "status": InstitutionMembership.Status.ACTIVE,
                "is_primary": True,
                "ended_at": None,
            }
            for field, value in expected.items():
                if getattr(membership, field) != value:
                    setattr(membership, field, value)
                    changed.append(field)
            if changed:
                membership.save(update_fields=(*changed, "updated_at"))
        return membership

    def _ensure_employee(
        self,
        *,
        institution,
        user,
        employee_number,
        first_name,
        last_name,
    ):
        employee, _ = Employee.objects.update_or_create(
            institution=institution,
            employee_number=employee_number,
            defaults={
                "user": user,
                "first_name": first_name,
                "last_name": last_name,
                "work_email": user.email,
                "date_of_birth": date(1990, 1, 1),
                "gender": Employee.Gender.PREFER_NOT_TO_SAY,
                "hire_date": date(2026, 1, 1),
                "status": Employee.Status.ACTIVE,
            },
        )
        return employee

    def _ensure_employment(
        self,
        *,
        institution,
        employee,
        department,
        position,
        grade,
        location,
    ):
        employment = Employment.objects.filter(employee=employee, is_current=True).first()
        if employment is None:
            return create_employment(
                institution=institution,
                employee=employee,
                department=department,
                position=position,
                grade=grade,
                location=location,
                employment_type=Employment.EmploymentType.PERMANENT,
                staff_category=Employment.StaffCategory.OTHER,
                start_date=date(2026, 1, 1),
                status=Employment.Status.ACTIVE,
                is_current=True,
            )
        expected = {
            "department": department,
            "position": position,
            "grade": grade,
            "location": location,
            "employment_type": Employment.EmploymentType.PERMANENT,
            "staff_category": Employment.StaffCategory.OTHER,
            "status": Employment.Status.ACTIVE,
        }
        changed = []
        for field, value in expected.items():
            if getattr(employment, field) != value:
                setattr(employment, field, value)
                changed.append(field)
        if changed:
            employment.save(update_fields=(*changed, "updated_at"))
        return employment

    def _ensure_compensation(
        self,
        *,
        institution,
        employee,
        salary_structure,
        base_salary,
        actor,
    ):
        compensation = EmployeeCompensation.objects.filter(
            employee=employee, is_current=True
        ).first()
        if compensation is None:
            return change_current_compensation(
                institution=institution,
                employee=employee,
                salary_structure=salary_structure,
                base_salary=base_salary,
                currency="GHS",
                effective_from=date(2026, 1, 1),
                actor=actor,
            )
        expected = (
            compensation.salary_structure_id == salary_structure.id
            and compensation.base_salary == base_salary
            and compensation.currency == "GHS"
            and compensation.effective_from == date(2026, 1, 1)
        )
        if not expected:
            raise CommandError(
                f"Existing demo compensation for {employee.employee_number} has drifted; "
                "refusing to rewrite effective-dated payroll inputs."
            )
        return compensation

    def _ensure_profile(self, institution, employee, actor, residency):
        profile = EmployeePayrollProfile.objects.filter(employee=employee).first()
        if profile is None or profile.tax_residency != residency:
            profile = configure_employee_payroll_profile(
                institution=institution,
                employee=employee,
                actor=actor,
                tax_residency=residency,
                tax_identification_number=f"TIN-{employee.employee_number}",
            )
        return profile

    def _seed(self, password):
        institution, _ = Institution.objects.update_or_create(
            code=DEMO_INSTITUTION_CODE,
            defaults={
                "name": "ErgonX Ghana Payroll Demo",
                "email": "demo@ergonx.local",
                "country_code": "GH",
                "default_currency": "GHS",
                "timezone": "Africa/Accra",
                "is_active": True,
            },
        )
        bootstrap_institution(institution)

        admin = self._ensure_user(
            DEMO_ADMIN_EMAIL,
            password,
            first_name="Ama",
            last_name="Administrator",
        )
        resident_user = self._ensure_user(
            DEMO_RESIDENT_EMAIL,
            password,
            first_name="Kwame",
            last_name="Mensah",
        )
        non_resident_user = self._ensure_user(
            DEMO_NON_RESIDENT_EMAIL,
            password,
            first_name="Nora",
            last_name="Diallo",
        )
        self._ensure_membership(admin, institution, "INSTITUTION_ADMIN")
        # A second person approves payroll: preparer != approver (BQ-04).
        approver = self._ensure_user(DEMO_APPROVER_EMAIL, password, first_name="Efua", last_name="Approver")
        self._ensure_membership(approver, institution, "FINANCE_MANAGER")
        self._ensure_membership(resident_user, institution, "EMPLOYEE")
        self._ensure_membership(non_resident_user, institution, "EMPLOYEE")

        module = institution.modules.get(module_code=InstitutionModule.ModuleCode.PAYROLL)
        module.is_enabled = True
        module.enabled_at = module.enabled_at or timezone.now()
        module.enabled_by = admin
        module.configuration_status = InstitutionModule.ConfigurationStatus.READY
        module.save()

        department, _ = Department.objects.update_or_create(
            institution=institution,
            code="DEMO-OPS",
            defaults={"name": "Demo Operations", "is_active": True},
        )
        position, _ = Position.objects.update_or_create(
            institution=institution,
            code="DEMO-OFFICER",
            defaults={
                "department": department,
                "title": "Demo Operations Officer",
                "is_active": True,
            },
        )
        grade, _ = Grade.objects.update_or_create(
            institution=institution,
            code="DEMO-G1",
            defaults={"name": "Demo Grade 1", "level": 1, "is_active": True},
        )
        location, _ = Location.objects.update_or_create(
            institution=institution,
            code="DEMO-ACC",
            defaults={
                "name": "Demo Accra Office",
                "city": "Accra",
                "country": "GH",
                "timezone": "Africa/Accra",
                "is_active": True,
            },
        )

        resident = self._ensure_employee(
            institution=institution,
            user=resident_user,
            employee_number="GH-DEMO-001",
            first_name="Kwame",
            last_name="Mensah",
        )
        non_resident = self._ensure_employee(
            institution=institution,
            user=non_resident_user,
            employee_number="GH-DEMO-002",
            first_name="Nora",
            last_name="Diallo",
        )
        for employee in (resident, non_resident):
            self._ensure_employment(
                institution=institution,
                employee=employee,
                department=department,
                position=position,
                grade=grade,
                location=location,
            )

        resident_structure, _ = SalaryStructure.objects.update_or_create(
            institution=institution,
            code="GH-DEMO-RESIDENT",
            defaults={"name": "Ghana Demo Resident", "is_active": True},
        )
        non_resident_structure, _ = SalaryStructure.objects.update_or_create(
            institution=institution,
            code="GH-DEMO-NONRESIDENT",
            defaults={"name": "Ghana Demo Non-resident", "is_active": True},
        )
        bonus, _ = PayComponent.objects.update_or_create(
            institution=institution,
            code="BONUS",
            defaults={
                "name": "Bonus",
                "component_type": PayComponent.ComponentType.EARNING,
                "calculation_type": PayComponent.CalculationType.FIXED,
                "taxable": True,
                "pensionable": False,
                "cash_or_kind": PayComponent.CashOrKind.CASH,
                "recurring": True,
                "is_active": True,
            },
        )
        allowance, _ = PayComponent.objects.update_or_create(
            institution=institution,
            code="DEMO-ADJUSTMENT",
            defaults={
                "name": "Demo taxable adjustment",
                "component_type": PayComponent.ComponentType.EARNING,
                "calculation_type": PayComponent.CalculationType.FIXED,
                "taxable": True,
                "pensionable": False,
                "cash_or_kind": PayComponent.CashOrKind.CASH,
                "recurring": False,
                "is_active": True,
            },
        )
        SalaryStructureComponent.objects.update_or_create(
            institution=institution,
            salary_structure=resident_structure,
            pay_component=bonus,
            defaults={
                "default_amount": Decimal("1000.00"),
                "default_percentage": None,
                "percentage_base_component": None,
                "sequence": 1,
                "is_required": True,
            },
        )

        self._ensure_compensation(
            institution=institution,
            employee=resident,
            salary_structure=resident_structure,
            base_salary=Decimal("3000.00"),
            actor=admin,
        )
        self._ensure_compensation(
            institution=institution,
            employee=non_resident,
            salary_structure=non_resident_structure,
            base_salary=Decimal("5000.00"),
            actor=admin,
        )

        version = PayrollPresetVersion.objects.select_related("payroll_preset").get(
            payroll_preset__code="GH-PAYROLL",
            version_code="GH-2026.1",
            status=PayrollPresetVersion.Status.ACTIVE,
        )
        configuration = InstitutionPayrollConfiguration.objects.filter(
            institution=institution
        ).first()
        configuration_is_current = (
            configuration is not None
            and configuration.country_code == "GH"
            and configuration.currency == "GHS"
            and configuration.payroll_frequency
            == InstitutionPayrollConfiguration.Frequency.MONTHLY
            and configuration.payroll_setup_mode
            == InstitutionPayrollConfiguration.SetupMode.PRESET
            and configuration.selected_payroll_preset_version_id == version.id
            and configuration.is_configured
        )
        if not configuration_is_current:
            configure_payroll(
                institution=institution,
                actor=admin,
                country_code="GH",
                currency="GHS",
                payroll_frequency=InstitutionPayrollConfiguration.Frequency.MONTHLY,
                payroll_setup_mode=InstitutionPayrollConfiguration.SetupMode.PRESET,
                selected_payroll_preset_version=version,
            )

        self._ensure_profile(
            institution,
            resident,
            admin,
            EmployeePayrollProfile.TaxResidency.RESIDENT,
        )
        self._ensure_profile(
            institution,
            non_resident,
            admin,
            EmployeePayrollProfile.TaxResidency.NON_RESIDENT,
        )

        evidence, _ = Document.objects.get_or_create(
            institution=institution,
            file_reference="demo://ghana-payroll/marriage-relief.pdf",
            defaults={
                "uploaded_by": admin,
                "original_filename": "demo-marriage-relief.pdf",
                "content_type": "application/pdf",
                "size_bytes": 1024,
                "category": "TAX_RELIEF",
                "classification": Document.Classification.CONFIDENTIAL,
            },
        )
        relief_definition = version.relief_definitions.get(
            code="MARRIAGE_RESPONSIBILITY"
        )
        claim = EmployeeTaxReliefClaim.objects.filter(
            employee=resident,
            relief_definition=relief_definition,
            tax_year=2026,
        ).first()
        if claim is None:
            claim = create_tax_relief_claim(
                institution=institution,
                actor=admin,
                employee=resident,
                relief_definition=relief_definition,
                tax_year=2026,
                claimed_amount=Decimal("1200.00"),
                evidence=evidence,
            )
        if claim.status == EmployeeTaxReliefClaim.Status.DRAFT:
            claim = submit_tax_relief_claim(claim=claim, actor=admin)
        if claim.status == EmployeeTaxReliefClaim.Status.PENDING:
            claim = decide_tax_relief_claim(claim=claim, actor=admin, approve=True)
        if claim.status != EmployeeTaxReliefClaim.Status.APPROVED:
            raise CommandError("The deterministic demo relief claim must be approved.")

        period = PayrollPeriod.objects.filter(
            institution=institution,
            start_date=date(2026, 9, 1),
            end_date=date(2026, 9, 30),
        ).first()
        if period is None:
            period = create_payroll_period(
                institution=institution,
                actor=admin,
                name="September 2026 Demo Payroll",
                start_date=date(2026, 9, 1),
                end_date=date(2026, 9, 30),
                pay_date=date(2026, 9, 30),
            )

        adjustment = PayrollAdjustment.objects.filter(
            institution=institution,
            employee=resident,
            payroll_period=period,
            pay_component=allowance,
            reason="Deterministic demo adjustment",
        ).first()
        if adjustment is None:
            adjustment = create_payroll_adjustment(
                institution=institution,
                actor=admin,
                employee=resident,
                payroll_period=period,
                pay_component=allowance,
                amount=Decimal("100.00"),
                reason="Deterministic demo adjustment",
            )
        if adjustment.status == PayrollAdjustment.Status.DRAFT:
            adjustment = submit_payroll_adjustment(adjustment=adjustment, actor=admin)
        if adjustment.status == PayrollAdjustment.Status.PENDING:
            adjustment = decide_payroll_adjustment(
                adjustment=adjustment,
                actor=admin,
                approve=True,
            )
        if adjustment.status not in {
            PayrollAdjustment.Status.APPROVED,
            PayrollAdjustment.Status.APPLIED,
        }:
            raise CommandError("The deterministic demo adjustment must be approved.")

        run = create_payroll_run(
            institution=institution,
            payroll_period=period,
            actor=admin,
            idempotency_key=DEMO_RUN_KEY,
        )
        if run.status == PayrollRun.Status.DRAFT:
            run = calculate_payroll_run(payroll_run=run, actor=admin)
        if run.status == PayrollRun.Status.CALCULATED:
            run = submit_payroll_run_for_review(payroll_run=run, actor=admin)
        if run.status == PayrollRun.Status.UNDER_REVIEW:
            run = approve_payroll_run(payroll_run=run, actor=run.institution.memberships.select_related("user").get(role__code="FINANCE_MANAGER", status="ACTIVE").user)
        if run.status == PayrollRun.Status.APPROVED:
            run = finalize_payroll_run(payroll_run=run, actor=admin)
        if run.status != PayrollRun.Status.FINALIZED:
            raise CommandError(
                f"Demo run stopped in unsupported status {run.status}; refusing to duplicate it."
            )

        return {"institution": institution, "period": period, "run": run}
