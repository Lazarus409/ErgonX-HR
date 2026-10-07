"""Row-level data scope for employee-linked records.

Role permissions answer *what* a member may do; the data scope answers *whose*
records they may do it to.  Every employee-linked queryset that a restricted
role can reach should pass through :func:`scope_to_employees` so the rule lives
in one place.

* ``INSTITUTION`` - every record in the tenant (HR, admins, finance, ...).
* ``DEPARTMENT``  - the member's own records plus current employees of the
  departments they head, including nested sub-departments.
* ``SELF``        - the member's own records only.

Within an institution-wide role, self-service permissions such as
``leave.view`` do not by themselves unlock everyone's rows: callers pass the
module's *broad* permissions, and a member holding none of them sees only
their own records.  This lets staff roles (finance, recruitment, ...) use
self-service without seeing colleagues' leave or attendance.
"""

from django.db.models import Q

INSTITUTION = "INSTITUTION"
DEPARTMENT = "DEPARTMENT"
SELF = "SELF"


# Management permissions that grant institution-wide rows per record family.
LEAVE_BROAD = ("leave.approve", "leave.reject", "leave.configure", "leave.balance.manage", "dashboard.leave.view")
ATTENDANCE_BROAD = ("attendance.manage", "attendance.approve", "schedule.manage", "dashboard.attendance.view")
PAYSLIP_BROAD = ("payroll.view",)


def data_scope(request):
    membership = getattr(request, "membership", None)
    if membership is None:
        return SELF
    return membership.role.data_scope or INSTITUTION


def permission_codes(request):
    """The requester's role permissions, cached on the request."""
    cached = getattr(request, "_scoping_permission_codes", None)
    if cached is None:
        membership = getattr(request, "membership", None)
        cached = frozenset(membership.role.permissions.values_list("code", flat=True)) if membership else frozenset()
        request._scoping_permission_codes = cached
    return cached


def headed_department_ids(user, institution):
    """Active departments headed by ``user`` plus all of their descendants."""
    from apps.organization.models import Department

    departments = list(
        Department.objects.for_institution(institution)
        .filter(is_active=True)
        .values_list("id", "parent_id", "head__user_id")
    )
    children = {}
    for department_id, parent_id, _ in departments:
        children.setdefault(parent_id, []).append(department_id)
    pending = [department_id for department_id, _, head_user_id in departments if head_user_id == user.id]
    seen = set()
    while pending:
        department_id = pending.pop()
        if department_id in seen:
            continue
        seen.add(department_id)
        pending.extend(children.get(department_id, ()))
    return seen


def _field(prefix, name):
    return f"{prefix}__{name}" if prefix else name


def team_filter(request, employee_field="employee"):
    """``Q`` selecting the requester's own employee plus their current team."""
    own = Q(**{_field(employee_field, "user"): request.user})
    department_ids = headed_department_ids(request.user, request.institution)
    if not department_ids:
        return own
    return own | Q(**{
        _field(employee_field, "employments__is_current"): True,
        _field(employee_field, "employments__department_id__in"): department_ids,
    })


def scope_to_employees(queryset, request, employee_field="employee", *, allow_team=True, broad=None):
    """Restrict an employee-linked queryset to what the requester may see.

    ``employee_field`` is the lookup path to the ``Employee`` ("" when the
    queryset is of employees).  Pass ``allow_team=False`` for pay and other
    personal records a department head may only see for themselves, and
    ``broad`` for record families where plain view permission is self-service.
    """
    scope = data_scope(request)
    if scope == INSTITUTION:
        if broad is None or permission_codes(request) & set(broad):
            return queryset
        return queryset.filter(**{_field(employee_field, "user"): request.user})
    if scope == DEPARTMENT and allow_team:
        return queryset.filter(team_filter(request, employee_field)).distinct()
    return queryset.filter(**{_field(employee_field, "user"): request.user})


def is_team_scoped(request):
    return data_scope(request) == DEPARTMENT


def sees_everyone(request, broad):
    """Whether the requester reads institution-wide rows for this record family."""
    return data_scope(request) == INSTITUTION and bool(permission_codes(request) & set(broad))
