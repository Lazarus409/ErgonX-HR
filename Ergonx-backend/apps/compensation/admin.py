from django.contrib import admin

from apps.compensation.models import (
    EmployeeCompensation,
    EmployeePayComponent,
    PayComponent,
    SalaryStructure,
    SalaryStructureComponent,
)


admin.site.register(
    [
        PayComponent,
        SalaryStructure,
        SalaryStructureComponent,
        EmployeeCompensation,
        EmployeePayComponent,
    ]
)
