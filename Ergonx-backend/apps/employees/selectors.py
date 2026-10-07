from apps.employees.models import Employment


def employment_history_for_employee(*, institution, employee):
    return (
        Employment.objects.for_institution(institution)
        .filter(employee=employee)
        .select_related("employee", "department", "position", "grade", "location", "reports_to")
    )
