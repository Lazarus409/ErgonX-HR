from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.institutions.models import UserActivityEvent, UserPreference
from apps.employees.models import Employee
from apps.notifications.models import Notification
from common.scoping import ATTENDANCE_BROAD, DEPARTMENT, INSTITUTION


ACTION_CATALOG = {
    "employee.create": {"permission": "employee.create", "module": "CORE_HR", "label": "Add employee", "route_hint": "/hr/employees/new"},
    # A personal leave request must use the self-service flow. The managed
    # requests route is not a create screen and can legitimately be hidden.
    "leave.request": {"permission": "leave.request", "module": "LEAVE", "label": "Request leave", "route_hint": "/me/leave/request"},
    "leave.approve": {"permission": "leave.approve", "module": "LEAVE", "label": "Review leave requests", "route_hint": "/leave/requests?status=PENDING"},
    "attendance.adjust": {"permission": "attendance.adjust", "module": "ATTENDANCE", "label": "Attendance adjustments", "route_hint": "/attendance/adjustments"},
    "payroll.prepare": {"permission": "payroll.prepare", "module": "PAYROLL", "label": "Prepare payroll run", "route_hint": "/payroll/runs"},
    "payroll.approve": {"permission": "payroll.approve", "module": "PAYROLL", "label": "Review payroll runs", "route_hint": "/payroll/runs?status=UNDER_REVIEW"},
    "payroll.adjustment": {"permission": "payroll.prepare", "module": "PAYROLL", "label": "Prepare payroll adjustment", "route_hint": "/payroll/adjustments"},
    "payroll.adjustment.review": {"permission": "payroll.approve", "module": "PAYROLL", "label": "Review payroll adjustment", "route_hint": "/payroll/adjustments?status=PENDING"},
    "compensation.change": {"permission": "payroll.configure", "module": "PAYROLL", "label": "Review compensation change", "route_hint": "/payroll/employee-profiles"},
    "journal.create": {"permission": "journal.create", "module": "ACCOUNTING", "label": "Create journal", "route_hint": "/accounting/journals/new"},
    "journal.approve": {"permission": "journal.approve", "module": "ACCOUNTING", "label": "Approve journals", "route_hint": "/accounting/journals?status=PENDING_APPROVAL"},
    "candidate.create": {"permission": "candidate.create", "module": "RECRUITMENT", "label": "Manage candidates", "route_hint": "/recruitment/candidates"},
    "application.submit": {"permission": "candidate.create", "module": "RECRUITMENT", "label": "Review application", "route_hint": "/recruitment/applications"},
    "interview.update": {"permission": "interview.manage", "module": "RECRUITMENT", "label": "Update interview", "route_hint": "/recruitment/interviews"},
    "offer.manage": {"permission": "offer.manage", "module": "RECRUITMENT", "label": "Recruitment workspace", "route_hint": "/recruitment"},
}


RESUME_ROUTE_BUILDERS = {
    "employee.create": lambda entity_id: f"/hr/employees/{entity_id}",
    "leave.request": lambda entity_id: f"/leave/requests/{entity_id}",
    "journal.create": lambda entity_id: f"/accounting/journals/{entity_id}",
    "journal.approve": lambda entity_id: f"/accounting/journals/{entity_id}",
    "candidate.create": lambda entity_id: f"/recruitment/candidates/{entity_id}",
    "application.submit": lambda entity_id: f"/recruitment/applications/{entity_id}",
    "interview.update": lambda entity_id: "/recruitment/interviews",
    "offer.manage": lambda entity_id: f"/recruitment/offers/{entity_id}",
    "payroll.prepare": lambda entity_id: f"/payroll/runs/{entity_id}",
    "payroll.adjustment": lambda entity_id: "/payroll/adjustments",
    "payroll.adjustment.review": lambda entity_id: "/payroll/adjustments?status=PENDING",
    "compensation.change": lambda entity_id: "/payroll/employee-profiles",
    # The frontend currently exposes the review modal from the adjustments
    # list rather than a dedicated detail route. Keep the resume target real;
    # the list remains filterable and avoids manufacturing a dead URL.
    "attendance.adjust": lambda entity_id: "/attendance/adjustments",
}


def _personal_routes(*, permissions, data_scope):
    """Route overrides for members who act on their own or their team's records.

    The module workspaces (/leave, /attendance, ...) are institution-wide; a
    department head decides leave in /department and self-service users
    correct attendance from /me.
    """
    routes = {}
    if data_scope == DEPARTMENT:
        routes["leave.approve"] = "/department/approvals"
    if data_scope != INSTITUTION or not permissions & set(ATTENDANCE_BROAD):
        routes["attendance.adjust"] = "/me/attendance"
    return routes


def permitted_actions(*, institution, permission_codes, data_scope=INSTITUTION):
    enabled_modules = set(
        institution.modules.filter(is_enabled=True).values_list("module_code", flat=True)
    )
    permissions = set(permission_codes)
    overrides = _personal_routes(permissions=permissions, data_scope=data_scope)
    return {
        code: {"code": code, **definition, **({"route_hint": overrides[code]} if code in overrides else {})}
        for code, definition in ACTION_CATALOG.items()
        if definition["permission"] in permissions
        and (definition["module"] == "CORE_HR" or definition["module"] in enabled_modules)
    }


def _greeting_context(user, institution):
    try:
        local_now = timezone.now().astimezone(ZoneInfo(institution.timezone))
    except Exception:
        local_now = timezone.localtime()
    hour = local_now.hour
    greeting = "Good morning" if 5 <= hour < 12 else "Good afternoon" if hour < 17 else "Good evening" if hour < 22 else "Hello"
    display_name = user.first_name or user.email.split("@", 1)[0]
    return {
        "greeting": f"{greeting}, {display_name}",
        "user_display_name": display_name,
        "institution_name": institution.name,
        "institution_timezone": institution.timezone,
        "local_time": local_now.isoformat(),
    }


def _quick_actions(*, user, institution, permission_codes, data_scope):
    available = permitted_actions(institution=institution, permission_codes=permission_codes, data_scope=data_scope)
    # Requesting leave is self-service. A role permission alone must not put a
    # broken action in Home for a user who has no employee record here.
    if "leave.request" in available and not Employee.objects.for_institution(institution).filter(user=user).exists():
        available.pop("leave.request")
    preference = UserPreference.objects.for_institution(institution).filter(
        user=user, preference_key="quick_actions"
    ).first()
    pinned = preference.value_json.get("pinned", []) if preference else []
    recent = UserActivityEvent.objects.for_institution(institution).filter(user=user).order_by("-occurred_at")[:30]
    frequencies = Counter(event.activity_code for event in recent if event.activity_code in available)
    ordered_codes = [code for code in pinned if code in available]
    ordered_codes.extend(
        code for code, _ in frequencies.most_common() if code not in ordered_codes
    )
    ordered_codes.extend(code for code in available if code not in ordered_codes)
    return [
        {**available[code], "is_pinned": code in pinned}
        for code in ordered_codes[:6]
    ]


def _recent_work(*, user, institution, permission_codes, data_scope):
    available = permitted_actions(institution=institution, permission_codes=permission_codes, data_scope=data_scope)
    overrides = _personal_routes(permissions=set(permission_codes), data_scope=data_scope)
    events = (
        UserActivityEvent.objects.for_institution(institution)
        .filter(user=user, entity_id__isnull=False)
        .order_by("-occurred_at")[:30]
    )
    rows, seen = [], set()
    for event in events:
        if event.entity_id in seen or event.activity_code not in available:
            continue
        seen.add(event.entity_id)
        rows.append({
            "type": event.entity_type or "WORK_ITEM",
            # Keep the JSON contract stable for UUID-backed domain entities;
            # frontend route builders and typed adapters consume string IDs.
            "id": str(event.entity_id),
            "reference": "",
            "title": available[event.activity_code]["label"],
            "status": "IN_PROGRESS",
            "resume_action": event.activity_code,
            "resume_route": overrides.get(event.activity_code) or RESUME_ROUTE_BUILDERS.get(event.activity_code, lambda _entity_id: "")(event.entity_id),
            "updated_at": event.occurred_at,
            "can_resume": True,
        })
        if len(rows) == 2:
            break
    return rows


def _attention_items(*, user, institution, permission_codes):
    from apps.accounting.models import JournalEntry
    from apps.leave.models import LeaveRequest
    from apps.payroll.models import PayrollRun
    from apps.recruitment.models import Interview

    permissions = set(permission_codes)
    enabled = set(institution.modules.filter(is_enabled=True).values_list("module_code", flat=True))
    items = []
    definitions = (
        ("LEAVE", "leave.approve", LeaveRequest.objects.for_institution(institution).filter(status=LeaveRequest.Status.PENDING), "LEAVE_APPROVAL_REQUIRED", "Leave requests awaiting approval", "leave.approve"),
        ("PAYROLL", "payroll.approve", PayrollRun.objects.for_institution(institution).filter(status=PayrollRun.Status.UNDER_REVIEW), "PAYROLL_APPROVAL_REQUIRED", "Payroll runs awaiting approval", "payroll.approve"),
        ("ACCOUNTING", "journal.approve", JournalEntry.objects.for_institution(institution).filter(status=JournalEntry.Status.PENDING_APPROVAL), "JOURNAL_APPROVAL_REQUIRED", "Journals awaiting approval", "journal.approve"),
        ("RECRUITMENT", "interview.manage", Interview.objects.for_institution(institution).filter(status=Interview.Status.SCHEDULED, scheduled_at__date=timezone.localdate()), "INTERVIEWS_TODAY", "Interviews scheduled today", "interview.manage"),
    )
    if "dashboard.department.view" in permissions and "leave.approve" in permissions and "dashboard.hr.view" not in permissions:
        # Department heads act on their own approval queue, not every pending request.
        from apps.dashboards.department import leave_awaiting_approval_by

        definitions = (
            ("LEAVE", "leave.approve", leave_awaiting_approval_by(user, institution), "LEAVE_APPROVAL_REQUIRED", "Team leave awaiting your approval", "leave.approve"),
            *definitions[1:],
        )
    for module, permission, queryset, code, title, action_code in definitions:
        if module not in enabled or permission not in permissions:
            continue
        count = queryset.count()
        if count:
            items.append({"code": code, "severity": "HIGH" if "APPROVAL" in code else "NORMAL", "title": title, "description": f"{count} item(s) require attention.", "action_code": action_code, "entity_type": "", "entity_id": None, "reference": "", "due_at": None})
    return items


def _personal_snapshot(*, user, institution, permission_codes):
    """Self-service context for a user who is also an employee here.

    Everything is scoped to the user's own employee record and gated by the
    enabled modules and the user's effective permissions; no performance,
    productivity or ranking metric is produced.
    """
    from django.core.exceptions import ValidationError as DjangoValidationError
    from rest_framework.exceptions import ValidationError as ApiValidationError

    from apps.attendance.models import AttendanceAdjustment, AttendanceRecord
    from apps.documents.models import Document
    from apps.leave.models import LeaveRequest
    from apps.scheduling.services import schedule_assignment_for, schedule_expectation

    employee = Employee.objects.for_institution(institution).filter(user=user).first()
    if employee is None:
        return None
    permissions = set(permission_codes)
    enabled = set(institution.modules.filter(is_enabled=True).values_list("module_code", flat=True))
    try:
        local_now = timezone.now().astimezone(ZoneInfo(institution.timezone))
    except Exception:
        local_now = timezone.localtime()
    today = local_now.date()

    upcoming_shifts = []
    today_expectation = None
    if "ATTENDANCE" in enabled and "schedule.view" in permissions:
        for offset in range(7):
            day = today + timedelta(days=offset)
            assignment = schedule_assignment_for(employee, day)
            if assignment is None:
                continue
            try:
                expectation = schedule_expectation(assignment, day)
            except (DjangoValidationError, ApiValidationError):
                continue
            if offset == 0:
                today_expectation = expectation
            upcoming_shifts.append({
                "date": day.isoformat(),
                "schedule": assignment.work_schedule.name,
                "off_day": expectation["off_day"],
                "flexible": expectation["flexible_rule"] is not None,
                "start": expectation["start"].isoformat() if expectation["start"] else None,
                "end": expectation["end"].isoformat() if expectation["end"] else None,
                "required_minutes": expectation["required_minutes"],
            })

    attention = []

    def add(code, severity, title, description, route):
        attention.append({"code": code, "severity": severity, "title": title, "description": description, "route": route})

    activity = {}
    if "LEAVE" in enabled and "leave.request" in permissions:
        mine = LeaveRequest.objects.for_institution(institution).filter(employee=employee)
        pending = mine.filter(status=LeaveRequest.Status.PENDING).count()
        if pending:
            add("MY_LEAVE_PENDING", "NORMAL", "Leave request awaiting approval", f"{pending} of your leave requests are waiting for a decision.", "/me/leave")
        activity["leave_requests_this_year"] = mine.filter(start_date__year=today.year).count()
    if "ATTENDANCE" in enabled and "attendance.clock" in permissions:
        if today_expectation and not today_expectation["off_day"] and today_expectation["start"] and local_now >= today_expectation["start"]:
            clocked_in = AttendanceRecord.objects.for_institution(institution).filter(employee=employee, attendance_date=today, check_in__isnull=False).exists()
            if not clocked_in:
                add("MY_CLOCK_IN_MISSING", "HIGH", "You haven't clocked in yet", f"Your shift started at {today_expectation['start'].strftime('%H:%M')}.", "/me/attendance")
    if "ATTENDANCE" in enabled and "attendance.adjust" in permissions:
        adjustments = AttendanceAdjustment.objects.for_institution(institution).filter(attendance_record__employee=employee)
        pending_adjustments = adjustments.filter(status=AttendanceAdjustment.Status.PENDING).count()
        if pending_adjustments:
            add("MY_ADJUSTMENT_PENDING", "NORMAL", "Attendance correction awaiting review", f"{pending_adjustments} of your correction requests are waiting for review.", "/me/attendance")
        rejected = adjustments.filter(status=AttendanceAdjustment.Status.REJECTED, acted_at__date__gte=today - timedelta(days=14)).count()
        if rejected:
            add("MY_ADJUSTMENT_REJECTED", "HIGH", "Attendance correction was not approved", f"{rejected} correction request(s) were rejected in the last two weeks.", "/me/attendance")
        activity["attendance_corrections_pending"] = pending_adjustments
    unread = Notification.objects.for_institution(institution).filter(user=user, status__in=(Notification.Status.PENDING, Notification.Status.SENT)).count()
    if unread:
        add("MY_NOTIFICATIONS_UNREAD", "NORMAL", "Unread notifications", f"You have {unread} unread update(s).", "/notifications")
    activity["documents_on_file"] = Document.objects.for_institution(institution).filter(entity_type="EMPLOYEE", entity_id=employee.id, is_active=True).count()

    return {"upcoming_shifts": upcoming_shifts, "attention": attention, "activity": activity}


def _team_snapshot(*, user, institution, permission_codes):
    if "dashboard.department.view" not in set(permission_codes):
        return None
    from apps.dashboards.department import team_snapshot

    return team_snapshot(user, institution)


def home_payload(*, user, institution, permission_codes, data_scope=INSTITUTION):
    unread = Notification.objects.for_institution(institution).filter(
        user=user, status__in=(Notification.Status.PENDING, Notification.Status.SENT)
    )
    return {
        "greeting_context": _greeting_context(user, institution),
        "quick_actions": _quick_actions(user=user, institution=institution, permission_codes=permission_codes, data_scope=data_scope),
        "recent_work": _recent_work(user=user, institution=institution, permission_codes=permission_codes, data_scope=data_scope),
        "attention_items": _attention_items(user=user, institution=institution, permission_codes=permission_codes),
        "notifications_summary": {"unread_count": unread.count(), "latest": list(unread.values("id", "notification_type", "title", "message", "created_at")[:5])},
        "optional_personal_snapshot": _personal_snapshot(user=user, institution=institution, permission_codes=permission_codes),
        "team_snapshot": _team_snapshot(user=user, institution=institution, permission_codes=permission_codes),
    }
