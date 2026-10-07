from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework.throttling import AnonRateThrottle
from django.conf import settings
from django.core.mail import BadHeaderError
from smtplib import SMTPException
from django.utils import timezone
from datetime import timedelta
import base64
import secrets
from django.utils.crypto import salted_hmac
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.db import models, transaction
from django.utils.text import slugify
from urllib.parse import quote
from uuid import uuid4
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken
from drf_spectacular.utils import OpenApiTypes, extend_schema
from apps.accounts.platform import expire_stale_admin_invitations, record_platform_event

from apps.accounts.serializers import (
    AuthBootstrapSerializer,
    EmailTokenObtainPairSerializer,
    SessionTokenRefreshSerializer,
    UserSerializer,
    SelfServiceRegistrationSerializer,
    InstitutionAdminInvitationCreateSerializer,
    InstitutionAdminInvitationAcceptanceSerializer,
    InstitutionAdminInvitationSerializer,
    InstitutionAccessRequestApproveSerializer,
    InstitutionAccessRequestCreateSerializer,
    InstitutionAccessRequestDeclineSerializer,
    InstitutionAccessRequestSerializer,
    AccountProfileSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    MFASetupSerializer,
    EmailOTPDeliveryError,
    EmailOTPRequired,
    MFARequired,
    consume_email_otp,
    email_otp_resend_wait,
    issue_email_otp,
)
from apps.accounts.models import AuthAttempt, UserSession
from apps.accounts.sessions import SESSION_CLAIM, active_sessions, revoke_sessions, start_session
from apps.accounts.security import (
    client_ip,
    email_key,
    ensure_login_allowed,
    mask_email,
    record_login_attempt,
    revoke_refresh_tokens,
)
from apps.institutions.services import create_membership, default_landing, effective_permission_codes
from apps.institutions.models import Institution, InstitutionInvitation, InstitutionMembership, InstitutionModule, Role
from apps.accounts.models import InstitutionAccessRequest, InstitutionAdminInvitation, User, UserMFA
from apps.employees.models import Employee
from apps.documents.models import ImageAsset
from apps.accounts.emails import send_institution_access_request_notice, send_institution_admin_invitation, send_password_reset
from apps.audit.services import record_audit_event
from common.scoping import data_scope
from common.permissions import TenantContextPermission


def _login_method(user):
    mfa = UserMFA.objects.filter(user=user, is_enabled=True).first()
    if mfa is None:
        return "password"
    return "email_otp" if mfa.method == UserMFA.Method.EMAIL_OTP else "totp"


class LoginView(TokenObtainPairView):
    """Password sign-in with MFA challenge, account lockout and per-IP limits (Wave 0 BQ-10)."""

    serializer_class = EmailTokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        email = str(request.data.get("email") or "").strip()
        key = email_key(email)
        ip, ip_trusted = client_ip(request)
        ensure_login_allowed(key=key, ip=ip, ip_trusted=ip_trusted)
        code_given = bool(str(request.data.get("mfa_code") or "").strip())
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as exc:
            raise InvalidToken(exc.args[0])
        except (MFARequired, EmailOTPRequired) as exc:
            # Without a code these only ask for one; with a code they mean it was wrong.
            if code_given:
                self._failed(key, ip, email, "mfa_invalid", getattr(serializer, "user", None))
            else:
                record_login_attempt(key=key, ip=ip, outcome=AuthAttempt.Outcome.CHALLENGED, reason=exc.api_code)
            raise
        except AuthenticationFailed as exc:
            reason = getattr(exc, "api_code", None) or exc.get_codes()
            reason = reason if isinstance(reason, str) else "authentication_failed"
            reason = "invalid_credentials" if reason == "no_active_account" else reason
            if reason != "email_otp_unavailable":
                self._failed(key, ip, email, reason, getattr(serializer, "user", None))
            raise
        user = serializer.user
        record_login_attempt(key=key, ip=ip, outcome=AuthAttempt.Outcome.SUCCEEDED)
        record_audit_event(actor=user, entity=user, action="account.login.succeeded", ip=ip, metadata={"method": _login_method(user)})
        return Response(serializer.validated_data, status=200)

    @staticmethod
    def _failed(key, ip, email, reason, user):
        record_login_attempt(key=key, ip=ip, outcome=AuthAttempt.Outcome.FAILED, reason=reason)
        user = user or User.objects.filter(email__iexact=email).first()
        metadata = {"reason": reason}
        if user is None:
            metadata["email_key"] = key
        record_audit_event(actor=user, entity=user, action="account.login.failed", ip=ip, metadata=metadata)


class LogoutView(APIView):
    """Blacklist the session's refresh token so it cannot mint new access tokens.

    Called by the BFF on sign-out with the refresh token from its HttpOnly cookie.
    Always answers 200 so a stale or foreign token reveals nothing.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        raw = str(request.data.get("refresh") or "")
        if raw:
            try:
                token = RefreshToken(raw)
                token.blacklist()
            except TokenError:
                token = None
            user = User.objects.filter(pk=token.payload.get("user_id")).first() if token else None
            if user is not None:
                sid = token.payload.get(SESSION_CLAIM)
                if sid:
                    UserSession.objects.filter(pk=sid, user=user, revoked_at__isnull=True).update(revoked_at=timezone.now(), revoked_reason="signed_out")
                record_audit_event(actor=user, entity=user, action="account.logout", ip=client_ip(request)[0], metadata={"jti": token.payload.get("jti"), "session": sid})
        return Response({"logged_out": True})


def _current_sid(request):
    auth = getattr(request, "auth", None)
    return auth.get(SESSION_CLAIM) if auth is not None else None


class SessionListView(APIView):
    """The signed-in user's active sessions (Security Center)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        current = _current_sid(request)
        rows = [
            {
                "id": str(session.id),
                "ip_address": session.ip_address,
                "user_agent": session.user_agent,
                "created_at": session.created_at,
                "last_seen_at": session.last_seen_at,
                "current": str(session.id) == str(current),
            }
            for session in active_sessions(request.user)
        ]
        return Response({"sessions": rows})


# Account events a member sees about themselves in the Security Center.
SIGN_IN_ACTIVITY_ACTIONS = (
    "account.login.succeeded", "account.login.failed", "account.logout",
    "account.password.changed", "account.password.reset_completed",
    "account.mfa.enabled", "account.mfa.disabled", "account.mfa.method_changed", "account.mfa.disable_refused",
)


class SignInActivityView(APIView):
    """The signed-in user's own recent sign-ins and security changes (S043)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        from apps.audit.models import AuditLog

        events = AuditLog.objects.filter(actor=request.user, action__in=SIGN_IN_ACTIVITY_ACTIONS).order_by("-created_at")[:20]
        return Response({"events": [
            {
                "id": str(event.id),
                "action": event.action,
                "created_at": event.created_at,
                "ip_address": event.ip_address,
                "user_agent": event.user_agent,
                # Only the sign-in method or failure reason; never codes or tokens.
                "detail": event.metadata.get("method") or event.metadata.get("reason") or "",
            }
            for event in events
        ]})


class SessionRevokeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        session = UserSession.objects.filter(pk=pk, user=request.user, revoked_at__isnull=True).first()
        if session is None:
            from rest_framework.exceptions import NotFound

            raise NotFound("No active session with this id.")
        revoke_sessions(request.user, actor=request.user, reason="revoked_by_user", only=session.pk)
        return Response({"revoked": 1, "current": str(session.pk) == str(_current_sid(request))})


class SessionRevokeOthersView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        revoked = revoke_sessions(request.user, actor=request.user, reason="revoked_by_user", keep_sid=_current_sid(request))
        return Response({"revoked": revoked})


def _refresh_sid(raw_refresh, user):
    """The session named by the caller's own refresh token (the BFF passes it on password change)."""
    try:
        token = RefreshToken(str(raw_refresh or ""))
    except TokenError:
        return None
    return token.payload.get(SESSION_CLAIM) if str(token.payload.get("user_id")) == str(user.pk) else None


def _session_jti(raw_refresh, user):
    """The jti of the caller's own refresh token, so a password change keeps this session."""
    try:
        token = RefreshToken(str(raw_refresh or ""))
    except TokenError:
        return None
    return token.payload.get("jti") if str(token.payload.get("user_id")) == str(user.pk) else None


class MFAConflict(APIException):
    status_code = 409
    default_code = "invalid_state_transition"

    def __init__(self, detail, api_code="invalid_state_transition"):
        super().__init__(detail)
        self.api_code = api_code


class MFASettingsView(APIView):
    permission_classes = [IsAuthenticated]
    serializer_class = MFASetupSerializer

    def get(self, request):
        mfa = UserMFA.objects.filter(user=request.user).first()
        return Response({"enabled": bool(mfa and mfa.is_enabled), "pending": bool(mfa and not mfa.is_enabled), "method": mfa.method if mfa else None})

    def post(self, request):
        mfa, _ = UserMFA.objects.get_or_create(user=request.user, defaults={"secret": base32_secret()})
        if mfa.is_enabled:
            raise MFAConflict("MFA is already enabled.")
        if mfa.method != UserMFA.Method.AUTHENTICATOR_APP:
            mfa.method = UserMFA.Method.AUTHENTICATOR_APP
            mfa.save(update_fields=("method", "updated_at"))
        record_audit_event(actor=request.user, institution=getattr(request, "institution", None), entity=mfa, action="account.mfa.setup_started", metadata={"method": mfa.method})
        label = quote(f"ErgonX:{request.user.email}")
        otpauth_uri = f"otpauth://totp/{label}?secret={mfa.secret}&issuer=ErgonX&algorithm=SHA1&digits=6&period=30"
        return Response({"enabled": False, "pending": True, "method": mfa.method, "secret": mfa.secret, "otpauth_uri": otpauth_uri})

    def put(self, request):
        serializer = MFASetupSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        mfa = UserMFA.objects.get(user=request.user)
        mfa.is_enabled = True
        mfa.confirmed_at = timezone.now()
        mfa.save(update_fields=("is_enabled", "confirmed_at", "updated_at"))
        record_audit_event(actor=request.user, institution=getattr(request, "institution", None), entity=mfa, action="account.mfa.enabled", metadata={"method": mfa.method})
        return Response({"enabled": True, "pending": False, "method": mfa.method})

    def patch(self, request):
        """Switch to email OTP: without `code` a code is emailed; with `code` it is confirmed."""
        if request.data.get("method") != UserMFA.Method.EMAIL_OTP:
            raise ValidationError({"method": "Use the authenticator setup flow to enable an authenticator app."})
        code = str(request.data.get("code") or "").strip()
        if not code:
            try:
                challenge = issue_email_otp(request.user, purpose="enrolment")
            except EmailOTPDeliveryError as exc:
                raise MFAConflict(str(exc), api_code="email_otp_unavailable")
            current = UserMFA.objects.filter(user=request.user).first()
            return Response({
                "enabled": bool(current and current.is_enabled),
                "pending": bool(current and not current.is_enabled),
                "method": current.method if current else None,
                "email_code_sent": True,
                "email": mask_email(request.user.email),
                "expires_at": challenge.expires_at,
                "resend_available_in": email_otp_resend_wait(challenge),
            })
        if not consume_email_otp(request.user, code):
            raise ValidationError({"code": "The email verification code is invalid or expired."})
        mfa, _ = UserMFA.objects.get_or_create(user=request.user, defaults={"secret": base32_secret()})
        mfa.method = UserMFA.Method.EMAIL_OTP
        mfa.is_enabled = True
        mfa.confirmed_at = timezone.now()
        mfa.save(update_fields=("method", "is_enabled", "confirmed_at", "updated_at"))
        record_audit_event(actor=request.user, institution=getattr(request, "institution", None), entity=mfa, action="account.mfa.method_changed", metadata={"method": mfa.method})
        return Response({"enabled": True, "pending": False, "method": mfa.method})

    def delete(self, request):
        mfa = UserMFA.objects.filter(user=request.user).first()
        if mfa and mfa.is_enabled and not request.user.check_password(str(request.data.get("current_password") or "")):
            # Step-up (W0-SEC-04): a stolen session alone cannot remove MFA.
            record_audit_event(actor=request.user, institution=getattr(request, "institution", None), entity=mfa, action="account.mfa.disable_refused", metadata={"method": mfa.method})
            raise ValidationError({"current_password": "Enter your current password to turn off multi-factor authentication."})
        if mfa:
            record_audit_event(actor=request.user, institution=getattr(request, "institution", None), entity=mfa, action="account.mfa.disabled", metadata={"method": mfa.method})
            mfa.delete()
        return Response({"enabled": False, "pending": False})


def base32_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


class SelfServiceRegistrationView(APIView):
    """Legacy endpoint retained only to give public users a clear response."""

    permission_classes = [AllowAny]

    @staticmethod
    def _institution_code(name):
        stem = slugify(name).upper().replace("_", "-")[:42] or "INSTITUTION"
        return f"{stem}-{uuid4().hex[:6].upper()}"

    @transaction.atomic
    @extend_schema(request=SelfServiceRegistrationSerializer, responses={201: UserSerializer})
    def post(self, request):
        raise PermissionDenied("Organization creation is available only through an Institution Admin invitation.")


def _assert_platform_admin(request):
    if not (request.user.is_platform_admin or request.user.is_superuser):
        raise PermissionDenied("Only a platform administrator can manage Institution Admin invitations.")


def issue_institution_admin_invitation(*, email, expires_in_hours, invited_by):
    """Create an invitation and try to email it; the raw token is returned once."""
    token = uuid4().hex + uuid4().hex
    invitation = InstitutionAdminInvitation.objects.create(
        email=email,
        token_hash=salted_hmac("institution-admin-invitation", token).hexdigest(),
        expires_at=timezone.now() + timedelta(hours=expires_in_hours),
        invited_by=invited_by,
    )
    delivery_status = "MANUAL_DELIVERY_REQUIRED"
    if settings.EMAIL_DELIVERY_ENABLED:
        try:
            send_institution_admin_invitation(
                recipient_email=invitation.email,
                acceptance_token=token,
                expires_at=invitation.expires_at,
            )
            delivery_status = "SENT"
        except (BadHeaderError, OSError, SMTPException):
            delivery_status = "FAILED"
    return invitation, token, delivery_status


class InstitutionAdminInvitationView(APIView):
    """Platform-only issuance and public acceptance of new-tenant invitations."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=InstitutionAdminInvitationSerializer(many=True))
    def get(self, request):
        _assert_platform_admin(request)
        expire_stale_admin_invitations()
        invitations = InstitutionAdminInvitation.objects.select_related("invited_by", "institution").order_by("-created_at")
        return Response(InstitutionAdminInvitationSerializer(invitations, many=True).data)

    @extend_schema(request=InstitutionAdminInvitationCreateSerializer, responses={201: OpenApiTypes.OBJECT})
    def post(self, request):
        _assert_platform_admin(request)
        serializer = InstitutionAdminInvitationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invitation, token, delivery_status = issue_institution_admin_invitation(
            email=serializer.validated_data["email"],
            expires_in_hours=serializer.validated_data["expires_in_hours"],
            invited_by=request.user,
        )
        record_platform_event(actor=request.user, action="invitation.created", entity=invitation, metadata={"email": invitation.email, "delivery": delivery_status})
        return Response({"id": str(invitation.id), "email": invitation.email, "expires_at": invitation.expires_at, "acceptance_token": token, "email_delivery_status": delivery_status}, status=201)


class InstitutionAdminInvitationActionView(APIView):
    """Platform admins revoke a pending invitation or re-issue a fresh link."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=InstitutionAccessRequestApproveSerializer, responses={200: OpenApiTypes.OBJECT}, operation_id="auth_institution_admin_invitations_action")
    @transaction.atomic
    def post(self, request, pk, action):
        _assert_platform_admin(request)
        if action not in ("revoke", "reissue"):
            return Response({"detail": "Unknown action."}, status=404)
        expire_stale_admin_invitations()
        invitation = InstitutionAdminInvitation.objects.select_for_update().filter(pk=pk).first()
        if invitation is None:
            return Response({"detail": "Invitation not found."}, status=404)
        Status = InstitutionAdminInvitation.Status
        if action == "revoke":
            if invitation.status != Status.PENDING:
                return Response({"detail": f"Only a pending invitation can be revoked; this one is {invitation.get_status_display().lower()}."}, status=409)
            invitation.status = Status.REVOKED
            invitation.save(update_fields=("status", "updated_at"))
            record_platform_event(actor=request.user, action="invitation.revoked", entity=invitation, metadata={"email": invitation.email})
            return Response({"invitation": InstitutionAdminInvitationSerializer(invitation).data})
        if invitation.status == Status.ACCEPTED:
            return Response({"detail": "This invitation was already used to create an organization."}, status=409)
        if User.objects.filter(email=invitation.email).exists():
            return Response({"detail": "This email already has an ErgonX account, so it cannot receive an organization invitation."}, status=409)
        serializer = InstitutionAccessRequestApproveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if invitation.status == Status.PENDING:
            invitation.status = Status.REVOKED
            invitation.save(update_fields=("status", "updated_at"))
        replacement, token, delivery_status = issue_institution_admin_invitation(
            email=invitation.email,
            expires_in_hours=serializer.validated_data["expires_in_hours"],
            invited_by=request.user,
        )
        access_request = InstitutionAccessRequest.objects.filter(invitation=invitation).first()
        if access_request is not None:
            access_request.invitation = replacement
            access_request.save(update_fields=("invitation", "updated_at"))
        record_platform_event(actor=request.user, action="invitation.reissued", entity=replacement, metadata={"email": invitation.email, "replaces": str(invitation.id), "delivery": delivery_status})
        return Response({
            "invitation": {"id": str(replacement.id), "email": replacement.email, "expires_at": replacement.expires_at, "acceptance_token": token, "email_delivery_status": delivery_status},
        })


class InstitutionAccessRequestThrottle(AnonRateThrottle):
    """Caps anonymous Get Started submissions per client address."""

    scope = "institution_access_request"

    def get_rate(self):
        return settings.INSTITUTION_ACCESS_REQUEST_RATE


class InstitutionAccessRequestView(APIView):
    """Public submission of an access request; platform admins list them."""

    def get_permissions(self):
        return [AllowAny()] if self.request.method == "POST" else [IsAuthenticated()]

    def get_throttles(self):
        return [InstitutionAccessRequestThrottle()] if self.request.method == "POST" else []

    @extend_schema(responses=InstitutionAccessRequestSerializer(many=True))
    def get(self, request):
        _assert_platform_admin(request)
        requests = list(InstitutionAccessRequest.objects.select_related("reviewed_by").order_by("-created_at"))
        existing_emails = set(User.objects.filter(email__in=[item.email for item in requests]).values_list("email", flat=True))
        return Response(InstitutionAccessRequestSerializer(requests, many=True, context={"existing_emails": existing_emails}).data)

    @extend_schema(request=InstitutionAccessRequestCreateSerializer, responses={202: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = InstitutionAccessRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        honeypot = values.pop("website", "")
        if values.pop("accepted_terms", False):
            values["terms_accepted_at"] = timezone.now()
        # The same answer is given whether the request was stored, was a
        # duplicate, or tripped the honeypot, so the endpoint reveals nothing.
        duplicate = InstitutionAccessRequest.objects.filter(email=values["email"], status=InstitutionAccessRequest.Status.PENDING).exists()
        if not honeypot and not duplicate:
            access_request = InstitutionAccessRequest.objects.create(**values)
            if settings.EMAIL_DELIVERY_ENABLED:
                recipients = list(
                    User.objects.filter(is_active=True)
                    .filter(models.Q(is_platform_admin=True) | models.Q(is_superuser=True))
                    .values_list("email", flat=True)
                )
                if recipients:
                    try:
                        send_institution_access_request_notice(recipients=recipients, access_request=access_request)
                    except (BadHeaderError, OSError, SMTPException):
                        pass
        return Response({"received": True}, status=202)


class InstitutionAccessRequestDecisionView(APIView):
    """Platform admins approve (issue an invitation) or decline a request."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=InstitutionAccessRequestApproveSerializer, responses={200: OpenApiTypes.OBJECT}, operation_id="auth_institution_access_requests_decide")
    @transaction.atomic
    def post(self, request, pk, decision):
        _assert_platform_admin(request)
        if decision not in ("approve", "decline"):
            return Response({"detail": "Unknown decision."}, status=404)
        access_request = InstitutionAccessRequest.objects.select_for_update().filter(pk=pk).first()
        if access_request is None:
            return Response({"detail": "Access request not found."}, status=404)
        if access_request.status != InstitutionAccessRequest.Status.PENDING:
            return Response({"detail": f"This request has already been {access_request.get_status_display().lower()}."}, status=409)
        if decision == "decline":
            serializer = InstitutionAccessRequestDeclineSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            access_request.status = InstitutionAccessRequest.Status.DECLINED
            access_request.decline_reason = serializer.validated_data["reason"].strip()
            access_request.reviewed_by = request.user
            access_request.reviewed_at = timezone.now()
            access_request.save(update_fields=("status", "decline_reason", "reviewed_by", "reviewed_at", "updated_at"))
            record_platform_event(actor=request.user, action="access_request.declined", entity=access_request, metadata={"email": access_request.email, "institution_name": access_request.institution_name, "reason": access_request.decline_reason})
            return Response({"request": InstitutionAccessRequestSerializer(access_request).data})
        serializer = InstitutionAccessRequestApproveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if User.objects.filter(email=access_request.email).exists():
            return Response({"detail": "This email already has an ErgonX account, so it cannot receive an organization invitation."}, status=409)
        invitation, token, delivery_status = issue_institution_admin_invitation(
            email=access_request.email,
            expires_in_hours=serializer.validated_data["expires_in_hours"],
            invited_by=request.user,
        )
        access_request.status = InstitutionAccessRequest.Status.INVITED
        access_request.invitation = invitation
        access_request.reviewed_by = request.user
        access_request.reviewed_at = timezone.now()
        access_request.save(update_fields=("status", "invitation", "reviewed_by", "reviewed_at", "updated_at"))
        record_platform_event(actor=request.user, action="access_request.approved", entity=access_request, metadata={"email": access_request.email, "institution_name": access_request.institution_name, "delivery": delivery_status})
        return Response({
            "request": InstitutionAccessRequestSerializer(access_request).data,
            "invitation": {"id": str(invitation.id), "email": invitation.email, "expires_at": invitation.expires_at, "acceptance_token": token, "email_delivery_status": delivery_status},
        })


@extend_schema(responses={200: OpenApiTypes.OBJECT, 201: OpenApiTypes.OBJECT})
class InstitutionAdminInvitationAcceptanceView(APIView):
    permission_classes = [AllowAny]
    serializer_class = InstitutionAdminInvitationAcceptanceSerializer

    @staticmethod
    def _institution_code(name):
        stem = slugify(name).upper().replace("_", "-")[:42] or "INSTITUTION"
        return f"{stem}-{uuid4().hex[:6].upper()}"

    def _invitation(self, token):
        digest = salted_hmac("institution-admin-invitation", token).hexdigest()
        invitation = InstitutionAdminInvitation.objects.filter(token_hash=digest, status="PENDING").first()
        if invitation is None or invitation.expires_at <= timezone.now():
            if invitation is not None:
                invitation.status = InstitutionAdminInvitation.Status.EXPIRED
                invitation.save(update_fields=("status", "updated_at"))
            return None
        return invitation

    def get(self, request, token):
        invitation = self._invitation(token)
        if invitation is None:
            return Response({"detail": "Invitation is invalid or expired."}, status=404)
        # Prefill from the access request this invitation came from, when there is one.
        request_row = getattr(invitation, "access_request", None)
        prefill = {}
        if request_row is not None:
            first, _, last = (request_row.contact_name or "").strip().partition(" ")
            prefill = {
                "institution_name": request_row.institution_name, "first_name": first, "last_name": last,
                "phone": request_row.phone, "country_code": request_row.country_code, "employee_size": request_row.organization_size,
                "institution_type": request_row.institution_type, "website": request_row.website_url,
            }
        return Response({
            "email": invitation.email, "expires_at": invitation.expires_at, "prefill": prefill,
            "institution_types": [{"value": value, "label": label} for value, label in Institution.InstitutionType.choices],
        })

    @extend_schema(operation_id="auth_institution_admin_invitation_accept")
    @transaction.atomic
    def post(self, request, token):
        invitation = self._invitation(token)
        if invitation is None:
            return Response({"detail": "Invitation is invalid or expired."}, status=404)
        payload = request.data.copy()
        payload["email"] = invitation.email
        serializer = InstitutionAdminInvitationAcceptanceSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        if User.objects.filter(email=invitation.email).exists():
            return Response({"detail": "An account already exists for this email. Sign in or ask the platform administrator to issue a new invitation."}, status=409)
        user = User.objects.create_user(email=invitation.email, password=values["password"], first_name=values["first_name"].strip(), last_name=values["last_name"].strip())
        institution = Institution.objects.create(
            name=values["institution_name"], code=self._institution_code(values["institution_name"]), country_code=values["country_code"].upper(),
            default_currency=values["default_currency"].upper(), timezone=values["timezone"], email=invitation.email,
            institution_type=values["institution_type"], employee_size=values["employee_size"], website=values["website"], phone=values["phone"].strip(),
        )
        role = Role.objects.get(institution=institution, code="INSTITUTION_ADMIN")
        create_membership(user=user, institution=institution, role=role, status=InstitutionMembership.Status.ACTIVE, is_primary=True, joined_at=timezone.now())
        invitation.status = InstitutionAdminInvitation.Status.ACCEPTED
        invitation.accepted_at = timezone.now()
        invitation.institution = institution
        invitation.save(update_fields=("status", "accepted_at", "institution", "updated_at"))
        record_platform_event(actor=user, action="institution.created", institution=institution, entity=institution, metadata={"name": institution.name, "invitation": str(invitation.id), "terms_accepted_at": timezone.now().isoformat()})
        refresh = start_session(user, request)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh), "user": UserSerializer(user).data, "institution": {"id": str(institution.id), "name": institution.name, "code": institution.code}}, status=201)


class RefreshView(TokenRefreshView):
    serializer_class = SessionTokenRefreshSerializer


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=UserSerializer)
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class AccountProfileView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=AccountProfileSerializer)
    def get(self, request):
        return Response(AccountProfileSerializer(request.user).data)

    @extend_schema(request=AccountProfileSerializer, responses=AccountProfileSerializer)
    def patch(self, request):
        serializer = AccountProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=PasswordChangeSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=("password", "updated_at"))
        # Other sessions end; the BFF passes this session's refresh token so it survives.
        revoked = revoke_refresh_tokens(request.user, keep_jti=_session_jti(request.data.get("current_refresh"), request.user))
        revoke_sessions(request.user, actor=request.user, reason="password_changed", keep_sid=_current_sid(request) or _refresh_sid(request.data.get("current_refresh"), request.user))
        record_audit_event(actor=request.user, entity=request.user, action="account.password.changed", metadata={"sessions_revoked": revoked})
        return Response({"changed": True})


class PasswordResetRequestView(APIView):
    """Always returns the same response to avoid account-enumeration leaks."""

    permission_classes = [AllowAny]

    @extend_schema(request=PasswordResetRequestSerializer, responses={202: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(email=serializer.validated_data["email"], is_active=True).first()
        if user and settings.EMAIL_DELIVERY_ENABLED:
            try:
                uid = urlsafe_base64_encode(force_bytes(user.pk))
                token = PasswordResetTokenGenerator().make_token(user)
                send_password_reset(recipient_email=user.email, uid=uid, token=token)
            except (BadHeaderError, OSError, SMTPException):
                pass
            else:
                record_audit_event(actor=user, entity=user, action="account.password.reset_requested")
        return Response({"requested": True}, status=202)


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(request=PasswordResetConfirmSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user_id = force_str(urlsafe_base64_decode(serializer.validated_data["uid"]))
            user = User.objects.get(pk=user_id, is_active=True)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return Response({"detail": "This password reset link is invalid or has expired."}, status=400)
        if not PasswordResetTokenGenerator().check_token(user, serializer.validated_data["token"]):
            return Response({"detail": "This password reset link is invalid or has expired."}, status=400)
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=("password", "updated_at"))
        revoked = revoke_refresh_tokens(user)
        revoke_sessions(user, actor=user, reason="password_reset")
        record_audit_event(actor=user, entity=user, action="account.password.reset_completed", metadata={"sessions_revoked": revoked})
        return Response({"reset": True})


def _active_institution_logo_id(institution):
    """The institution's current logo image, if one has been uploaded."""
    logo_id = (
        ImageAsset.objects.filter(
            institution=institution,
            owner_type=ImageAsset.OwnerType.INSTITUTION,
            owner_id=institution.id,
            is_active=True,
        )
        .values_list("id", flat=True)
        .first()
    )
    return str(logo_id) if logo_id else None


class AuthBootstrapView(APIView):
    permission_classes = [TenantContextPermission]

    @extend_schema(responses=AuthBootstrapSerializer)
    def get(self, request):
        permission_codes = effective_permission_codes(request.membership)
        enabled_modules = list(
            request.institution.modules.filter(is_enabled=True)
            .order_by("module_code")
            .values_list("module_code", flat=True)
        )
        onboarding = getattr(request.institution, "onboarding", None)
        onboarding_ready = bool(onboarding and onboarding.status == "READY")
        dashboards = [
            code.removeprefix("dashboard.").removesuffix(".view")
            for code in permission_codes
            if code.startswith("dashboard.") and code.endswith(".view")
        ]
        # Landing follows effective permissions, never role titles (BQ-01).
        landing = default_landing(permission_codes)
        payload = {
            "user": request.user,
            "active_institution": {
                "id": str(request.institution.id),
                "code": request.institution.code,
                "name": request.institution.name,
                "timezone": request.institution.timezone,
                "logo_image_id": _active_institution_logo_id(request.institution),
            },
            "active_membership": {
                "id": str(request.membership.id),
                "role_code": request.membership.role.code,
                "role_name": request.membership.role.name,
                "status": request.membership.status,
                # INSTITUTION, DEPARTMENT or SELF: whose records this member works with.
                "data_scope": data_scope(request),
                # Read-only roles may view what they are granted but not change it.
                "read_only": request.membership.role.is_read_only,
            },
            "effective_permissions": list(permission_codes),
            "enabled_modules": enabled_modules,
            "onboarding_ready": onboarding_ready,
            "onboarding_status": onboarding.status if onboarding else "NOT_STARTED",
            "default_landing": landing,
            "available_dashboards": sorted(dashboards),
        }
        return Response(AuthBootstrapSerializer(payload, context={"institution": request.institution}).data)


@extend_schema(responses={200: OpenApiTypes.OBJECT, 201: OpenApiTypes.OBJECT})
class InvitationAcceptanceView(APIView):
    permission_classes = [AllowAny]
    serializer_class = InstitutionAdminInvitationAcceptanceSerializer

    @staticmethod
    def _access_preview(invitation):
        enabled_modules = set(
            invitation.institution.modules.filter(is_enabled=True).values_list(
                "module_code", flat=True
            )
        )
        permitted_modules = set(
            invitation.role.permissions.values_list("module_code", flat=True)
        )
        modules = [
            {"code": code, "name": label}
            for code, label in InstitutionModule.ModuleCode.choices
            if code in enabled_modules and code in permitted_modules
        ]
        return {
            "role_code": invitation.role.code,
            "role_name": invitation.role.name,
            "modules": modules,
        }

    def _invitation(self, token):
        digest = salted_hmac("institution-invitation", token).hexdigest()
        invitation = InstitutionInvitation.objects.select_related("institution", "role", "employee").filter(token_hash=digest, status="PENDING").first()
        if invitation is None or invitation.expires_at <= timezone.now():
            if invitation is not None:
                invitation.status = "EXPIRED"; invitation.save(update_fields=("status", "updated_at"))
            return None
        return invitation

    def get(self, request, token):
        invitation = self._invitation(token)
        if invitation is None:
            return Response({"detail": "Invitation is invalid or expired."}, status=404)
        return Response({
            "email": invitation.email,
            "institution_name": invitation.institution.name,
            "role_name": invitation.role.name,
            "expires_at": invitation.expires_at,
            "existing_account": User.objects.filter(email=invitation.email).exists(),
            "access_preview": self._access_preview(invitation),
        })

    @extend_schema(operation_id="auth_institution_invitation_accept")
    @transaction.atomic
    def post(self, request, token):
        invitation = self._invitation(token)
        if invitation is None:
            return Response({"detail": "Invitation is invalid or expired."}, status=404)
        password = request.data.get("password", "")
        first_name = request.data.get("first_name", "")
        last_name = request.data.get("last_name", "")
        user = User.objects.filter(email=invitation.email).first()
        created = user is None
        if user and user.has_usable_password():
            # A recipient can be invited into another institution or role. The
            # invitation token plus their current password proves ownership of
            # the existing account without creating a duplicate identity.
            if not user.check_password(password):
                return Response(
                    {"detail": "Enter your current ErgonX password to accept this invitation."},
                    status=400,
                )
        else:
            if len(password) < 8:
                return Response({"detail": "Password must contain at least 8 characters."}, status=400)
            if user is None:
                user = User.objects.create_user(
                    email=invitation.email,
                    password=password,
                    first_name=first_name,
                    last_name=last_name,
                )
            else:
                user.set_password(password)
                user.save(update_fields=("password", "updated_at"))
        membership, _ = InstitutionMembership.objects.get_or_create(institution=invitation.institution, user=user, defaults={"role": invitation.role, "status": "ACTIVE"})
        membership.role = invitation.role; membership.status = "ACTIVE"; membership.save()
        if invitation.employee_id:
            employee = invitation.employee
            if employee.user_id and employee.user_id != user.id:
                return Response({"detail": "This employee record is already linked to another account."}, status=409)
            employee.user = user
            employee.save(update_fields=("user", "updated_at"))
        elif invitation.role.code == "EMPLOYEE":
            # New employee invitations deliberately start without an HR record.
            # Acceptance creates the minimum linked profile; the employee can
            # complete personal details in Self-Service and HR can assign work
            # information afterwards.
            Employee.objects.get_or_create(
                institution=invitation.institution,
                user=user,
                defaults={
                    "first_name": user.first_name or "New",
                    "last_name": user.last_name or "Employee",
                    "personal_email": invitation.email,
                    "work_email": invitation.email,
                    "hire_date": timezone.localdate(),
                },
            )
        invitation.status = "ACCEPTED"; invitation.accepted_at = timezone.now(); invitation.save(update_fields=("status", "accepted_at", "updated_at"))
        return Response(
            {
                "accepted": True,
                "existing_account": not created,
                "access_preview": self._access_preview(invitation),
            },
            status=200 if not created else 201,
        )
