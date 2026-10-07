import django_filters

from apps.employees.models import EmergencyContact, Employee, Employment


class EmployeeFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=Employee.Status.choices)
    department = django_filters.UUIDFilter(method="filter_current_employment")
    grade = django_filters.UUIDFilter(method="filter_current_employment")
    location = django_filters.UUIDFilter(method="filter_current_employment")
    employment_type = django_filters.ChoiceFilter(
        choices=Employment.EmploymentType.choices,
        method="filter_current_employment",
    )

    class Meta:
        model = Employee
        fields = ("status", "department", "grade", "location", "employment_type")

    def filter_current_employment(self, queryset, name, value):
        if value in (None, ""):
            return queryset
        return queryset.filter(
            **{f"employments__{name}": value, "employments__is_current": True}
        ).distinct()


class EmergencyContactFilter(django_filters.FilterSet):
    employee = django_filters.UUIDFilter()
    is_primary = django_filters.BooleanFilter()

    class Meta:
        model = EmergencyContact
        fields = ("employee", "is_primary")
