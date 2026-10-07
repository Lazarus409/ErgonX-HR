import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import unquote, urlparse

from corsheaders.defaults import default_headers
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[2]
# Local development settings come from the ignored project `.env` file. Existing
# process environment variables take precedence, which keeps container and
# production deployments explicitly configured by their runtime environment.
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY", "unsafe-development-only-key-change-before-production"
)
DEBUG = False

# ErgonX HR edition: modules this product does not offer. They can never be
# enabled for an institution and their API routes are not mounted.
ERGONX_EXCLUDED_MODULES = frozenset(
    code.strip().upper()
    for code in os.environ.get("ERGONX_EXCLUDED_MODULES", "PAYROLL,ACCOUNTING").split(",")
    if code.strip()
)
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]
THIRD_PARTY_APPS = [
    "corsheaders",
    "django_filters",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
]
LOCAL_APPS = [
    "apps.accounts.apps.AccountsConfig",
    "apps.institutions.apps.InstitutionsConfig",
    "apps.organization.apps.OrganizationConfig",
    "apps.employees.apps.EmployeesConfig",
    "apps.audit.apps.AuditConfig",
    "apps.documents.apps.DocumentsConfig",
    "apps.workflows.apps.WorkflowsConfig",
    "apps.notifications.apps.NotificationsConfig",
    "apps.operations.apps.OperationsConfig",
    "apps.leave.apps.LeaveConfig",
    "apps.scheduling.apps.SchedulingConfig",
    "apps.attendance.apps.AttendanceConfig",
    "apps.compensation.apps.CompensationConfig",
    "apps.payroll.apps.PayrollConfig",
    "apps.accounting.apps.AccountingConfig",
    "apps.dashboards.apps.DashboardsConfig",
    "apps.reports.apps.ReportsConfig",
    "apps.recruitment.apps.RecruitmentConfig",
]
INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "common.security.ApiContentSecurityPolicyMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.audit.middleware.AuditRequestContextMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "ergonx"),
        "USER": os.environ.get("POSTGRES_USER", "ergonx"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "ergonx"),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": int(os.environ.get("POSTGRES_CONN_MAX_AGE", "60")),
        "OPTIONS": {"connect_timeout": int(os.environ.get("POSTGRES_CONNECT_TIMEOUT", "5"))},
    }
}

# Managed platforms such as Render provide a private PostgreSQL connection URL.
# Keep the individual POSTGRES_* settings as the local Docker fallback.
database_url = os.environ.get("DATABASE_URL")
if database_url:
    parsed_database_url = urlparse(database_url)
    if parsed_database_url.scheme not in {"postgres", "postgresql"} or not parsed_database_url.hostname:
        raise ImproperlyConfigured("DATABASE_URL must be a valid PostgreSQL URL")
    DATABASES["default"] = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(parsed_database_url.path.lstrip("/")),
        "USER": unquote(parsed_database_url.username or ""),
        "PASSWORD": unquote(parsed_database_url.password or ""),
        "HOST": parsed_database_url.hostname,
        "PORT": str(parsed_database_url.port or 5432),
        "CONN_MAX_AGE": int(os.environ.get("POSTGRES_CONN_MAX_AGE", "60")),
        "OPTIONS": {"connect_timeout": int(os.environ.get("POSTGRES_CONNECT_TIMEOUT", "5"))},
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
DOCUMENT_UPLOAD_MAX_BYTES = int(os.environ.get("DOCUMENT_UPLOAD_MAX_MB", "25")) * 1024 * 1024
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.accounts.authentication.SessionJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_RENDERER_CLASSES": ("common.renderers.EnvelopeJSONRenderer",),
    "EXCEPTION_HANDLER": "common.exceptions.api_exception_handler",
    "DEFAULT_PAGINATION_CLASS": "common.pagination.StandardPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_SCHEMA_CLASS": "common.schema.ErgonXAutoSchema",
    "DEFAULT_VERSIONING_CLASS": "rest_framework.versioning.NamespaceVersioning",
    "DEFAULT_VERSION": "v1",
    "ALLOWED_VERSIONS": ("v1",),
    "VERSION_PARAM": "version",
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=int(os.environ.get("JWT_ACCESS_MINUTES", "15"))
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        days=int(os.environ.get("JWT_REFRESH_DAYS", "7"))
    ),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "ErgonX API",
    "DESCRIPTION": "Tenant-aware ErgonX backend foundation",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "POSTPROCESSING_HOOKS": ("common.schema.envelope_responses",),
}

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS", "http://localhost:3000"
    ).split(",")
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = os.environ.get("CORS_ALLOW_CREDENTIALS", "false").lower() == "true"
CORS_ALLOW_HEADERS = (*default_headers, "x-institution-id")

# Outbound email remains disabled until SMTP has been explicitly configured.
# This prevents local/demo environments from accidentally sending real emails.
# Shared with the Next.js BFF, which forwards the browser's IP in
# X-ErgonX-Client-IP together with this secret. Empty disables per-IP sign-in limits.
BFF_PROXY_SECRET = os.environ.get("BFF_PROXY_SECRET", "")

EMAIL_DELIVERY_ENABLED = os.environ.get("EMAIL_DELIVERY_ENABLED", "false").lower() == "true"
EMAIL_BACKEND = os.environ.get(
    "EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend"
)
# Used only by django.core.mail.backends.filebased.EmailBackend (local development).
EMAIL_FILE_PATH = os.environ.get("EMAIL_FILE_PATH", str(BASE_DIR / "media" / "dev-mail"))
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "true").lower() == "true"
EMAIL_USE_SSL = os.environ.get("EMAIL_USE_SSL", "false").lower() == "true"
EMAIL_TIMEOUT = int(os.environ.get("EMAIL_TIMEOUT", "15"))
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "ErgonX <no-reply@ergonx.local>")
SERVER_EMAIL = DEFAULT_FROM_EMAIL
FRONTEND_PUBLIC_URL = os.environ.get("FRONTEND_PUBLIC_URL", "http://localhost:3000").rstrip("/")
# Anonymous Get Started access requests allowed per client address.
INSTITUTION_ACCESS_REQUEST_RATE = os.environ.get("INSTITUTION_ACCESS_REQUEST_RATE", "5/hour")
