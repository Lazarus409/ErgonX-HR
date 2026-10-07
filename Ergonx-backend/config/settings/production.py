import os

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403


if SECRET_KEY == "unsafe-development-only-key-change-before-production":  # noqa: F405
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set in production")
if not os.environ.get("DJANGO_ALLOWED_HOSTS"):
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must be set in production")
if not os.environ.get("CORS_ALLOWED_ORIGINS"):
    raise ImproperlyConfigured("CORS_ALLOWED_ORIGINS must be set in production")
if os.environ.get("EMAIL_DELIVERY_ENABLED", "false").lower() == "true":
    required_email_settings = ("EMAIL_HOST", "EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD", "DEFAULT_FROM_EMAIL", "FRONTEND_PUBLIC_URL")
    missing_email_settings = [name for name in required_email_settings if not os.environ.get(name)]
    if missing_email_settings:
        raise ImproperlyConfigured(
            f"Email delivery is enabled but missing: {', '.join(missing_email_settings)}"
        )

DEBUG = False
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_SECURE_HSTS_SECONDS", "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
