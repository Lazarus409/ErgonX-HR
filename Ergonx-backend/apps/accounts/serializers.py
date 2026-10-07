from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenObtainSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth.models import update_last_login
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import AuthenticationFailed, Throttled
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
import secrets
import base64
import hashlib
import hmac
import struct
import time
from apps.accounts.models import EmailOTPChallenge, InstitutionAccessRequest, InstitutionAdminInvitation, User, UserMFA
from apps.documents.models import ImageAsset
from apps.institutions.models import Institution
from apps.accounts.emails import send_email_mfa_code
from apps.accounts.security import mask_email
from apps.audit.services import record_audit_event
from django.utils.crypto import salted_hmac


def _totp(secret: str, timestamp: int | None = None) -> str:
    counter = int((timestamp or time.time()) // 30)
    key = base64.b32decode(secret, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1_000_000:06d}"


def verify_totp(secret: str, code: str) -> bool:
    normalized = str(code).strip()
    return bool(normalized) and any(hmac.compare_digest(_totp(secret, int(time.time()) + drift * 30), normalized) for drift in (-1, 0, 1))


EMAIL_OTP_TTL = timedelta(minutes=5)
EMAIL_OTP_MAX_ATTEMPTS = 5
# A fresh code is sent at most once a minute and five times per 15 minutes
# (Wave 0 decision BQ-10). Within the cooldown the open code stays valid.
EMAIL_OTP_RESEND_COOLDOWN = timedelta(seconds=60)
EMAIL_OTP_ISSUE_LIMIT = 5
EMAIL_OTP_ISSUE_WINDOW = timedelta(minutes=15)


class EmailOTPDeliveryError(Exception):
    """The email one-time code could not be issued or delivered."""


class EmailOTPThrottled(Throttled):
    api_code = "email_otp_throttled"


def _email_otp_digest(code: str) -> str:
    return salted_hmac("ergonx-email-mfa", code).hexdigest()


def email_otp_resend_wait(challenge) -> int:
    """Seconds until a new code may be requested for this challenge."""
    remaining = (challenge.sent_at + EMAIL_OTP_RESEND_COOLDOWN - timezone.now()).total_seconds()
    return max(0, int(-(-remaining // 1)))


def issue_email_otp(user, *, purpose="login") -> EmailOTPChallenge:
    """Email a fresh six-digit code, or keep the open one while the resend cooldown runs.

    A new code revokes earlier open codes. More than EMAIL_OTP_ISSUE_LIMIT codes
    in EMAIL_OTP_ISSUE_WINDOW raises EmailOTPThrottled, so repeated sign-ins cannot
    buy unlimited guesses or flood the mailbox.
    """
    if not settings.EMAIL_DELIVERY_ENABLED:
        raise EmailOTPDeliveryError("Email MFA delivery is not configured.")
    now = timezone.now()
    latest = EmailOTPChallenge.objects.filter(user=user).order_by("-created_at").first()
    if (
        latest
        and latest.consumed_at is None
        and latest.expires_at > now
        and latest.attempts < EMAIL_OTP_MAX_ATTEMPTS
        and latest.sent_at > now - EMAIL_OTP_RESEND_COOLDOWN
    ):
        return latest
    recent = list(
        EmailOTPChallenge.objects.filter(user=user, created_at__gte=now - EMAIL_OTP_ISSUE_WINDOW)
        .order_by("-created_at")
        .values_list("created_at", flat=True)[:EMAIL_OTP_ISSUE_LIMIT]
    )
    if len(recent) >= EMAIL_OTP_ISSUE_LIMIT:
        wait = max(1, int((recent[-1] + EMAIL_OTP_ISSUE_WINDOW - now).total_seconds()))
        raise EmailOTPThrottled(wait=wait, detail="Too many verification codes were requested. Wait a few minutes before asking for another.")
    EmailOTPChallenge.objects.filter(user=user, consumed_at__isnull=True).update(consumed_at=now)
    plain_code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = EmailOTPChallenge.objects.create(user=user, code_digest=_email_otp_digest(plain_code), expires_at=now + EMAIL_OTP_TTL, sent_at=now)
    try:
        send_email_mfa_code(recipient_email=user.email, code=plain_code, expires_at=challenge.expires_at)
    except Exception as exc:
        challenge.delete()
        raise EmailOTPDeliveryError("Email MFA delivery failed.") from exc
    record_audit_event(
        actor=user,
        entity=challenge,
        action="account.mfa.email_otp.issued",
        metadata={"purpose": purpose, "destination": mask_email(user.email), "expires_at": challenge.expires_at.isoformat()},
    )
    return challenge


def consume_email_otp(user, code: str) -> bool:
    """Check a code against the latest open challenge; a match consumes it."""
    code = str(code or "").strip()
    challenge = EmailOTPChallenge.objects.filter(user=user, consumed_at__isnull=True).order_by("-created_at").first()
    if not code or not challenge or challenge.expires_at <= timezone.now() or challenge.attempts >= EMAIL_OTP_MAX_ATTEMPTS:
        return False
    challenge.attempts += 1
    challenge.save(update_fields=("attempts", "updated_at"))
    if not hmac.compare_digest(challenge.code_digest, _email_otp_digest(code)):
        if challenge.attempts >= EMAIL_OTP_MAX_ATTEMPTS:
            record_audit_event(actor=user, entity=challenge, action="account.mfa.email_otp.locked", metadata={"attempts": challenge.attempts})
        return False
    challenge.consumed_at = timezone.now()
    challenge.save(update_fields=("consumed_at", "updated_at"))
    return True


class MFARequired(AuthenticationFailed):
    api_code = "mfa_required"


class EmailOTPRequired(AuthenticationFailed):
    api_code = "email_otp_required"


class UserSerializer(serializers.ModelSerializer):
    is_platform_admin = serializers.SerializerMethodField()
    profile_image_id = serializers.SerializerMethodField()

    def get_is_platform_admin(self, user) -> bool:
        return bool(user.is_platform_admin or user.is_superuser)

    def get_profile_image_id(self, user) -> str | None:
        """Return this user's active avatar within the selected institution."""
        institution = self.context.get("institution")
        if institution is None:
            return None
        image_id = (
            ImageAsset.objects.filter(
                institution=institution,
                owner_type=ImageAsset.OwnerType.USER,
                owner_id=user.id,
                is_active=True,
            )
            .values_list("id", flat=True)
            .first()
        )
        return str(image_id) if image_id else None

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "is_platform_admin",
            "profile_image_id",
            "created_at",
        )
        read_only_fields = fields


class AuthBootstrapSerializer(serializers.Serializer):
    user = UserSerializer()
    active_institution = serializers.DictField()
    active_membership = serializers.DictField()
    effective_permissions = serializers.ListField(child=serializers.CharField())
    enabled_modules = serializers.ListField(child=serializers.CharField())
    onboarding_ready = serializers.BooleanField()
    onboarding_status = serializers.CharField()
    # EXECUTIVE → /dashboard, INSIGHTS → /insights, ME → /me (BQ-01).
    default_landing = serializers.ChoiceField(choices=("EXECUTIVE", "INSIGHTS", "ME"))
    available_dashboards = serializers.ListField(child=serializers.CharField())


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    mfa_code = serializers.CharField(required=False, write_only=True, allow_blank=True)
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["email"] = user.email
        return token

    def validate(self, attrs):
        # Authenticate only; tokens are issued after MFA, bound to a new session.
        data = TokenObtainSerializer.validate(self, attrs)
        mfa = UserMFA.objects.filter(user=self.user, is_enabled=True).first()
        if mfa and mfa.method == UserMFA.Method.EMAIL_OTP:
            code = str(attrs.get("mfa_code", "")).strip()
            if not code:
                try:
                    challenge = issue_email_otp(self.user)
                except EmailOTPDeliveryError as exc:
                    raise AuthenticationFailed(str(exc), code="email_otp_unavailable")
                raise EmailOTPRequired({
                    "detail": "Enter the verification code sent to your email.",
                    "destination": mask_email(self.user.email),
                    "resend_available_in": email_otp_resend_wait(challenge),
                })
            if not consume_email_otp(self.user, code):
                raise AuthenticationFailed("The email verification code is invalid or expired.", code="email_otp_invalid")
        elif mfa and not verify_totp(mfa.secret, attrs.get("mfa_code", "")):
            raise MFARequired("Enter the six-digit authenticator code to continue.")
        from apps.accounts.sessions import start_session

        refresh = start_session(self.user, self.context.get("request"))
        data["refresh"] = str(refresh)
        data["access"] = str(refresh.access_token)
        if jwt_settings.UPDATE_LAST_LOGIN:
            update_last_login(None, self.user)
        data["user"] = UserSerializer(self.user).data
        return data


class SessionTokenRefreshSerializer(TokenRefreshSerializer):
    """Refuses refresh tokens of a revoked session and records the session as seen."""

    def validate(self, attrs):
        from apps.accounts.models import UserSession
        from apps.accounts.sessions import SESSION_CLAIM

        sid = RefreshToken(attrs["refresh"]).get(SESSION_CLAIM)
        if sid:
            updated = UserSession.objects.filter(pk=sid, revoked_at__isnull=True).update(last_seen_at=timezone.now())
            if not updated:
                raise InvalidToken({"detail": "This session has been signed out.", "code": "session_revoked"})
        return super().validate(attrs)


class MFASetupSerializer(serializers.Serializer):
    code = serializers.RegexField(regex=r"^\d{6}$", required=False)

    def validate_code(self, value):
        mfa = UserMFA.objects.filter(user=self.context["request"].user).first()
        if not mfa or not verify_totp(mfa.secret, value):
            raise serializers.ValidationError("The authenticator code is invalid or expired.")
        return value


class SelfServiceRegistrationSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    institution_name = serializers.CharField(max_length=255)
    country_code = serializers.CharField(max_length=2, required=False, default="GH")
    default_currency = serializers.CharField(max_length=3, required=False, default="GHS")
    timezone = serializers.CharField(max_length=64, required=False, default="Africa/Accra")

    def validate_email(self, value):
        email = User.objects.normalize_email(value).lower()
        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError("An account with this email already exists. Sign in instead.")
        return email

    def validate_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages)) from error
        return value

    def validate_institution_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Institution name is required.")
        return value


class InstitutionAdminInvitationCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    expires_in_hours = serializers.IntegerField(required=False, default=168, min_value=1, max_value=720)

    def validate_email(self, value):
        email = User.objects.normalize_email(value).lower()
        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError("This email already has an ErgonX account.")
        return email


class InstitutionAdminInvitationSerializer(serializers.ModelSerializer):
    invited_by_email = serializers.EmailField(source="invited_by.email", read_only=True)
    institution_id = serializers.UUIDField(read_only=True, allow_null=True)
    institution_name = serializers.CharField(source="institution.name", read_only=True, allow_null=True)

    class Meta:
        model = InstitutionAdminInvitation
        fields = ("id", "email", "status", "expires_at", "accepted_at", "invited_by_email", "institution_id", "institution_name", "created_at")
        read_only_fields = fields


class InstitutionAdminInvitationAcceptanceSerializer(SelfServiceRegistrationSerializer):
    """Invitees establish their tenant and the first administrator account."""

    email = serializers.EmailField(read_only=True)
    institution_type = serializers.ChoiceField(choices=Institution.InstitutionType.choices)
    country_code = serializers.CharField(max_length=2)
    employee_size = serializers.ChoiceField(choices=("1-50", "51-200", "201-1000", "1000+"), required=False, allow_blank=True, default="")
    website = serializers.URLField(max_length=255, required=False, allow_blank=True, default="")
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    accepted_terms = serializers.BooleanField()

    def validate_country_code(self, value):
        value = value.strip().upper()
        if len(value) != 2 or not value.isalpha():
            raise serializers.ValidationError("Choose a country.")
        return value

    def validate_accepted_terms(self, value):
        if value is not True:
            raise serializers.ValidationError("Agree to the Terms of Service and Privacy Policy to continue.")
        return value


class InstitutionAccessRequestCreateSerializer(serializers.ModelSerializer):
    """Public Get Started form. ``website`` is a honeypot real visitors never see."""

    website = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = InstitutionAccessRequest
        fields = ("institution_name", "contact_name", "job_title", "email", "phone", "country_code", "organization_size", "institution_type", "website_url", "accepted_terms", "message", "website")
        extra_kwargs = {"message": {"max_length": 2000}}

    institution_type = serializers.ChoiceField(choices=Institution.InstitutionType.choices, required=False, allow_blank=True, default="")
    # Not required, so earlier API clients keep working; when sent it must be true.
    accepted_terms = serializers.BooleanField(required=False, write_only=True)

    def validate_accepted_terms(self, value):
        if value is not True:
            raise serializers.ValidationError("Agree to the Terms of Service and Privacy Policy to continue.")
        return value

    def validate_email(self, value):
        return User.objects.normalize_email(value).lower()

    def validate_country_code(self, value):
        value = value.strip().upper()
        if len(value) != 2 or not value.isalpha():
            raise serializers.ValidationError("Use a two-letter country code.")
        return value

    def validate(self, attrs):
        for field in ("institution_name", "contact_name", "job_title", "phone", "message"):
            if field in attrs:
                attrs[field] = attrs[field].strip()
        if not attrs.get("institution_name"):
            raise serializers.ValidationError({"institution_name": "Organization name is required."})
        if not attrs.get("contact_name"):
            raise serializers.ValidationError({"contact_name": "Your name is required."})
        return attrs


class InstitutionAccessRequestSerializer(serializers.ModelSerializer):
    reviewed_by_email = serializers.EmailField(source="reviewed_by.email", read_only=True, default=None)
    has_account = serializers.SerializerMethodField()

    class Meta:
        model = InstitutionAccessRequest
        fields = (
            "id", "institution_name", "contact_name", "job_title", "email", "phone", "country_code",
            "organization_size", "institution_type", "website_url", "terms_accepted_at", "message", "status", "reviewed_by_email", "reviewed_at", "decline_reason",
            "invitation", "has_account", "created_at",
        )
        read_only_fields = fields

    def get_has_account(self, obj) -> bool:
        return obj.email in self.context.get("existing_emails", set())


class InstitutionAccessRequestApproveSerializer(serializers.Serializer):
    expires_in_hours = serializers.IntegerField(required=False, default=168, min_value=1, max_value=720)


class InstitutionAccessRequestDeclineSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")


class AccountProfileSerializer(serializers.ModelSerializer):
    """Authenticated account profile; users may update only their own identity."""

    class Meta:
        model = User
        fields = ("email", "first_name", "last_name")

    def validate_email(self, value):
        email = User.objects.normalize_email(value).lower()
        if User.objects.exclude(pk=self.instance.pk).filter(email=email).exists():
            raise serializers.ValidationError("This email address is already in use.")
        return email


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Your current password is incorrect.")
        return value

    def validate_new_password(self, value):
        try:
            validate_password(value, self.context["request"].user)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages)) from error
        return value


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        return User.objects.normalize_email(value).lower()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_new_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages)) from error
        return value
