from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.employees.views import EmployeeViewSet, SelfServiceEmergencyContactDetailView


class EmployeeInvitationPermissionTests(SimpleTestCase):
    def test_new_employee_invitation_requires_employee_update_permission(self):
        view = EmployeeViewSet()
        view.action = "invite_new_self_service"

        self.assertEqual(view.get_required_permission(), "employee.update")


class SelfServiceEmergencyContactTests(SimpleTestCase):
    def test_update_ignores_employee_id_supplied_by_browser(self):
        employee = SimpleNamespace(id="employee-owned-by-requester")
        request = SimpleNamespace(data={"employee": "another-employee", "phone": "0200000000"})
        view = SelfServiceEmergencyContactDetailView()
        view.employee = MagicMock(return_value=employee)
        view._contact = MagicMock(return_value=SimpleNamespace())

        write_serializer = MagicMock()
        write_serializer.save.return_value = SimpleNamespace()
        response_serializer = MagicMock()
        response_serializer.data = {"id": "contact-id"}

        with patch("apps.employees.views.EmergencyContactSerializer", side_effect=[write_serializer, response_serializer]) as serializer:
            response = view.patch(request, "contact-id")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(serializer.call_args_list[0].kwargs["data"]["employee"], "employee-owned-by-requester")
