from datetime import date, timedelta

from django.conf import settings
from django.utils import timezone
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.institutions.models import Institution, InstitutionMembership, InstitutionModule
from apps.organization.models import Department, Grade, Location, Position
from apps.recruitment.models import Application, Candidate, JobPosting, RecruitmentStage
from apps.recruitment.services import publish_job_posting, submit_application


class Command(BaseCommand):
    help = "Create an idempotent, development-only Recruitment MVP demonstration dataset."

    def add_arguments(self, parser):
        parser.add_argument("--password", default="DemoPass123!")

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_recruitment_demo is development-only and refuses to run when DEBUG=False.")
        institution, _ = Institution.objects.get_or_create(name="ErgonX Recruitment Demo", defaults={"code": "RECDEMO", "country_code": "GH", "default_currency": "GHS"})
        admin, created = User.objects.get_or_create(email="demo.recruitment@ergonx.local", defaults={"first_name": "Recruitment", "last_name": "Admin"})
        if created:
            admin.set_password(options["password"]); admin.save(update_fields=("password",))
        role = institution.roles.get(code="HR_ADMIN")
        InstitutionMembership.objects.get_or_create(user=admin, institution=institution, defaults={"role": role, "status": "ACTIVE", "is_primary": True})
        InstitutionModule.objects.filter(institution=institution, module_code="RECRUITMENT").update(is_enabled=True, configuration_status="READY")
        department, _ = Department.objects.get_or_create(institution=institution, code="PEOPLE", defaults={"name": "People Operations"})
        position, _ = Position.objects.get_or_create(institution=institution, code="HR-ANALYST", defaults={"department": department, "title": "HR Analyst"})
        grade, _ = Grade.objects.get_or_create(institution=institution, code="G5", defaults={"name": "Grade 5", "level": 5})
        location, _ = Location.objects.get_or_create(institution=institution, code="ACCRA", defaults={"name": "Accra Office", "city": "Accra", "country": "GH", "timezone": "Africa/Accra"})
        stage, _ = RecruitmentStage.objects.get_or_create(institution=institution, sequence=1, defaults={"name": "Applied"})
        RecruitmentStage.objects.get_or_create(institution=institution, sequence=2, defaults={"name": "Interview"})
        posting, _ = JobPosting.objects.get_or_create(institution=institution, code="REC-DEMO-001", defaults={"title": "HR Analyst", "department": department, "position": position, "location": location, "hiring_manager": admin, "employment_type": "PERMANENT", "description": "Deterministic Recruitment MVP demo posting."})
        if posting.status == JobPosting.Status.DRAFT:
            # Demo history: the requisition was approved before publishing (BQ-06 removed
            # the draft shortcut).
            JobPosting.objects.filter(pk=posting.pk).update(status=JobPosting.Status.APPROVED, approved_by=admin, approved_at=timezone.now())
            posting.refresh_from_db()
            publish_job_posting(job_posting=posting, actor=admin)
        candidate, _ = Candidate.objects.get_or_create(institution=institution, email="ada.applicant@ergonx.local", defaults={"first_name": "Ada", "last_name": "Applicant", "source": "DEMO"})
        application, _ = Application.objects.get_or_create(institution=institution, job_posting=posting, candidate=candidate)
        if application.status == Application.Status.DRAFT:
            submit_application(application=application, actor=admin)
        self.stdout.write(self.style.SUCCESS(f"Recruitment demo ready: {institution.code}, {posting.code}, {candidate.email}, grade {grade.code}, stage {stage.name}."))
