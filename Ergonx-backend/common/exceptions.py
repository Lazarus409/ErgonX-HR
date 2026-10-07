from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework.exceptions import (
    AuthenticationFailed,
    MethodNotAllowed,
    NotAuthenticated,
    NotFound,
    ParseError,
    PermissionDenied,
    Throttled,
    UnsupportedMediaType,
    ValidationError,
)
from rest_framework.views import exception_handler
from rest_framework.response import Response


API_ERROR_CODES = (
    "authentication_required",
    "authentication_failed",
    "permission_denied",
    "module_disabled",
    "tenant_mismatch",
    "invalid_state_transition",
    "record_immutable",
    "period_closed",
    "duplicate_operation",
    "insufficient_leave_balance",
    "policy_not_applicable",
    "unbalanced_journal",
    "last_required_admin",
    "role_protected",
    "permission_not_delegable",
    "membership_inactive",
    "onboarding_incomplete",
    "search_query_invalid",
    "validation_error",
    "invalid_request",
    "not_found",
    "method_not_allowed",
    "unsupported_media_type",
    "throttled",
    "api_error",
)


class CodedValidationError(DjangoValidationError):
    """Domain validation failure with a stable public API error code."""

    def __init__(self, message, *, api_code, params=None):
        self.api_code = api_code
        super().__init__(message, code=api_code, params=params)


def _api_error_code(exc):
    explicit_code = getattr(exc, "api_code", None)
    if explicit_code:
        return explicit_code
    if isinstance(exc, NotAuthenticated):
        return "authentication_required"
    if isinstance(exc, AuthenticationFailed):
        return "authentication_failed"
    if isinstance(exc, PermissionDenied):
        code = exc.get_codes()
        return code if isinstance(code, str) else "permission_denied"
    if isinstance(exc, DjangoPermissionDenied):
        return "permission_denied"
    if isinstance(exc, (NotFound, Http404)):
        return "not_found"
    if isinstance(exc, MethodNotAllowed):
        return "method_not_allowed"
    if isinstance(exc, UnsupportedMediaType):
        return "unsupported_media_type"
    if isinstance(exc, ParseError):
        return "invalid_request"
    if isinstance(exc, Throttled):
        return "throttled"
    if isinstance(exc, ValidationError):
        return "validation_error"
    return "api_error"


def _first_error_message(value):
    if isinstance(value, dict):
        for item in value.values():
            message = _first_error_message(item)
            if message:
                return message
        return None
    if isinstance(value, (list, tuple)):
        return _first_error_message(value[0]) if value else None
    return str(value) if value is not None else None


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None and isinstance(exc, CodedValidationError):
        response = Response(exc.message_dict if hasattr(exc, "message_dict") else {"detail": exc.messages}, status=400)
    if response is None:
        return None

    errors = response.data
    if isinstance(errors, dict) and "detail" in errors:
        message = str(errors["detail"])
    else:
        message = _first_error_message(errors) or "The request could not be completed."
    response.data = {
        "success": False,
        "data": None,
        "message": message,
        "code": _api_error_code(exc),
        "errors": errors,
    }
    return response
