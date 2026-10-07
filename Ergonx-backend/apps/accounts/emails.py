"""Transactional email messages owned by the accounts domain."""

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils.html import escape


def send_institution_admin_invitation(*, recipient_email: str, acceptance_token: str, expires_at) -> None:
    """Send the secure organization-establishment invitation.

    The token is deliberately present only in this message and the immediate
    API response. It is never stored in the database in recoverable form.
    """
    acceptance_url = (
        f"{settings.FRONTEND_PUBLIC_URL}/create-organization/{acceptance_token}"
    )
    expires_text = expires_at.strftime("%d %b %Y, %H:%M %Z")
    subject = "You have been invited to set up an ErgonX organization"
    text_body = (
        "You have been selected as the first Institution Administrator for a new "
        "ErgonX organization.\n\n"
        f"Create your organization and administrator account: {acceptance_url}\n\n"
        f"This single-use link expires on {expires_text}. If you were not expecting "
        "this invitation, you can ignore this email."
    )
    html_body = f"""
    <div style=\"font-family:Arial,sans-serif;color:#0f172a;line-height:1.55;max-width:620px\">
      <p style=\"font-weight:700;letter-spacing:0.12em;color:#0284c7\">ERGONX</p>
      <h1 style=\"font-size:24px\">Set up your ErgonX organization</h1>
      <p>You have been selected as the first Institution Administrator for a new organization.</p>
      <p><a href=\"{acceptance_url}\" style=\"display:inline-block;background:#0f172a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700\">Create organization</a></p>
      <p>This single-use link expires on <strong>{expires_text}</strong>.</p>
      <p style=\"color:#64748b;font-size:13px\">If you were not expecting this invitation, you can safely ignore this email.</p>
    </div>
    """
    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient_email],
    )
    message.attach_alternative(html_body, "text/html")
    message.send(fail_silently=False)


def send_password_reset(*, recipient_email: str, uid: str, token: str) -> None:
    """Send a reset link; Django's token becomes invalid after password change."""
    reset_url = f"{settings.FRONTEND_PUBLIC_URL}/reset-password/{uid}/{token}"
    subject = "Reset your ErgonX password"
    text_body = (
        "We received a request to reset your ErgonX password.\n\n"
        f"Set a new password: {reset_url}\n\n"
        "If you did not request a password reset, you can ignore this email."
    )
    html_body = f"""
    <div style=\"font-family:Arial,sans-serif;color:#0f172a;line-height:1.55;max-width:620px\">
      <p style=\"font-weight:700;letter-spacing:0.12em;color:#0284c7\">ERGONX</p>
      <h1 style=\"font-size:24px\">Reset your password</h1>
      <p>We received a request to reset your ErgonX password.</p>
      <p><a href=\"{reset_url}\" style=\"display:inline-block;background:#0f172a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700\">Set new password</a></p>
      <p style=\"color:#64748b;font-size:13px\">If you did not request this reset, you can safely ignore this email.</p>
    </div>
    """
    message = EmailMultiAlternatives(subject=subject, body=text_body, from_email=settings.DEFAULT_FROM_EMAIL, to=[recipient_email])
    message.attach_alternative(html_body, "text/html")
    message.send(fail_silently=False)


def send_email_mfa_code(*, recipient_email: str, code: str, expires_at) -> None:
    """Send a short-lived MFA code without persisting the plaintext value."""
    message = EmailMultiAlternatives(
        subject="Your ErgonX verification code",
        body=f"Your ErgonX verification code is {code}. It expires at {expires_at:%H:%M %Z}.",
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient_email],
    )
    message.send(fail_silently=False)


def send_employee_self_service_invitation(*, recipient_email: str, acceptance_token: str, institution_name: str, expires_at) -> None:
    """Deliver the single-use employee account activation link."""
    acceptance_url = f"{settings.FRONTEND_PUBLIC_URL}/accept-invitation/{acceptance_token}"
    expires_text = expires_at.strftime("%d %b %Y, %H:%M %Z")
    subject = f"Join {institution_name} on ErgonX"
    text_body = (
        f"You have been invited to join {institution_name} on ErgonX.\n\n"
        f"Create your employee account: {acceptance_url}\n\n"
        f"This single-use link expires on {expires_text}."
    )
    html_body = f'''<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.55;max-width:620px">
      <p style="font-weight:700;letter-spacing:.12em;color:#0284c7">ERGONX</p>
      <h1 style="font-size:24px">Your employee account is ready</h1>
      <p>You have been invited to join <strong>{institution_name}</strong>. Create your account to access Employee Self-Service.</p>
      <p><a href="{acceptance_url}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Create account</a></p>
      <p>This single-use link expires on <strong>{expires_text}</strong>.</p>
    </div>'''
    message = EmailMultiAlternatives(subject=subject, body=text_body, from_email=settings.DEFAULT_FROM_EMAIL, to=[recipient_email])
    message.attach_alternative(html_body, "text/html")
    message.send(fail_silently=False)


def send_institution_access_request_notice(*, recipients: list[str], access_request) -> None:
    """Tell platform administrators that an organization asked for an invitation."""
    review_url = f"{settings.FRONTEND_PUBLIC_URL}/platform"
    subject = f"New ErgonX access request: {access_request.institution_name}"
    text_body = (
        f"{access_request.contact_name} ({access_request.email}) asked for an invitation for "
        f"{access_request.institution_name}.\n\n"
        f"Review it in the platform console: {review_url}"
    )
    html_body = f"""
    <div style=\"font-family:Arial,sans-serif;color:#0f172a;line-height:1.55;max-width:620px\">
      <p style=\"font-weight:700;letter-spacing:0.12em;color:#0284c7\">ERGONX</p>
      <h1 style=\"font-size:24px\">New access request</h1>
      <p><strong>{escape(access_request.contact_name)}</strong> ({escape(access_request.email)}) asked for an invitation for <strong>{escape(access_request.institution_name)}</strong>.</p>
      <p><a href=\"{review_url}\" style=\"display:inline-block;background:#0f172a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700\">Review request</a></p>
    </div>
    """
    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=recipients,
    )
    message.attach_alternative(html_body, "text/html")
    message.send(fail_silently=False)
