from copy import deepcopy

from drf_spectacular.openapi import AutoSchema

from common.exceptions import API_ERROR_CODES


ERROR_RESPONSE_CODES = {
    "400": "Validation or business-rule failure; inspect code and errors.",
    "401": "Authentication is missing or invalid.",
    "403": "Tenant context, module enablement, or permission denied.",
    "404": "Resource not found in the caller's permitted scope.",
}


class ErgonXAutoSchema(AutoSchema):
    """Provide useful operation text and tenant access context by default."""

    ACTION_VERBS = {
        "list": "List",
        "retrieve": "Retrieve",
        "create": "Create",
        "update": "Update",
        "partial_update": "Update",
        "destroy": "Delete",
    }

    def _resource_names(self):
        model = getattr(self.view, "model", None)
        if model is None:
            queryset = getattr(self.view, "queryset", None)
            model = getattr(queryset, "model", None)
        if model is not None:
            return str(model._meta.verbose_name), str(model._meta.verbose_name_plural)
        fallback = self.view.__class__.__name__.removesuffix("ViewSet")
        words = "".join(
            f" {character}" if character.isupper() else character
            for character in fallback
        )
        singular = words.strip().lower() or "resource"
        return singular, f"{singular}s"

    def get_summary(self):
        action = getattr(self.view, "action", self.method.lower())
        configured = getattr(self.view, "schema_action_summaries", {}).get(action)
        if configured:
            return configured
        singular, plural = self._resource_names()
        verb = self.ACTION_VERBS.get(action)
        if verb:
            resource = plural if action == "list" else singular
            return f"{verb} {resource}"
        return f"{action.replace('_', ' ').capitalize()} {singular}"

    def _error_codes(self, action, is_tenant_endpoint):
        codes = []
        if is_tenant_endpoint:
            codes.extend(
                (
                    "authentication_required",
                    "authentication_failed",
                    "tenant_mismatch",
                    "module_disabled",
                    "permission_denied",
                )
            )
        if "{" in self.path:
            codes.append("not_found")
        if self.method in {"POST", "PUT", "PATCH"}:
            codes.append("validation_error")
        codes.extend(
            getattr(self.view, "schema_action_error_codes", {}).get(action, ())
        )
        return tuple(dict.fromkeys(codes))

    def get_description(self):
        action = getattr(self.view, "action", self.method.lower())
        configured = getattr(self.view, "schema_action_descriptions", {}).get(action)
        purpose = configured or super().get_description() or f"{self.get_summary()}."
        if not purpose.endswith((".", "!", "?")):
            purpose = f"{purpose}."

        permission_classes = getattr(self.view, "permission_classes", ())
        is_tenant_endpoint = any(
            permission.__name__ == "TenantContextPermission"
            for permission in permission_classes
        )
        if not is_tenant_endpoint:
            return purpose

        requirements = ["an authenticated user", "an active institution context"]
        required_module = getattr(self.view, "required_module", None)
        if required_module:
            requirements.append(f"the `{required_module}` module enabled")
        permission_code = None
        get_required_permission = getattr(self.view, "get_required_permission", None)
        if get_required_permission:
            try:
                permission_code = get_required_permission()
            except (AttributeError, TypeError):
                permission_code = None
        if permission_code:
            requirements.append(f"the `{permission_code}` permission")

        access = "Requires " + ", ".join(requirements) + "."
        scope = getattr(
            self.view,
            "schema_scope_description",
            "Tenant-owned results are scoped to the active institution.",
        )
        error_codes = self._error_codes(action, is_tenant_endpoint)
        errors = "Documented error codes: " + ", ".join(
            f"`{code}`" for code in error_codes
        ) + "."
        return "\n\n".join((purpose, access, scope, errors))

    def get_operation(self, path, path_regex, path_prefix, method, registry):
        operation = super().get_operation(
            path,
            path_regex,
            path_prefix,
            method,
            registry,
        )
        if operation is None:
            return None
        action = getattr(self.view, "action", method.lower())
        permission_classes = getattr(self.view, "permission_classes", ())
        is_tenant_endpoint = any(
            permission.__name__ == "TenantContextPermission"
            for permission in permission_classes
        )
        error_codes = self._error_codes(action, is_tenant_endpoint)
        if error_codes:
            operation["x-error-codes"] = list(error_codes)
        return operation


def _success_envelope(data_schema):
    return {
        "type": "object",
        "required": ["success", "data", "message", "errors"],
        "properties": {
            "success": {"type": "boolean", "enum": [True]},
            "data": deepcopy(data_schema),
            "message": {"type": "string"},
            "errors": {"type": "object", "nullable": True, "additionalProperties": True},
        },
    }


def _error_response(description):
    return {
        "description": description,
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/ErrorEnvelope"}
            }
        },
    }


def envelope_responses(result, generator, request, public):
    """Make OpenAPI match the JSON envelope applied by EnvelopeJSONRenderer."""
    schemas = result.setdefault("components", {}).setdefault("schemas", {})
    schemas["ErrorEnvelope"] = {
        "type": "object",
        "required": ["success", "data", "message", "code", "errors"],
        "properties": {
            "success": {"type": "boolean", "enum": [False]},
            "data": {"type": "object", "nullable": True},
            "message": {"type": "string"},
            "code": {
                "type": "string",
                "description": "Stable machine-readable error code.",
                "enum": list(API_ERROR_CODES),
                "example": "validation_error",
            },
            "errors": {"type": "object", "nullable": True, "additionalProperties": True},
        },
        "example": {
            "success": False,
            "data": None,
            "message": "The PAYROLL module is disabled.",
            "code": "module_disabled",
            "errors": {"detail": "The PAYROLL module is disabled."},
        },
    }

    for path, path_item in result.get("paths", {}).items():
        if path.endswith("/schema/") or path.endswith("/docs/"):
            continue
        is_detail = "{" in path
        for method, operation in path_item.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            responses = operation.setdefault("responses", {})
            for status_code, response in list(responses.items()):
                if not str(status_code).startswith("2") or str(status_code) == "204":
                    continue
                media = response.get("content", {}).get("application/json")
                if media and "schema" in media:
                    media["schema"] = _success_envelope(media["schema"])

            declared_error_codes = set(operation.get("x-error-codes", ()))
            if method.lower() in {"post", "put", "patch"} or "validation_error" in declared_error_codes:
                responses.setdefault("400", _error_response(ERROR_RESPONSE_CODES["400"]))
            if operation.get("security"):
                responses.setdefault("401", _error_response(ERROR_RESPONSE_CODES["401"]))
                responses.setdefault("403", _error_response(ERROR_RESPONSE_CODES["403"]))
            if is_detail or "not_found" in declared_error_codes:
                responses.setdefault("404", _error_response(ERROR_RESPONSE_CODES["404"]))
    return result
