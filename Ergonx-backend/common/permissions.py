from uuid import UUID

from django.conf import settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

SELF_SERVICE_ACTIONS = frozenset({
    "home.view",
    "settings.profile.manage_self",
    "leave.request",
    "attendance.clock",
    "attendance.adjust",
    "tax_relief.claim",
})


class TenantContextPermission(BasePermission):
    message = "An active institution membership is required."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        memberships = request.user.memberships.filter(status="ACTIVE").select_related(
            "institution", "role"
        )
        requested_id = request.headers.get("X-Institution-ID")
        if requested_id:
            try:
                requested_id = UUID(requested_id)
            except (TypeError, ValueError):
                raise PermissionDenied(
                    "Invalid institution selector.", code="tenant_mismatch"
                )
            membership = memberships.filter(institution_id=requested_id).first()
            if membership is None:
                raise PermissionDenied(
                    "No active membership for the selected institution.",
                    code="tenant_mismatch",
                )
        else:
            membership = memberships.filter(is_primary=True).first()
            if membership is None:
                candidates = list(memberships[:2])
                if len(candidates) != 1:
                    raise PermissionDenied(
                        "Select an institution using X-Institution-ID from your memberships.",
                        code="tenant_mismatch",
                    )
                membership = candidates[0]

        if not membership.institution.is_active:
            raise PermissionDenied(
                "This organization has been suspended. Contact ErgonX support to restore access.",
                code="institution_suspended",
            )

        request.membership = membership
        request.institution = membership.institution
        return True


class TenantRBACPermission(BasePermission):
    def has_permission(self, request, view):
        institution = getattr(request, "institution", None)
        membership = getattr(request, "membership", None)
        if institution is None or membership is None:
            return False

        required_module = getattr(view, "required_module", None)
        if required_module in settings.ERGONX_EXCLUDED_MODULES:
            raise PermissionDenied(
                f"The {required_module} module is not part of this product.", code="module_not_available"
            )
        if required_module and not institution.modules.filter(
            module_code=required_module, is_enabled=True
        ).exists():
            raise PermissionDenied(
                f"The {required_module} module is disabled.", code="module_disabled"
            )

        permission_code = view.get_required_permission()
        if (
            request.method not in SAFE_METHODS
            # Read-only roles (Role.is_read_only) may only use self-service writes.
            and membership.role.is_read_only
            and permission_code not in SELF_SERVICE_ACTIONS
        ):
            raise PermissionDenied("Your role has read-only access.", code="read_only_role")
        if permission_code is None:
            return True
        if membership.role.permissions.filter(code=permission_code).exists():
            return True
        raise PermissionDenied("Your institution role does not grant this permission.")
