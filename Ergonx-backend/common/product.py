"""What this product edition offers, derived from settings.ERGONX_EXCLUDED_MODULES.

The ErgonX HR edition excludes Payroll and Accounting. Their permissions and the
finance-only system roles stay in the database (the code is shared with the full
ERP) but are left out of every catalogue and role listing shown to users.
"""

from django.conf import settings
from django.db.models import Q

# System roles that only exist for the payroll and finance modules.
FINANCE_ROLE_CODES = frozenset({"FINANCE_MANAGER", "ACCOUNTANT"})
# Core HR permissions that only open a payroll or finance dashboard.
MODULE_DASHBOARD_PERMISSIONS = {"PAYROLL": "dashboard.payroll.view", "ACCOUNTING": "dashboard.finance.view"}


def excluded_modules():
    return settings.ERGONX_EXCLUDED_MODULES


def excluded_role_codes():
    return FINANCE_ROLE_CODES if {"PAYROLL", "ACCOUNTING"} <= excluded_modules() else frozenset()


def excluded_permission_codes_q():
    """Q matching permissions that belong to an excluded module."""
    excluded = excluded_modules()
    return Q(module_code__in=excluded) | Q(code__in=[code for module, code in MODULE_DASHBOARD_PERMISSIONS.items() if module in excluded])


_hidden_permission_codes = None


def hidden_permission_codes(permission_model):
    """Codes of excluded-module permissions; the catalogue is fixed by migrations, so it is read once."""
    global _hidden_permission_codes
    if _hidden_permission_codes is None:
        _hidden_permission_codes = frozenset(permission_model.objects.filter(excluded_permission_codes_q()).values_list("code", flat=True))
    return _hidden_permission_codes


def offered_permission_codes(codes, permission_model):
    """Filter permission codes down to those this edition offers."""
    hidden = hidden_permission_codes(permission_model)
    return [code for code in codes if code not in hidden]
