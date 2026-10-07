from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from uuid import UUID

from apps.institutions.models import Institution
from apps.organization.models import Department, Location, Position


DEPARTMENTS = {
    "EXEC": "Executive Office",
    "FIN": "Finance",
    "HR": "Human Resources",
    "OPS": "Operations",
    "IT": "Information Technology",
    "SALES": "Sales and Marketing",
    "LEGAL": "Legal and Compliance",
}

POSITIONS = (
    ("MD", "EXEC", "Managing Director"),
    ("DIRECTOR", "EXEC", "Director"),
    ("FIN-MGR", "FIN", "Finance Manager"),
    ("ACCOUNTANT", "FIN", "Accountant"),
    ("ACCTS-OFF", "FIN", "Accounts Officer"),
    ("HR-MGR", "HR", "HR Manager"),
    ("HR-OFF", "HR", "HR Officer"),
    ("RECRUIT-OFF", "HR", "Recruitment Officer"),
    ("PAYROLL-OFF", "HR", "Payroll Officer"),
    ("OPS-MGR", "OPS", "Operations Manager"),
    ("OPS-OFF", "OPS", "Operations Officer"),
    ("SHIFT-SUP", "OPS", "Shift Supervisor"),
    ("IT-MGR", "IT", "IT Manager"),
    ("SOFTWARE-ENG", "IT", "Software Engineer"),
    ("SYS-ADMIN", "IT", "Systems Administrator"),
    ("SALES-MGR", "SALES", "Sales Manager"),
    ("SALES-EXEC", "SALES", "Sales Executive"),
    ("MKT-OFF", "SALES", "Marketing Officer"),
    ("COMPLIANCE-OFF", "LEGAL", "Compliance Officer"),
)

LOCATIONS = (
    ("ACCRA-HO", "Accra Head Office", "Accra", False),
    ("TEMA-OPS", "Tema Operations Centre", "Tema", False),
    ("KUMASI", "Kumasi Branch", "Kumasi", False),
    ("TAKORADI", "Takoradi Branch", "Takoradi", False),
    ("REMOTE", "Remote / Hybrid", "", True),
)


class Command(BaseCommand):
    help = "Create a reusable starter department, position, and location catalogue for an institution."

    def add_arguments(self, parser):
        parser.add_argument("--institution", required=True, help="Institution UUID or exact name")

    @transaction.atomic
    def handle(self, *args, **options):
        selector = options["institution"].strip()
        institution = Institution.objects.filter(name=selector).first()
        if institution is None:
            try:
                institution_id = UUID(selector)
            except ValueError:
                institution_id = None
            if institution_id is not None:
                institution = Institution.objects.filter(pk=institution_id).first()
        if institution is None:
            raise CommandError("Institution was not found. Use its UUID or exact name.")

        departments = {}
        for code, name in DEPARTMENTS.items():
            department, _ = Department.objects.get_or_create(
                institution=institution,
                code=code,
                defaults={"name": name, "description": f"{name} functional area", "is_active": True},
            )
            departments[code] = department

        for code, department_code, title in POSITIONS:
            Position.objects.get_or_create(
                institution=institution,
                code=code,
                defaults={
                    "department": departments[department_code],
                    "title": title,
                    "description": f"{title} position",
                    "is_active": True,
                },
            )

        for code, name, city, is_remote in LOCATIONS:
            Location.objects.get_or_create(
                institution=institution,
                code=code,
                defaults={
                    "name": name,
                    "city": city,
                    "country": institution.country_code,
                    "timezone": institution.timezone,
                    "is_remote": is_remote,
                    "is_active": True,
                },
            )

        self.stdout.write(self.style.SUCCESS(
            f"Starter organization structure is ready for {institution.name}: "
            f"{Department.objects.for_institution(institution).count()} departments, "
            f"{Position.objects.for_institution(institution).count()} positions, "
            f"{Location.objects.for_institution(institution).count()} locations."
        ))
