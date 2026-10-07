from django.contrib import admin

from apps.employees.models import (
    EmergencyContact,
    Employee,
    EmployeeOffboarding,
    EmployeeOnboarding,
    Employment,
)

admin.site.register(
    [Employee, Employment, EmergencyContact, EmployeeOnboarding, EmployeeOffboarding]
)
