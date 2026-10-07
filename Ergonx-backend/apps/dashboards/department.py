"""Department Head workspace rollups.

Everything here is limited to the current employees of the departments the
user heads (including nested sub-departments, see ``common.scoping``).  Pay
data is deliberately absent.
"""

from datetime import timedelta

from django.db.models import Count, Exists, OuterRef, Q, Sum
from django.utils import timezone

from apps.attendance.models import AttendanceRecord
from apps.employees.models import Employee, Employment
from apps.leave.models import LeaveApproval, LeaveBalance, LeaveRequest
from apps.organization.models import Department
from common.scoping import headed_department_ids


def leave_awaiting_approval_by(user, institution):
    """Pending leave approvals whose *current* step belongs to ``user``."""
    earlier_pending = LeaveApproval.objects.filter(
        leave_request=OuterRef("leave_request"),
        status=LeaveApproval.Status.PENDING,
        sequence__lt=OuterRef("sequence"),
    )
    return (
        LeaveApproval.objects.for_institution(institution)
        .filter(
            approver=user,
            status=LeaveApproval.Status.PENDING,
            leave_request__status=LeaveRequest.Status.PENDING,
        )
        .exclude(Exists(earlier_pending))
    )


def _team(institution, department_ids):
    return (
        Employment.objects.for_institution(institution)
        .filter(is_current=True, department_id__in=department_ids)
        .exclude(employee__status=Employee.Status.TERMINATED)
        .select_related("employee", "department", "position", "grade", "reports_to__employee")
        .order_by("department__name", "employee__last_name", "employee__first_name")
    )


def _today_status(institution, employee_ids, today):
    statuses = dict(
        AttendanceRecord.objects.for_institution(institution)
        .filter(employee_id__in=employee_ids, attendance_date=today)
        .values_list("employee_id", "status")
    )
    on_leave = LeaveRequest.objects.for_institution(institution).filter(
        employee_id__in=employee_ids,
        status=LeaveRequest.Status.APPROVED,
        start_date__lte=today,
        end_date__gte=today,
    )
    for employee_id in on_leave.values_list("employee_id", flat=True):
        statuses[employee_id] = AttendanceRecord.Status.ON_LEAVE
    return statuses


def team_snapshot(user, institution):
    """Compact "Team today" card for Home; ``None`` when the user heads nothing."""
    department_ids = headed_department_ids(user, institution)
    if not department_ids:
        return None
    today = timezone.localdate()
    employee_ids = list(_team(institution, department_ids).exclude(employee__user=user).values_list("employee_id", flat=True))
    statuses = _today_status(institution, employee_ids, today)
    counts = {status: 0 for status in ("PRESENT", "LATE", "ABSENT", "ON_LEAVE", "REMOTE")}
    for status in statuses.values():
        if status in counts:
            counts[status] += 1
    return {
        "departments": list(
            Department.objects.filter(id__in=department_ids).order_by("name").values_list("name", flat=True)
        ),
        "headcount": len(employee_ids),
        "today": {**{key.lower(): value for key, value in counts.items()}, "not_recorded": len(employee_ids) - len(statuses)},
        "pending_approvals": leave_awaiting_approval_by(user, institution).count(),
    }


def department_dashboard(user, institution):
    department_ids = headed_department_ids(user, institution)
    today = timezone.localdate()
    if not department_ids:
        return {"as_of": today, "departments": [], "headcount": 0, "team": [], "today": {}, "on_leave_today": [], "upcoming_leave": [], "pending_approvals": 0, "approval_queue": [], "leave_by_type": [], "attendance_trend": [], "by_position": []}

    team = list(_team(institution, department_ids))
    members = [row for row in team if row.employee.user_id != user.id]
    employee_ids = [row.employee_id for row in members]
    statuses = _today_status(institution, employee_ids, today)

    counts = {"present": 0, "late": 0, "absent": 0, "on_leave": 0, "remote": 0}
    for status in statuses.values():
        key = status.lower()
        if key in counts:
            counts[key] += 1
    counts["not_recorded"] = len(employee_ids) - len(statuses)

    leave = LeaveRequest.objects.for_institution(institution).filter(employee_id__in=employee_ids).select_related("employee", "leave_type")
    horizon = today + timedelta(days=30)
    trend_start = today - timedelta(days=13)
    trend_rows = (
        AttendanceRecord.objects.for_institution(institution)
        .filter(employee_id__in=employee_ids, attendance_date__range=(trend_start, today))
        .values("attendance_date")
        .annotate(
            present=Count("id", filter=Q(status__in=(AttendanceRecord.Status.PRESENT, AttendanceRecord.Status.REMOTE))),
            late=Count("id", filter=Q(status=AttendanceRecord.Status.LATE)),
            absent=Count("id", filter=Q(status=AttendanceRecord.Status.ABSENT)),
        )
    )
    trend_by_day = {row["attendance_date"]: row for row in trend_rows}

    departments = (
        Department.objects.filter(id__in=department_ids)
        .annotate(headcount=Count("employments", filter=Q(employments__is_current=True) & ~Q(employments__employee__status=Employee.Status.TERMINATED)))
        .order_by("name")
    )
    return {
        "as_of": today,
        "departments": [{"id": str(item.id), "name": item.name, "code": item.code, "headcount": item.headcount} for item in departments],
        "headcount": len(members),
        "team": [
            {
                "employee_id": str(row.employee_id),
                "employee_number": row.employee.employee_number,
                "full_name": row.employee.full_name,
                "work_email": row.employee.work_email,
                "phone": row.employee.phone,
                "status": row.employee.status,
                "department": row.department.name,
                "position": row.position.title,
                "grade": row.grade.name,
                "employment_type": row.employment_type,
                "reports_to": row.reports_to.employee.full_name if row.reports_to_id else None,
                "today_status": statuses.get(row.employee_id),
            }
            for row in members
        ],
        "today": counts,
        "on_leave_today": [
            {"id": str(item.id), "employee": item.employee.full_name, "leave_type": item.leave_type.name, "start_date": item.start_date, "end_date": item.end_date}
            for item in leave.filter(status=LeaveRequest.Status.APPROVED, start_date__lte=today, end_date__gte=today).order_by("end_date")
        ],
        "upcoming_leave": [
            {"id": str(item.id), "employee": item.employee.full_name, "leave_type": item.leave_type.name, "start_date": item.start_date, "end_date": item.end_date, "requested_days": item.requested_days, "status": item.status}
            for item in leave.filter(
                status__in=(LeaveRequest.Status.APPROVED, LeaveRequest.Status.PENDING),
                start_date__gt=today,
                start_date__lte=horizon,
            ).order_by("start_date")[:20]
        ],
        "pending_approvals": leave_awaiting_approval_by(user, institution).count(),
        "approval_queue": _approval_queue(user, institution, employee_ids),
        "leave_by_type": list(
            leave.filter(status=LeaveRequest.Status.APPROVED, start_date__year=today.year)
            .values("leave_type__name")
            .annotate(days=Sum("requested_days"), requests=Count("id"))
            .order_by("-days")
        ),
        "attendance_trend": [
            {
                "date": day,
                "present": trend_by_day.get(day, {}).get("present", 0),
                "late": trend_by_day.get(day, {}).get("late", 0),
                "absent": trend_by_day.get(day, {}).get("absent", 0),
            }
            for day in (trend_start + timedelta(days=offset) for offset in range(14))
        ],
        "by_position": [
            {"position": position, "count": count}
            for position, count in sorted(
                _count_by(members, lambda row: row.position.title).items(), key=lambda item: (-item[1], item[0])
            )
        ],
    }


def _approval_queue(user, institution, team_employee_ids):
    """Requests waiting on ``user`` with the context needed to decide them."""
    approvals = list(
        leave_awaiting_approval_by(user, institution)
        .select_related("leave_request__employee", "leave_request__leave_type")
        .order_by("leave_request__start_date")[:50]
    )
    queue = []
    for approval in approvals:
        item = approval.leave_request
        balance = LeaveBalance.objects.filter(
            employee=item.employee, leave_type=item.leave_type, year=item.start_date.year
        ).first()
        overlapping = (
            LeaveRequest.objects.for_institution(institution)
            .filter(
                employee_id__in=team_employee_ids,
                status__in=(LeaveRequest.Status.APPROVED, LeaveRequest.Status.PENDING),
                start_date__lte=item.end_date,
                end_date__gte=item.start_date,
            )
            .exclude(pk=item.pk)
            .select_related("employee")
        )
        queue.append({
            "id": str(item.id),
            "employee": item.employee.full_name,
            "employee_number": item.employee.employee_number,
            "leave_type": item.leave_type.name,
            "start_date": item.start_date,
            "end_date": item.end_date,
            "requested_days": item.requested_days,
            "reason": item.reason,
            "submitted_at": item.submitted_at,
            "step": approval.sequence,
            "available_balance": balance.available if balance else None,
            "also_off": sorted({other.employee.full_name for other in overlapping}),
        })
    return queue


def _count_by(rows, key):
    counts = {}
    for row in rows:
        counts[key(row)] = counts.get(key(row), 0) + 1
    return counts
