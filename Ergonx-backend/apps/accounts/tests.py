from datetime import date, timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from django.utils.crypto import salted_hmac

from apps.accounts.models import User
from apps.employees.models import Employee
from apps.institutions.models import Institution, InstitutionInvitation, InstitutionMembership, Role


class EmployeeInvitationAcceptanceTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(name="Invitation Test Institution", code="INVITE-TEST")
        self.role = Role.objects.get(institution=self.institution, code="EMPLOYEE")
        self.invited_by = User.objects.create_user(
            email="hr.admin@example.com", password="StrongPass!123"
        )
        InstitutionMembership.objects.create(
            institution=self.institution,
            user=self.invited_by,
            role=Role.objects.get(institution=self.institution, code="HR_ADMIN"),
            status=InstitutionMembership.Status.ACTIVE,
        )

    def invitation_url(self, token):
        return reverse("v1:invitation-acceptance", args=[token])

    def create_invitation(self, email, employee=None):
        token = "employee-invitation-test-token"
        return token, InstitutionInvitation.objects.create(
            institution=self.institution,
            email=email,
            role=self.role,
            employee=employee,
            token_hash=salted_hmac("institution-invitation", token).hexdigest(),
            expires_at=timezone.now() + timedelta(days=1),
            invited_by=self.invited_by,
        )

    def test_new_employee_acceptance_creates_linked_employee_profile(self):
        token, invitation = self.create_invitation("new.employee@example.com")

        response = self.client.post(self.invitation_url(token), {
            "first_name": "New",
            "last_name": "Employee",
            "password": "StrongPass!123",
        })

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(email="new.employee@example.com")
        employee = Employee.objects.get(user=user, institution=self.institution)
        self.assertEqual(employee.first_name, "New")
        self.assertEqual(employee.work_email, user.email)
        self.assertTrue(InstitutionMembership.objects.filter(user=user, institution=self.institution, role=self.role, status="ACTIVE").exists())
        invitation.refresh_from_db()
        self.assertEqual(invitation.status, InstitutionInvitation.Status.ACCEPTED)

    def test_one_user_can_have_employee_profiles_in_multiple_institutions(self):
        user = User.objects.create_user(email="multi.institution@example.com", password="StrongPass!123")
        InstitutionMembership.objects.create(
            institution=self.institution,
            user=user,
            role=self.role,
            status=InstitutionMembership.Status.ACTIVE,
        )
        Employee.objects.create(
            institution=self.institution,
            user=user,
            employee_number="EMP-FIRST",
            first_name="Multi",
            last_name="Institution",
            hire_date=date.today(),
        )
        second_institution = Institution.objects.create(name="Second Institution", code="INVITE-SECOND")
        second_role = Role.objects.get(institution=second_institution, code="EMPLOYEE")
        InstitutionMembership.objects.create(
            institution=second_institution,
            user=user,
            role=second_role,
            status=InstitutionMembership.Status.ACTIVE,
        )
        Employee.objects.create(
            institution=second_institution,
            user=user,
            employee_number="EMP-SECOND",
            first_name="Multi",
            last_name="Institution",
            hire_date=date.today(),
        )

        self.assertEqual(Employee.objects.filter(user=user).count(), 2)

    def test_acceptance_links_the_employee_record_prepared_by_hr(self):
        employee = Employee.objects.create(
            institution=self.institution,
            employee_number="EMP-001",
            first_name="Prepared",
            last_name="Employee",
            work_email="prepared.employee@example.com",
            hire_date=date.today(),
        )
        token, invitation = self.create_invitation("prepared.employee@example.com", employee=employee)

        response = self.client.post(self.invitation_url(token), {
            "first_name": "Prepared",
            "last_name": "Employee",
            "password": "StrongPass!123",
        })

        self.assertEqual(response.status_code, 201)
        employee.refresh_from_db()
        self.assertIsNotNone(employee.user_id)
        invitation.refresh_from_db()
        self.assertEqual(invitation.status, InstitutionInvitation.Status.ACCEPTED)
