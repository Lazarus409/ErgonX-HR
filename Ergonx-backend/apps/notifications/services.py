"""Notification categories, recipient preferences and the email channel (Wave 2, S056).

In-app notifications are the system of record and cannot be muted: approvals
and corrections must always reach the people who act on them. Email is an
opt-in copy per module, sent only when the institution allows notification
email and email delivery is configured. Email bodies carry the title, the
message and a link to an allow-listed route; opening the link re-checks
authorization like any other page load.
"""

import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.utils.html import escape

logger = logging.getLogger(__name__)

PREFERENCE_KEY = "notifications"
INSTITUTION_EMAIL_SETTING = "notifications.email_enabled"

MODULES = ("APPROVALS", "HR", "LEAVE", "ATTENDANCE", "PAYROLL", "RECRUITMENT", "ACCOUNTING", "REPORTS", "SECURITY", "SYSTEM")
MODULE_LABELS = {
    "APPROVALS": "Approvals", "HR": "HR", "LEAVE": "Leave", "ATTENDANCE": "Attendance", "PAYROLL": "Payroll",
    "RECRUITMENT": "Recruitment", "ACCOUNTING": "Accounting", "REPORTS": "Reports", "SECURITY": "Security", "SYSTEM": "System",
}

# Type prefixes first (most specific), then the record the metadata points at.
_TYPE_PREFIXES = (
    ("APPROVAL", "APPROVALS"),
    ("LEAVE", "LEAVE"),
    ("ATTENDANCE", "ATTENDANCE"),
    ("OVERTIME", "ATTENDANCE"),
    ("PAYROLL", "PAYROLL"),
    ("PAYSLIP", "PAYROLL"),
    ("TAX_RELIEF", "PAYROLL"),
    ("MISSING_PAYROLL", "PAYROLL"),
    ("RECRUITMENT", "RECRUITMENT"),
    ("INTERVIEW", "RECRUITMENT"),
    ("OFFER", "RECRUITMENT"),
    ("APPLICATION", "RECRUITMENT"),
    ("CANDIDATE", "RECRUITMENT"),
    ("JOB_", "RECRUITMENT"),
    ("REQUISITION", "RECRUITMENT"),
    ("ACCOUNTING", "ACCOUNTING"),
    ("JOURNAL", "ACCOUNTING"),
    ("EXPENSE", "ACCOUNTING"),
    ("INVOICE", "ACCOUNTING"),
    ("VENDOR", "ACCOUNTING"),
    ("BUDGET", "ACCOUNTING"),
    ("ANALYTICS", "REPORTS"),
    ("REPORT", "REPORTS"),
    ("ACCESS_REQUEST", "SECURITY"),
    ("ACCOUNT", "SECURITY"),
    ("SECURITY", "SECURITY"),
    ("MFA", "SECURITY"),
    ("EMPLOYEE", "HR"),
    ("DOCUMENT", "HR"),
    ("TRAINING", "HR"),
    ("PERFORMANCE", "HR"),
)
_METADATA_KEYS = (
    ("approval_request_id", "APPROVALS"),
    ("leave_request_id", "LEAVE"),
    ("attendance_adjustment_id", "ATTENDANCE"),
    ("payroll_run_id", "PAYROLL"),
    ("payslip_id", "PAYROLL"),
    ("journal_entry_id", "ACCOUNTING"),
    ("expense_id", "ACCOUNTING"),
    ("invoice_id", "ACCOUNTING"),
    ("vendor_bill_id", "ACCOUNTING"),
    ("employee_id", "HR"),
)


def notification_module(notification_type, metadata=None):
    """The module a notification belongs to, for filtering and email preferences."""
    code = str(notification_type or "").upper()
    for prefix, module in _TYPE_PREFIXES:
        if code.startswith(prefix):
            return module
    metadata = metadata if isinstance(metadata, dict) else {}
    for key, module in _METADATA_KEYS:
        if metadata.get(key):
            return module
    if str(metadata.get("entity_type", "")).startswith("recruitment."):
        return "RECRUITMENT"
    return "SYSTEM"


def email_modules(user, institution):
    """Modules this member asked to receive by email (default: none)."""
    from apps.institutions.models import UserPreference

    preference = UserPreference.objects.filter(institution=institution, user=user, preference_key=PREFERENCE_KEY).first()
    value = preference.value_json if preference and isinstance(preference.value_json, dict) else {}
    return [module for module in value.get("email_modules", []) if module in MODULES]


def save_email_modules(user, institution, modules):
    from apps.institutions.models import UserPreference

    chosen = [module for module in MODULES if module in set(modules)]
    UserPreference.objects.update_or_create(
        institution=institution, user=user, preference_key=PREFERENCE_KEY,
        defaults={"value_json": {"email_modules": chosen}},
    )
    return chosen


def institution_allows_email(institution):
    from apps.institutions.models import InstitutionSetting

    setting = InstitutionSetting.objects.filter(institution=institution, key=INSTITUTION_EMAIL_SETTING).first()
    return True if setting is None else setting.value is not False


def should_email(notification):
    from apps.notifications.models import Notification

    if notification.channel != Notification.Channel.IN_APP or not settings.EMAIL_DELIVERY_ENABLED:
        return False
    if not notification.user.email or not notification.user.is_active:
        return False
    if notification_module(notification.notification_type, notification.metadata) not in email_modules(notification.user, notification.institution):
        return False
    return institution_allows_email(notification.institution)


def send_notification_email(notification):
    from apps.notifications.serializers import NotificationSerializer

    route = NotificationSerializer.route_for(notification.notification_type, notification.metadata) or "/notifications"
    link = f"{settings.FRONTEND_PUBLIC_URL}{route}"
    text_body = f"{notification.message}\n\nOpen in ErgonX: {link}\n\nYou receive this because you turned on email for {MODULE_LABELS[notification_module(notification.notification_type, notification.metadata)]} notifications. Change this under Notifications > Preferences."
    html_body = f"""
    <div style=\"font-family:Arial,sans-serif;color:#0f172a;line-height:1.55;max-width:620px\">
      <p style=\"font-weight:700;letter-spacing:0.12em;color:#0284c7\">ERGONX</p>
      <h1 style=\"font-size:20px\">{escape(notification.title)}</h1>
      <p>{escape(notification.message)}</p>
      <p><a href=\"{escape(link)}\" style=\"display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700\">Open in ErgonX</a></p>
      <p style=\"color:#64748b;font-size:13px\">You can change which notifications reach your email under Notifications &gt; Preferences.</p>
    </div>
    """
    message = EmailMultiAlternatives(subject=notification.title, body=text_body, from_email=settings.DEFAULT_FROM_EMAIL, to=[notification.user.email])
    message.attach_alternative(html_body, "text/html")
    message.send(fail_silently=False)


def queue_notification_email(notification):
    """Email a copy after the creating transaction commits, when the recipient opted in."""
    if not should_email(notification):
        return

    def deliver():
        from django.utils import timezone

        from apps.notifications.models import Notification

        try:
            send_notification_email(notification)
        except Exception:  # noqa: BLE001 - email is best effort; the in-app copy is the record
            logger.exception("Notification email failed for %s", notification.pk)
            Notification.objects.filter(pk=notification.pk).update(metadata={**notification.metadata, "email_status": "FAILED"})
            return
        Notification.objects.filter(pk=notification.pk).update(sent_at=timezone.now(), metadata={**notification.metadata, "email_status": "SENT"})

    transaction.on_commit(deliver)
